package dev.photocleaner.features.shared.duplicates

import dev.photocleaner.features.shared.protection.InventoryClassifier
import dev.photocleaner.features.shared.protection.model.Eligibility
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
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Random libraries, each with what Google really holds and what a scan of it recorded (interrupted,
 * phases left unfinished, albums unreadable or half read, counts that don't add up, listings that
 * disagree with the flags). The classification is checked against the truth, not against the
 * snapshot: missing protection data must never make a photo eligible, and a clean, fresh scan must
 * find exactly the truly loose photos.
 */
class EligibilityInvariantTest {

    private fun <T> Random.pick(vararg options: T): T = options[nextInt(options.size)]

    /** How a listed album was read. */
    private enum class AlbumFate { READ, FAILED, UNFINISHED, COUNT_MISSING, MISMATCH, MISMATCH_READ_TWICE_DIFFERENT, MISMATCH_READ_TWICE_SAME }

    @Test
    fun missing_protection_data_never_produces_eligibility() {
        var completeScenarios = 0
        var scenariosWithEligible = 0
        repeat(SCENARIOS) { seed ->
            val random = Random(seed)
            val size = random.nextInt(0, 25)
            val library = (0 until size).map { i ->
                InventoryItem(
                    mediaKey = "m$i",
                    dedupKey = "d$i",
                    takenAtMs = 1_000L + i,
                    mediaType = random.pick(StoredMediaType.PHOTO, StoredMediaType.PHOTO, StoredMediaType.VIDEO, null),
                    isFavourite = random.pick(false, false, false, true, null),
                    isArchived = random.pick(false, false, false, true, null),
                    isOwned = random.pick(true, true, true, false, null),
                    width = 1,
                    height = 1,
                    thumbUrl = null,
                )
            }
            // What Google holds. The favourites listing also covers some items whose flag is missing;
            // the archive listing may include items whose archived flag is false or missing.
            val trueFavourites = library.filter { it.isFavourite == true || (it.isFavourite == null && random.nextBoolean()) }.map { it.dedupKey }.toSet()
            val trueArchive = library.filter { it.isArchived == true || random.nextInt(8) == 0 }.map { it.dedupKey }.toSet()
            val trueAlbums = (0 until random.nextInt(0, 4)).associate { a -> "A$a" to library.filter { random.nextInt(4) == 0 }.map { it.dedupKey }.toSet() }

            // What the scan recorded.
            val interrupted = random.nextInt(3) == 0
            val unfinished = if (interrupted) ScanPhase.entries.filter { random.nextBoolean() }.toSet() else emptySet()
            val status = if (interrupted) random.pick(RunStatus.PAUSED, RunStatus.FAILED, RunStatus.RUNNING, RunStatus.CANCELLED) else RunStatus.COMPLETED
            val items = if (ScanPhase.LIBRARY in unfinished) library.take(random.nextInt(0, size + 1)) else library
            val favourites = if (ScanPhase.FAVOURITES in unfinished) trueFavourites.filter { random.nextBoolean() }.toSet() else trueFavourites
            val archive = if (ScanPhase.ARCHIVE in unfinished) trueArchive.filter { random.nextBoolean() }.toSet() else trueArchive
            val listedAlbums = if (ScanPhase.ALBUM_LIST in unfinished) trueAlbums.filterKeys { random.nextBoolean() } else trueAlbums
            val fates = listedAlbums.mapValues { random.pick(*Array(6) { AlbumFate.READ }, *AlbumFate.entries.toTypedArray()) }
            val recordedMembers = listedAlbums.mapValues { (key, members) ->
                when (fates.getValue(key)) {
                    AlbumFate.FAILED -> emptySet()
                    AlbumFate.UNFINISHED -> members.filter { random.nextBoolean() }.toSet()
                    else -> members
                }
            }
            val albums = listedAlbums.map { (key, members) ->
                val fate = fates.getValue(key)
                val seen = recordedMembers.getValue(key).size
                AlbumStatus(
                    album = AlbumRecord(key, "Album $key", null, random.nextBoolean(), 1, when (fate) {
                        AlbumFate.COUNT_MISSING -> null
                        AlbumFate.MISMATCH, AlbumFate.MISMATCH_READ_TWICE_DIFFERENT, AlbumFate.MISMATCH_READ_TWICE_SAME -> members.size + 1
                        else -> members.size
                    }, null),
                    membersSeen = seen,
                    membersComplete = fate != AlbumFate.UNFINISHED && fate != AlbumFate.FAILED,
                    failureReason = if (fate == AlbumFate.FAILED) "HTTP 403" else null,
                    reread = when (fate) {
                        AlbumFate.MISMATCH_READ_TWICE_DIFFERENT -> AlbumReread.DIFFERENT_ENTRIES
                        AlbumFate.MISMATCH_READ_TWICE_SAME -> AlbumReread.SAME_ENTRIES
                        else -> null
                    },
                )
            }
            val stale = random.nextInt(8) == 0
            val finishedAtMs = if (status == RunStatus.COMPLETED) NOW - if (stale) 2 * DAY_MS else 60_000 else null
            val snapshot = InventorySnapshot(
                run = ScanRun(1, "account-a", NOW - 3 * DAY_MS, finishedAtMs, status, null),
                cursors = listOf(ScanPhase.LIBRARY, ScanPhase.FAVOURITES, ScanPhase.ARCHIVE, ScanPhase.ALBUM_LIST)
                    .filter { it !in unfinished || random.nextBoolean() } // an unfinished phase may have no cursor at all
                    .map { PhaseCursor(it, "", null, 1, 0, 0, completed = it !in unfinished) },
                items = items,
                favouriteDedupKeys = favourites,
                archivedDedupKeys = archive,
                albums = albums,
                albumMembership = recordedMembers.flatMap { (key, members) -> members.map { it to key } }
                    .groupBy({ it.first }, { it.second }).mapValues { it.value.toSet() },
            )
            val result = InventoryClassifier.classify(snapshot, NOW)

            // The truth, from what Google holds.
            val trueAlbumMembers = trueAlbums.values.flatten().toSet()
            val trulyProtected = library.filter {
                it.isFavourite == true || it.dedupKey in trueFavourites || it.dedupKey in trueAlbumMembers ||
                    it.isArchived == true || it.dedupKey in trueArchive
            }.map { it.mediaKey }.toSet()
            val trulyLoose = library.filter {
                it.mediaKey !in trulyProtected && it.isFavourite == false && it.isArchived == false && it.mediaType != null
            }.map { it.mediaKey }.toSet()
            val clean = status == RunStatus.COMPLETED && unfinished.isEmpty() &&
                fates.values.all { it == AlbumFate.READ || it == AlbumFate.MISMATCH_READ_TWICE_SAME }
            val eligible = result.items.filter { it.eligibility == Eligibility.ELIGIBLE }.map { it.item.mediaKey }.toSet()

            val claimsComplete = result.report.coverage.isComplete
            if (claimsComplete) completeScenarios++
            if (claimsComplete && !stale && trulyLoose.isNotEmpty()) scenariosWithEligible++

            assertTrue(trulyLoose.containsAll(eligible), "seed $seed: eligible items that are not truly loose: ${eligible - trulyLoose}")
            assertEquals(clean, claimsComplete, "seed $seed: coverage claimed ${if (claimsComplete) "complete" else "incomplete"}")
            if (!clean || stale) assertEquals(emptySet(), eligible, "seed $seed: an incomplete or old scan produced eligible items")
            if (clean && !stale) assertEquals(trulyLoose, eligible, "seed $seed: a complete scan must find exactly the loose items")
            // Truly protected items are never eligible. When their evidence was not read they are
            // UNKNOWN; under complete coverage they must be PROTECTED.
            result.items.filter { it.item.mediaKey in trulyProtected }.forEach {
                if (claimsComplete) {
                    assertEquals(Eligibility.PROTECTED, it.eligibility, "seed $seed: protected item ${it.item.mediaKey} misclassified")
                } else {
                    assertTrue(it.eligibility != Eligibility.ELIGIBLE, "seed $seed: protected item ${it.item.mediaKey} became eligible")
                }
            }
        }
        // Guard against a vacuous pass: the exactness checks must actually run.
        assertTrue(completeScenarios >= SCENARIOS / 4, "only $completeScenarios scenarios reached complete coverage")
        assertTrue(scenariosWithEligible >= SCENARIOS / 10, "only $scenariosWithEligible complete scenarios had loose photos")
    }

    private companion object {
        const val SCENARIOS = 300
        const val DAY_MS = 24L * 60 * 60 * 1000
    }
}
