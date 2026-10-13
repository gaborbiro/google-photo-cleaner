package dev.photocleaner.features.duplicates.usecase

import dev.photocleaner.features.duplicates.model.DuplicateGroup
import dev.photocleaner.features.duplicates.model.GroupMember
import dev.photocleaner.features.duplicates.model.MemberRole
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.repositories.review.domain.Decision
import dev.photocleaner.repositories.review.domain.DecisionItem
import dev.photocleaner.repositories.review.domain.DecisionKind
import dev.photocleaner.repositories.review.domain.ReviewRepository

data class ReviewQueue(
    val blockedReason: String?,
    /** Groups to review: undecided first (newest photos first), then deferred ones. */
    val pending: List<DuplicateGroup>,
    val deferredIds: Set<String>,
    val totalGroups: Int,
    val decidedGroups: Int,
    /** When the photos were last analysed for duplicates; null before the first analysis. */
    val analysedAtMs: Long?,
    /** Photos in the library scan that the duplicate scan has analysed, and those it has not (yet). */
    val photosAnalysed: Int,
    val photosNotAnalysed: Int,
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
class LoadReviewQueueUseCase(
    private val buildGroups: BuildDuplicateGroupsUseCase,
    private val review: ReviewRepository,
) {
    suspend fun execute(): ReviewQueue {
        val result = buildGroups.execute()
        val active = decisionsWithMembers(result.groups)
        val decisions = active.associateBy { it.groupId }
        val deferred = decisions.values.filter { it.kind == DecisionKind.DEFERRED }.map { it.groupId }.toSet()
        // Photos already approved elsewhere (e.g. a search sweep) are not proposed again.
        val approved = active.filter { it.kind == DecisionKind.APPROVED }.flatMap { d -> d.items.map { it.mediaKey } }.toSet()
        // Photos the user has decided on: kept, or trashed from. Skipping decides nothing.
        val reviewed = active.filter { it.kind != DecisionKind.DEFERRED }.flatMap { it.members }.toSet() + approved
        val undecided = result.groups.filter { it.id !in decisions }
            .mapNotNull { it.withoutApproved(approved) }
            .filter { group -> group.members.any { it.photo.item.mediaKey !in reviewed } }
            .map { it.markReviewed(reviewed) }
        val deferredGroups = result.groups.filter { it.id in deferred }
        return ReviewQueue(
            blockedReason = result.blockedReason,
            pending = undecided + deferredGroups,
            deferredIds = deferred,
            totalGroups = result.groups.size,
            decidedGroups = result.groups.count { it.id in decisions && it.id !in deferred },
            analysedAtMs = result.analysedAtMs,
            photosAnalysed = result.photosCompared,
            photosNotAnalysed = result.photosWithoutEmbedding,
        )
    }

    /**
     * Active decisions with their photos. Decisions recorded before photos were stored per
     * decision get them from their group, while that group still exists unchanged.
     */
    private suspend fun decisionsWithMembers(groups: List<DuplicateGroup>): List<Decision> {
        val active = review.activeDecisions()
        val byId = groups.associateBy { it.id }
        val missing = active.filter { it.members.isEmpty() && it.groupId in byId }
        if (missing.isEmpty()) return active
        missing.forEach { decision ->
            review.addDecisionMembers(decision.id, byId.getValue(decision.groupId).members.map { it.photo.item.mediaKey }.toSet())
        }
        return review.activeDecisions()
    }
}

/** Marks the photos already decided on; a group where some are is a decided moment that gained new photos. */
private fun DuplicateGroup.markReviewed(reviewed: Set<String>): DuplicateGroup =
    copy(members = members.map { it.copy(previouslyReviewed = it.photo.item.mediaKey in reviewed) })

/** Members the user may select for the trash: eligible ones, including an eligible keeper ("trash all"). */
fun DuplicateGroup.selectableMembers(): List<GroupMember> =
    members.filter { it.photo.eligibility == Eligibility.ELIGIBLE && it.role != MemberRole.REFERENCE }

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

/**
 * Records a decision on one group. An approval stores exactly [selectedMediaKeys]
 * and only accepts eligible members; protected and unknown photos can never be selected.
 */
class DecideGroupUseCase(
    private val review: ReviewRepository,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    suspend fun execute(group: DuplicateGroup, kind: DecisionKind, selectedMediaKeys: Set<String>): Long {
        val proposable = group.selectableMembers().associateBy { it.photo.item.mediaKey }
        val items = when (kind) {
            DecisionKind.APPROVED -> {
                require(selectedMediaKeys.isNotEmpty()) { "Nothing is selected for the trash" }
                require(proposable.keys.containsAll(selectedMediaKeys)) { "Only eligible photos can be trashed" }
                selectedMediaKeys.sorted().map { DecisionItem(it, proposable.getValue(it).photo.item.dedupKey) }
            }
            DecisionKind.KEPT, DecisionKind.DEFERRED -> emptyList()
        }
        // Every photo shown is remembered as decided on, so it is not proposed again if the moment comes back.
        return review.recordDecision(group.id, kind, items, group.members.map { it.photo.item.mediaKey }.toSet(), clock())
    }
}

/** Undoes the most recent decision that is still active; returns it, or null when there is none. */
class UndoLastDecisionUseCase(
    private val review: ReviewRepository,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    suspend fun execute(): Decision? {
        val latest = review.activeDecisions().firstOrNull() ?: return null
        return review.undoDecision(latest.id, clock())
    }
}
