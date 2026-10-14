package dev.photocleaner.features.calibration.usecase

import dev.photocleaner.features.shared.duplicates.calibration.BudgetReport
import dev.photocleaner.features.calibration.model.CalibrationView
import dev.photocleaner.features.calibration.model.ScoredPair
import dev.photocleaner.features.shared.duplicates.calibration.CalibrationReports
import dev.photocleaner.features.shared.duplicates.calibration.LabelledScore
import dev.photocleaner.features.shared.embeddings.EmbeddingSettings
import dev.photocleaner.features.shared.duplicates.Vectors
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.analysis.domain.CalibrationRepository
import dev.photocleaner.repositories.analysis.domain.EmbeddingRepository

/** Calibration pairs with their scores, the next pair to label, and per-budget threshold reports. */
class LoadCalibrationUseCase(
    private val classify: ClassifyInventoryUseCase,
    private val calibration: CalibrationRepository,
    private val embeddings: EmbeddingRepository,
) {

    suspend fun execute(): CalibrationView {
        val pairs = calibration.pairs()
        val items = classify.execute()?.items.orEmpty().associate { it.item.mediaKey to it.item }
        val keys = pairs.flatMap { listOf(it.mediaKeyA, it.mediaKeyB) }.distinct()
        val vectors = EmbeddingSettings.CALIBRATION_BUDGETS.associateWith { budget ->
            embeddings.find(EmbeddingSettings.modelKey(budget).id, keys)
        }
        val scored = pairs.map { pair ->
            ScoredPair(
                pair = pair,
                itemA = items[pair.mediaKeyA],
                itemB = items[pair.mediaKeyB],
                scores = vectors.mapValues { (_, byKey) ->
                    val a = byKey[pair.mediaKeyA]?.vector
                    val b = byKey[pair.mediaKeyB]?.vector
                    if (a != null && b != null) Vectors.cosine(a, b) else null
                },
            )
        }
        val ready = scored.filter { it.itemA != null && it.itemB != null && it.scores.values.all { s -> s != null } }
        return CalibrationView(
            pairs = scored,
            labelled = scored.count { it.pair.label != null },
            nextUnlabelled = ready.firstOrNull { it.pair.label == null },
            reports = EmbeddingSettings.CALIBRATION_BUDGETS.map { budget -> report(budget, scored) },
        )
    }

    private fun report(budget: Int, pairs: List<ScoredPair>): BudgetReport = CalibrationReports.report(
        budget,
        pairs.mapNotNull { p -> p.pair.label?.let { label -> p.scores[budget]?.let { score -> LabelledScore(label, score) } } },
    )
}
