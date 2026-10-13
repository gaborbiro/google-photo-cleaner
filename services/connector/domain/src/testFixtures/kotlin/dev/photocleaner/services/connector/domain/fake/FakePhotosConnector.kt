package dev.photocleaner.services.connector.domain.fake

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

/** Synthetic library item; keys are derived from [index] and never resemble real ones. */
fun fakeItem(
    index: Int,
    favourite: Boolean? = false,
    archived: Boolean? = false,
    owned: Boolean? = true,
    type: MediaType? = MediaType.PHOTO,
    thumbUrl: String? = "https://photos.fife.usercontent.google.com/pw/thumb-$index",
) = LibraryItem(
    mediaKey = "lib-$index",
    dedupKey = "dedup-$index",
    takenAtMs = 10_000_000L - index * 1_000L,
    uploadedAtMs = null,
    mediaType = type,
    isFavourite = favourite,
    isArchived = archived,
    isOwned = owned,
    uploaderActorId = null,
    width = 100,
    height = 100,
    thumbUrl = thumbUrl,
)

/** Album entry for library item [index]: album-scoped media key, shared dedup key. */
fun fakeMember(albumKey: String, index: Int) =
    AlbumMember("$albumKey-entry-$index", "dedup-$index", 10_000_000L - index * 1_000L, MediaType.PHOTO, "actor-me")

data class FakeAlbum(
    val album: Album,
    val members: List<AlbumMember>,
)

fun fakeAlbum(key: String, memberIndexes: List<Int>, reportedCount: Int? = memberIndexes.size, shared: Boolean? = null, owner: String = "actor-me") =
    FakeAlbum(Album(key, "Album $key", owner, reportedCount, shared, if (shared == true) 4 else 1, null), memberIndexes.map { fakeMember(key, it) })

/**
 * In-memory Google Photos with token paging. Tokens carry a generation so tests
 * can expire them, and [failure] can inject a [ConnectorException] into any call.
 */
class FakePhotosConnector(
    var library: List<LibraryItem>,
    var favourites: List<LibraryItem> = library.filter { it.isFavourite == true },
    var albums: List<FakeAlbum> = emptyList(),
    var archive: List<LibraryItem> = library.filter { it.isArchived == true },
    private val libraryPageSize: Int = 3,
    private val favouritesPageSize: Int = 2,
    private val archivePageSize: Int = 2,
    private val albumsPageSize: Int = 2,
    private val membersPageSize: Int = 2,
) : PhotosConnector {

    var accountFingerprint = "account-a"

    /** Operation names in call order, e.g. "library", "favourites", "archive", "albums", "album:<key>", "preview". */
    val calls = mutableListOf<String>()

    /** Returns an exception to throw for the n-th (0-based) call overall, or null to answer normally. */
    var failure: (op: String, callIndex: Int) -> ConnectorException? = { _, _ -> null }

    /** Albums whose contents always fail, e.g. a shared album that is no longer accessible. */
    var inaccessibleAlbums: Set<String> = emptySet()

    /** Thumb URLs that answer as expired. */
    var expiredThumbUrls: Set<String> = emptySet()

    private var tokenGeneration = 1

    fun expireTokens() {
        tokenGeneration++
    }

    private fun before(op: String) {
        val index = calls.size
        calls += op
        failure(op, index)?.let { throw it }
    }

    private fun offsetOf(token: String?, prefix: String): Int {
        if (token == null) return 0
        val parts = token.split(":")
        if (parts.size != 3 || parts[0] != prefix) throw ConnectorException.RpcFailed("unknown token", null, 3)
        if (parts[1].toInt() != tokenGeneration) throw ConnectorException.RpcFailed("expired token", null, 3)
        return parts[2].toInt()
    }

    private fun tokenAfter(prefix: String, offset: Int, size: Int, total: Int): String? =
        (offset + size).takeIf { it < total }?.let { "$prefix:$tokenGeneration:$it" }

    override suspend fun sessionStatus(): PhotosSession {
        before("session")
        return PhotosSession(accountFingerprint, 1)
    }

    override suspend fun libraryPage(pageToken: String?, takenAtOrBeforeMs: Long?, includeShape: Boolean): LibraryPage {
        before("library")
        val start = if (takenAtOrBeforeMs != null && pageToken == null) {
            library.indexOfFirst { it.takenAtMs <= takenAtOrBeforeMs }.coerceAtLeast(0)
        } else {
            offsetOf(pageToken, "lib")
        }
        val slice = library.drop(start).take(libraryPageSize)
        return LibraryPage(slice, tokenAfter("lib", start, libraryPageSize, library.size), slice.lastOrNull()?.takenAtMs, accountFingerprint, null)
    }

    override suspend fun favouritesPage(pageToken: String?, includeShape: Boolean): LibraryPage {
        before("favourites")
        val start = offsetOf(pageToken, "fav")
        val slice = favourites.drop(start).take(favouritesPageSize)
        return LibraryPage(slice, tokenAfter("fav", start, favouritesPageSize, favourites.size), null, accountFingerprint, null)
    }

    override suspend fun archivePage(pageToken: String?, includeShape: Boolean): LibraryPage {
        before("archive")
        val start = offsetOf(pageToken, "arc")
        val slice = archive.drop(start).take(archivePageSize)
        return LibraryPage(slice, tokenAfter("arc", start, archivePageSize, archive.size), null, accountFingerprint, null)
    }

    override suspend fun albumsPage(pageToken: String?, includeShape: Boolean): AlbumsPage {
        before("albums")
        val start = offsetOf(pageToken, "albums")
        val slice = albums.drop(start).take(albumsPageSize).map { it.album }
        return AlbumsPage(slice, tokenAfter("albums", start, albumsPageSize, albums.size), accountFingerprint, null)
    }

    override suspend fun albumItemsPage(albumKey: String, authKey: String?, pageToken: String?, includeShape: Boolean): AlbumItemsPage {
        before("album:$albumKey")
        if (albumKey in inaccessibleAlbums) throw ConnectorException.RpcFailed("album not accessible", null, 5)
        val album = albums.firstOrNull { it.album.albumKey == albumKey }
            ?: throw ConnectorException.RpcFailed("album not found", null, 5)
        val prefix = "m-$albumKey"
        val start = offsetOf(pageToken, prefix)
        val slice = album.members.drop(start).take(membersPageSize)
        return AlbumItemsPage(
            albumKey = albumKey,
            items = slice,
            nextPageToken = tokenAfter(prefix, start, membersPageSize, album.members.size),
            reportedItemCount = album.album.reportedItemCount,
            ownerActorId = album.album.ownerActorId,
            accountFingerprint = accountFingerprint,
            shapeSample = null,
        )
    }

    override suspend fun preview(thumbUrl: String, sizePx: Int): PreviewImage {
        before("preview")
        if (thumbUrl in expiredThumbUrls) throw ConnectorException.PreviewUnavailable("HTTP 403 fetching preview", 403)
        return PreviewImage("image/png", PNG_1X1)
    }

    companion object {
        /** A valid 1×1 transparent PNG. */
        val PNG_1X1: ByteArray = java.util.Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        )
    }
}
