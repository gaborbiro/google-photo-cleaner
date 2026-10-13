package dev.photocleaner.features.scan.usecase

import dev.photocleaner.features.scan.model.ScanPolicy
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.inventory.SqlInventoryRepository
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.services.connector.domain.MediaType
import dev.photocleaner.services.connector.domain.fake.FakeAlbum
import dev.photocleaner.services.connector.domain.fake.FakePhotosConnector
import dev.photocleaner.services.connector.domain.fake.fakeAlbum
import dev.photocleaner.services.connector.domain.fake.fakeItem
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.last
import kotlinx.coroutines.test.runTest

/**
 * Randomised scenarios checked against ground truth taken from the fake account,
 * not from the database: incomplete or missing protection data must never yield
 * an eligible item, and a clean scan must find exactly the truly loose photos.
 */
class EligibilityInvariantTest {

    private val policy = ScanPolicy(pacingMs = 0, transientBaseDelayMs = 1, rateLimitBaseDelayMs = 1)

    private fun <T> Random.pick(vararg options: T): T = options[nextInt(options.size)]

    @Test
    fun `incomplete protection data never produces eligibility`() = runTest {
        var completeScenarios = 0
        var scenariosWithEligible = 0
        repeat(SCENARIOS) { seed ->
            val random = Random(seed)
            val size = random.nextInt(0, 25)
            val library = (0 until size).map { i ->
                fakeItem(
                    index = i,
                    favourite = random.pick(false, false, false, true, null),
                    archived = random.pick(false, false, false, true, null),
                    owned = random.pick(true, true, true, false, null),
                    type = random.pick(MediaType.PHOTO, MediaType.PHOTO, MediaType.VIDEO, null),
                )
            }
            // The favourites listing also covers some items whose flag is missing.
            val favourites = library.filter { it.isFavourite == true || (it.isFavourite == null && random.nextBoolean()) }
            val albums = (0 until random.nextInt(0, 4)).map { a ->
                val members = (0 until size).filter { random.nextInt(4) == 0 }
                val mismatch = random.nextInt(8) == 0
                fakeAlbum("A$a", members, reportedCount = if (mismatch) members.size + 1 else members.size, shared = random.nextBoolean())
            }
            // The archive listing may include items whose archived flag is false or missing.
            val archive = library.filter { it.isArchived == true || random.nextInt(8) == 0 }
            val inaccessible = albums.filter { random.nextInt(10) == 0 }.map { it.album.albumKey }.toSet()
            val connector = FakePhotosConnector(library, favourites, albums, archive).apply { inaccessibleAlbums = inaccessible }
            val interruptAt = if (random.nextInt(3) == 0) random.nextInt(1, 12) else -1
            connector.failure = { _, call -> if (call == interruptAt) ConnectorException.SessionExpired("signed out", 401) else null }

            val repository = SqlInventoryRepository.inMemory()
            ScanInventoryUseCase(connector, repository, { NOW }, policy).execute().last()
            if (interruptAt >= 0 && random.nextBoolean()) {
                connector.failure = { _, _ -> null }
                ScanInventoryUseCase(connector, repository, { NOW }, policy).execute().last()
            }
            val result = ClassifyInventoryUseCase(repository, { NOW }).execute() ?: return@repeat

            val completed = repository.latestRun()!!.status == RunStatus.COMPLETED
            val albumsClean = inaccessible.isEmpty() && albums.all { it.album.reportedItemCount == it.members.size }
            val favouriteDedups = favourites.map { it.dedupKey }.toSet()
            val albumDedups = albums.flatMap(FakeAlbum::members).map { it.dedupKey }.toSet()
            val archiveDedups = archive.map { it.dedupKey }.toSet()
            val trulyLoose = library.filter {
                it.isFavourite == false && it.dedupKey !in favouriteDedups && it.dedupKey !in albumDedups &&
                    it.isArchived == false && it.dedupKey !in archiveDedups && it.isOwned == true && it.mediaType != null
            }.map { it.mediaKey }.toSet()
            val eligible = result.items.filter { it.eligibility == Eligibility.ELIGIBLE }.map { it.item.mediaKey }.toSet()

            val claimsComplete = result.report.coverage.isComplete
            if (claimsComplete) completeScenarios++
            if (claimsComplete && trulyLoose.isNotEmpty()) scenariosWithEligible++

            assertTrue(trulyLoose.containsAll(eligible), "seed $seed: eligible items that are not truly loose: ${eligible - trulyLoose}")
            if (!completed || !albumsClean) {
                assertTrue(!claimsComplete, "seed $seed: coverage claimed complete for an incomplete scan")
                assertEquals(emptySet(), eligible, "seed $seed: incomplete coverage produced eligible items")
            }
            // A clean account can still end with incomplete coverage when an interruption hit an
            // album read (it is then recorded as unreadable). Exactness is required only when the
            // app claims complete coverage, and that claim was checked against ground truth above.
            if (claimsComplete) {
                assertEquals(trulyLoose, eligible, "seed $seed: a complete scan must find exactly the loose items")
            }
            // Truly protected items are never eligible. When their evidence was not read they are
            // UNKNOWN; under complete coverage they must be PROTECTED.
            result.items.filter {
                it.item.dedupKey in favouriteDedups || it.item.dedupKey in albumDedups || it.item.isArchived == true || it.item.dedupKey in archiveDedups
            }
                .forEach {
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
        const val NOW = 5_000_000_000L
    }
}
