package dev.photocleaner.features.shared.duplicates

import dev.photocleaner.features.shared.protection.InventoryClassifier
import dev.photocleaner.features.shared.protection.model.TypeCounts
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

/** The scan report's counts: photos, videos and items of unknown type apart, each protection counted. */
class InventoryCountsTest {

    private fun item(key: String, type: StoredMediaType?, favourite: Boolean = false, archived: Boolean = false, owned: Boolean? = true) =
        InventoryItem(key, "d-$key", 1_000, type, favourite, archived, owned, 1, 1, null)

    @Test
    fun photos_videos_and_items_of_unknown_type_are_counted_apart() {
        val items = listOf(
            item("favourite", StoredMediaType.PHOTO, favourite = true),
            item("inAlbum", StoredMediaType.PHOTO),
            item("favouriteInAlbum", StoredMediaType.PHOTO, favourite = true),
            item("archived", StoredMediaType.PHOTO, archived = true),
            item("loose", StoredMediaType.PHOTO),
            item("loose2", StoredMediaType.PHOTO),
            item("someoneElses", StoredMediaType.PHOTO, owned = false),
            item("clip", StoredMediaType.VIDEO),
            item("clipInAlbum", StoredMediaType.VIDEO),
            item("mystery", null),
        )
        val snapshot = InventorySnapshot(
            run = ScanRun(1, "acc", NOW - 60_000, NOW, RunStatus.COMPLETED, null),
            cursors = listOf(ScanPhase.LIBRARY, ScanPhase.FAVOURITES, ScanPhase.ARCHIVE, ScanPhase.ALBUM_LIST).map { PhaseCursor(it, "", null, 1, 0, 0, true) },
            items = items,
            favouriteDedupKeys = setOf("d-favourite", "d-favouriteInAlbum"),
            archivedDedupKeys = setOf("d-archived"),
            albums = listOf(AlbumStatus(AlbumRecord("a1", "Trip", null, false, 1, 3, null), 3, true, null, null)),
            albumMembership = listOf("d-inAlbum", "d-favouriteInAlbum", "d-clipInAlbum").associateWith { setOf("a1") },
        )

        val counts = InventoryClassifier.classify(snapshot, NOW).report.counts.associateBy { it.mediaType }

        assertEquals(
            TypeCounts(
                mediaType = StoredMediaType.PHOTO, total = 7, protectedTotal = 4, protectedByFavourite = 2, protectedByAlbum = 2,
                protectedByArchive = 1, protectedByFavouriteAndAlbum = 1, eligible = 2, unknown = 1,
                unknownByReason = mapOf(UnknownReason.NOT_OWNED to 1),
            ),
            counts[StoredMediaType.PHOTO],
        )
        assertEquals(
            TypeCounts(StoredMediaType.VIDEO, total = 2, protectedTotal = 1, protectedByFavourite = 0, protectedByAlbum = 1, protectedByArchive = 0, protectedByFavouriteAndAlbum = 0, eligible = 1, unknown = 0, unknownByReason = emptyMap()),
            counts[StoredMediaType.VIDEO],
        )
        assertEquals(
            TypeCounts(null, total = 1, protectedTotal = 0, protectedByFavourite = 0, protectedByAlbum = 0, protectedByArchive = 0, protectedByFavouriteAndAlbum = 0, eligible = 0, unknown = 1, unknownByReason = mapOf(UnknownReason.MEDIA_TYPE_UNKNOWN to 1)),
            counts[null],
        )
    }
}
