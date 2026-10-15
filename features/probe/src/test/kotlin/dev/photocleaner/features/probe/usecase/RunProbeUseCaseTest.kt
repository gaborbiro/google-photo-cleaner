package dev.photocleaner.features.probe.usecase

import dev.photocleaner.features.probe.model.ProbeOutcome
import dev.photocleaner.features.probe.model.ProbeReport
import dev.photocleaner.services.connector.domain.Album
import dev.photocleaner.services.connector.domain.AlbumItemsPage
import dev.photocleaner.services.connector.domain.AlbumMember
import dev.photocleaner.services.connector.domain.AlbumsPage
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.services.connector.domain.LibraryItem
import dev.photocleaner.services.connector.domain.LibraryPage
import dev.photocleaner.services.connector.domain.MediaType
import dev.photocleaner.services.connector.domain.PhotosConnector
import dev.photocleaner.services.connector.domain.PhotosSession
import dev.photocleaner.services.connector.domain.PreviewImage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.last
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json

private const val ME = "actor-me"
private const val OTHER = "actor-other"
private const val ACCOUNT = "fingerprint"

/** In-memory library: 1200 items, newest first, three favourites, three albums. */
private class FakeLibrary(
    val favouriteFlag: (index: Int) -> Boolean? = { it in FAVOURITES },
    val favouritesListing: List<Int> = FAVOURITES,
    val sessionFails: Boolean = false,
) : PhotosConnector {

    val items = (0 until 1200).map { i ->
        LibraryItem(
            mediaKey = "lib-$i", dedupKey = "dedup-$i", takenAtMs = 2_000_000L - i * 1000L, uploadedAtMs = null,
            mediaType = if (i % 50 == 0) MediaType.VIDEO else MediaType.PHOTO, isFavourite = favouriteFlag(i),
            isArchived = false, isOwned = true, uploaderActorId = null, width = 10, height = 10,
            thumbUrl = "https://photos.fife.usercontent.google.com/pw/secret-thumb-$i",
        )
    }
    val albums = listOf(
        Album("album-own", "Private holiday title", ME, 2, null, 1, null),
        Album("album-shared", "Shared title", ME, 1, true, 4, "auth-key"),
        Album("album-joined", "Friend's title", OTHER, 2, true, 4, "auth-key-2"),
    )
    val members = mapOf(
        "album-own" to listOf(member(10), member(700)),
        "album-shared" to listOf(member(20)),
        "album-joined" to listOf(member(30, OTHER), member(40)),
    )

    private fun member(i: Int, uploader: String = ME) =
        AlbumMember("album-scoped-$i", "dedup-$i", items[i].takenAtMs, MediaType.PHOTO, uploader)

    override suspend fun sessionStatus(): PhotosSession {
        if (sessionFails) throw ConnectorException.SessionExpired("signed out", 401)
        return PhotosSession(ACCOUNT, 1)
    }

    override suspend fun libraryPage(pageToken: String?, takenAtOrBeforeMs: Long?, includeShape: Boolean): LibraryPage {
        val start = when {
            pageToken != null -> pageToken.toInt()
            takenAtOrBeforeMs != null -> items.indexOfFirst { it.takenAtMs <= takenAtOrBeforeMs }
            else -> 0
        }
        val slice = items.drop(start).take(500)
        val next = (start + 500).takeIf { it < items.size }?.toString()
        return LibraryPage(slice, next, slice.lastOrNull()?.takenAtMs, ACCOUNT, if (includeShape) "[[\"s\"]]" else null)
    }

    override suspend fun favouritesPage(pageToken: String?, includeShape: Boolean): LibraryPage {
        val favs = favouritesListing.map { items[it].copy(uploaderActorId = ME, isFavourite = true) }
        return LibraryPage(favs, null, null, ACCOUNT, null)
    }

    override suspend fun archivePage(pageToken: String?, includeShape: Boolean) = LibraryPage(emptyList(), null, null, ACCOUNT, null)

    override suspend fun albumsPage(pageToken: String?, includeShape: Boolean) = AlbumsPage(albums, null, ACCOUNT, null)

    override suspend fun albumItemsPage(albumKey: String, authKey: String?, pageToken: String?, includeShape: Boolean): AlbumItemsPage {
        val list = members.getValue(albumKey)
        return AlbumItemsPage(albumKey, list, null, albums.first { it.albumKey == albumKey }.reportedItemCount, null, ACCOUNT, null)
    }

    override suspend fun preview(thumbUrl: String, sizePx: Int) = PreviewImage("image/jpeg", ByteArray(2048))

    companion object {
        val FAVOURITES = listOf(5, 600, 1100)
    }
}

class RunProbeUseCaseTest {

    private suspend fun probe(connector: PhotosConnector): ProbeReport =
        RunProbeUseCase(connector, pacingMs = 0).execute().last().report!!

    private fun ProbeReport.outcome(id: String) = checks.single { it.id == id }.outcome

    @Test
    fun `a consistent account passes every check`() = runTest {
        val report = probe(FakeLibrary())
        assertEquals(setOf(
            "google-photos-session", "library-first-page", "library-pagination", "favourites-listing",
            "favourites-agree-with-library-flags", "album-list", "album-contents-link-to-library-photos", "previews", "requests",
        ), report.checks.map { it.id }.toSet())
        val failed = report.checks.filter { it.outcome != ProbeOutcome.PASS }
        assertTrue(failed.isEmpty(), "unexpected: ${failed.map { "${it.id}=${it.outcome}: ${it.summary}" }}")
    }

    @Test
    fun `missing favourite flags are reported, not assumed false`() = runTest {
        val report = probe(FakeLibrary(favouriteFlag = { if (it == 3) null else it in FakeLibrary.FAVOURITES }))
        assertEquals(ProbeOutcome.WARN, report.outcome("library-first-page"))
    }

    @Test
    fun `a favourite the library does not flag fails the agreement check`() = runTest {
        val report = probe(FakeLibrary(favouriteFlag = { it in listOf(5, 1100) }))
        assertEquals(ProbeOutcome.FAIL, report.outcome("favourites-agree-with-library-flags"))
    }

    @Test
    fun `a flagged favourite missing from the listing fails the agreement check`() = runTest {
        val report = probe(FakeLibrary(favouriteFlag = { it in listOf(5, 6, 600, 1100) }))
        assertEquals(ProbeOutcome.FAIL, report.outcome("favourites-agree-with-library-flags"))
    }

    @Test
    fun `no favourites asks the user to create one`() = runTest {
        val report = probe(FakeLibrary(favouriteFlag = { false }, favouritesListing = emptyList()))
        assertEquals(ProbeOutcome.WARN, report.outcome("favourites-listing"))
        assertEquals(ProbeOutcome.SKIPPED, report.outcome("favourites-agree-with-library-flags"))
    }

    @Test
    fun `a failed session skips everything else`() = runTest {
        val report = probe(FakeLibrary(sessionFails = true))
        assertEquals(9, report.checks.size, "the failed session must explicitly skip the remaining checks")
        assertEquals(ProbeOutcome.FAIL, report.outcome("google-photos-session"))
        assertTrue(report.checks.drop(1).dropLast(1).all { it.outcome == ProbeOutcome.SKIPPED })
    }

    @Test
    fun `the report contains no keys, titles or URLs`() = runTest {
        val report = probe(FakeLibrary())
        assertEquals(9, report.checks.size, "privacy must be checked on a populated report")
        val text = Json.encodeToString(ProbeReport.serializer(), report)
        listOf("lib-", "dedup-", "album-scoped", "album-own", "holiday", "Friend", "secret-thumb", "auth-key", ME, OTHER, ACCOUNT)
            .forEach { assertFalse(it in text, "report leaks '$it'") }
    }
}
