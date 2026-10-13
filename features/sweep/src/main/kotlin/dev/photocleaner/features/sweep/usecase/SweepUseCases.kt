package dev.photocleaner.features.sweep.usecase

import dev.photocleaner.features.shared.embeddings.EmbeddingSettings
import dev.photocleaner.features.shared.embeddings.Vectors
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.features.shared.protection.model.InventoryClassification
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.analysis.domain.EmbeddingRepository
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import dev.photocleaner.repositories.review.domain.DecisionItem
import dev.photocleaner.repositories.review.domain.DecisionKind
import dev.photocleaner.repositories.review.domain.ReviewRepository
import dev.photocleaner.services.inference.domain.InferenceWorker
import java.security.MessageDigest
import kotlin.math.sqrt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

sealed interface SweepQuery {
    /** A description, e.g. "meal prep boxes". */
    data class Text(val text: String) : SweepQuery

    /** Photos that look like these (the average of their embeddings). */
    data class LikePhotos(val mediaKeys: Set<String>) : SweepQuery
}

/** [rank] is 1 for the strongest match. */
data class SweepHit(val item: InventoryItem, val score: Double, val rank: Int)

data class SweepResult(
    val blockedReason: String?,
    /** True when the block is fixed by scanning the library again (missing, unfinished or more than a day old). */
    val scanNeeded: Boolean,
    /** The strongest-matching eligible photos (up to the limit), shown newest first. */
    val hits: List<SweepHit>,
    val protectedOrUnknownHidden: Int,
    val alreadyApprovedHidden: Int,
)

private const val TOKEN_BUDGET = 280

/** Blocks sweeping unless the protection inventory is complete and fresh. */
private fun InventoryClassification?.sweepBlockedReason(): String? = when {
    this == null -> "The library has not been scanned yet. Start on the Scan library tab."
    !report.coverage.isComplete -> "The library scan is unfinished, so no photo can be trashed. Finish it on the Scan library tab."
    report.coverage.isStale -> "The library scan is more than a day old. Scan again on the Scan library tab (about 2–3 minutes)."
    else -> null
}

private suspend fun ReviewRepository.approvedMediaKeys(): Set<String> =
    activeDecisions().filter { it.kind == DecisionKind.APPROVED }.flatMap { d -> d.items.map { it.mediaKey } }.toSet()

/**
 * Finds the library's photos that best match a description or example photos,
 * and returns them newest first with their match rank. Only
 * eligible photos are returned; protected, unknown and already approved photos
 * are left out and counted, so a sweep can never select them.
 */
class SearchPhotosUseCase(
    private val classify: ClassifyInventoryUseCase,
    private val embeddings: EmbeddingRepository,
    private val worker: InferenceWorker,
    private val review: ReviewRepository,
) {
    suspend fun execute(query: SweepQuery, limit: Int): SweepResult {
        val classification = classify.execute()
        classification.sweepBlockedReason()?.let { return SweepResult(it, scanNeeded = true, emptyList(), 0, 0) }
        val photos = checkNotNull(classification).items.filter { it.item.mediaType == StoredMediaType.PHOTO }
        val vectors = embeddings.find(EmbeddingSettings.modelKey(TOKEN_BUDGET).id, photos.map { it.item.mediaKey })
        val target = when (query) {
            is SweepQuery.Text -> worker.embedText(listOf(query.text)).single()
            is SweepQuery.LikePhotos -> mean(query.mediaKeys.mapNotNull { vectors[it]?.vector })
                ?: return SweepResult("None of the chosen photos has been analysed yet (run the duplicate scan).", scanNeeded = false, emptyList(), 0, 0)
        }
        val approved = review.approvedMediaKeys()
        return withContext(Dispatchers.Default) {
            val scored = photos.mapNotNull { classified ->
                vectors[classified.item.mediaKey]?.let { classified to Vectors.cosine(target, it.vector) }
            }.sortedByDescending { it.second }
            val eligible = scored.filter { it.first.eligibility == Eligibility.ELIGIBLE }
            SweepResult(
                blockedReason = null,
                scanNeeded = false,
                // Which photos: chosen by match strength. In what order: newest first (user preference).
                hits = eligible.filter { it.first.item.mediaKey !in approved }.take(limit)
                    .mapIndexed { index, (classified, score) -> SweepHit(classified.item, score, index + 1) }
                    .sortedByDescending { it.item.takenAtMs },
                protectedOrUnknownHidden = scored.take(limit).count { it.first.eligibility != Eligibility.ELIGIBLE },
                alreadyApprovedHidden = eligible.take(limit).count { it.first.item.mediaKey in approved },
            )
        }
    }

    private fun mean(vectors: List<FloatArray>): FloatArray? {
        if (vectors.isEmpty()) return null
        val sum = FloatArray(vectors.first().size)
        vectors.forEach { v -> v.indices.forEach { sum[it] += v[it] } }
        val norm = sqrt(sum.sumOf { (it * it).toDouble() }).toFloat()
        return FloatArray(sum.size) { sum[it] / norm }
    }
}

/**
 * Approves a hand-picked set of photos from a sweep for the trash queue. Every
 * photo is re-checked against the latest inventory: anything not eligible, or
 * already approved, is refused, and nothing is recorded.
 */
class ApproveSweepUseCase(
    private val classify: ClassifyInventoryUseCase,
    private val review: ReviewRepository,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    suspend fun execute(label: String, mediaKeys: Set<String>): Int {
        require(mediaKeys.isNotEmpty()) { "Nothing is selected for the trash" }
        val classification = classify.execute()
        classification.sweepBlockedReason()?.let { throw IllegalStateException(it) }
        val items = checkNotNull(classification).items.associateBy { it.item.mediaKey }
        val approved = review.approvedMediaKeys()
        val refused = mediaKeys.filter { items[it]?.eligibility != Eligibility.ELIGIBLE || it in approved }
        require(refused.isEmpty()) { "${refused.size} selected photo(s) are no longer eligible or are already in the trash queue; search again" }
        val now = clock()
        val id = MessageDigest.getInstance("SHA-256").digest("$label|$now".toByteArray()).take(8).joinToString("") { "%02x".format(it) }
        review.recordDecision("sweep:$id", DecisionKind.APPROVED, mediaKeys.sorted().map { DecisionItem(it, items.getValue(it).item.dedupKey) }, mediaKeys, now)
        return mediaKeys.size
    }
}
