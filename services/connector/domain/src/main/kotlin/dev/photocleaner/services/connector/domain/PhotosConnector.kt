package dev.photocleaner.services.connector.domain

/**
 * Read-only access to the signed-in Google Photos account, through the browser
 * extension. Every call is a single attempt; retries and pacing belong to the
 * caller. Failures are thrown as [ConnectorException] subclasses.
 */
interface PhotosConnector {

    suspend fun sessionStatus(): PhotosSession

    /** Library (including archive), newest taken first. */
    suspend fun libraryPage(
        pageToken: String?,
        takenAtOrBeforeMs: Long? = null,
        includeShape: Boolean = false,
    ): LibraryPage

    suspend fun favouritesPage(pageToken: String?, includeShape: Boolean = false): LibraryPage

    /** Archived items only, newest taken first. */
    suspend fun archivePage(pageToken: String?, includeShape: Boolean = false): LibraryPage

    suspend fun albumsPage(pageToken: String?, includeShape: Boolean = false): AlbumsPage

    suspend fun albumItemsPage(
        albumKey: String,
        authKey: String?,
        pageToken: String?,
        includeShape: Boolean = false,
    ): AlbumItemsPage

    suspend fun preview(thumbUrl: String, sizePx: Int): PreviewImage
}
