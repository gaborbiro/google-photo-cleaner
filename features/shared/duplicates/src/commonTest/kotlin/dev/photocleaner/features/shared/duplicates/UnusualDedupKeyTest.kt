package dev.photocleaner.features.shared.duplicates

import dev.photocleaner.features.shared.protection.InventoryClassifier
import dev.photocleaner.features.shared.protection.model.AlbumIssueKind
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.features.shared.protection.model.ProtectionReason
import dev.photocleaner.features.shared.protection.model.UnknownReason
import dev.photocleaner.repositories.inventory.domain.AlbumRecord
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

/** A dedup key of a form other than the usual one: the item is read, but never trashed. */
class UnusualDedupKeyTest {

    private fun item(mediaKey: String, dedupKey: String, favourite: Boolean = false) =
        InventoryItem(mediaKey, dedupKey, 1_000, StoredMediaType.PHOTO, favourite, false, true, 1, 1, null)

    /** A finished, fresh scan of [items], with album "a1" holding the entries [inAlbum]. */
    private fun snapshot(items: List<InventoryItem>, inAlbum: Set<String> = emptySet()) = InventorySnapshot(
        run = ScanRun(1, "acc", NOW - 60_000, NOW, RunStatus.COMPLETED, null),
        cursors = listOf(ScanPhase.LIBRARY, ScanPhase.FAVOURITES, ScanPhase.ARCHIVE, ScanPhase.ALBUM_LIST).map { PhaseCursor(it, "", null, 1, 0, 0, true) },
        items = items,
        favouriteDedupKeys = items.filter { it.isFavourite == true }.map { it.dedupKey }.toSet(),
        archivedDedupKeys = emptySet(),
        albums = listOf(AlbumStatus(AlbumRecord("a1", "Holiday", null, false, 1, inAlbum.size, null), inAlbum.size, true, null, null)),
        albumMembership = inAlbum.associateWith { setOf("a1") },
    )

    private fun classify(snapshot: InventorySnapshot) = InventoryClassifier.classify(snapshot, NOW)

    @Test
    fun only_keys_of_the_usual_form_can_be_eligible() {
        val usual = listOf(dedupKey("plain"), "${dedupKey("suffix")}:${"b".repeat(11)}", "${dedupKey("suffix16")}:${"c".repeat(16)}")
        val unusual = listOf("abc+def/ghi:jkl=mn", "${dedupKey("dot").dropLast(1)}.", "${dedupKey("short")}:short", "DEDUP", "${dedupKey("long")}x")
        val keys = usual + unusual
        val result = classify(snapshot(keys.mapIndexed { i, key -> item("m$i", key) }))
        assertTrue(result.report.coverage.isComplete)
        assertEquals(usual.map { Eligibility.ELIGIBLE } + unusual.map { Eligibility.UNKNOWN }, result.items.map { it.eligibility })
        result.items.drop(usual.size).forEach { assertEquals(setOf(UnknownReason.DEDUP_KEY_UNUSUAL), it.unknownReasons) }
        assertEquals(unusual.size, result.report.counts.single { it.mediaType == StoredMediaType.PHOTO }.unknownByReason[UnknownReason.DEDUP_KEY_UNUSUAL])
    }

    @Test
    fun an_unusual_key_still_protects() {
        val result = classify(snapshot(listOf(item("fav", "odd+key:1", favourite = true), item("album", "odd+key:2")), inAlbum = setOf("odd+key:2")))
        assertTrue(result.report.coverage.isComplete)
        assertEquals(listOf(setOf(ProtectionReason.FAVOURITE), setOf(ProtectionReason.IN_ALBUM)), result.items.map { it.protectionReasons })
        assertEquals(listOf(Eligibility.PROTECTED, Eligibility.PROTECTED), result.items.map { it.eligibility })
    }

    @Test
    fun an_album_entry_with_an_unusual_key_the_library_has_is_matched_as_any_other() {
        val coverage = classify(snapshot(listOf(item("odd", "odd+key"), item("loose", dedupKey("loose"))), inAlbum = setOf("odd+key"))).report.coverage
        assertTrue(coverage.isComplete)
        assertEquals(emptyList(), coverage.albumIssues + coverage.albumWarnings)
        assertEquals(1, coverage.albumsFullyRead)
    }

    @Test
    fun an_album_entry_with_an_unusual_key_no_library_item_has_blocks_every_photo() {
        // Album entries read wrongly would protect nothing; trashing waits until they make sense.
        val loose = item("loose", dedupKey("loose"))
        val result = classify(snapshot(listOf(loose), inAlbum = setOf("odd+key:a", "odd+key:b", dedupKey("someone-elses"))))
        val coverage = result.report.coverage
        assertFalse(coverage.isComplete)
        assertEquals(AlbumIssueKind.UNUSUAL_KEY_NOT_IN_LIBRARY, coverage.albumIssues.single().kind)
        assertEquals("2 entries with an unusual Google ID that no library item has", coverage.albumIssues.single().detail)
        assertEquals(0, coverage.albumsFullyRead)
        assertEquals(Eligibility.UNKNOWN, result.items.single().eligibility)
        assertEquals(setOf(UnknownReason.INVENTORY_INCOMPLETE), result.items.single().unknownReasons)
    }
}
