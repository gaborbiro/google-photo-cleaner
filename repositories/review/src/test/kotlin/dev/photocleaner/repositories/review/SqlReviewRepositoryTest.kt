package dev.photocleaner.repositories.review

import dev.photocleaner.repositories.review.domain.DecisionItem
import dev.photocleaner.repositories.review.domain.DecisionKind
import java.nio.file.Files
import java.sql.DriverManager
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlinx.coroutines.test.runTest

class SqlReviewRepositoryTest {

    private val repo = SqlReviewRepository.inMemory()

    @Test
    fun `a decision remembers every photo it covered, not just the selection`() = runTest {
        repo.recordDecision("g", DecisionKind.APPROVED, listOf(DecisionItem("b", "db")), setOf("a", "b", "c"), 1)
        repo.recordDecision("h", DecisionKind.KEPT, emptyList(), setOf("d", "e"), 2)
        val (kept, approved) = repo.activeDecisions()
        assertEquals(setOf("d", "e"), kept.members)
        assertEquals(setOf("a", "b", "c"), approved.members)
        assertEquals(listOf("b"), approved.items.map { it.mediaKey })
    }

    @Test
    fun `selected photos must be among the decision's photos`() = runTest {
        assertFailsWith<IllegalArgumentException> {
            repo.recordDecision("g", DecisionKind.APPROVED, listOf(DecisionItem("x", "dx")), setOf("a", "b"), 1)
        }
    }

    @Test
    fun `a version 1 database is migrated without losing decisions, and old decisions can be filled in`() = runTest {
        val file = Files.createTempDirectory("review-v1").resolve("review.db")
        DriverManager.getConnection("jdbc:sqlite:$file").use { c ->
            c.createStatement().use { s ->
                // The version 1 schema as first shipped.
                s.executeUpdate("CREATE TABLE decision (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL, undone_at INTEGER)")
                s.executeUpdate("CREATE TABLE decision_item (decision_id INTEGER NOT NULL, media_key TEXT NOT NULL, dedup_key TEXT NOT NULL, PRIMARY KEY (decision_id, media_key))")
                s.executeUpdate("CREATE TABLE trash_job (id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id INTEGER NOT NULL, media_key TEXT NOT NULL, dedup_key TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL, last_error TEXT, updated_at INTEGER NOT NULL)")
                s.executeUpdate("CREATE INDEX trash_job_state ON trash_job(state)")
                s.executeUpdate("INSERT INTO decision (group_id, kind, created_at) VALUES ('g', 'APPROVED', 5)")
                s.executeUpdate("INSERT INTO decision_item VALUES (1, 'b', 'db')")
                s.executeUpdate("PRAGMA user_version = 1")
            }
        }
        val migrated = SqlReviewRepository.open(file)
        val old = migrated.activeDecisions().single()
        assertEquals(listOf("b"), old.items.map { it.mediaKey })
        assertEquals(emptySet(), old.members, "members were not recorded in version 1")

        migrated.addDecisionMembers(old.id, setOf("a", "b"))
        assertEquals(setOf("a", "b"), migrated.activeDecisions().single().members)
    }
}
