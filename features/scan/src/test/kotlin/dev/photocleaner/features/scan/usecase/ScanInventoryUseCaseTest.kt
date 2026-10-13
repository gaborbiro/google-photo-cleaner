package dev.photocleaner.features.scan.usecase

import dev.photocleaner.features.scan.model.ScanPolicy
import dev.photocleaner.features.scan.model.ScanProgress
import dev.photocleaner.features.scan.model.ScanState
import dev.photocleaner.features.shared.protection.model.AlbumIssueKind
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.features.shared.protection.model.InventoryClassification
import dev.photocleaner.features.shared.protection.model.ProtectionReason
import dev.photocleaner.features.shared.protection.model.UnknownReason
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.inventory.SqlInventoryRepository
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.ScanPhase
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.services.connector.domain.MediaType
import dev.photocleaner.services.connector.domain.fake.FakePhotosConnector
import dev.photocleaner.services.connector.domain.fake.fakeAlbum
import dev.photocleaner.services.connector.domain.fake.fakeItem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.last
import kotlinx.coroutines.flow.takeWhile
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest

class ScanInventoryUseCaseTest {

    private val repository = SqlInventoryRepository.inMemory()
    private var now = 1_000_000_000L
    private val policy = ScanPolicy(pacingMs = 0, transientBaseDelayMs = 10, rateLimitBaseDelayMs = 10)

    private fun scan(connector: FakePhotosConnector) = ScanInventoryUseCase(connector, repository, { now }, policy)

    private suspend fun scanToEnd(connector: FakePhotosConnector): ScanProgress = scan(connector).execute().last()

    private suspend fun classify(): InventoryClassification = ClassifyInventoryUseCase(repository, { now }).execute()!!

    private fun InventoryClassification.eligibility(index: Int) = items.single { it.item.mediaKey == "lib-$index" }.eligibility

    private fun InventoryClassification.eligibleIndexes() =
        items.filter { it.eligibility == Eligibility.ELIGIBLE }.map { it.item.mediaKey.removePrefix("lib-").toInt() }.sorted()

    /** 10 photos over 4 library pages; 1 and 2 are favourites; albums A = {2,3,4}, B = {4,5}. */
    private fun standardAccount() = FakePhotosConnector(
        library = (0 until 10).map { fakeItem(it, favourite = it in setOf(1, 2)) },
        albums = listOf(fakeAlbum("A", listOf(2, 3, 4)), fakeAlbum("B", listOf(4, 5), shared = true)),
    )

    @Test
    fun `enumerates every page and classifies by favourites and albums`() = runTest {
        val connector = standardAccount()
        val last = scanToEnd(connector)

        assertEquals(ScanState.COMPLETED, last.state)
        assertEquals(10, last.libraryEntries)
        assertEquals(4, last.libraryPages)
        assertEquals(2, last.albumsRead)
        val result = classify()
        assertTrue(result.report.coverage.isComplete)
        assertEquals(listOf(0, 6, 7, 8, 9), result.eligibleIndexes())
        val photos = result.report.counts.single { it.mediaType == StoredMediaType.PHOTO }
        assertEquals(10, photos.total)
        assertEquals(5, photos.protectedTotal, "item 4 is in two albums and item 2 is a favourite in an album; each counts once")
        assertEquals(1, photos.protectedByFavouriteAndAlbum)
        assertEquals(5, photos.eligible)
        assertEquals(0, photos.unknown)
    }

    @Test
    fun `album entries protect through the dedup key, not the album-scoped media key`() = runTest {
        scanToEnd(standardAccount())
        val result = classify()
        val item3 = result.items.single { it.item.mediaKey == "lib-3" }
        assertEquals(Eligibility.PROTECTED, item3.eligibility)
        assertEquals(setOf(ProtectionReason.IN_ALBUM), item3.protectionReasons)
    }

    @Test
    fun `missing or negative proof makes items unknown, never eligible`() = runTest {
        val connector = FakePhotosConnector(
            library = listOf(
                fakeItem(0),
                fakeItem(1, favourite = null),
                fakeItem(2, archived = null),
                fakeItem(3, owned = false),
                fakeItem(4, owned = null),
                fakeItem(5, type = null),
                fakeItem(6, favourite = null),
                fakeItem(7, archived = true),
            ),
            favourites = listOf(fakeItem(6, favourite = null)),
        )
        scanToEnd(connector)
        val result = classify()
        assertEquals(listOf(0), result.eligibleIndexes())
        val reasons = result.items.associate { it.item.mediaKey to it.unknownReasons }
        assertEquals(setOf(UnknownReason.FAVOURITE_FLAG_MISSING), reasons["lib-1"])
        assertEquals(setOf(UnknownReason.ARCHIVE_FLAG_MISSING), reasons["lib-2"])
        assertEquals(setOf(UnknownReason.NOT_OWNED), reasons["lib-3"])
        assertEquals(setOf(UnknownReason.NOT_OWNED), reasons["lib-4"])
        assertEquals(setOf(UnknownReason.MEDIA_TYPE_UNKNOWN), reasons["lib-5"])
        assertEquals(Eligibility.PROTECTED, result.eligibility(6), "the favourites listing protects even without the flag")
        assertEquals(Eligibility.PROTECTED, result.eligibility(7), "archived photos are protected")
    }

    @Test
    fun `the archive listing protects items whose archived flag is false`() = runTest {
        val connector = standardAccount().apply { archive = listOf(library[7], library[8]) }
        scanToEnd(connector)
        val result = classify()
        assertEquals(listOf(0, 6, 9), result.eligibleIndexes())
        assertEquals(setOf(ProtectionReason.ARCHIVED), result.items.single { it.item.mediaKey == "lib-7" }.protectionReasons)
        val archive = result.report.coverage.archive
        assertEquals(2, archive.listed)
        assertEquals(0, archive.flagged)
        assertEquals(2, archive.listedButNotFlagged)
        assertEquals(2, result.report.counts.single { it.mediaType == StoredMediaType.PHOTO }.protectedByArchive)
    }

    @Test
    fun `progress reports how far back in time the library has been read`() = runTest {
        val connector = standardAccount()
        val progress = scan(connector).execute().toList()
        val firstLibraryPage = progress.first { it.libraryPages == 1 }
        assertEquals(connector.library[2].takenAtMs, firstLibraryPage.scannedBackToMs)
        assertEquals(connector.library.last().takenAtMs, progress.last().scannedBackToMs)
    }

    @Test
    fun `an inaccessible shared album makes every unprotected item unknown`() = runTest {
        val connector = standardAccount().apply { inaccessibleAlbums = setOf("B") }
        val last = scanToEnd(connector)

        assertEquals(ScanState.COMPLETED, last.state)
        assertEquals(1, last.albumsFailed)
        val result = classify()
        assertTrue(!result.report.coverage.isComplete)
        assertEquals(AlbumIssueKind.FAILED, result.report.coverage.albumIssues.single().kind)
        assertEquals(emptyList(), result.eligibleIndexes())
        assertEquals(Eligibility.PROTECTED, result.eligibility(1), "positive evidence still protects")
        assertEquals(Eligibility.UNKNOWN, result.eligibility(5), "item 5 is only in the unreadable album")
        assertTrue(UnknownReason.INVENTORY_INCOMPLETE in result.items.single { it.item.mediaKey == "lib-0" }.unknownReasons)
    }

    @Test
    fun `a permission-denied album with a healthy session is recorded as failed`() = runTest {
        val connector = standardAccount()
        connector.failure = { op, _ -> if (op == "album:B") ConnectorException.SessionExpired("denied", 403) else null }
        val last = scanToEnd(connector)
        assertEquals(ScanState.COMPLETED, last.state)
        assertEquals(1, last.albumsFailed)
        assertEquals(emptyList(), classify().eligibleIndexes())
    }

    @Test
    fun `an album whose entry count differs from Google's count blocks eligibility`() = runTest {
        val connector = FakePhotosConnector(
            library = (0 until 6).map { fakeItem(it) },
            albums = listOf(fakeAlbum("A", listOf(1, 2), reportedCount = 3)),
        )
        scanToEnd(connector)
        val result = classify()
        assertEquals(AlbumIssueKind.COUNT_MISMATCH, result.report.coverage.albumIssues.single().kind)
        assertEquals(emptyList(), result.eligibleIndexes())
    }

    @Test
    fun `transient failures are retried and the result is unchanged`() = runTest {
        val connector = standardAccount()
        connector.failure = { _, call -> if (call in setOf(2, 3, 7)) ConnectorException.Transient("network", null) else null }
        val last = scanToEnd(connector)
        assertEquals(ScanState.COMPLETED, last.state)
        assertEquals(listOf(0, 6, 7, 8, 9), classify().eligibleIndexes())
    }

    @Test
    fun `persistent rate limiting pauses, and resuming completes without duplicates`() = runTest {
        val connector = standardAccount()
        connector.failure = { op, call -> if (op == "favourites" && call < 12) ConnectorException.RateLimited("429", 429, null) else null }
        val paused = scanToEnd(connector)
        assertEquals(ScanState.PAUSED, paused.state)
        assertEquals(RunStatus.PAUSED, repository.latestRun()!!.status)
        assertEquals(emptyList(), classify().eligibleIndexes(), "a paused scan proves nothing")

        connector.failure = { _, _ -> null }
        val resumed = scanToEnd(connector)
        assertEquals(ScanState.COMPLETED, resumed.state)
        assertEquals(10, resumed.libraryEntries)
        assertEquals(0, repository.cursor(repository.latestRun()!!.id, ScanPhase.LIBRARY)!!.duplicateEntries)
        assertEquals(listOf(0, 6, 7, 8, 9), classify().eligibleIndexes())
    }

    @Test
    fun `after a lost session a fresh instance resumes from the saved page`() = runTest {
        val connector = standardAccount()
        connector.failure = { op, call -> if (op == "library" && call == 3) ConnectorException.SessionExpired("signed out", 401) else null }
        val paused = scanToEnd(connector)
        assertEquals(ScanState.PAUSED, paused.state)
        assertEquals(6, paused.libraryEntries)

        // Simulates an app restart: new use case, same database.
        connector.failure = { _, _ -> null }
        connector.calls.clear()
        val resumed = ScanInventoryUseCase(connector, repository, { now }, policy).execute().last()
        assertEquals(ScanState.COMPLETED, resumed.state)
        assertEquals(2, connector.calls.count { it == "library" }, "only the two remaining library pages are read again")
        assertEquals(10, resumed.libraryEntries)
        assertEquals(listOf(0, 6, 7, 8, 9), classify().eligibleIndexes())
    }

    @Test
    fun `stopping the collector pauses the run and it resumes later`() = runTest {
        val connector = standardAccount()
        val seen = scan(connector).execute().takeWhile { it.libraryPages < 2 }.toList()
        assertTrue(seen.isNotEmpty())
        assertEquals(RunStatus.PAUSED, repository.latestRun()!!.status)
        assertEquals(ScanState.PAUSED, GetScanStatusUseCase(repository).execute().state)

        assertEquals(ScanState.COMPLETED, scanToEnd(connector).state)
        assertEquals(listOf(0, 6, 7, 8, 9), classify().eligibleIndexes())
    }

    @Test
    fun `an expired saved page token restarts that phase from the beginning`() = runTest {
        val connector = standardAccount()
        connector.failure = { op, call -> if (op == "library" && call == 3) ConnectorException.SessionExpired("signed out", 401) else null }
        scanToEnd(connector)
        connector.failure = { _, _ -> null }
        connector.expireTokens()

        val resumed = scanToEnd(connector)
        assertEquals(ScanState.COMPLETED, resumed.state)
        assertEquals(10, resumed.libraryEntries)
        assertEquals(0, repository.cursor(repository.latestRun()!!.id, ScanPhase.LIBRARY)!!.duplicateEntries)
        assertEquals(listOf(0, 6, 7, 8, 9), classify().eligibleIndexes())
    }

    @Test
    fun `switching Google account mid-scan pauses and refuses to mix accounts`() = runTest {
        val connector = standardAccount()
        connector.failure = { op, call ->
            if (op == "library" && call == 3) connector.accountFingerprint = "account-b"
            null
        }
        val paused = scanToEnd(connector)
        assertEquals(ScanState.PAUSED, paused.state)
        assertEquals(6, paused.libraryEntries, "the other account's page is not stored")

        val refused = scanToEnd(connector)
        assertEquals(ScanState.PAUSED, refused.state)
        assertTrue(refused.notice!!.contains("different Google account"))

        connector.accountFingerprint = "account-a"
        assertEquals(ScanState.COMPLETED, scanToEnd(connector).state)
    }

    @Test
    fun `an unreadable response fails the scan and nothing becomes eligible`() = runTest {
        val connector = standardAccount()
        connector.failure = { op, _ -> if (op == "albums") ConnectorException.ProtocolMismatch("shape changed") else null }
        val last = scanToEnd(connector)
        assertEquals(ScanState.FAILED, last.state)
        assertEquals(RunStatus.FAILED, repository.latestRun()!!.status)
        assertEquals(emptyList(), classify().eligibleIndexes())
    }

    @Test
    fun `an old inventory no longer proves anything is unprotected`() = runTest {
        scanToEnd(standardAccount())
        now += 25L * 60 * 60 * 1000
        val result = classify()
        assertTrue(result.report.coverage.isStale)
        assertEquals(emptyList(), result.eligibleIndexes())
        assertEquals(Eligibility.UNKNOWN, result.eligibility(0))
    }

    @Test
    fun `discarding an unfinished scan makes the next scan start fresh`() = runTest {
        val connector = standardAccount()
        connector.failure = { op, call -> if (op == "library" && call == 2) ConnectorException.NotConnected() else null }
        scanToEnd(connector)
        val pausedRun = repository.latestRun()!!
        DiscardScanUseCase(repository, { now }).execute()
        assertEquals(RunStatus.CANCELLED, repository.latestRun()!!.status)

        connector.failure = { _, _ -> null }
        assertEquals(ScanState.COMPLETED, scanToEnd(connector).state)
        assertTrue(repository.latestRun()!!.id > pausedRun.id)
    }

    @Test
    fun `videos are classified but reported separately`() = runTest {
        val connector = FakePhotosConnector(library = listOf(fakeItem(0), fakeItem(1, type = MediaType.VIDEO)))
        scanToEnd(connector)
        val counts = classify().report.counts
        assertEquals(1, counts.single { it.mediaType == StoredMediaType.PHOTO }.total)
        assertEquals(1, counts.single { it.mediaType == StoredMediaType.VIDEO }.total)
    }
}
