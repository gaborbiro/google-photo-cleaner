package dev.photocleaner.repositories.inventory

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import dev.photocleaner.repositories.inventory.db.InventoryDatabase
import dev.photocleaner.repositories.inventory.db.InventoryQueries
import dev.photocleaner.repositories.inventory.db.Phase_cursor
import dev.photocleaner.repositories.inventory.db.Scan_run
import dev.photocleaner.repositories.inventory.domain.AlbumMemberEntry
import dev.photocleaner.repositories.inventory.domain.AlbumRecord
import dev.photocleaner.repositories.inventory.domain.AlbumStatus
import dev.photocleaner.repositories.inventory.domain.ArchiveEntry
import dev.photocleaner.repositories.inventory.domain.FavouriteEntry
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.InventoryRepository
import dev.photocleaner.repositories.inventory.domain.InventorySnapshot
import dev.photocleaner.repositories.inventory.domain.PhaseCursor
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.ScanPhase
import dev.photocleaner.repositories.inventory.domain.ScanRun
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import java.nio.file.Files
import java.nio.file.Path
import java.util.Properties
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class SqlInventoryRepository(
    database: InventoryDatabase,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : InventoryRepository {

    private val q: InventoryQueries = database.inventoryQueries

    override suspend fun latestRun(): ScanRun? = withContext(io) {
        q.selectLatestRun().executeAsOneOrNull()?.toDomain()
    }

    override suspend fun createRun(accountFingerprint: String, startedAtMs: Long): ScanRun = withContext(io) {
        q.transactionWithResult {
            q.insertRun(accountFingerprint, startedAtMs, RunStatus.RUNNING.name)
            val id = q.lastInsertedId().executeAsOne()
            q.selectRun(id).executeAsOne().toDomain()
        }
    }

    override suspend fun updateRunStatus(runId: Long, status: RunStatus, reason: String?, finishedAtMs: Long?) {
        withContext(io) { q.updateRunStatus(status.name, reason, finishedAtMs, runId) }
    }

    override suspend fun cursor(runId: Long, phase: ScanPhase, scope: String): PhaseCursor? = withContext(io) {
        q.selectCursor(runId, phase.name, scope).executeAsOneOrNull()?.toDomain()
    }

    override suspend fun saveLibraryPage(runId: Long, items: List<InventoryItem>, nextPageToken: String?) = withContext(io) {
        q.transaction {
            val duplicates = items.count { item ->
                q.insertItem(
                    run_id = runId,
                    media_key = item.mediaKey,
                    dedup_key = item.dedupKey,
                    taken_at = item.takenAtMs,
                    media_type = item.mediaType?.name,
                    is_favourite = item.isFavourite,
                    is_archived = item.isArchived,
                    is_owned = item.isOwned,
                    width = item.width?.toLong(),
                    height = item.height?.toLong(),
                    thumb_url = item.thumbUrl,
                )
                q.changes().executeAsOne() == 0L
            }
            advance(runId, ScanPhase.LIBRARY, "", items.size, duplicates, nextPageToken)
        }
    }

    override suspend fun saveFavouritesPage(runId: Long, entries: List<FavouriteEntry>, nextPageToken: String?) = withContext(io) {
        q.transaction {
            val duplicates = entries.count { entry ->
                q.insertFavourite(runId, entry.mediaKey, entry.dedupKey)
                q.changes().executeAsOne() == 0L
            }
            advance(runId, ScanPhase.FAVOURITES, "", entries.size, duplicates, nextPageToken)
        }
    }

    override suspend fun saveArchivePage(runId: Long, entries: List<ArchiveEntry>, nextPageToken: String?) = withContext(io) {
        q.transaction {
            val duplicates = entries.count { entry ->
                q.insertArchived(runId, entry.mediaKey, entry.dedupKey)
                q.changes().executeAsOne() == 0L
            }
            advance(runId, ScanPhase.ARCHIVE, "", entries.size, duplicates, nextPageToken)
        }
    }

    override suspend fun oldestTakenAtMs(runId: Long): Long? = withContext(io) {
        q.selectOldestTakenAt(runId).executeAsOne().oldest
    }

    override suspend fun saveAlbumsPage(runId: Long, albums: List<AlbumRecord>, nextPageToken: String?) = withContext(io) {
        q.transaction {
            val duplicates = albums.count { album ->
                q.insertAlbum(
                    run_id = runId,
                    album_key = album.albumKey,
                    title = album.title,
                    owner_actor_id = album.ownerActorId,
                    is_shared = album.isShared,
                    kind_code = album.kindCode?.toLong(),
                    reported_count = album.reportedItemCount?.toLong(),
                    auth_key = album.authKey,
                )
                q.changes().executeAsOne() == 0L
            }
            advance(runId, ScanPhase.ALBUM_LIST, "", albums.size, duplicates, nextPageToken)
        }
    }

    override suspend fun saveAlbumMembersPage(runId: Long, albumKey: String, members: List<AlbumMemberEntry>, nextPageToken: String?) =
        withContext(io) {
            q.transaction {
                val duplicates = members.count { member ->
                    q.insertAlbumMember(runId, albumKey, member.mediaKey, member.dedupKey)
                    q.changes().executeAsOne() == 0L
                }
                advance(runId, ScanPhase.ALBUM_MEMBERS, albumKey, members.size, duplicates, nextPageToken)
            }
        }

    override suspend fun markAlbumFailed(runId: Long, albumKey: String, reason: String) {
        withContext(io) { q.markAlbumFailed(reason, runId, albumKey) }
    }

    override suspend fun resetPhase(runId: Long, phase: ScanPhase, scope: String) = withContext(io) {
        q.transaction {
            when (phase) {
                ScanPhase.LIBRARY -> q.deleteItems(runId)
                ScanPhase.FAVOURITES -> q.deleteFavourites(runId)
                ScanPhase.ARCHIVE -> q.deleteArchived(runId)
                ScanPhase.ALBUM_LIST -> {
                    q.deleteAlbums(runId)
                    q.deleteAllAlbumMembers(runId)
                    q.deleteCursorsOfPhase(runId, ScanPhase.ALBUM_MEMBERS.name)
                }
                ScanPhase.ALBUM_MEMBERS -> {
                    q.deleteAlbumMembers(runId, scope)
                    q.clearAlbumFailure(runId, scope)
                }
            }
            q.deleteCursor(runId, phase.name, scope)
        }
    }

    override suspend fun albums(runId: Long): List<AlbumStatus> = withContext(io) { loadAlbums(runId) }

    override suspend fun snapshot(runId: Long): InventorySnapshot = withContext(io) {
        q.transactionWithResult {
            val run = q.selectRun(runId).executeAsOne().toDomain()
            val membership = mutableMapOf<String, MutableSet<String>>()
            q.selectMembership(runId).executeAsList().forEach { row ->
                membership.getOrPut(row.dedup_key) { mutableSetOf() } += row.album_key
            }
            InventorySnapshot(
                run = run,
                cursors = q.selectCursors(runId).executeAsList().map { it.toDomain() },
                items = q.selectItems(runId).executeAsList().map { row ->
                    InventoryItem(
                        mediaKey = row.media_key,
                        dedupKey = row.dedup_key,
                        takenAtMs = row.taken_at,
                        mediaType = row.media_type?.let(StoredMediaType::valueOf),
                        isFavourite = row.is_favourite,
                        isArchived = row.is_archived,
                        isOwned = row.is_owned,
                        width = row.width?.toInt(),
                        height = row.height?.toInt(),
                        thumbUrl = row.thumb_url,
                    )
                },
                favouriteDedupKeys = q.selectFavouriteDedupKeys(runId).executeAsList().toSet(),
                archivedDedupKeys = q.selectArchivedDedupKeys(runId).executeAsList().toSet(),
                albums = loadAlbums(runId),
                albumMembership = membership,
            )
        }
    }

    override suspend fun deleteOtherRuns(keepRunId: Long) {
        withContext(io) { q.deleteOtherRuns(keepRunId) }
    }

    private fun loadAlbums(runId: Long): List<AlbumStatus> {
        val cursors = q.selectCursors(runId).executeAsList()
            .filter { it.phase == ScanPhase.ALBUM_MEMBERS.name }
            .associateBy { it.scope }
        return q.selectAlbums(runId).executeAsList().map { row ->
            AlbumStatus(
                album = AlbumRecord(
                    albumKey = row.album_key,
                    title = row.title,
                    ownerActorId = row.owner_actor_id,
                    isShared = row.is_shared,
                    kindCode = row.kind_code?.toInt(),
                    reportedItemCount = row.reported_count?.toInt(),
                    authKey = row.auth_key,
                ),
                membersSeen = row.members_seen.toInt(),
                membersComplete = cursors[row.album_key]?.completed == true,
                failureReason = row.failure_reason,
                // The desktop scan doesn't read albums a second time, so a count mismatch keeps blocking there.
                reread = null,
            )
        }
    }

    private fun advance(runId: Long, phase: ScanPhase, scope: String, received: Int, duplicates: Int, nextPageToken: String?) {
        val current = q.selectCursor(runId, phase.name, scope).executeAsOneOrNull()
        check(current?.completed != true) { "$phase is already complete for this run" }
        q.upsertCursor(
            run_id = runId,
            phase = phase.name,
            scope = scope,
            next_page_token = nextPageToken,
            pages_done = (current?.pages_done ?: 0) + 1,
            entries_seen = (current?.entries_seen ?: 0) + received,
            duplicate_entries = (current?.duplicate_entries ?: 0) + duplicates,
            completed = nextPageToken == null,
        )
    }

    private fun Scan_run.toDomain() = ScanRun(
        id = id,
        accountFingerprint = account_fingerprint,
        startedAtMs = started_at,
        finishedAtMs = finished_at,
        status = RunStatus.valueOf(status),
        statusReason = status_reason,
    )

    private fun Phase_cursor.toDomain() = PhaseCursor(
        phase = ScanPhase.valueOf(phase),
        scope = scope,
        nextPageToken = next_page_token,
        pagesDone = pages_done.toInt(),
        entriesSeen = entries_seen.toInt(),
        duplicateEntries = duplicate_entries.toInt(),
        completed = completed,
    )

    companion object {
        fun open(file: Path): SqlInventoryRepository {
            Files.createDirectories(file.parent)
            val driver = JdbcSqliteDriver("jdbc:sqlite:$file", Properties(), InventoryDatabase.Schema)
            return SqlInventoryRepository(InventoryDatabase(driver))
        }

        fun inMemory(): SqlInventoryRepository {
            val driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY, Properties(), InventoryDatabase.Schema)
            return SqlInventoryRepository(InventoryDatabase(driver))
        }
    }
}
