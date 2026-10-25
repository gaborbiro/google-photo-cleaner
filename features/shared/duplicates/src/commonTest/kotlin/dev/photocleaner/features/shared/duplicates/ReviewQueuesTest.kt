package dev.photocleaner.features.shared.duplicates

import dev.photocleaner.features.shared.duplicates.model.DuplicateGroup
import dev.photocleaner.features.shared.duplicates.model.GroupMember
import dev.photocleaner.features.shared.duplicates.model.GroupingSettings
import dev.photocleaner.features.shared.duplicates.model.MemberRole
import dev.photocleaner.features.shared.duplicates.model.PhotoFacts
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import dev.photocleaner.repositories.review.domain.Decision
import dev.photocleaner.repositories.review.domain.DecisionItem
import dev.photocleaner.repositories.review.domain.DecisionKind
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** Decisions survive rescans: a decided moment only returns for photos never decided on. */
class ReviewQueuesTest {

    /** One moment: photos a few seconds apart that look alike (angles a few degrees apart). */
    private val moment = mapOf("a" to (1_000L to 0.0), "b" to (3_000L to 3.0), "c" to (5_000L to 6.0), "d" to (7_000L to 4.0))

    private val decisions = mutableListOf<Decision>()

    /** The queue after a library scan that finds exactly [keys], with the decisions so far. */
    private fun queue(vararg keys: String, favourites: Set<String> = emptySet()): ReviewQueue {
        val specs = keys.map { Spec(it, moment.getValue(it).first, moment.getValue(it).second, favourite = it in favourites) }
        // The repository returns active decisions newest first.
        return ReviewQueues.build(DuplicateGrouper.build(classification(specs), analyses(specs), GroupingSettings()), decisions.reversed())
    }

    private fun decide(group: DuplicateGroup, kind: DecisionKind, selected: Set<String> = emptySet()) {
        decisions += Decision(decisions.size + 1L, group.id, kind, group.decisionItems(kind, selected), group.members.map { it.photo.item.mediaKey }.toSet(), 0, null)
    }

    @Test
    fun a_decided_moment_that_gains_a_photo_comes_back_with_only_the_newcomer_undecided() {
        // Pin the existing keeper so the newcomer is a proposal, rather than a new recommended keeper.
        decide(queue("a", "b", "c", favourites = setOf("a")).pending.single(), DecisionKind.KEPT)
        assertTrue(queue("a", "b", "c", favourites = setOf("a")).pending.isEmpty())

        val returning = queue("a", "b", "c", "d", favourites = setOf("a")).pending.single()
        assertEquals(setOf("a", "b", "c", "d"), returning.members.map { it.photo.item.mediaKey }.toSet())
        assertEquals(setOf("d"), returning.members.filter { !it.previouslyReviewed }.map { it.photo.item.mediaKey }.toSet())
        // Photos decided on before are never pre-selected for the trash again.
        assertEquals(setOf("d"), returning.defaultSelection())
    }

    @Test
    fun a_decided_moment_that_only_lost_a_photo_does_not_come_back() {
        decide(queue("a", "b", "c").pending.single(), DecisionKind.KEPT)
        // As after really trashing a photo elsewhere: the group changes, but holds nothing new.
        assertTrue(queue("b", "c").pending.isEmpty())
    }

    @Test
    fun a_fresh_group_marks_nothing_as_decided_before() {
        val group = queue("a", "b", "c").pending.single()
        assertTrue(group.members.none { it.previouslyReviewed })
        assertEquals(group.members.filter { it.role == MemberRole.PROPOSED }.map { it.photo.item.mediaKey }.toSet(), group.defaultSelection())
    }

    @Test
    fun skipping_a_moment_decides_nothing_about_its_photos() {
        decide(queue("a", "b", "c").pending.single(), DecisionKind.DEFERRED)
        val after = queue("a", "b", "c")
        assertEquals(1, after.pending.size)
        assertEquals(1, after.deferredIds.size)
        assertEquals(0, after.decidedGroups)

        assertTrue(queue("a", "b", "c", "d").pending.first().members.none { it.previouslyReviewed })
    }

    @Test
    fun a_skipped_moment_kept_later_counts_as_decided() {
        val group = queue("a", "b", "c").pending.single()
        decide(group, DecisionKind.DEFERRED)
        decide(group, DecisionKind.KEPT)
        val after = queue("a", "b", "c")
        assertTrue(after.pending.isEmpty(), "the newest decision on a group counts, not the skip")
        assertEquals(emptySet(), after.deferredIds)
        assertEquals(1, after.decidedGroups)
    }

    @Test
    fun photos_approved_elsewhere_are_not_proposed_again() {
        val group = queue("a", "b", "c").pending.single()
        val proposed = group.members.first { it.role == MemberRole.PROPOSED }.photo.item
        // As if trashed from Search: a decision on another "group" holding that photo.
        decisions += Decision(1, "sweep", DecisionKind.APPROVED, listOf(DecisionItem(proposed.mediaKey, proposed.dedupKey)), setOf(proposed.mediaKey), 0, null)
        val left = queue("a", "b", "c").pending.single()
        assertTrue(left.members.none { it.photo.item.mediaKey == proposed.mediaKey })

        decisions += Decision(2, "sweep", DecisionKind.APPROVED, listOf(DecisionItem(group.keeper.photo.item.mediaKey, "d")), setOf(group.keeper.photo.item.mediaKey), 0, null)
        assertTrue(queue("a", "b", "c").pending.isEmpty(), "proposals relative to a keeper that is going away are dropped")
    }

    @Test
    fun a_skipped_moment_also_leaves_out_photos_approved_elsewhere() {
        val group = queue("a", "b", "c").pending.single()
        decide(group, DecisionKind.DEFERRED)
        val proposed = group.members.first { it.role == MemberRole.PROPOSED }.photo.item
        decisions += Decision(2, "sweep", DecisionKind.APPROVED, listOf(DecisionItem(proposed.mediaKey, proposed.dedupKey)), setOf(proposed.mediaKey), 0, null)
        val left = queue("a", "b", "c").pending.single()
        assertTrue(left.members.none { it.photo.item.mediaKey == proposed.mediaKey }, "a photo already queued is not offered twice")

        // Search queued the keeper: what is left of the skipped moment would trash every copy of it.
        decisions += Decision(3, "sweep", DecisionKind.APPROVED, listOf(DecisionItem(group.keeper.photo.item.mediaKey, "d")), setOf(group.keeper.photo.item.mediaKey), 0, null)
        assertTrue(queue("a", "b", "c").pending.isEmpty(), "a skipped moment whose keeper is going away is dropped too")
    }

    @Test
    fun only_eligible_photos_can_be_approved_and_an_approval_needs_a_selection() {
        val group = queue("a", "b", "c", favourites = setOf("b")).pending.single()
        assertEquals("b", group.keeper.photo.item.mediaKey) // a favourite keeps the moment
        assertFailsWith<IllegalArgumentException> { group.decisionItems(DecisionKind.APPROVED, emptySet()) }
        assertFailsWith<IllegalArgumentException> { group.decisionItems(DecisionKind.APPROVED, setOf("b")) }
        assertEquals(listOf(DecisionItem("a", dedupKey("a")), DecisionItem("c", dedupKey("c"))), group.decisionItems(DecisionKind.APPROVED, setOf("c", "a")))
        assertEquals(emptyList(), group.decisionItems(DecisionKind.KEPT, setOf("a")))
    }

    @Test
    fun an_eligible_keeper_may_be_selected_too() {
        val group = queue("a", "b", "c").pending.single()
        assertTrue(group.selectableMembers().any { it.role == MemberRole.KEEPER })
        assertEquals(3, group.decisionItems(DecisionKind.APPROVED, group.members.map { it.photo.item.mediaKey }.toSet()).size)
    }

    private fun member(key: String, role: MemberRole, eligibility: Eligibility = Eligibility.ELIGIBLE) = GroupMember(
        PhotoFacts(InventoryItem(key, dedupKey(key), 1_000, StoredMediaType.PHOTO, false, false, true, 1, 1, null), eligibility, emptySet(), 1.0, 0.0, 1, null),
        role, 0.97, emptyList(),
    )

    @Test
    fun a_photo_from_outside_the_group_can_never_be_approved() {
        val group = DuplicateGroup("g", listOf(member("k", MemberRole.KEEPER), member("a", MemberRole.PROPOSED)), 1_000)
        assertFailsWith<IllegalArgumentException> { group.decisionItems(DecisionKind.APPROVED, setOf("a", "x")) }
        assertFailsWith<IllegalArgumentException> { group.decisionItems(DecisionKind.APPROVED, setOf("x")) }
    }

    @Test
    fun a_protected_or_unknown_photo_is_never_selectable_whatever_its_role() {
        val withReference = DuplicateGroup(
            "g",
            listOf(member("k", MemberRole.KEEPER), member("a", MemberRole.PROPOSED), member("p", MemberRole.REFERENCE, Eligibility.PROTECTED)),
            1_000,
        )
        assertEquals(setOf("k", "a"), withReference.selectableMembers().map { it.photo.item.mediaKey }.toSet())
        assertFailsWith<IllegalArgumentException> { withReference.decisionItems(DecisionKind.APPROVED, setOf("k", "a", "p")) }
        assertEquals(listOf(DecisionItem("a", dedupKey("a")), DecisionItem("k", dedupKey("k"))), withReference.decisionItems(DecisionKind.APPROVED, setOf("k", "a")))

        for (keeper in listOf(Eligibility.PROTECTED, Eligibility.UNKNOWN)) {
            val group = DuplicateGroup("g2", listOf(member("k", MemberRole.KEEPER, keeper), member("a", MemberRole.PROPOSED)), 1_000)
            assertEquals(setOf("a"), group.selectableMembers().map { it.photo.item.mediaKey }.toSet(), "keeper $keeper")
            assertFailsWith<IllegalArgumentException>("keeper $keeper") { group.decisionItems(DecisionKind.APPROVED, setOf("k", "a")) }
        }
    }
}
