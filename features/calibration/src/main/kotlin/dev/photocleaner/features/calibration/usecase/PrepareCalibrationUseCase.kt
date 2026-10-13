package dev.photocleaner.features.calibration.usecase

import dev.photocleaner.features.calibration.model.CalibrationPrepProgress
import dev.photocleaner.features.shared.embeddings.EmbedPhotosUseCase
import dev.photocleaner.features.shared.embeddings.EmbedProgress
import dev.photocleaner.features.shared.embeddings.EmbeddingSettings
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.analysis.domain.CalibrationPair
import dev.photocleaner.repositories.analysis.domain.CalibrationRepository
import dev.photocleaner.repositories.analysis.domain.PairKind
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import kotlin.random.Random
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * Chooses calibration pairs (consecutive photos taken close together, plus a
 * baseline of photos taken far apart) and embeds their photos at every
 * calibration token budget. Existing pairs and labels are kept unless [fresh].
 * Any photo may appear in a pair: calibration never selects anything for deletion.
 */
class PrepareCalibrationUseCase(
    private val classify: ClassifyInventoryUseCase,
    private val calibration: CalibrationRepository,
    private val embedPhotos: EmbedPhotosUseCase,
    private val nearPairs: Int = 150,
    private val farPairs: Int = 30,
) {

    fun execute(fresh: Boolean): Flow<CalibrationPrepProgress> = flow {
        val classification = classify.execute()
        if (classification == null) {
            emit(CalibrationPrepProgress.Stopped("No inventory yet. Run a scan first."))
            return@flow
        }
        val photos = classification.items.map { it.item }
            .filter { it.mediaType == StoredMediaType.PHOTO }
            .sortedByDescending { it.takenAtMs }
        val byKey = photos.associateBy { it.mediaKey }

        var pairs = calibration.pairs()
        if (fresh || pairs.isEmpty()) {
            emit(CalibrationPrepProgress.Selecting(photos.size))
            pairs = selectPairs(photos, Random(classification.report.runId))
            calibration.replacePairs(pairs)
        }
        val items = pairs.flatMap { listOf(it.mediaKeyA, it.mediaKeyB) }.distinct().mapNotNull(byKey::get)

        embedPhotos.execute(items, EmbeddingSettings.CALIBRATION_BUDGETS).collect { progress ->
            emit(
                when (progress) {
                    is EmbedProgress.Running -> CalibrationPrepProgress.Embedding(pairs.size, progress.stats)
                    is EmbedProgress.Stopped -> CalibrationPrepProgress.Stopped(progress.reason)
                    is EmbedProgress.Finished -> CalibrationPrepProgress.Ready(pairs.size, progress.stats)
                },
            )
        }
    }

    private fun selectPairs(photos: List<InventoryItem>, random: Random): List<CalibrationPair> {
        val near = photos.zipWithNext()
            .filter { (a, b) -> a.takenAtMs - b.takenAtMs in 0..NEAR_GAP_MS }
            .shuffled(random)
            .take(nearPairs)
            .map { (a, b) -> Triple(a, b, PairKind.NEAR) }
        val far = buildList {
            var attempts = 0
            while (size < farPairs && photos.size >= 2 && attempts < farPairs * 50) {
                attempts++
                val a = photos[random.nextInt(photos.size)]
                val b = photos[random.nextInt(photos.size)]
                if (kotlin.math.abs(a.takenAtMs - b.takenAtMs) > FAR_GAP_MS) add(Triple(a, b, PairKind.FAR))
            }
        }
        val order = (near.indices + (near.size until near.size + far.size)).shuffled(random)
        return (near + far).mapIndexed { index, (a, b, kind) ->
            CalibrationPair(
                pairId = "${a.mediaKey}|${b.mediaKey}",
                mediaKeyA = a.mediaKey,
                mediaKeyB = b.mediaKey,
                kind = kind,
                takenGapMs = kotlin.math.abs(a.takenAtMs - b.takenAtMs),
                order = order[index],
                label = null,
                labelledAtMs = null,
            )
        }.distinctBy { it.pairId }
    }

    private companion object {
        const val NEAR_GAP_MS = 120_000L
        const val FAR_GAP_MS = 30L * 24 * 60 * 60 * 1000
    }
}
