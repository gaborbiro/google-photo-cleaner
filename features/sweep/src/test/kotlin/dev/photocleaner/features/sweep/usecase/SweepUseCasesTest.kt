package dev.photocleaner.features.sweep.usecase

import dev.photocleaner.features.shared.embeddings.EmbeddingSettings
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.analysis.SqlAnalysisRepository
import dev.photocleaner.repositories.analysis.domain.StoredEmbedding
import dev.photocleaner.repositories.analysis.domain.StoredQuality
import dev.photocleaner.repositories.inventory.SqlInventoryRepository
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import dev.photocleaner.repositories.review.SqlReviewRepository
import dev.photocleaner.repositories.review.domain.DecisionKind
import dev.photocleaner.services.inference.domain.EmbedResult
import dev.photocleaner.services.inference.domain.InferenceWorker
import dev.photocleaner.services.inference.domain.WorkerImage
import dev.photocleaner.services.inference.domain.WorkerInfo
import kotlin.math.cos
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlinx.coroutines.test.runTest

class SweepUseCasesTest {

    /** "boxes" points at 0°, anything else at 90°. */
    private class TextWorker : InferenceWorker {
        override suspend fun info() = WorkerInfo("fake", EmbeddingSettings.REVISION, "cpu", null, "float32", "none")
        override suspend fun embed(images: List<WorkerImage>, tokenBudget: Int): EmbedResult = error("not used")
        override suspend fun embedText(texts: List<String>) = texts.map { if (it.contains("boxes")) floatArrayOf(1f, 0f) else floatArrayOf(0f, 1f) }
    }

    private val now = 1_000_000_000L
    private val inventory = SqlInventoryRepository.inMemory()
    private val analysis = SqlAnalysisRepository.inMemory()
    private val review = SqlReviewRepository.inMemory()
    private val classify = ClassifyInventoryUseCase(inventory, { now })
    private val search = SearchPhotosUseCase(classify, analysis, TextWorker(), review)
    private val approve = ApproveSweepUseCase(classify, review) { now }

    /** Photos at angles: box1 0°, box2 5°, favBox 2° (favourite), other 80°. */
    private suspend fun library(complete: Boolean = true) {
        val angles = mapOf("box1" to 0.0, "box2" to 5.0, "favBox" to 2.0, "other" to 80.0)
        val takenAt = mapOf("box1" to 1_000L, "box2" to 3_000L, "favBox" to 500L, "other" to 2_000L)
        val run = inventory.createRun("acct", now)
        inventory.saveLibraryPage(run.id, angles.keys.map {
            InventoryItem(it, "d-$it", takenAt.getValue(it), StoredMediaType.PHOTO, it == "favBox", false, true, 1, 1, null)
        }, null)
        inventory.saveFavouritesPage(run.id, emptyList(), null)
        inventory.saveArchivePage(run.id, emptyList(), null)
        inventory.saveAlbumsPage(run.id, emptyList(), null)
        inventory.updateRunStatus(run.id, if (complete) RunStatus.COMPLETED else RunStatus.PAUSED, null, now)
        analysis.save(angles.map { (key, deg) ->
            val r = Math.toRadians(deg)
            StoredEmbedding(key, "d-$key", EmbeddingSettings.modelKey(280).id, floatArrayOf(cos(r).toFloat(), sin(r).toFloat()), StoredQuality(1.0, 1.0, 0.0, 0.0, 1, 1), now)
        })
    }

    @Test
    fun `text search shows eligible matches newest first with their match rank, hiding protected ones`() = runTest {
        library()
        val result = search.execute(SweepQuery.Text("meal prep boxes"), limit = 10)
        assertEquals(listOf("box2" to 2, "other" to 3, "box1" to 1), result.hits.map { it.item.mediaKey to it.rank })
        assertEquals(1, result.protectedOrUnknownHidden)
    }

    @Test
    fun `the limit keeps the strongest matches, then orders them by time`() = runTest {
        library()
        val result = search.execute(SweepQuery.Text("meal prep boxes"), limit = 2)
        assertEquals(listOf("box2", "box1"), result.hits.map { it.item.mediaKey }, "other is the weakest match and is left out")
    }

    @Test
    fun `more like selected uses the example photos`() = runTest {
        library()
        val result = search.execute(SweepQuery.LikePhotos(setOf("other")), limit = 1)
        assertEquals(listOf("other"), result.hits.map { it.item.mediaKey })
    }

    @Test
    fun `approved photos are recorded once and hidden from later searches`() = runTest {
        library()
        assertEquals(2, approve.execute("meal prep boxes", setOf("box1", "box2")))
        val decision = review.activeDecisions().single()
        assertEquals(DecisionKind.APPROVED, decision.kind)
        assertEquals(setOf("box1", "box2"), decision.items.map { it.mediaKey }.toSet())

        val again = search.execute(SweepQuery.Text("meal prep boxes"), limit = 10)
        assertEquals(listOf("other"), again.hits.map { it.item.mediaKey })
        assertEquals(2, again.alreadyApprovedHidden)
        assertFailsWith<IllegalArgumentException> { approve.execute("again", setOf("box1")) }
    }

    @Test
    fun `a protected photo can never be approved through a sweep`() = runTest {
        library()
        assertFailsWith<IllegalArgumentException> { approve.execute("boxes", setOf("box1", "favBox")) }
        assertEquals(emptyList(), review.activeDecisions(), "nothing is recorded when any photo is refused")
    }

    @Test
    fun `sweeping needs a complete inventory`() = runTest {
        library(complete = false)
        assertNotNull(search.execute(SweepQuery.Text("boxes"), 10).blockedReason)
        assertFailsWith<IllegalStateException> { approve.execute("boxes", setOf("box1")) }
    }
}
