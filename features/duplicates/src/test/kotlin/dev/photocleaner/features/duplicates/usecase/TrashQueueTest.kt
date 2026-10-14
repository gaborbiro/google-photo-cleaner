package dev.photocleaner.features.duplicates.usecase

import dev.photocleaner.features.shared.duplicates.model.DuplicateGroup
import dev.photocleaner.features.shared.duplicates.selectableMembers
import dev.photocleaner.features.shared.duplicates.model.GroupMember
import dev.photocleaner.features.shared.duplicates.model.MemberRole
import dev.photocleaner.features.shared.duplicates.model.PhotoFacts
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.inventory.SqlInventoryRepository
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import dev.photocleaner.repositories.review.SqlReviewRepository
import dev.photocleaner.repositories.review.domain.DecisionKind
import dev.photocleaner.repositories.review.domain.TrashJobState
import dev.photocleaner.services.trash.SimulatedTrashService
import java.nio.file.Files
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest

class TrashQueueTest {

    private var now = 1_000_000_000L
    private val inventory = SqlInventoryRepository.inMemory()
    private val review = SqlReviewRepository.inMemory()
    private val trashFile = Files.createTempDirectory("trash").resolve("simulated-trash.txt")
    private var trash = SimulatedTrashService(trashFile, latencyMs = 0)
    private val classify = ClassifyInventoryUseCase(inventory, { now })
    private val decide = DecideGroupUseCase(review) { now }

    private fun item(key: String) = InventoryItem(key, "d-$key", 1_000, StoredMediaType.PHOTO, false, false, true, 1, 1, null)

    /** A completed inventory in which [favourites] are protected and everything else is eligible. */
    private suspend fun scan(keys: List<String>, favourites: Set<String> = emptySet()) {
        val run = inventory.createRun("account-a", now)
        inventory.saveLibraryPage(run.id, keys.map { item(it).copy(isFavourite = it in favourites) }, null)
        inventory.saveFavouritesPage(run.id, emptyList(), null)
        inventory.saveArchivePage(run.id, emptyList(), null)
        inventory.saveAlbumsPage(run.id, emptyList(), null)
        inventory.updateRunStatus(run.id, RunStatus.COMPLETED, null, now)
    }

    private fun group(id: String, keeper: String, proposed: List<String>) = DuplicateGroup(
        id = id,
        members = listOf(member(keeper, MemberRole.KEEPER)) + proposed.map { member(it, MemberRole.PROPOSED) },
        takenAtMs = 1_000,
    )

    private fun member(key: String, role: MemberRole) =
        GroupMember(PhotoFacts(item(key), Eligibility.ELIGIBLE, emptySet(), 1.0, 0.0, 1, 1), role, 0.97, emptyList())

    /** One pass of the background worker, as after an app start. */
    private suspend fun runQueueOnce() = ProcessTrashQueueUseCase(review, trash, classify, { now }, idleMs = 0).execute().take(1).toList().single()

    private suspend fun states() = review.jobs(TrashJobState.entries.toSet()).associate { it.mediaKey to it.state }

    @Test
    fun `an approval trashes exactly the selected photos`() = runTest {
        scan(listOf("k", "a", "b", "c"))
        decide.execute(group("g", "k", listOf("a", "b", "c")), DecisionKind.APPROVED, setOf("a", "c"))
        val status = runQueueOnce()
        assertEquals(mapOf("a" to TrashJobState.COMPLETED, "c" to TrashJobState.COMPLETED), states())
        assertEquals(mapOf("d-a" to true, "d-b" to false, "d-c" to true, "d-k" to false), trash.inTrash(listOf("d-a", "d-b", "d-c", "d-k")))
        assertTrue(status.simulated)
    }

    @Test
    fun `photos outside the group cannot be approved, and approving nothing is refused`() = runTest {
        scan(listOf("k", "a", "x"))
        val g = group("g", "k", listOf("a"))
        // Keeper eligibility is covered by the "delete all" test; here: nothing from outside the group.
        assertFailsWith<IllegalArgumentException> { decide.execute(g, DecisionKind.APPROVED, setOf("a", "x")) }
        assertFailsWith<IllegalArgumentException> { decide.execute(g, DecisionKind.APPROVED, emptySet()) }
        assertEquals(emptyMap(), states())
    }

    @Test
    fun `delete all can include an eligible keeper but never a protected or unknown photo`() = runTest {
        scan(listOf("k", "a", "p"))
        val withReference = DuplicateGroup(
            id = "g",
            members = listOf(
                member("k", MemberRole.KEEPER),
                member("a", MemberRole.PROPOSED),
                GroupMember(PhotoFacts(item("p"), Eligibility.PROTECTED, emptySet(), 1.0, 0.0, 1, 1), MemberRole.REFERENCE, 0.97, emptyList()),
            ),
            takenAtMs = 1_000,
        )
        assertEquals(setOf("k", "a"), withReference.selectableMembers().map { it.photo.item.mediaKey }.toSet())
        assertFailsWith<IllegalArgumentException> { decide.execute(withReference, DecisionKind.APPROVED, setOf("k", "a", "p")) }

        decide.execute(withReference, DecisionKind.APPROVED, setOf("k", "a"))
        runQueueOnce()
        assertEquals(mapOf("k" to TrashJobState.COMPLETED, "a" to TrashJobState.COMPLETED), states())

        val protectedKeeper = DuplicateGroup(
            id = "g2",
            members = listOf(
                GroupMember(PhotoFacts(item("p"), Eligibility.PROTECTED, emptySet(), 1.0, 0.0, 1, 1), MemberRole.KEEPER, 1.0, emptyList()),
                member("a", MemberRole.PROPOSED),
            ),
            takenAtMs = 1_000,
        )
        assertEquals(listOf("a"), protectedKeeper.selectableMembers().map { it.photo.item.mediaKey })
        assertFailsWith<IllegalArgumentException> { decide.execute(protectedKeeper, DecisionKind.APPROVED, setOf("p")) }
    }

    @Test
    fun `a photo that became protected after approval is blocked, not trashed`() = runTest {
        scan(listOf("k", "a", "b"))
        decide.execute(group("g", "k", listOf("a", "b")), DecisionKind.APPROVED, setOf("a", "b"))
        scan(listOf("k", "a", "b"), favourites = setOf("b")) // the user favourited b in Google Photos
        runQueueOnce()
        assertEquals(TrashJobState.COMPLETED, states()["a"])
        assertEquals(TrashJobState.BLOCKED, states()["b"])
        assertEquals(false, trash.inTrash(listOf("d-b"))["d-b"])
    }

    @Test
    fun `undo before sending cancels and nothing is trashed`() = runTest {
        scan(listOf("k", "a"))
        decide.execute(group("g", "k", listOf("a")), DecisionKind.APPROVED, setOf("a"))
        assertNotNull(UndoLastDecisionUseCase(review) { now }.execute())
        runQueueOnce()
        assertEquals(TrashJobState.CANCELLED, states()["a"])
        assertEquals(false, trash.inTrash(listOf("d-a"))["d-a"])
    }

    @Test
    fun `undo after trashing restores the photos`() = runTest {
        scan(listOf("k", "a"))
        decide.execute(group("g", "k", listOf("a")), DecisionKind.APPROVED, setOf("a"))
        runQueueOnce()
        assertEquals(true, trash.inTrash(listOf("d-a"))["d-a"])
        UndoLastDecisionUseCase(review) { now }.execute()
        runQueueOnce()
        assertEquals(TrashJobState.RESTORED, states()["a"])
        assertEquals(false, trash.inTrash(listOf("d-a"))["d-a"])
    }

    @Test
    fun `requests interrupted mid-send are reconciled before any retry`() = runTest {
        scan(listOf("k", "a", "b"))
        decide.execute(group("g", "k", listOf("a", "b")), DecisionKind.APPROVED, setOf("a", "b"))
        val (jobA, jobB) = review.jobs(setOf(TrashJobState.QUEUED))
        // Simulate a crash: both were being sent, but only a reached the trash.
        review.transition(jobA.id, TrashJobState.QUEUED, TrashJobState.SENDING, null, now)
        review.transition(jobB.id, TrashJobState.QUEUED, TrashJobState.SENDING, null, now)
        trash.moveToTrash(listOf(dev.photocleaner.services.trash.domain.TrashTarget("a", "d-a")))

        trash = SimulatedTrashService(trashFile, latencyMs = 0) // the app restarts
        runQueueOnce()
        assertEquals(TrashJobState.COMPLETED, states()["a"])
        assertEquals(1, review.jobs(setOf(TrashJobState.COMPLETED)).single { it.mediaKey == "a" }.attempts, "a was not sent twice")
        runQueueOnce()
        assertEquals(TrashJobState.COMPLETED, states()["b"], "b was re-queued after reconciliation and then sent")
    }

    @Test
    fun `an out-of-date inventory holds the queue`() = runTest {
        scan(listOf("k", "a"))
        decide.execute(group("g", "k", listOf("a")), DecisionKind.APPROVED, setOf("a"))
        now += 25L * 60 * 60 * 1000
        val status = runQueueOnce()
        assertEquals(TrashJobState.QUEUED, states()["a"])
        assertTrue(status.waitingReason!!.contains("out of date"))
    }

    @Test
    fun `failures are recorded per photo`() = runTest {
        trash = SimulatedTrashService(trashFile, latencyMs = 0, failureRate = 1.0, random = Random(1))
        scan(listOf("k", "a"))
        decide.execute(group("g", "k", listOf("a")), DecisionKind.APPROVED, setOf("a"))
        runQueueOnce()
        val job = review.jobs(setOf(TrashJobState.FAILED)).single()
        assertEquals("Simulated failure", job.lastError)
    }

    @Test
    fun `undo brings a kept or deferred group back, and deferred groups come last`() = runTest {
        scan(listOf("k", "a"))
        val g1 = group("g1", "k", listOf("a"))
        decide.execute(g1, DecisionKind.KEPT, emptySet())
        assertEquals(DecisionKind.KEPT, review.activeDecisions().single().kind)
        val undone = UndoLastDecisionUseCase(review) { now }.execute()
        assertEquals("g1", undone?.groupId)
        assertEquals(emptyList(), review.activeDecisions())
        decide.execute(g1, DecisionKind.DEFERRED, emptySet())
        assertEquals(setOf("g1"), review.activeDecisions().filter { it.kind == DecisionKind.DEFERRED }.map { it.groupId }.toSet())
    }
}
