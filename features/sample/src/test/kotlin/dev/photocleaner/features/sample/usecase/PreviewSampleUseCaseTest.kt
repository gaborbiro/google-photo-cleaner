package dev.photocleaner.features.sample.usecase

import dev.photocleaner.features.shared.previews.FetchPreviewUseCase
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.inventory.SqlInventoryRepository
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.services.connector.domain.fake.FakePhotosConnector
import dev.photocleaner.services.connector.domain.fake.fakeItem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest

class PreviewSampleUseCaseTest {

    private val now = 2_000_000_000L
    private val repository = SqlInventoryRepository.inMemory()
    private val library = (0 until 100).map { fakeItem(it) }
    private val connector = FakePhotosConnector(library, libraryPageSize = 10)

    private fun stored(i: Int, thumbUrl: String? = library[i].thumbUrl, type: StoredMediaType = StoredMediaType.PHOTO) =
        InventoryItem(library[i].mediaKey, library[i].dedupKey, library[i].takenAtMs, type, false, false, true, 1, 1, thumbUrl)

    private suspend fun completedInventory(items: List<InventoryItem>, complete: Boolean = true) {
        val run = repository.createRun("account-a", now)
        repository.saveLibraryPage(run.id, items, null)
        repository.saveFavouritesPage(run.id, emptyList(), null)
        repository.saveArchivePage(run.id, emptyList(), null)
        repository.saveAlbumsPage(run.id, emptyList(), null)
        repository.updateRunStatus(run.id, if (complete) RunStatus.COMPLETED else RunStatus.PAUSED, null, now)
    }

    private fun useCase() = PreviewSampleUseCase(ClassifyInventoryUseCase(repository, { now }), FetchPreviewUseCase(connector, pacingMs = 0), clock = { now })

    @Test
    fun `fetches a bounded sample of eligible photos only`() = runTest {
        completedInventory((0 until 100).map { if (it % 10 == 0) stored(it, type = StoredMediaType.VIDEO) else stored(it) })
        val events = useCase().execute(emptySet(), sampleSize = 12).toList()

        assertEquals(SampleEvent.Planned(12, 90), events.first())
        val loaded = events.filterIsInstance<SampleEvent.Loaded>()
        assertEquals(12, loaded.size)
        assertTrue(loaded.none { it.item.mediaType == StoredMediaType.VIDEO })
        assertEquals(12, connector.calls.count { it == "preview" })
        assertIs<SampleEvent.Finished>(events.last())
    }

    @Test
    fun `resuming skips previews already loaded`() = runTest {
        completedInventory((0 until 100).map { stored(it) })
        val first = useCase().execute(emptySet(), sampleSize = 10).toList().filterIsInstance<SampleEvent.Loaded>()
        val alreadyLoaded = first.take(4).map { it.item.mediaKey }.toSet()
        connector.calls.clear()

        val resumed = useCase().execute(alreadyLoaded, sampleSize = 10).toList().filterIsInstance<SampleEvent.Loaded>()
        assertEquals(6, resumed.size)
        assertTrue(resumed.none { it.item.mediaKey in alreadyLoaded })
    }

    @Test
    fun `an expired preview link is refreshed from the library listing once`() = runTest {
        val stale = "https://photos.fife.usercontent.google.com/pw/stale-5"
        completedInventory(listOf(stored(5, thumbUrl = stale)))
        connector.expiredThumbUrls = setOf(stale)

        val events = useCase().execute(emptySet()).toList()
        val loaded = events.filterIsInstance<SampleEvent.Loaded>().single()
        assertEquals("lib-5", loaded.item.mediaKey)
        assertEquals(1, loaded.stats.refreshedUrls)
    }

    @Test
    fun `an incomplete inventory offers nothing to sample`() = runTest {
        completedInventory((0 until 10).map { stored(it) }, complete = false)
        val events = useCase().execute(emptySet()).toList()
        assertIs<SampleEvent.NothingEligible>(events.single())
        assertEquals(0, connector.calls.count { it == "preview" })
    }

    @Test
    fun `a lost session stops the sample with a reason`() = runTest {
        completedInventory((0 until 10).map { stored(it) })
        connector.failure = { op, call -> if (op == "preview" && call >= 2) ConnectorException.SessionExpired("signed out", 401) else null }
        val events = useCase().execute(emptySet()).toList()
        assertEquals(2, events.filterIsInstance<SampleEvent.Loaded>().size)
        assertIs<SampleEvent.Stopped>(events.last())
    }
}
