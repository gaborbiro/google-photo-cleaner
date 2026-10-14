package dev.photocleaner.features.shared.duplicates

import dev.photocleaner.features.shared.duplicates.model.DuplicateGroupsResult
import dev.photocleaner.features.shared.duplicates.model.GroupingSettings
import dev.photocleaner.features.shared.duplicates.model.GroupsBlocked
import dev.photocleaner.features.shared.duplicates.model.MemberRole
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import kotlin.math.abs
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DuplicateGrouperTest {

    private fun groups(specs: List<Spec>, settings: GroupingSettings = GroupingSettings()): DuplicateGroupsResult =
        DuplicateGrouper.build(classification(specs), analyses(specs), settings)

    @Test
    fun a_burst_becomes_one_group_with_the_sharpest_photo_as_keeper() {
        val group = groups(listOf(
            Spec("a", 1_000, 0.0, sharpness = 50.0),
            Spec("b", 3_000, 5.0, sharpness = 400.0),
            Spec("c", 5_000, 10.0, sharpness = 60.0),
            Spec("other", 7_000, 80.0),
        )).groups.single()
        assertEquals("b", group.keeper.photo.item.mediaKey)
        assertEquals(setOf("a", "c"), group.members.filter { it.role == MemberRole.PROPOSED }.map { it.photo.item.mediaKey }.toSet())
        assertTrue(group.members.single { it.photo.item.mediaKey == "a" }.reasons.any { it.startsWith("Blurrier") })
        assertTrue(group.keeper.reasons.contains("Sharpest"))
    }

    @Test
    fun members_always_match_the_keeper_directly_so_groups_never_chain() {
        // a-b-c-d each 20° apart: neighbours match (cos 20° = 0.94), a and d do not.
        val result = groups(listOf(Spec("a", 1_000, 0.0), Spec("b", 2_000, 20.0), Spec("c", 3_000, 40.0), Spec("d", 4_000, 60.0)))
        result.groups.forEach { group ->
            group.members.filter { it.role != MemberRole.KEEPER }.forEach { assertTrue(it.similarity >= 0.925) }
            val keys = group.members.map { it.photo.item.mediaKey }
            assertTrue(!(keys.contains("a") && keys.contains("d")), "a and d are not similar")
        }
        val all = result.groups.flatMap { g -> g.members.map { it.photo.item.mediaKey } }
        assertEquals(all.size, all.toSet().size, "a photo appears in at most one group")
    }

    @Test
    fun a_protected_photo_is_kept_as_reference_keeper_and_never_proposed() {
        val group = groups(listOf(Spec("fav", 1_000, 0.0, favourite = true, sharpness = 10.0), Spec("x", 2_000, 3.0, sharpness = 900.0))).groups.single()
        assertEquals("fav", group.keeper.photo.item.mediaKey)
        assertEquals(Eligibility.PROTECTED, group.keeper.photo.eligibility)
        assertEquals(MemberRole.PROPOSED, group.members.single { it.photo.item.mediaKey == "x" }.role)
        assertTrue(group.keeper.reasons.single { it.startsWith("Protected") }.contains("favourite"))
    }

    @Test
    fun groups_with_nothing_eligible_to_propose_are_dropped() {
        assertEquals(emptyList(), groups(listOf(Spec("fav", 1_000, 0.0, favourite = true), Spec("saved", 2_000, 2.0, owned = false))).groups)
    }

    @Test
    fun identical_photos_taken_more_than_two_minutes_apart_are_not_compared() {
        assertEquals(emptyList(), groups(listOf(Spec("a", 0, 0.0), Spec("b", 180_000, 0.0))).groups)
    }

    @Test
    fun the_later_edited_copy_of_the_same_instant_is_kept_over_a_larger_original() {
        val group = groups(listOf(
            Spec("original", 1_000, 0.0, width = 4000, height = 3000, uploadedAtMs = 1_000, sharpness = 300.0),
            Spec("crop", 1_000, 2.0, width = 2000, height = 1500, uploadedAtMs = 3_600_000, sharpness = 200.0),
        )).groups.single()
        assertEquals("crop", group.keeper.photo.item.mediaKey)
        assertTrue(group.members.single { it.role == MemberRole.PROPOSED }.reasons.contains("Original of the edited copy being kept"))
    }

    @Test
    fun the_reasons_give_numbers_as_the_desktop_printed_them() {
        val group = groups(listOf(Spec("big", 1_000, 0.0, sharpness = 300.0), Spec("small", 2_000, 10.0, width = 2000, height = 1500))).groups.single()
        val reasons = group.members.single { it.role == MemberRole.PROPOSED }.reasons
        assertEquals("98.5% similar to the keeper", reasons[0]) // cos 10° = 0.98481
        assertTrue(reasons.contains("Lower resolution (3.0 MP vs 12.0 MP)"))
    }

    @Test
    fun no_group_can_be_built_from_a_missing_unfinished_or_old_scan() {
        val specs = listOf(Spec("a", 1_000, 0.0), Spec("b", 2_000, 1.0))
        assertEquals(GroupsBlocked.NOT_SCANNED, DuplicateGrouper.build(null, analyses(specs), GroupingSettings()).blocked)
        assertEquals(GroupsBlocked.SCAN_UNFINISHED, DuplicateGrouper.build(classification(specs, complete = false), analyses(specs), GroupingSettings()).blocked)
        val old = DuplicateGrouper.build(classification(specs, finishedAtMs = NOW - 25 * 3_600_000L), analyses(specs), GroupingSettings())
        assertEquals(GroupsBlocked.SCAN_STALE, old.blocked)
        assertEquals(emptyList(), old.groups)
    }

    @Test
    fun videos_are_not_compared_and_photos_not_analysed_yet_are_counted() {
        val specs = listOf(Spec("a", 1_000, 0.0), Spec("b", 2_000, 1.0), Spec("clip", 3_000, 0.0, mediaType = StoredMediaType.VIDEO))
        val result = DuplicateGrouper.build(classification(specs + Spec("new", 4_000, 0.5)), analyses(specs), GroupingSettings())
        assertEquals(2, result.photosCompared)
        assertEquals(1, result.photosWithoutEmbedding)
        assertEquals(setOf("a", "b"), result.groups.single().members.map { it.photo.item.mediaKey }.toSet())
    }

    @Test
    fun a_group_id_names_its_set_of_photos_whatever_their_order() {
        val result = groups(listOf(Spec("a", 1_000, 0.0), Spec("b", 2_000, 1.0)))
        val id = result.groups.single().id
        assertEquals(24, id.length)
        assertTrue(id.all { it in "0123456789abcdef" })
        // SHA-256 of "a|b" (the sorted keys), first 12 bytes.
        assertEquals("0eab8a0a3380abf4c7d1fb0b", id)
    }

    @Test
    fun groups_come_newest_moment_first() {
        val result = groups(listOf(Spec("a", 1_000, 0.0), Spec("b", 2_000, 1.0), Spec("c", 900_000, 50.0), Spec("d", 901_000, 51.0)))
        assertEquals(listOf(setOf("c", "d"), setOf("a", "b")), result.groups.map { g -> g.members.map { it.photo.item.mediaKey }.toSet() })
    }

    @Test
    fun random_libraries_never_propose_a_protected_or_unknown_photo() {
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
                    width = 1,
                    height = 1,
                )
            }
            val result = groups(specs)
            assertNull(result.blocked)
            val vectors = specs.associate { it.key to unit(it.angleDeg) }
            val seen = mutableSetOf<String>()
            result.groups.forEach { group ->
                val keeper = group.keeper
                group.members.forEach { member ->
                    assertTrue(seen.add(member.photo.item.mediaKey), "seed $seed: photo in two groups")
                    if (member.role == MemberRole.PROPOSED) assertEquals(Eligibility.ELIGIBLE, member.photo.eligibility, "seed $seed")
                    if (member.role != MemberRole.KEEPER) {
                        val score = Vectors.cosine(vectors.getValue(keeper.photo.item.mediaKey), vectors.getValue(member.photo.item.mediaKey))
                        assertTrue(score >= 0.925, "seed $seed: member below threshold to keeper")
                        assertTrue(abs(member.photo.item.takenAtMs - keeper.photo.item.takenAtMs) <= 120_000, "seed $seed: outside window")
                    }
                }
                assertTrue(group.members.any { it.role == MemberRole.PROPOSED }, "seed $seed: group without proposals")
            }
        }
    }
}
