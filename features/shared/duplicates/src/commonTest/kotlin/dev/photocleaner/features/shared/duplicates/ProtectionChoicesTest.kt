package dev.photocleaner.features.shared.duplicates

import dev.photocleaner.features.shared.protection.InventoryClassifier
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.features.shared.protection.model.ProtectionChoices
import dev.photocleaner.features.shared.protection.model.ProtectionReason
import dev.photocleaner.features.shared.protection.model.UnknownReason
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.InventorySnapshot
import dev.photocleaner.repositories.inventory.domain.PhaseCursor
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.ScanPhase
import dev.photocleaner.repositories.inventory.domain.ScanRun
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import kotlin.test.Test
import kotlin.test.assertEquals

/** The user's protection choices: which kinds of photo are never trashed. */
class ProtectionChoicesTest {

    private fun item(key: String, favourite: Boolean = false, archived: Boolean = false, owned: Boolean = true) =
        InventoryItem(key, "d-$key", 1_000, StoredMediaType.PHOTO, favourite, archived, owned, 1, 1, null)

    /** A favourite, an album photo, an archived one, one saved from someone's share into an album, and a plain one. */
    private val snapshot = InventorySnapshot(
        run = ScanRun(1, "acc", NOW - 60_000, NOW, RunStatus.COMPLETED, null),
        cursors = listOf(ScanPhase.LIBRARY, ScanPhase.FAVOURITES, ScanPhase.ARCHIVE, ScanPhase.ALBUM_LIST).map { PhaseCursor(it, "", null, 1, 0, 0, true) },
        items = listOf(item("fav", favourite = true), item("inAlbum"), item("archived", archived = true), item("shared", owned = false), item("plain")),
        favouriteDedupKeys = setOf("d-fav"),
        archivedDedupKeys = setOf("d-archived"),
        albums = emptyList(),
        albumMembership = mapOf("d-inAlbum" to setOf("a1"), "d-shared" to setOf("a1")),
    )

    private fun eligibility(chosen: ProtectionChoices) =
        InventoryClassifier.classify(snapshot, NOW, chosen = chosen).items.associate { it.item.mediaKey to it.eligibility }

    @Test
    fun all_on_by_default_as_the_desktop_has_always_worked() {
        assertEquals(
            mapOf("fav" to Eligibility.PROTECTED, "inAlbum" to Eligibility.PROTECTED, "archived" to Eligibility.PROTECTED, "shared" to Eligibility.PROTECTED, "plain" to Eligibility.ELIGIBLE),
            eligibility(ProtectionChoices.ALL),
        )
    }

    @Test
    fun a_protection_turned_off_makes_those_photos_eligible_the_others_stay_protected() {
        val noAlbums = eligibility(ProtectionChoices(albums = false))
        assertEquals(Eligibility.ELIGIBLE, noAlbums["inAlbum"])
        assertEquals(Eligibility.PROTECTED, noAlbums["fav"])
        assertEquals(Eligibility.PROTECTED, noAlbums["archived"])
        assertEquals(Eligibility.ELIGIBLE, eligibility(ProtectionChoices(favourites = false))["fav"])
        assertEquals(Eligibility.ELIGIBLE, eligibility(ProtectionChoices(archived = false))["archived"])
    }

    @Test
    fun a_photo_saved_from_someone_elses_share_is_never_trashable() {
        // Protected for being in an album; without that protection it is of unknown status, not eligible.
        val item = InventoryClassifier.classify(snapshot, NOW, chosen = ProtectionChoices(albums = false)).items.single { it.item.mediaKey == "shared" }
        assertEquals(Eligibility.UNKNOWN, item.eligibility)
        assertEquals(setOf(UnknownReason.NOT_OWNED), item.unknownReasons)
    }

    @Test
    fun only_the_chosen_reasons_are_given_and_counted() {
        val favAndAlbum = snapshot.copy(albumMembership = snapshot.albumMembership + ("d-fav" to setOf("a1")))
        val result = InventoryClassifier.classify(favAndAlbum, NOW, chosen = ProtectionChoices(albums = false))
        assertEquals(setOf(ProtectionReason.FAVOURITE), result.items.single { it.item.mediaKey == "fav" }.protectionReasons)
        val photos = result.report.counts.single { it.mediaType == StoredMediaType.PHOTO }
        assertEquals(0, photos.protectedByAlbum)
        assertEquals(2, photos.protectedTotal) // the favourite and the archived photo
    }
}
