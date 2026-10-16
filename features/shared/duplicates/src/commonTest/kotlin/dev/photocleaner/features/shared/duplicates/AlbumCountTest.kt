package dev.photocleaner.features.shared.duplicates

import dev.photocleaner.features.shared.protection.InventoryClassifier
import dev.photocleaner.features.shared.protection.model.AlbumIssueKind
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.features.shared.protection.model.UnknownReason
import dev.photocleaner.repositories.inventory.domain.AlbumRecord
import dev.photocleaner.repositories.inventory.domain.AlbumReread
import dev.photocleaner.repositories.inventory.domain.AlbumStatus
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.InventorySnapshot
import dev.photocleaner.repositories.inventory.domain.PhaseCursor
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.ScanPhase
import dev.photocleaner.repositories.inventory.domain.ScanRun
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** An album whose entries don't add up to Google's count: when that blocks trashing and when it doesn't. */
class AlbumCountTest {

    private fun item(key: String) = InventoryItem(key, "d-$key", 1_000, StoredMediaType.PHOTO, false, false, true, 1, 1, null)

    /** A finished scan with one photo in album "a1" and one loose photo; Google says the album holds [reported] entries. */
    private fun snapshot(reported: Int?, seen: Int = 1, reread: AlbumReread? = null) = InventorySnapshot(
        run = ScanRun(1, "acc", NOW - 60_000, NOW, RunStatus.COMPLETED, null),
        cursors = listOf(ScanPhase.LIBRARY, ScanPhase.FAVOURITES, ScanPhase.ARCHIVE, ScanPhase.ALBUM_LIST).map { PhaseCursor(it, "", null, 1, 0, 0, true) },
        items = listOf(item("inAlbum"), item("loose")),
        favouriteDedupKeys = emptySet(),
        archivedDedupKeys = emptySet(),
        albums = listOf(
            AlbumStatus(
                album = AlbumRecord("a1", "Wedding", "someone-else", true, 4, reported, null),
                membersSeen = seen,
                membersComplete = true,
                failureReason = null,
                reread = reread,
            ),
        ),
        albumMembership = mapOf("d-inAlbum" to setOf("a1")),
    )

    private fun classify(snapshot: InventorySnapshot) = InventoryClassifier.classify(snapshot, NOW)

    private fun eligibilityOfLoose(snapshot: InventorySnapshot) = classify(snapshot).items.single { it.item.mediaKey == "loose" }

    @Test
    fun a_matching_count_needs_no_second_read() {
        val coverage = classify(snapshot(reported = 1)).report.coverage
        assertTrue(coverage.isComplete)
        assertEquals(emptyList(), coverage.albumIssues + coverage.albumWarnings)
        assertEquals(Eligibility.ELIGIBLE, eligibilityOfLoose(snapshot(reported = 1)).eligibility)
    }

    @Test
    fun a_mismatch_not_read_a_second_time_blocks_every_unprotected_photo() {
        val result = classify(snapshot(reported = 40))
        assertFalse(result.report.coverage.isComplete)
        assertEquals(AlbumIssueKind.COUNT_MISMATCH, result.report.coverage.albumIssues.single().kind)
        assertEquals("Google reports 40 entries; 1 read", result.report.coverage.albumIssues.single().detail)
        val loose = eligibilityOfLoose(snapshot(reported = 40))
        assertEquals(Eligibility.UNKNOWN, loose.eligibility)
        assertEquals(setOf(UnknownReason.INVENTORY_INCOMPLETE), loose.unknownReasons)
    }

    @Test
    fun a_mismatch_whose_second_read_differed_still_blocks() {
        val coverage = classify(snapshot(reported = 40, reread = AlbumReread.DIFFERENT_ENTRIES)).report.coverage
        assertFalse(coverage.isComplete)
        assertEquals(AlbumIssueKind.COUNT_MISMATCH, coverage.albumIssues.single().kind)
        assertEquals("Google reports 40 entries; 1 read, and a second read found different ones", coverage.albumIssues.single().detail)
        assertEquals(emptyList(), coverage.albumWarnings)
        assertEquals(Eligibility.UNKNOWN, eligibilityOfLoose(snapshot(reported = 40, reread = AlbumReread.DIFFERENT_ENTRIES)).eligibility)
    }

    @Test
    fun a_mismatch_read_twice_with_the_same_entries_is_a_warning_not_a_block() {
        val read = snapshot(reported = 40, reread = AlbumReread.SAME_ENTRIES)
        val result = classify(read)
        val coverage = result.report.coverage
        assertTrue(coverage.isComplete)
        assertEquals(emptyList(), coverage.albumIssues)
        assertEquals(AlbumIssueKind.COUNT_MISMATCH_READ_TWICE, coverage.albumWarnings.single().kind)
        assertEquals("Google reports 40 entries; 1 read, the same ones on a second read", coverage.albumWarnings.single().detail)
        // Not counted among the albums that match Google's counts.
        assertEquals(0, coverage.albumsFullyRead)
        assertEquals(Eligibility.ELIGIBLE, eligibilityOfLoose(read).eligibility)
        // What the album lists is still protected.
        assertEquals(Eligibility.PROTECTED, result.items.single { it.item.mediaKey == "inAlbum" }.eligibility)
    }

    @Test
    fun more_entries_than_google_reports_read_twice_the_same_is_a_warning_too() {
        val coverage = classify(snapshot(reported = 0, seen = 1, reread = AlbumReread.SAME_ENTRIES)).report.coverage
        assertTrue(coverage.isComplete)
        assertEquals(AlbumIssueKind.COUNT_MISMATCH_READ_TWICE, coverage.albumWarnings.single().kind)
    }

    @Test
    fun a_second_read_never_excuses_a_missing_count_an_unfinished_album_or_a_failed_one() {
        val missing = snapshot(reported = null, reread = AlbumReread.SAME_ENTRIES)
        assertEquals(AlbumIssueKind.COUNT_MISSING, classify(missing).report.coverage.albumIssues.single().kind)

        val unfinished = snapshot(reported = 40, reread = AlbumReread.SAME_ENTRIES)
            .let { s -> s.copy(albums = s.albums.map { it.copy(membersComplete = false) }) }
        assertEquals(AlbumIssueKind.NOT_FINISHED, classify(unfinished).report.coverage.albumIssues.single().kind)

        val failed = snapshot(reported = 40, reread = AlbumReread.SAME_ENTRIES)
            .let { s -> s.copy(albums = s.albums.map { it.copy(failureReason = "refused") }) }
        assertEquals(AlbumIssueKind.FAILED, classify(failed).report.coverage.albumIssues.single().kind)

        for (s in listOf(missing, unfinished, failed)) {
            assertFalse(classify(s).report.coverage.isComplete)
            assertEquals(Eligibility.UNKNOWN, eligibilityOfLoose(s).eligibility)
        }
    }
}
