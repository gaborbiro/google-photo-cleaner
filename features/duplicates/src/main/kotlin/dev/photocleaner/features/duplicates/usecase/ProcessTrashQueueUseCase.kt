package dev.photocleaner.features.duplicates.usecase

import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import dev.photocleaner.repositories.review.domain.ReviewRepository
import dev.photocleaner.repositories.review.domain.TrashJob
import dev.photocleaner.repositories.review.domain.TrashJobState
import dev.photocleaner.services.trash.domain.TrashService
import dev.photocleaner.services.trash.domain.TrashTarget
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import org.slf4j.LoggerFactory

data class TrashQueueStatus(
    val counts: Map<TrashJobState, Int>,
    val simulated: Boolean,
    /** Why queued jobs are not moving, e.g. the inventory needs refreshing. */
    val waitingReason: String?,
)

/**
 * Background worker for approved deletions. Runs until cancelled.
 *
 * 1. At start, jobs left SENDING by a previous run become UNCERTAIN.
 * 2. UNCERTAIN jobs are reconciled against the trash before anything is retried.
 * 3. Restorations requested by undo are carried out.
 * 4. Queued jobs are revalidated against a fresh, complete inventory: a photo that
 *    is no longer eligible (now a favourite, in an album, archived, unknown) is BLOCKED.
 * 5. The rest are sent in small batches with a per-item result.
 */
class ProcessTrashQueueUseCase(
    private val review: ReviewRepository,
    private val trash: TrashService,
    private val classify: ClassifyInventoryUseCase,
    private val clock: () -> Long = System::currentTimeMillis,
    private val batchSize: Int = 25,
    private val idleMs: Long = 1_000,
) {
    private val log = LoggerFactory.getLogger(ProcessTrashQueueUseCase::class.java)

    fun execute(): Flow<TrashQueueStatus> = flow {
        review.jobs(setOf(TrashJobState.SENDING)).forEach { review.transition(it.id, TrashJobState.SENDING, TrashJobState.UNCERTAIN, "Interrupted while sending", clock()) }
        while (true) {
            reconcileUncertain()
            restoreRequested()
            val waiting = sendQueued()
            emit(TrashQueueStatus(review.jobCounts(), trash.isSimulated, waiting))
            delay(idleMs)
        }
    }

    private suspend fun reconcileUncertain() {
        val uncertain = review.jobs(setOf(TrashJobState.UNCERTAIN), batchSize)
        if (uncertain.isEmpty()) return
        val state = trash.inTrash(uncertain.map { it.dedupKey })
        val active = review.activeDecisions().map { it.id }.toSet()
        uncertain.forEach { job ->
            val to = when {
                state[job.dedupKey] == true -> TrashJobState.COMPLETED
                job.decisionId in active -> TrashJobState.QUEUED
                else -> TrashJobState.CANCELLED // undone while its outcome was unknown, and it never reached the trash
            }
            review.transition(job.id, TrashJobState.UNCERTAIN, to, null, clock())
        }
        log.info("Reconciled {} interrupted trash requests", uncertain.size)
        // A reconciled COMPLETED job whose decision was undone in the meantime still needs restoring.
        markUndoneCompletions(uncertain)
    }

    private suspend fun restoreRequested() {
        val jobs = review.jobs(setOf(TrashJobState.RESTORE_REQUESTED), batchSize)
        if (jobs.isEmpty()) return
        val outcomes = trash.restore(jobs.map { TrashTarget(it.mediaKey, it.dedupKey) }).associateBy { it.dedupKey }
        jobs.forEach { job ->
            val outcome = outcomes[job.dedupKey]
            if (outcome?.succeeded == true) {
                review.transition(job.id, TrashJobState.RESTORE_REQUESTED, TrashJobState.RESTORED, null, clock())
            } else {
                // Stays RESTORE_REQUESTED and is retried; the error is kept for display.
                review.transition(job.id, TrashJobState.RESTORE_REQUESTED, TrashJobState.RESTORE_REQUESTED, outcome?.error ?: "No result", clock())
            }
        }
    }

    /** Returns why queued jobs are waiting, or null. */
    private suspend fun sendQueued(): String? {
        val queued = review.jobs(setOf(TrashJobState.QUEUED), batchSize)
        if (queued.isEmpty()) return null
        val classification = classify.execute() ?: return "Waiting: no inventory."
        val coverage = classification.report.coverage
        if (!coverage.isComplete) return "Waiting: the inventory is incomplete. Run the scan again."
        if (coverage.isStale) return "Waiting: the inventory is out of date. Run the scan again to continue."
        val eligibility = classification.items.associate { it.item.mediaKey to it.eligibility }
        val identities = classification.items.associate { it.item.mediaKey to it.item.dedupKey }
        // Videos are never cleanup candidates, whatever approved them.
        val photos = classification.items.filter { it.item.mediaType == StoredMediaType.PHOTO }.map { it.item.mediaKey }.toSet()
        val active = review.activeDecisions().map { it.id }.toSet()

        val sendable = mutableListOf<TrashJob>()
        queued.forEach { job ->
            when {
                job.decisionId !in active -> review.transition(job.id, TrashJobState.QUEUED, TrashJobState.CANCELLED, null, clock())
                identities[job.mediaKey] != null && identities[job.mediaKey] != job.dedupKey ->
                    review.transition(job.id, TrashJobState.QUEUED, TrashJobState.BLOCKED, "Photo identity changed since approval", clock())
                eligibility[job.mediaKey] == Eligibility.ELIGIBLE && job.mediaKey !in photos ->
                    review.transition(job.id, TrashJobState.QUEUED, TrashJobState.BLOCKED, "Not a photo: only photos are trashed", clock())
                eligibility[job.mediaKey] == Eligibility.ELIGIBLE -> sendable += job
                eligibility[job.mediaKey] == null ->
                    review.transition(job.id, TrashJobState.QUEUED, TrashJobState.BLOCKED, "No longer in the library", clock())
                else ->
                    review.transition(job.id, TrashJobState.QUEUED, TrashJobState.BLOCKED, "No longer eligible (${eligibility[job.mediaKey]})", clock())
            }
        }
        val sending = sendable.filter { review.transition(it.id, TrashJobState.QUEUED, TrashJobState.SENDING, null, clock()) }
        if (sending.isEmpty()) return null
        val outcomes = trash.moveToTrash(sending.map { TrashTarget(it.mediaKey, it.dedupKey) }).associateBy { it.dedupKey }
        sending.forEach { job ->
            val outcome = outcomes[job.dedupKey]
            if (outcome?.succeeded == true) {
                review.transition(job.id, TrashJobState.SENDING, TrashJobState.COMPLETED, null, clock())
            } else {
                review.transition(job.id, TrashJobState.SENDING, TrashJobState.FAILED, outcome?.error ?: "No result for this photo", clock())
            }
        }
        markUndoneCompletions(sending)
        log.info("Trash batch: {} sent, {} completed", sending.size, sending.count { outcomes[it.dedupKey]?.succeeded == true })
        return null
    }

    /** Jobs whose decision was undone while they were in flight are restored rather than left in the trash. */
    private suspend fun markUndoneCompletions(jobs: List<TrashJob>) {
        val active = review.activeDecisions().map { it.id }.toSet()
        jobs.filter { it.decisionId !in active }.forEach {
            review.transition(it.id, TrashJobState.COMPLETED, TrashJobState.RESTORE_REQUESTED, null, clock())
        }
    }
}
