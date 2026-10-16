package dev.photocleaner.repositories.inventory.domain

enum class RunStatus {
    /** In progress, or interrupted by a crash; resumable. */
    RUNNING,

    /** Stopped by the user or by a recoverable problem; resumable. */
    PAUSED,

    /** Abandoned by the user; never used for classification. */
    CANCELLED,

    /** Every phase finished. */
    COMPLETED,

    /** Stopped by a problem that needs a code or account fix; not resumable. */
    FAILED,
}

enum class ScanPhase { LIBRARY, FAVOURITES, ARCHIVE, ALBUM_LIST, ALBUM_MEMBERS }

enum class StoredMediaType { PHOTO, VIDEO }

data class ScanRun(
    val id: Long,
    val accountFingerprint: String,
    val startedAtMs: Long,
    val finishedAtMs: Long?,
    val status: RunStatus,
    val statusReason: String?,
)

/** Resume point of one phase; [scope] is the album key for album members, empty otherwise. */
data class PhaseCursor(
    val phase: ScanPhase,
    val scope: String,
    val nextPageToken: String?,
    val pagesDone: Int,
    val entriesSeen: Int,
    val duplicateEntries: Int,
    val completed: Boolean,
)

data class InventoryItem(
    val mediaKey: String,
    val dedupKey: String,
    val takenAtMs: Long,
    val mediaType: StoredMediaType?,
    val isFavourite: Boolean?,
    val isArchived: Boolean?,
    val isOwned: Boolean?,
    val width: Int?,
    val height: Int?,
    val thumbUrl: String?,
)

data class FavouriteEntry(val mediaKey: String, val dedupKey: String)

data class ArchiveEntry(val mediaKey: String, val dedupKey: String)

data class AlbumRecord(
    val albumKey: String,
    val title: String?,
    val ownerActorId: String?,
    val isShared: Boolean?,
    val kindCode: Int?,
    val reportedItemCount: Int?,
    val authKey: String?,
)

data class AlbumMemberEntry(val mediaKey: String, val dedupKey: String)

/** How a second read of an album's entries compared with the first. */
enum class AlbumReread { SAME_ENTRIES, DIFFERENT_ENTRIES }

/** An album with the outcome of enumerating its members in a run. */
data class AlbumStatus(
    val album: AlbumRecord,
    val membersSeen: Int,
    val membersComplete: Boolean,
    val failureReason: String?,
    /** The outcome of reading the album again after its entries didn't add up to Google's count; null if it wasn't. */
    val reread: AlbumReread?,
)

/** Everything recorded in one run, for classification. */
data class InventorySnapshot(
    val run: ScanRun,
    val cursors: List<PhaseCursor>,
    val items: List<InventoryItem>,
    val favouriteDedupKeys: Set<String>,
    val archivedDedupKeys: Set<String>,
    val albums: List<AlbumStatus>,
    /** dedupKey -> keys of the albums it appears in. */
    val albumMembership: Map<String, Set<String>>,
)
