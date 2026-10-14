package dev.photocleaner.features.shared.duplicates

import dev.photocleaner.features.shared.duplicates.model.DuplicateGroup
import dev.photocleaner.features.shared.duplicates.model.DuplicateGroupsResult
import dev.photocleaner.features.shared.duplicates.model.GroupMember
import dev.photocleaner.features.shared.duplicates.model.GroupingSettings
import dev.photocleaner.features.shared.duplicates.model.GroupsBlocked
import dev.photocleaner.features.shared.duplicates.model.MemberRole
import dev.photocleaner.features.shared.duplicates.model.PhotoAnalysis
import dev.photocleaner.features.shared.duplicates.model.PhotoFacts
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.features.shared.protection.model.InventoryClassification
import dev.photocleaner.features.shared.protection.model.ProtectionReason
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import kotlin.math.abs

/**
 * Builds duplicate groups from a classified library scan and the photos' analyses.
 *
 * - Only photos taken within [GroupingSettings.windowMs] of each other are compared.
 * - Every member of a group matches the group's keeper directly (no chaining).
 * - Protected and unknown photos can be keepers or references, never trash proposals.
 * - Groups without an eligible photo to propose are dropped.
 */
object DuplicateGrouper {

    /** [classification] is null before any scan; [analyses] are keyed by media key. */
    fun build(classification: InventoryClassification?, analyses: Map<String, PhotoAnalysis>, settings: GroupingSettings): DuplicateGroupsResult {
        fun blocked(reason: GroupsBlocked) = DuplicateGroupsResult(reason, emptyList(), 0, 0, null, settings)
        classification ?: return blocked(GroupsBlocked.NOT_SCANNED)
        val coverage = classification.report.coverage
        when {
            !coverage.isComplete -> return blocked(GroupsBlocked.SCAN_UNFINISHED)
            coverage.isStale -> return blocked(GroupsBlocked.SCAN_STALE)
        }
        val photos = classification.items.filter { it.item.mediaType == StoredMediaType.PHOTO }
        val candidates = photos.mapNotNull { classified ->
            val analysis = analyses[classified.item.mediaKey] ?: return@mapNotNull null
            val width = analysis.width ?: classified.item.width
            val height = analysis.height ?: classified.item.height
            Candidate(
                facts = PhotoFacts(
                    item = classified.item,
                    eligibility = classified.eligibility,
                    protectionReasons = classified.protectionReasons,
                    sharpness = analysis.sharpness,
                    clipped = analysis.clipped,
                    pixels = if (width != null && height != null) width.toLong() * height else null,
                    uploadedAtMs = analysis.uploadedAtMs,
                ),
                vector = analysis.vector,
            )
        }.sortedBy { it.facts.item.takenAtMs }
        return DuplicateGroupsResult(
            blocked = null,
            groups = Grouping(candidates, settings).groups().sortedByDescending { it.takenAtMs },
            photosCompared = candidates.size,
            photosWithoutEmbedding = photos.size - candidates.size,
            analysedAtMs = photos.mapNotNull { analyses[it.item.mediaKey]?.analysedAtMs }.maxOrNull(),
            settings = settings,
        )
    }

    private class Candidate(val facts: PhotoFacts, val vector: FloatArray)

    private class Grouping(private val candidates: List<Candidate>, private val settings: GroupingSettings) {
        private val similar = HashMap<Int, MutableMap<Int, Double>>()

        private fun score(a: Int, b: Int): Double? = similar[a]?.get(b)

        fun groups(): List<DuplicateGroup> {
            // Similar pairs within the time window, and their connected components.
            val parent = IntArray(candidates.size) { it }
            fun root(i: Int): Int {
                var r = i
                while (parent[r] != r) r = parent[r]
                var c = i
                while (parent[c] != r) {
                    val next = parent[c]
                    parent[c] = r
                    c = next
                }
                return r
            }
            for (i in candidates.indices) {
                var j = i + 1
                while (j < candidates.size && candidates[j].facts.item.takenAtMs - candidates[i].facts.item.takenAtMs <= settings.windowMs) {
                    val score = Vectors.cosine(candidates[i].vector, candidates[j].vector)
                    if (score >= settings.threshold) {
                        similar.getOrPut(i) { mutableMapOf() }[j] = score
                        similar.getOrPut(j) { mutableMapOf() }[i] = score
                        parent[root(i)] = root(j)
                    }
                    j++
                }
            }

            // Photos are visited oldest first, so ties are broken the same way on every platform.
            val groups = mutableListOf<DuplicateGroup>()
            similar.keys.sorted().groupBy(::root).values.forEach { component ->
                val remaining = component.toMutableSet()
                while (remaining.size >= 2) {
                    val connected = remaining.filter { node -> remaining.any { other -> other != node && score(node, other) != null } }
                    if (connected.isEmpty()) break
                    val keeper = chooseKeeper(connected)
                    val members = remaining.asSequence()
                        .filter { it != keeper }
                        .mapNotNull { node -> score(keeper, node)?.let { node to it } }
                        .sortedByDescending { it.second }
                        .take(settings.maxGroupSize - 1)
                        .toList()
                    remaining -= keeper
                    remaining -= members.map { it.first }.toSet()
                    buildGroup(candidates[keeper], members.map { candidates[it.first] to it.second })?.let(groups::add)
                }
            }
            return groups
        }

        /**
         * Keeper preference: a protected photo (kept anyway), then an unknown one (also
         * kept anyway), then the latest edited copy of the same instant, then the best
         * quality. Ties go to the photo matching the most others.
         */
        private fun chooseKeeper(nodes: List<Int>): Int {
            fun degree(n: Int) = nodes.count { it != n && score(n, it) != null }
            val protected = nodes.filter { candidates[it].facts.eligibility == Eligibility.PROTECTED }
            if (protected.isNotEmpty()) return protected.maxBy(::degree)
            val unknown = nodes.filter { candidates[it].facts.eligibility == Eligibility.UNKNOWN }
            if (unknown.isNotEmpty()) return unknown.maxBy(::degree)
            val edits = nodes.filter { n -> nodes.any { o -> o != n && isEditedCopyOf(candidates[n].facts, candidates[o].facts, score(n, o)) } }
            if (edits.isNotEmpty()) return edits.maxBy { candidates[it].facts.uploadedAtMs ?: 0 }
            val sharpnessRank = rank(nodes) { candidates[it].facts.sharpness }
            val pixelRank = rank(nodes) { (candidates[it].facts.pixels ?: 0).toDouble() }
            val exposureRank = rank(nodes) { -candidates[it].facts.clipped }
            return nodes.maxWith(compareBy<Int> { 0.5 * sharpnessRank.getValue(it) + 0.3 * pixelRank.getValue(it) + 0.2 * exposureRank.getValue(it) }.thenBy(::degree))
        }

        private fun isEditedCopyOf(candidate: PhotoFacts, original: PhotoFacts, similarity: Double?): Boolean {
            val uploaded = candidate.uploadedAtMs ?: return false
            val originalUploaded = original.uploadedAtMs ?: return false
            return similarity != null && similarity >= settings.editedCopyMinSimilarity &&
                abs(candidate.item.takenAtMs - original.item.takenAtMs) <= settings.editedCopyMaxTakenGapMs &&
                uploaded - originalUploaded >= settings.editedCopyMinUploadGapMs
        }

        /** 0.0 (worst) to 1.0 (best) within the group. */
        private fun rank(nodes: List<Int>, value: (Int) -> Double): Map<Int, Double> {
            if (nodes.size == 1) return mapOf(nodes.single() to 1.0)
            val sorted = nodes.sortedBy(value)
            return sorted.withIndex().associate { (index, node) -> node to index.toDouble() / (nodes.size - 1) }
        }

        private fun buildGroup(keeper: Candidate, members: List<Pair<Candidate, Double>>): DuplicateGroup? {
            val proposals = members.count { it.first.facts.eligibility == Eligibility.ELIGIBLE }
            if (proposals == 0) return null
            val keeperFacts = keeper.facts
            val all = listOf(GroupMember(keeperFacts, MemberRole.KEEPER, 1.0, keeperReasons(keeperFacts, members.map { it.first.facts to it.second }))) +
                members.map { (candidate, similarity) ->
                    val f = candidate.facts
                    if (f.eligibility == Eligibility.ELIGIBLE) {
                        GroupMember(f, MemberRole.PROPOSED, similarity, deletionReasons(f, keeperFacts, similarity))
                    } else {
                        GroupMember(f, MemberRole.REFERENCE, similarity, referenceReasons(f))
                    }
                }
            val digest = Sha256.digest(all.map { it.photo.item.mediaKey }.sorted().joinToString("|").encodeToByteArray())
            return DuplicateGroup(
                id = digest.copyOf(12).hex(),
                members = all,
                takenAtMs = all.maxOf { it.photo.item.takenAtMs },
            )
        }

        private fun keeperReasons(keeper: PhotoFacts, matches: List<Pair<PhotoFacts, Double>>): List<String> = buildList {
            val others = matches.map { it.first }
            if (keeper.eligibility == Eligibility.PROTECTED) add(protectionText(keeper.protectionReasons))
            if (keeper.eligibility == Eligibility.UNKNOWN) add("Status unknown, so it is kept")
            if (matches.any { (other, similarity) -> isEditedCopyOf(keeper, other, similarity) }) add("Edited or cropped copy, uploaded later")
            if (others.all { keeper.sharpness >= it.sharpness }) add("Sharpest")
            val pixels = keeper.pixels
            if (pixels != null && others.all { (it.pixels ?: 0) <= pixels }) add("Highest resolution")
            if (isEmpty()) add("Best balance of sharpness, resolution and exposure")
        }

        private fun deletionReasons(photo: PhotoFacts, keeper: PhotoFacts, similarity: Double): List<String> = buildList {
            add("${oneDecimal(similarity * 100)}% similar to the keeper")
            if (isEditedCopyOf(keeper, photo, similarity)) add("Original of the edited copy being kept")
            if (keeper.sharpness > 0 && photo.sharpness < keeper.sharpness * 0.7) add("Blurrier than the keeper")
            val pixels = photo.pixels
            val keeperPixels = keeper.pixels
            if (pixels != null && keeperPixels != null && pixels < keeperPixels * 0.8) {
                add("Lower resolution (${oneDecimal(pixels / 1e6)} MP vs ${oneDecimal(keeperPixels / 1e6)} MP)")
            }
            if (photo.clipped > keeper.clipped + 0.05) add("More over- or under-exposed")
            if (size == 1) add("Near-identical shot")
        }

        private fun referenceReasons(photo: PhotoFacts): List<String> = when (photo.eligibility) {
            Eligibility.PROTECTED -> listOf(protectionText(photo.protectionReasons))
            else -> listOf("Status unknown, so it is kept")
        }

        private fun protectionText(reasons: Set<ProtectionReason>): String = "Protected: " + reasons.sorted().joinToString(", ") {
            when (it) {
                ProtectionReason.FAVOURITE -> "favourite"
                ProtectionReason.IN_ALBUM -> "in an album"
                ProtectionReason.ARCHIVED -> "archived"
            }
        }
    }
}
