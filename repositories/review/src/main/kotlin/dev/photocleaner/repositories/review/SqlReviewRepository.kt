package dev.photocleaner.repositories.review

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import dev.photocleaner.repositories.review.db.ReviewDatabase
import dev.photocleaner.repositories.review.db.ReviewQueries
import dev.photocleaner.repositories.review.domain.Decision
import dev.photocleaner.repositories.review.domain.DecisionItem
import dev.photocleaner.repositories.review.domain.DecisionKind
import dev.photocleaner.repositories.review.domain.ReviewRepository
import dev.photocleaner.repositories.review.domain.TrashJob
import dev.photocleaner.repositories.review.domain.TrashJobState
import java.nio.file.Files
import java.nio.file.Path
import java.util.Properties
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class SqlReviewRepository(
    database: ReviewDatabase,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ReviewRepository {

    private val q: ReviewQueries = database.reviewQueries

    override suspend fun recordDecision(groupId: String, kind: DecisionKind, items: List<DecisionItem>, atMs: Long): Long = withContext(io) {
        require(kind == DecisionKind.APPROVED || items.isEmpty()) { "Only approvals carry a selection" }
        require(kind != DecisionKind.APPROVED || items.isNotEmpty()) { "An approval needs at least one selected photo" }
        q.transactionWithResult {
            q.insertDecision(groupId, kind.name, atMs)
            val id = q.lastInsertedId().executeAsOne()
            items.forEach { item ->
                q.insertDecisionItem(id, item.mediaKey, item.dedupKey)
                if (kind == DecisionKind.APPROVED) q.insertJob(id, item.mediaKey, item.dedupKey, atMs)
            }
            id
        }
    }

    override suspend fun activeDecisions(): List<Decision> = withContext(io) {
        q.selectActiveDecisions().executeAsList().map { it.toDomain() }
    }

    override suspend fun undoDecision(decisionId: Long, atMs: Long): Decision? = withContext(io) {
        q.transactionWithResult {
            val row = q.selectDecision(decisionId).executeAsOneOrNull() ?: return@transactionWithResult null
            q.markUndone(atMs, decisionId)
            if (q.changes().executeAsOne() == 0L) return@transactionWithResult null
            q.cancelUnsentJobs(atMs, decisionId)
            q.requestRestore(atMs, decisionId)
            row.toDomain()
        }
    }

    override suspend fun jobs(states: Set<TrashJobState>, limit: Int): List<TrashJob> = withContext(io) {
        q.selectJobsInStates(states.map { it.name }, limit.toLong()).executeAsList().map { row ->
            TrashJob(row.id, row.decision_id, row.media_key, row.dedup_key, TrashJobState.valueOf(row.state), row.attempts.toInt(), row.last_error, row.updated_at)
        }
    }

    override suspend fun transition(jobId: Long, from: TrashJobState, to: TrashJobState, error: String?, atMs: Long): Boolean = withContext(io) {
        q.transactionWithResult {
            q.transition(to = to.name, error = error, at = atMs, id = jobId, from = from.name)
            q.changes().executeAsOne() == 1L
        }
    }

    override suspend fun jobCounts(): Map<TrashJobState, Int> = withContext(io) {
        q.selectJobCounts().executeAsList().associate { TrashJobState.valueOf(it.state) to it.n.toInt() }
    }

    private fun dev.photocleaner.repositories.review.db.Decision.toDomain() = Decision(
        id = id,
        groupId = group_id,
        kind = DecisionKind.valueOf(kind),
        items = q.selectDecisionItems(id).executeAsList().map { DecisionItem(it.media_key, it.dedup_key) },
        createdAtMs = created_at,
        undoneAtMs = undone_at,
    )

    companion object {
        fun open(file: Path): SqlReviewRepository {
            Files.createDirectories(file.parent)
            return SqlReviewRepository(ReviewDatabase(JdbcSqliteDriver("jdbc:sqlite:$file", Properties(), ReviewDatabase.Schema)))
        }

        fun inMemory(): SqlReviewRepository =
            SqlReviewRepository(ReviewDatabase(JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY, Properties(), ReviewDatabase.Schema)))
    }
}
