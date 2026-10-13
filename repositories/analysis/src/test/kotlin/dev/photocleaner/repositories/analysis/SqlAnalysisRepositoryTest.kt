package dev.photocleaner.repositories.analysis

import dev.photocleaner.repositories.analysis.domain.CalibrationPair
import dev.photocleaner.repositories.analysis.domain.PairKind
import dev.photocleaner.repositories.analysis.domain.PairLabel
import dev.photocleaner.repositories.analysis.domain.StoredEmbedding
import dev.photocleaner.repositories.analysis.domain.StoredQuality
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.coroutines.test.runTest

class SqlAnalysisRepositoryTest {

    private val repo = SqlAnalysisRepository.inMemory()
    private val quality = StoredQuality(10.0, 120.0, 0.0, 0.01, 512, 384)

    private fun embedding(key: String, model: String, vararg values: Float) =
        StoredEmbedding(key, "d-$key", model, values, quality, 1L)

    @Test
    fun `embeddings round-trip per model key`() = runTest {
        repo.save(listOf(embedding("a", "m1", 0.6f, 0.8f), embedding("a", "m2", 1f, 0f), embedding("b", "m1", 0f, 1f)))
        val found = repo.find("m1", listOf("a", "b", "missing"))
        assertEquals(setOf("a", "b"), found.keys)
        assertContentEquals(floatArrayOf(0.6f, 0.8f), found.getValue("a").vector)
        assertEquals(quality, found.getValue("a").quality)
        assertEquals(setOf("a"), repo.storedKeys("m2"))
    }

    @Test
    fun `lookups larger than one SQL chunk work`() = runTest {
        repo.save((0 until 1_200).map { embedding("k$it", "m", it.toFloat()) })
        assertEquals(1_200, repo.find("m", (0 until 1_300).map { "k$it" }).size)
    }

    @Test
    fun `a version 1 database is migrated without losing embeddings or labels`() = runTest {
        val file = java.nio.file.Files.createTempDirectory("analysis-v1").resolve("analysis.db")
        java.sql.DriverManager.getConnection("jdbc:sqlite:$file").use { c ->
            c.createStatement().use { s ->
                // The version 1 schema as first shipped.
                s.executeUpdate("CREATE TABLE embedding (media_key TEXT NOT NULL, model_key TEXT NOT NULL, dedup_key TEXT NOT NULL, vector BLOB NOT NULL, sharpness REAL NOT NULL, brightness REAL NOT NULL, clipped_dark REAL NOT NULL, clipped_bright REAL NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (media_key, model_key))")
                s.executeUpdate("CREATE TABLE calibration_pair (pair_id TEXT NOT NULL PRIMARY KEY, media_key_a TEXT NOT NULL, media_key_b TEXT NOT NULL, kind TEXT NOT NULL, taken_gap_ms INTEGER NOT NULL, display_order INTEGER NOT NULL, label TEXT, labelled_at INTEGER)")
                s.executeUpdate("INSERT INTO calibration_pair VALUES ('p', 'a', 'b', 'NEAR', 1000, 0, 'SAME', 5)")
                s.executeUpdate("PRAGMA user_version = 1")
            }
        }
        val migrated = SqlAnalysisRepository.open(file)
        assertEquals(PairLabel.SAME, migrated.pairs().single().label)
        migrated.savePhotoInfo(listOf(dev.photocleaner.repositories.analysis.domain.PhotoInfo("a", 7L, 4000, 3000)))
        assertEquals(7L, migrated.photoInfo(listOf("a")).getValue("a").uploadedAtMs)
    }

    @Test
    fun `calibration labels can be set, changed and cleared`() = runTest {
        repo.replacePairs(listOf(
            CalibrationPair("p1", "a", "b", PairKind.NEAR, 2_000, 1, null, null),
            CalibrationPair("p2", "c", "d", PairKind.FAR, 9_000_000, 0, null, null),
        ))
        assertEquals(listOf("p2", "p1"), repo.pairs().map { it.pairId })
        repo.setLabel("p1", PairLabel.SAME, 5)
        assertEquals(PairLabel.SAME, repo.pairs().single { it.pairId == "p1" }.label)
        repo.setLabel("p1", null, null)
        assertNull(repo.pairs().single { it.pairId == "p1" }.label)
    }
}
