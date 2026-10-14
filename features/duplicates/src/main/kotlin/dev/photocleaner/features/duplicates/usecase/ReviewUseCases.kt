package dev.photocleaner.features.duplicates.usecase

import dev.photocleaner.features.shared.duplicates.ReviewQueue
import dev.photocleaner.features.shared.duplicates.ReviewQueues
import dev.photocleaner.features.shared.duplicates.decisionItems
import dev.photocleaner.features.shared.duplicates.model.DuplicateGroup
import dev.photocleaner.repositories.review.domain.Decision
import dev.photocleaner.repositories.review.domain.DecisionKind
import dev.photocleaner.repositories.review.domain.ReviewRepository

/** Duplicate groups that still need a decision, by the shared rules in [ReviewQueues]. */
class LoadReviewQueueUseCase(
    private val buildGroups: BuildDuplicateGroupsUseCase,
    private val review: ReviewRepository,
) {
    suspend fun execute(): ReviewQueue {
        val result = buildGroups.execute()
        return ReviewQueues.build(result, decisionsWithMembers(result.groups))
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

/**
 * Records a decision on one group. An approval stores exactly [selectedMediaKeys]
 * and only accepts eligible members; protected and unknown photos can never be selected.
 */
class DecideGroupUseCase(
    private val review: ReviewRepository,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    suspend fun execute(group: DuplicateGroup, kind: DecisionKind, selectedMediaKeys: Set<String>): Long {
        val items = group.decisionItems(kind, selectedMediaKeys)
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
