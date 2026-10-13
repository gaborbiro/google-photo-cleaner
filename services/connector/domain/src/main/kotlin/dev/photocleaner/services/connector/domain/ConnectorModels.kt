package dev.photocleaner.services.connector.domain

enum class MediaType { PHOTO, VIDEO }

data class PhotosSession(
    val accountFingerprint: String,
    val photosTabCount: Int,
)

/** Nullable flags mean the service did not say; they are never defaulted. */
data class LibraryItem(
    val mediaKey: String,
    val dedupKey: String,
    val takenAtMs: Long,
    val uploadedAtMs: Long?,
    val mediaType: MediaType?,
    val isFavourite: Boolean?,
    val isArchived: Boolean?,
    val isOwned: Boolean?,
    val uploaderActorId: String?,
    val width: Int?,
    val height: Int?,
    val thumbUrl: String?,
)

data class LibraryPage(
    val items: List<LibraryItem>,
    val nextPageToken: String?,
    val lastItemTakenAtMs: Long?,
    val accountFingerprint: String,
    /** Content-free structure of the raw payload, as JSON, when requested. */
    val shapeSample: String?,
)

data class Album(
    val albumKey: String,
    val title: String?,
    val ownerActorId: String?,
    val reportedItemCount: Int?,
    val isShared: Boolean?,
    /** Raw album type code from the service; meaning is established by probing. */
    val kindCode: Int?,
    val authKey: String?,
)

data class AlbumsPage(
    val albums: List<Album>,
    val nextPageToken: String?,
    val accountFingerprint: String,
    val shapeSample: String?,
)

/** An album entry. Its [mediaKey] is album-scoped; [dedupKey] links it to the library. */
data class AlbumMember(
    val mediaKey: String,
    val dedupKey: String,
    val takenAtMs: Long,
    val mediaType: MediaType?,
    val uploaderActorId: String?,
)

data class AlbumItemsPage(
    val albumKey: String?,
    val items: List<AlbumMember>,
    val nextPageToken: String?,
    val reportedItemCount: Int?,
    val ownerActorId: String?,
    val accountFingerprint: String,
    val shapeSample: String?,
)

class PreviewImage(
    val contentType: String,
    val bytes: ByteArray,
)
