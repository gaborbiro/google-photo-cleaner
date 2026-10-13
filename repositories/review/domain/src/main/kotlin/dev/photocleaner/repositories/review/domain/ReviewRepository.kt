package dev.photocleaner.repositories.review.domain

/**
 * Review decisions and the trash job queue. Recording an approval stores the
 * selection snapshot and queues its jobs in one transaction.
 */
interface ReviewRepository {

    /** Records a decision; for APPROVED, also queues one trash job per item. Returns the decision id. */
    suspend fun recordDecision(groupId: String, kind: DecisionKind, items: List<DecisionItem>, atMs: Long): Long

    /** Decisions that have not been undone, newest first. */
    suspend fun activeDecisions(): List<Decision>

    /**
     * Undoes a decision: queued jobs are cancelled, trashed ones are marked for
     * restoration. Returns the decision as it was, or null if it is unknown or already undone.
     */
    suspend fun undoDecision(decisionId: Long, atMs: Long): Decision?

    suspend fun jobs(states: Set<TrashJobState>, limit: Int = Int.MAX_VALUE): List<TrashJob>

    /** Moves a job to [to] only if it is still in [from]; returns whether it moved. */
    suspend fun transition(jobId: Long, from: TrashJobState, to: TrashJobState, error: String?, atMs: Long): Boolean

    suspend fun jobCounts(): Map<TrashJobState, Int>
}
