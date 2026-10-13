package dev.photocleaner.features.duplicates.usecase

import dev.photocleaner.features.duplicates.model.DuplicateGroupsResult
import dev.photocleaner.features.duplicates.model.GroupingSettings
import dev.photocleaner.features.duplicates.model.MemberRole
import dev.photocleaner.features.shared.embeddings.EmbeddingSettings
import dev.photocleaner.features.shared.embeddings.Vectors
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.analysis.SqlAnalysisRepository
import dev.photocleaner.repositories.analysis.domain.PhotoInfo
import dev.photocleaner.repositories.analysis.domain.StoredEmbedding
import dev.photocleaner.repositories.analysis.domain.StoredQuality
import dev.photocleaner.repositories.inventory.SqlInventoryRepository
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

class BuildDuplicateGroupsUseCaseTest {

    private val now = 5_000_000_000L
    private val inventory = SqlInventoryRepository.inMemory()
    private val analysis = SqlAnalysisRepository.inMemory()
    private val modelId = EmbeddingSettings.modelKey(280).id

    /** A synthetic photo: [angleDeg] places its unit vector, so photos 10° apart score cos(10°) ≈ 0.985. */
    private data class Spec(
        val key: String,
        val takenAtMs: Long,
        val angleDeg: Double,
        val favourite: Boolean = false,
        val owned: Boolean = true,
        val sharpness: Double = 100.0,
        val width: Int = 4000,
        val height: Int = 3000,
        val uploadedAtMs: Long = 1_000,
    )

    private suspend fun setUp(specs: List<Spec>, complete: Boolean = true) {
        val run = inventory.createRun("account-a", now)
        inventory.saveLibraryPage(run.id, specs.map {
            InventoryItem(it.key, "d-${it.key}", it.takenAtMs, StoredMediaType.PHOTO, it.favourite, false, it.owned, it.width, it.height, null)
        }, null)
        inventory.saveFavouritesPage(run.id, emptyList(), null)
        inventory.saveArchivePage(run.id, emptyList(), null)
        inventory.saveAlbumsPage(run.id, emptyList(), null)
        inventory.updateRunStatus(run.id, if (complete) RunStatus.COMPLETED else RunStatus.PAUSED, null, now)
        analysis.save(specs.map {
            val radians = Math.toRadians(it.angleDeg)
            StoredEmbedding(it.key, "d-${it.key}", modelId, floatArrayOf(cos(radians).toFloat(), sin(radians).toFloat()), StoredQuality(it.sharpness, 120.0, 0.0, 0.0, 512, 384), now)
        })
        analysis.savePhotoInfo(specs.map { PhotoInfo(it.key, it.uploadedAtMs, it.width, it.height) })
    }

    private suspend fun groups(): DuplicateGroupsResult = BuildDuplicateGroupsUseCase(ClassifyInventoryUseCase(inventory, { now }), analysis).execute()

    @Test
    fun `a burst becomes one group with the sharpest photo as keeper`() = runTest {
        setUp(listOf(
            Spec("a", 1_000, 0.0, sharpness = 50.0),
            Spec("b", 3_000, 5.0, sharpness = 400.0),
            Spec("c", 5_000, 10.0, sharpness = 60.0),
            Spec("other", 7_000, 80.0),
        ))
        val group = groups().groups.single()
        assertEquals("b", group.keeper.photo.item.mediaKey)
        assertEquals(setOf("a", "c"), group.members.filter { it.role == MemberRole.PROPOSED }.map { it.photo.item.mediaKey }.toSet())
        assertTrue(group.members.single { it.photo.item.mediaKey == "a" }.reasons.any { it.startsWith("Blurrier") })
    }

    @Test
    fun `members always match the keeper directly, so groups never chain`() = runTest {
        // a-b-c-d each 20° apart: neighbours match (cos 20° = 0.94), a and d do not.
        setUp(listOf(Spec("a", 1_000, 0.0), Spec("b", 2_000, 20.0), Spec("c", 3_000, 40.0), Spec("d", 4_000, 60.0)))
        val result = groups()
        result.groups.forEach { group ->
            group.members.filter { it.role != MemberRole.KEEPER }.forEach { assertTrue(it.similarity >= 0.925) }
            val keys = group.members.map { it.photo.item.mediaKey }
            assertTrue(!(keys.contains("a") && keys.contains("d")), "a and d are not similar")
        }
        val all = result.groups.flatMap { g -> g.members.map { it.photo.item.mediaKey } }
        assertEquals(all.size, all.toSet().size, "a photo appears in at most one group")
    }

    @Test
    fun `a protected photo is kept as reference keeper and never proposed`() = runTest {
        setUp(listOf(Spec("fav", 1_000, 0.0, favourite = true, sharpness = 10.0), Spec("x", 2_000, 3.0, sharpness = 900.0)))
        val group = groups().groups.single()
        assertEquals("fav", group.keeper.photo.item.mediaKey)
        assertEquals(Eligibility.PROTECTED, group.keeper.photo.eligibility)
        assertEquals(MemberRole.PROPOSED, group.members.single { it.photo.item.mediaKey == "x" }.role)
        assertTrue(group.keeper.reasons.single { it.startsWith("Protected") }.contains("favourite"))
    }

    @Test
    fun `groups with nothing eligible to propose are dropped`() = runTest {
        setUp(listOf(Spec("fav", 1_000, 0.0, favourite = true), Spec("saved", 2_000, 2.0, owned = false)))
        assertEquals(emptyList(), groups().groups)
    }

    @Test
    fun `identical photos taken more than two minutes apart are not compared`() = runTest {
        setUp(listOf(Spec("a", 0, 0.0), Spec("b", 180_000, 0.0)))
        assertEquals(emptyList(), groups().groups)
    }

    @Test
    fun `the later edited copy of the same instant is kept over a larger original`() = runTest {
        setUp(listOf(
            Spec("original", 1_000, 0.0, width = 4000, height = 3000, uploadedAtMs = 1_000, sharpness = 300.0),
            Spec("crop", 1_000, 2.0, width = 2000, height = 1500, uploadedAtMs = 3_600_000, sharpness = 200.0),
        ))
        val group = groups().groups.single()
        assertEquals("crop", group.keeper.photo.item.mediaKey)
        assertTrue(group.members.single { it.role == MemberRole.PROPOSED }.reasons.contains("Original of the edited copy being kept"))
    }

    @Test
    fun `an incomplete or stale inventory produces no groups`() = runTest {
        setUp(listOf(Spec("a", 1_000, 0.0), Spec("b", 2_000, 1.0)), complete = false)
        val result = groups()
        assertNotNull(result.blockedReason)
        assertEquals(emptyList(), result.groups)
    }

    @Test
    fun `random libraries never propose a protected or unknown photo`() = runTest {
        repeat(40) { seed ->
            val random = Random(seed)
            val specs = (0 until 60).map { i ->
                Spec(
                    key = "s$seed-$i",
                    takenAtMs = i * random.nextLong(1_000, 40_000),
                    angleDeg = (i / 4) * 30.0 + random.nextDouble(0.0, 15.0),
                    favourite = random.nextInt(6) == 0,
                    owned = random.nextInt(8) != 0,
                    sharpness = random.nextDouble(1.0, 500.0),
                )
            }
            val repoInventory = SqlInventoryRepository.inMemory()
            val repoAnalysis = SqlAnalysisRepository.inMemory()
            val run = repoInventory.createRun("acct", now)
            repoInventory.saveLibraryPage(run.id, specs.map { InventoryItem(it.key, "d-${it.key}", it.takenAtMs, StoredMediaType.PHOTO, it.favourite, false, it.owned, 1, 1, null) }, null)
            repoInventory.saveFavouritesPage(run.id, emptyList(), null)
            repoInventory.saveArchivePage(run.id, emptyList(), null)
            repoInventory.saveAlbumsPage(run.id, emptyList(), null)
            repoInventory.updateRunStatus(run.id, RunStatus.COMPLETED, null, now)
            val vectors = specs.associate { s -> s.key to Math.toRadians(s.angleDeg).let { floatArrayOf(cos(it).toFloat(), sin(it).toFloat()) } }
            repoAnalysis.save(specs.map { StoredEmbedding(it.key, "d-${it.key}", modelId, vectors.getValue(it.key), StoredQuality(it.sharpness, 100.0, 0.0, 0.0, 1, 1), now) })

            val result = BuildDuplicateGroupsUseCase(ClassifyInventoryUseCase(repoInventory, { now }), repoAnalysis, GroupingSettings()).execute()
            assertNull(result.blockedReason)
            val seen = mutableSetOf<String>()
            result.groups.forEach { group ->
                val keeper = group.keeper
                group.members.forEach { member ->
                    assertTrue(seen.add(member.photo.item.mediaKey), "seed $seed: photo in two groups")
                    if (member.role == MemberRole.PROPOSED) assertEquals(Eligibility.ELIGIBLE, member.photo.eligibility, "seed $seed")
                    if (member.role != MemberRole.KEEPER) {
                        val score = Vectors.cosine(vectors.getValue(keeper.photo.item.mediaKey), vectors.getValue(member.photo.item.mediaKey))
                        assertTrue(score >= 0.925, "seed $seed: member below threshold to keeper")
                        assertTrue(kotlin.math.abs(member.photo.item.takenAtMs - keeper.photo.item.takenAtMs) <= 120_000, "seed $seed: outside window")
                    }
                }
                assertTrue(group.members.any { it.role == MemberRole.PROPOSED }, "seed $seed: group without proposals")
            }
        }
    }
}
