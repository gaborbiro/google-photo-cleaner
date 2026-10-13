package dev.photocleaner.repositories.inventory.domain

/**
 * Persistent scan state. Every `save…Page` call stores the page's entries and
 * advances the phase cursor in one transaction, so a crash between pages never
 * leaves entries without a cursor or a cursor without entries.
 */
interface InventoryRepository {

    suspend fun latestRun(): ScanRun?

    suspend fun createRun(accountFingerprint: String, startedAtMs: Long): ScanRun

    suspend fun updateRunStatus(runId: Long, status: RunStatus, reason: String?, finishedAtMs: Long?)

    suspend fun cursor(runId: Long, phase: ScanPhase, scope: String = ""): PhaseCursor?

    suspend fun saveLibraryPage(runId: Long, items: List<InventoryItem>, nextPageToken: String?)

    suspend fun saveFavouritesPage(runId: Long, entries: List<FavouriteEntry>, nextPageToken: String?)

    suspend fun saveArchivePage(runId: Long, entries: List<ArchiveEntry>, nextPageToken: String?)

    /** Taken time of the oldest library item stored so far; the library is read newest first. */
    suspend fun oldestTakenAtMs(runId: Long): Long?

    suspend fun saveAlbumsPage(runId: Long, albums: List<AlbumRecord>, nextPageToken: String?)

    suspend fun saveAlbumMembersPage(runId: Long, albumKey: String, members: List<AlbumMemberEntry>, nextPageToken: String?)

    suspend fun markAlbumFailed(runId: Long, albumKey: String, reason: String)

    /** Drops a phase's entries and cursor so it can be enumerated again from the start. */
    suspend fun resetPhase(runId: Long, phase: ScanPhase, scope: String = "")

    suspend fun albums(runId: Long): List<AlbumStatus>

    suspend fun snapshot(runId: Long): InventorySnapshot

    /** Removes all runs except [keepRunId]. */
    suspend fun deleteOtherRuns(keepRunId: Long)
}
