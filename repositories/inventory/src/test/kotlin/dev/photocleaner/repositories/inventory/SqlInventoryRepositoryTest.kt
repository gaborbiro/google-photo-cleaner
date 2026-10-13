package dev.photocleaner.repositories.inventory

import dev.photocleaner.repositories.inventory.domain.AlbumMemberEntry
import dev.photocleaner.repositories.inventory.domain.AlbumRecord
import dev.photocleaner.repositories.inventory.domain.FavouriteEntry
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.ScanPhase
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

class SqlInventoryRepositoryTest {

    private fun item(i: Int, favourite: Boolean? = false) =
        InventoryItem("m$i", "d$i", 1_000L - i, StoredMediaType.PHOTO, favourite, false, true, 1, 1, null)

    private fun album(key: String, count: Int?) = AlbumRecord(key, "t", "owner", null, 1, count, null)

    @Test
    fun `pages advance the cursor and count duplicates`() = runTest {
        val repo = SqlInventoryRepository.inMemory()
        val run = repo.createRun("acct", 1)
        repo.saveLibraryPage(run.id, listOf(item(1), item(2)), "t1")
        repo.saveLibraryPage(run.id, listOf(item(2), item(3)), null)

        val cursor = repo.cursor(run.id, ScanPhase.LIBRARY)!!
        assertEquals(2, cursor.pagesDone)
        assertEquals(4, cursor.entriesSeen)
        assertEquals(1, cursor.duplicateEntries)
        assertTrue(cursor.completed)
        assertEquals(3, repo.snapshot(run.id).items.size)
    }

    @Test
    fun `a completed phase cannot receive more pages`() = runTest {
        val repo = SqlInventoryRepository.inMemory()
        val run = repo.createRun("acct", 1)
        repo.saveFavouritesPage(run.id, listOf(FavouriteEntry("m1", "d1")), null)
        assertFailsWith<IllegalStateException> { repo.saveFavouritesPage(run.id, listOf(FavouriteEntry("m2", "d2")), null) }
        assertEquals(setOf("d1"), repo.snapshot(run.id).favouriteDedupKeys, "the rejected page left nothing behind")
    }

    @Test
    fun `album membership is keyed by dedup key and counted per album`() = runTest {
        val repo = SqlInventoryRepository.inMemory()
        val run = repo.createRun("acct", 1)
        repo.saveAlbumsPage(run.id, listOf(album("A", 2), album("B", 1)), null)
        repo.saveAlbumMembersPage(run.id, "A", listOf(AlbumMemberEntry("a-1", "d1"), AlbumMemberEntry("a-2", "d2")), null)
        repo.saveAlbumMembersPage(run.id, "B", listOf(AlbumMemberEntry("b-1", "d1")), null)

        val snapshot = repo.snapshot(run.id)
        assertEquals(setOf("A", "B"), snapshot.albumMembership["d1"])
        assertEquals(mapOf("A" to 2, "B" to 1), snapshot.albums.associate { it.album.albumKey to it.membersSeen })
        assertTrue(snapshot.albums.all { it.membersComplete })
    }

    @Test
    fun `resetting the album list clears albums, members and their cursors`() = runTest {
        val repo = SqlInventoryRepository.inMemory()
        val run = repo.createRun("acct", 1)
        repo.saveAlbumsPage(run.id, listOf(album("A", 1)), null)
        repo.saveAlbumMembersPage(run.id, "A", listOf(AlbumMemberEntry("a-1", "d1")), null)
        repo.resetPhase(run.id, ScanPhase.ALBUM_LIST)

        val snapshot = repo.snapshot(run.id)
        assertTrue(snapshot.albums.isEmpty())
        assertTrue(snapshot.albumMembership.isEmpty())
        assertNull(repo.cursor(run.id, ScanPhase.ALBUM_MEMBERS, "A"))
        assertNull(repo.cursor(run.id, ScanPhase.ALBUM_LIST))
    }

    @Test
    fun `a failed album keeps its reason until its members are reset`() = runTest {
        val repo = SqlInventoryRepository.inMemory()
        val run = repo.createRun("acct", 1)
        repo.saveAlbumsPage(run.id, listOf(album("A", 1)), null)
        repo.markAlbumFailed(run.id, "A", "denied")
        assertEquals("denied", repo.albums(run.id).single().failureReason)
        repo.resetPhase(run.id, ScanPhase.ALBUM_MEMBERS, "A")
        assertNull(repo.albums(run.id).single().failureReason)
    }

    @Test
    fun `progress survives reopening the database file`() = runTest {
        val file = Files.createTempDirectory("pc-db").resolve("inventory.db")
        val first = SqlInventoryRepository.open(file)
        val run = first.createRun("acct", 1)
        first.saveLibraryPage(run.id, listOf(item(1)), "next-token")
        first.updateRunStatus(run.id, RunStatus.PAUSED, "Paused", null)

        val reopened = SqlInventoryRepository.open(file)
        val latest = reopened.latestRun()!!
        assertEquals(RunStatus.PAUSED, latest.status)
        assertEquals("next-token", reopened.cursor(latest.id, ScanPhase.LIBRARY)!!.nextPageToken)
        assertEquals(1, reopened.snapshot(latest.id).items.size)
    }

    @Test
    fun `deleting other runs keeps only the given run`() = runTest {
        val repo = SqlInventoryRepository.inMemory()
        val old = repo.createRun("acct", 1)
        repo.saveLibraryPage(old.id, listOf(item(1)), null)
        val current = repo.createRun("acct", 2)
        repo.saveLibraryPage(current.id, listOf(item(2)), null)
        repo.deleteOtherRuns(current.id)

        assertEquals(current.id, repo.latestRun()!!.id)
        assertEquals(listOf("m2"), repo.snapshot(current.id).items.map { it.mediaKey })
        assertNull(repo.cursor(old.id, ScanPhase.LIBRARY))
    }
}
