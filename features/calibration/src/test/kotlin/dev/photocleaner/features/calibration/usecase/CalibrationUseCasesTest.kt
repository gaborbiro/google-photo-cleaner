package dev.photocleaner.features.calibration.usecase

import dev.photocleaner.features.calibration.model.CalibrationPrepProgress
import dev.photocleaner.features.shared.embeddings.EmbedPhotosUseCase
import dev.photocleaner.features.shared.embeddings.EmbeddingSettings
import dev.photocleaner.features.shared.previews.FetchPreviewUseCase
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.analysis.SqlAnalysisRepository
import dev.photocleaner.repositories.analysis.domain.PairKind
import dev.photocleaner.repositories.analysis.domain.PairLabel
import dev.photocleaner.repositories.inventory.SqlInventoryRepository
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.services.connector.domain.fake.FakePhotosConnector
import dev.photocleaner.services.connector.domain.fake.fakeItem
import dev.photocleaner.services.inference.domain.EmbedResult
import dev.photocleaner.services.inference.domain.EmbeddedImage
import dev.photocleaner.services.inference.domain.ImageQuality
import dev.photocleaner.services.inference.domain.InferenceWorker
import dev.photocleaner.services.inference.domain.WorkerImage
import dev.photocleaner.services.inference.domain.WorkerInfo
import kotlin.math.cos
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.last
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest

private const val DAY = 24L * 60 * 60 * 1000

/**
 * Library of 60 photos in 20 "moments" of 3 shots taken 10 s apart, moments 40 days
 * apart. The fake worker maps each photo to a unit vector at an angle that depends
 * on its moment, with a small offset per shot, so shots of one moment score high.
 */
private class FakeWorker(var revision: String = EmbeddingSettings.REVISION) : InferenceWorker {
    val embedCalls = mutableListOf<Pair<Int, Int>>()

    override suspend fun info() = WorkerInfo("fake", revision, "cpu", null, "float32", "none")

    override suspend fun embedText(texts: List<String>): List<FloatArray> = error("not used")

    override suspend fun embed(images: List<WorkerImage>, tokenBudget: Int): EmbedResult {
        embedCalls += tokenBudget to images.size
        return EmbedResult(
            images.map { image ->
                val index = image.key.removePrefix("lib-").toInt()
                val angle = (index / 3) * 0.6 + (index % 3) * 0.02
                EmbeddedImage(image.key, floatArrayOf(cos(angle).toFloat(), sin(angle).toFloat()), ImageQuality(1.0, 100.0, 0.0, 0.0, 10, 10))
            },
            emptyList(),
        )
    }
}

class CalibrationUseCasesTest {

    private val inventory = SqlInventoryRepository.inMemory()
    private val analysis = SqlAnalysisRepository.inMemory()
    private val now = 10_000L * DAY
    private val library = (0 until 60).map { i ->
        fakeItem(i).copy(takenAtMs = now - (i / 3) * 40 * DAY - (i % 3) * 10_000L)
    }
    private val connector = FakePhotosConnector(library)
    private val worker = FakeWorker()
    private val classify = ClassifyInventoryUseCase(inventory, { now })
    private val embed = EmbedPhotosUseCase(FetchPreviewUseCase(connector, pacingMs = 0), worker, analysis, { now }, batchSize = 8)

    private suspend fun completedInventory() {
        val run = inventory.createRun("account-a", now)
        inventory.saveLibraryPage(run.id, library.map {
            InventoryItem(it.mediaKey, it.dedupKey, it.takenAtMs, StoredMediaType.PHOTO, false, false, true, 1, 1, it.thumbUrl)
        }, null)
        inventory.saveFavouritesPage(run.id, emptyList(), null)
        inventory.saveArchivePage(run.id, emptyList(), null)
        inventory.saveAlbumsPage(run.id, emptyList(), null)
        inventory.updateRunStatus(run.id, RunStatus.COMPLETED, null, now)
    }

    private fun prepare(near: Int = 10, far: Int = 5) = PrepareCalibrationUseCase(classify, analysis, embed, near, far)

    @Test
    fun `selects close and far pairs and embeds their photos at every budget`() = runTest {
        completedInventory()
        val last = prepare().execute(fresh = false).last()

        assertIs<CalibrationPrepProgress.Ready>(last)
        val pairs = analysis.pairs()
        assertEquals(10, pairs.count { it.kind == PairKind.NEAR })
        assertEquals(5, pairs.count { it.kind == PairKind.FAR })
        assertTrue(pairs.filter { it.kind == PairKind.NEAR }.all { it.takenGapMs <= 120_000 })
        assertTrue(pairs.filter { it.kind == PairKind.FAR }.all { it.takenGapMs > 30 * DAY })
        val photos = pairs.flatMap { listOf(it.mediaKeyA, it.mediaKeyB) }.toSet()
        EmbeddingSettings.CALIBRATION_BUDGETS.forEach { budget ->
            assertEquals(photos, analysis.storedKeys(EmbeddingSettings.modelKey(budget).id))
        }
    }

    @Test
    fun `preparing again keeps labels and embeds nothing twice`() = runTest {
        completedInventory()
        prepare().execute(fresh = false).last()
        val first = analysis.pairs().first()
        LabelCalibrationPairUseCase(analysis) { now }.execute(first.pairId, PairLabel.SAME)
        worker.embedCalls.clear()
        connector.calls.clear()

        prepare().execute(fresh = false).last()
        assertEquals(PairLabel.SAME, analysis.pairs().single { it.pairId == first.pairId }.label)
        assertTrue(worker.embedCalls.isEmpty())
        assertEquals(0, connector.calls.count { it == "preview" })
    }

    @Test
    fun `a worker on another model revision is refused`() = runTest {
        completedInventory()
        worker.revision = "0000000000000000"
        val last = prepare().execute(fresh = false).last()
        assertIs<CalibrationPrepProgress.Stopped>(last)
        assertTrue(worker.embedCalls.isEmpty())
    }

    @Test
    fun `a lost session stops embedding and resuming finishes it`() = runTest {
        completedInventory()
        connector.failure = { op, call -> if (op == "preview" && call == 5) ConnectorException.SessionExpired("signed out", 401) else null }
        assertIs<CalibrationPrepProgress.Stopped>(prepare().execute(fresh = false).last())

        connector.failure = { _, _ -> null }
        val resumed = prepare().execute(fresh = false).toList()
        assertIs<CalibrationPrepProgress.Ready>(resumed.last())
    }

    @Test
    fun `report finds the threshold just above the highest different pair`() = runTest {
        completedInventory()
        prepare(near = 20, far = 10).execute(fresh = false).last()
        val label = LabelCalibrationPairUseCase(analysis) { now }
        // Ground truth for the fake: same moment = near-duplicate, otherwise different.
        analysis.pairs().forEach { pair ->
            val sameMoment = pair.mediaKeyA.removePrefix("lib-").toInt() / 3 == pair.mediaKeyB.removePrefix("lib-").toInt() / 3
            label.execute(pair.pairId, if (sameMoment) PairLabel.NEAR_DUPLICATE else PairLabel.DIFFERENT)
        }
        val view = LoadCalibrationUseCase(classify, analysis, analysis).execute()
        assertEquals(null, view.nextUnlabelled)
        val report = view.reports.first()
        val highest = checkNotNull(report.highestDifferent)
        val recommended = checkNotNull(report.recommendedThreshold)
        assertTrue(recommended > highest && recommended - highest <= 0.005 + 1e-9)
        val row = report.rows.single { it.threshold == recommended }
        assertEquals(0, row.falsePositives)
        assertEquals(1.0, row.precision)
        assertEquals(1.0, row.recall, "every same-moment pair scores above every different pair in this fake")
    }

    @Test
    fun `undo clears the most recent label`() = runTest {
        completedInventory()
        prepare().execute(fresh = false).last()
        val (a, b) = analysis.pairs().take(2)
        var clock = now
        val label = LabelCalibrationPairUseCase(analysis) { clock++ }
        label.execute(a.pairId, PairLabel.SAME)
        label.execute(b.pairId, PairLabel.DIFFERENT)
        assertEquals(b.pairId, UndoLastCalibrationLabelUseCase(analysis).execute())
        assertEquals(PairLabel.SAME, analysis.pairs().single { it.pairId == a.pairId }.label)
    }
}
