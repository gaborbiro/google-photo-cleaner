package dev.photocleaner.features.duplicates.usecase

import dev.photocleaner.features.shared.embeddings.EmbedPhotosUseCase
import dev.photocleaner.features.shared.embeddings.EmbeddingSettings
import dev.photocleaner.features.shared.previews.FetchPreviewUseCase
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.analysis.SqlAnalysisRepository
import dev.photocleaner.repositories.inventory.SqlInventoryRepository
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.services.connector.domain.MediaType
import dev.photocleaner.services.connector.domain.fake.FakePhotosConnector
import dev.photocleaner.services.connector.domain.fake.fakeItem
import dev.photocleaner.services.inference.domain.EmbedResult
import dev.photocleaner.services.inference.domain.EmbeddedImage
import dev.photocleaner.services.inference.domain.ImageQuality
import dev.photocleaner.services.inference.domain.InferenceWorker
import dev.photocleaner.services.inference.domain.WorkerImage
import dev.photocleaner.services.inference.domain.WorkerInfo
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.coroutines.flow.last
import kotlinx.coroutines.test.runTest

class EmbedLibraryUseCaseTest {

    private class CountingWorker : InferenceWorker {
        val embedded = mutableListOf<String>()
        override suspend fun info() = WorkerInfo("fake", EmbeddingSettings.REVISION, "cpu", null, "float32", "none")
        override suspend fun embedText(texts: List<String>): List<FloatArray> = error("not used")

    override suspend fun embed(images: List<WorkerImage>, tokenBudget: Int): EmbedResult {
            embedded += images.map { it.key }
            return EmbedResult(images.map { EmbeddedImage(it.key, floatArrayOf(1f, 0f), ImageQuality(1.0, 1.0, 0.0, 0.0, 1, 1)) }, emptyList())
        }
    }

    private val now = 1_000_000_000L
    private val inventory = SqlInventoryRepository.inMemory()
    private val analysis = SqlAnalysisRepository.inMemory()
    private val library = (0 until 12).map { fakeItem(it, type = if (it == 4) MediaType.VIDEO else MediaType.PHOTO) }
    private val connector = FakePhotosConnector(library, libraryPageSize = 5)
    private val worker = CountingWorker()

    private suspend fun inventory() {
        val run = inventory.createRun("account-a", now)
        inventory.saveLibraryPage(run.id, library.map {
            InventoryItem(it.mediaKey, it.dedupKey, it.takenAtMs, if (it.mediaType == MediaType.VIDEO) StoredMediaType.VIDEO else StoredMediaType.PHOTO, false, false, true, 1, 1, "stale")
        }, null)
        inventory.saveFavouritesPage(run.id, emptyList(), null)
        inventory.saveArchivePage(run.id, emptyList(), null)
        inventory.saveAlbumsPage(run.id, emptyList(), null)
        inventory.updateRunStatus(run.id, RunStatus.COMPLETED, null, now)
    }

    private fun useCase() = EmbedLibraryUseCase(
        ClassifyInventoryUseCase(inventory, { now }),
        connector,
        EmbedPhotosUseCase(FetchPreviewUseCase(connector, pacingMs = 0), worker, analysis, { now }, batchSize = 4),
        analysis,
        { now },
        pageRetryDelayMs = 0,
    )

    @Test
    fun `embeds every photo once with fresh preview links and records photo info`() = runTest {
        inventory()
        val last = useCase().execute().last()
        assertEquals(LibraryEmbedProgress.State.FINISHED, last.state)
        assertEquals(11, last.embedded)
        assertEquals(11, worker.embedded.size)
        assertEquals(setOf("lib-4"), library.map { it.mediaKey }.toSet() - worker.embedded.toSet(), "videos are not embedded")
        // Fresh links from the listing were used: no per-photo refresh lookups beyond the 3 library pages.
        assertEquals(3, connector.calls.count { it == "library" })
        assertEquals(11, analysis.photoInfo(library.map { it.mediaKey }).size)
    }

    @Test
    fun `stopping midway and running again only embeds the rest`() = runTest {
        inventory()
        connector.failure = { op, call -> if (op == "preview" && call == 8) ConnectorException.NotConnected() else null }
        assertEquals(LibraryEmbedProgress.State.STOPPED, useCase().execute().last().state)
        val firstRun = worker.embedded.toSet()

        connector.failure = { _, _ -> null }
        worker.embedded.clear()
        val last = useCase().execute().last()
        assertEquals(LibraryEmbedProgress.State.FINISHED, last.state)
        assertEquals(11, last.embedded)
        assertEquals(emptySet(), worker.embedded.toSet().intersect(firstRun), "nothing is embedded twice")
    }

    @Test
    fun `a different account in the Photos tab stops the run`() = runTest {
        inventory()
        connector.accountFingerprint = "account-b"
        val last = useCase().execute().last()
        assertEquals(LibraryEmbedProgress.State.STOPPED, last.state)
        assertEquals(0, worker.embedded.size)
    }
}
