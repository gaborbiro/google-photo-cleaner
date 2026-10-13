package dev.photocleaner.features.duplicates.usecase

import dev.photocleaner.features.duplicates.model.MemberRole
import dev.photocleaner.features.shared.embeddings.EmbeddingSettings
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.analysis.SqlAnalysisRepository
import dev.photocleaner.repositories.analysis.domain.PhotoInfo
import dev.photocleaner.repositories.analysis.domain.StoredEmbedding
import dev.photocleaner.repositories.analysis.domain.StoredQuality
import dev.photocleaner.repositories.inventory.SqlInventoryRepository
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import dev.photocleaner.repositories.review.SqlReviewRepository
import dev.photocleaner.repositories.review.domain.DecisionKind
import kotlin.math.cos
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

/** Decisions survive rescans: a decided moment only returns for photos never decided on. */
class LoadReviewQueueUseCaseTest {

    private val now = 5_000_000_000L
    private val inventory = SqlInventoryRepository.inMemory()
    private val analysis = SqlAnalysisRepository.inMemory()
    private val review = SqlReviewRepository.inMemory()
    private val modelId = EmbeddingSettings.modelKey(280).id
    private val queue = LoadReviewQueueUseCase(BuildDuplicateGroupsUseCase(ClassifyInventoryUseCase(inventory, { now }), analysis), review)
    private val decide = DecideGroupUseCase(review) { now }

    /** One moment: photos a few seconds apart that look alike (angles a few degrees apart). */
    private val moment = mapOf("a" to (1_000L to 0.0), "b" to (3_000L to 3.0), "c" to (5_000L to 6.0), "d" to (7_000L to 4.0))

    /** A library scan that finds exactly [keys]. */
    private suspend fun scan(vararg keys: String) {
        val run = inventory.createRun("account-a", now)
        inventory.saveLibraryPage(run.id, keys.map { InventoryItem(it, "d-$it", moment.getValue(it).first, StoredMediaType.PHOTO, false, false, true, 4000, 3000, null) }, null)
        inventory.saveFavouritesPage(run.id, emptyList(), null)
        inventory.saveArchivePage(run.id, emptyList(), null)
        inventory.saveAlbumsPage(run.id, emptyList(), null)
        inventory.updateRunStatus(run.id, RunStatus.COMPLETED, null, now)
        inventory.deleteOtherRuns(run.id)
        analysis.save(keys.map {
            val radians = Math.toRadians(moment.getValue(it).second)
            StoredEmbedding(it, "d-$it", modelId, floatArrayOf(cos(radians).toFloat(), sin(radians).toFloat()), StoredQuality(100.0, 120.0, 0.0, 0.0, 512, 384), now)
        })
        analysis.savePhotoInfo(keys.map { PhotoInfo(it, 1_000, 4000, 3000) })
    }

    @Test
    fun `a decided moment that gains a photo comes back with only the newcomer undecided`() = runTest {
        scan("a", "b", "c")
        decide.execute(queue.execute().pending.single(), DecisionKind.KEPT, emptySet())
        assertTrue(queue.execute().pending.isEmpty())

        scan("a", "b", "c", "d")
        val returning = queue.execute().pending.single()
        assertEquals(setOf("a", "b", "c", "d"), returning.members.map { it.photo.item.mediaKey }.toSet())
        assertEquals(setOf("d"), returning.members.filter { !it.previouslyReviewed }.map { it.photo.item.mediaKey }.toSet())
    }

    @Test
    fun `a decided moment that only lost a photo does not come back`() = runTest {
        scan("a", "b", "c")
        decide.execute(queue.execute().pending.single(), DecisionKind.KEPT, emptySet())

        // As after really trashing a photo elsewhere: the group changes, but holds nothing new.
        scan("b", "c")
        assertTrue(queue.execute().pending.isEmpty())
    }

    @Test
    fun `a fresh group marks nothing as decided before`() = runTest {
        scan("a", "b", "c")
        val group = queue.execute().pending.single()
        assertTrue(group.members.none { it.previouslyReviewed })
        assertTrue(group.members.any { it.role == MemberRole.PROPOSED })
    }

    @Test
    fun `skipping a moment decides nothing about its photos`() = runTest {
        scan("a", "b", "c")
        decide.execute(queue.execute().pending.single(), DecisionKind.DEFERRED, emptySet())

        scan("a", "b", "c", "d")
        val group = queue.execute().pending.first()
        assertTrue(group.members.none { it.previouslyReviewed })
    }
}
