package dev.photocleaner.features.shared.duplicates

import dev.photocleaner.features.shared.duplicates.model.DuplicateGroup
import dev.photocleaner.features.shared.duplicates.model.DuplicateGroupsResult
import dev.photocleaner.features.shared.duplicates.model.GroupMember
import dev.photocleaner.features.shared.duplicates.model.GroupingSettings
import dev.photocleaner.features.shared.duplicates.model.GroupsBlocked
import dev.photocleaner.features.shared.duplicates.model.MemberRole
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.repositories.review.domain.Decision
import dev.photocleaner.repositories.review.domain.DecisionItem
import dev.photocleaner.repositories.review.domain.DecisionKind

data class ReviewQueue(
    val blocked: GroupsBlocked?,
    /** Groups to review: undecided first (newest photos first), then deferred ones. */
    val pending: List<DuplicateGroup>,
    val deferredIds: Set<String>,
    val totalGroups: Int,
    val decidedGroups: Int,
    /** When the photos were last analysed for duplicates; null before the first analysis. */
    val analysedAtMs: Long?,
    /** Photos in the library scan that have been analysed for duplicates, and those not (yet). */
    val photosAnalysed: Int,
    val photosNotAnalysed: Int,
    /** What counts as a duplicate: similarity threshold and time window. */
    val settings: GroupingSettings,
)

/**
 * Duplicate groups that still need a decision.
 *
 * A group is identified by its exact set of photos, so a moment already decided comes back
 * as a new group when its photos change (a newly found photo of that moment, or later a
 * photo really removed from the library). Decisions are therefore also remembered per photo:
 * such a group only comes back when it holds a photo never decided on, and the photos
 * already decided on are marked as such, so they are not proposed for the trash again.
 */
object ReviewQueues {

    /** [active] are the decisions not undone, newest first, each with the photos it covered. */
    fun build(result: DuplicateGroupsResult, active: List<Decision>): ReviewQueue {
        // The newest decision on a group is the one that counts (a group skipped, then kept, is kept).
        val decisions = active.distinctBy { it.groupId }.associateBy { it.groupId }
        val deferred = decisions.values.filter { it.kind == DecisionKind.DEFERRED }.map { it.groupId }.toSet()
        // Photos already approved elsewhere (e.g. a search sweep) are not proposed again.
        val approved = active.filter { it.kind == DecisionKind.APPROVED }.flatMap { d -> d.items.map { it.mediaKey } }.toSet()
        // Photos the user has decided on: kept, or trashed from. Skipping decides nothing.
        val reviewed = active.filter { it.kind != DecisionKind.DEFERRED }.flatMap { it.members }.toSet() + approved
        val undecided = result.groups.filter { it.id !in decisions }
            .mapNotNull { it.withoutApproved(approved) }
            .filter { group -> group.members.any { it.photo.item.mediaKey !in reviewed } }
            .map { it.markReviewed(reviewed) }
        // Skipping decides nothing, but what was decided elsewhere still counts: a photo already approved
        // (e.g. from Search) is not offered twice, and a moment whose keeper is going away is dropped.
        val deferredGroups = result.groups.filter { it.id in deferred }
            .mapNotNull { it.withoutApproved(approved) }
            .map { it.markReviewed(reviewed) }
        return ReviewQueue(
            blocked = result.blocked,
            pending = undecided + deferredGroups,
            deferredIds = deferred,
            totalGroups = result.groups.size,
            decidedGroups = result.groups.count { it.id in decisions && it.id !in deferred },
            analysedAtMs = result.analysedAtMs,
            photosAnalysed = result.photosCompared,
            photosNotAnalysed = result.photosWithoutEmbedding,
            settings = result.settings,
        )
    }

    /** Marks the photos already decided on; a group where some are is a decided moment that gained new photos. */
    private fun DuplicateGroup.markReviewed(reviewed: Set<String>): DuplicateGroup =
        copy(members = members.map { it.copy(previouslyReviewed = it.photo.item.mediaKey in reviewed) })

    /**
     * The group without photos already approved for the trash. If the keeper itself
     * is already approved, the group is dropped: its proposals were relative to a
     * photo that is going away.
     */
    private fun DuplicateGroup.withoutApproved(approved: Set<String>): DuplicateGroup? {
        if (keeper.photo.item.mediaKey in approved) return null
        val remaining = members.filter { it.photo.item.mediaKey !in approved }
        if (remaining.none { it.role == MemberRole.PROPOSED }) return null
        return copy(members = remaining)
    }
}

/** Members the user may select for the trash: eligible ones, including an eligible keeper ("trash all"). */
fun DuplicateGroup.selectableMembers(): List<GroupMember> =
    members.filter { it.photo.eligibility == Eligibility.ELIGIBLE && it.role != MemberRole.REFERENCE }

/** Starts with the proposals, except photos the user already decided on in an earlier version of this moment. */
fun DuplicateGroup.defaultSelection(): Set<String> =
    members.filter { it.role == MemberRole.PROPOSED && !it.previouslyReviewed }.map { it.photo.item.mediaKey }.toSet()

/**
 * What a decision on this group records for the trash: exactly [selectedMediaKeys] when approving,
 * which must be eligible members; nothing for keep and skip. Protected and unknown photos can never
 * be selected.
 */
fun DuplicateGroup.decisionItems(kind: DecisionKind, selectedMediaKeys: Set<String>): List<DecisionItem> =
    decisionItems(selectableMembers().associate { it.photo.item.mediaKey to it.photo.item.dedupKey }, kind, selectedMediaKeys)

/**
 * The rule behind [DuplicateGroup.decisionItems], for a group known only by its [selectable] members
 * (media key to dedup key), as the browser extension holds it.
 */
fun decisionItems(selectable: Map<String, String>, kind: DecisionKind, selectedMediaKeys: Set<String>): List<DecisionItem> =
    when (kind) {
        DecisionKind.APPROVED -> {
            require(selectedMediaKeys.isNotEmpty()) { "Nothing is selected for the trash" }
            require(selectable.keys.containsAll(selectedMediaKeys)) { "Only eligible photos can be trashed" }
            selectedMediaKeys.sorted().map { DecisionItem(it, selectable.getValue(it)) }
        }
        DecisionKind.KEPT, DecisionKind.DEFERRED -> emptyList()
    }
