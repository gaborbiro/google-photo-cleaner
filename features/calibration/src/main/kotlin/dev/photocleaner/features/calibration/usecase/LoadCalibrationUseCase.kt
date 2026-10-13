package dev.photocleaner.features.calibration.usecase

import dev.photocleaner.features.calibration.model.BudgetReport
import dev.photocleaner.features.calibration.model.CalibrationView
import dev.photocleaner.features.calibration.model.ScoredPair
import dev.photocleaner.features.calibration.model.ThresholdRow
import dev.photocleaner.features.shared.embeddings.EmbeddingSettings
import dev.photocleaner.features.shared.embeddings.Vectors
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.analysis.domain.CalibrationRepository
import dev.photocleaner.repositories.analysis.domain.EmbeddingRepository
import dev.photocleaner.repositories.analysis.domain.PairLabel

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

    private fun report(budget: Int, pairs: List<ScoredPair>): BudgetReport {
        val labelled = pairs.mapNotNull { p -> p.pair.label?.let { label -> p.scores[budget]?.let { score -> label to score } } }
        val duplicates = labelled.filter { it.first != PairLabel.DIFFERENT }
        val same = labelled.filter { it.first == PairLabel.SAME }
        val different = labelled.filter { it.first == PairLabel.DIFFERENT }
        val highestDifferent = different.maxOfOrNull { it.second }
        val rows = GRID.map { threshold ->
            val flagged = labelled.filter { it.second >= threshold }
            val truePositives = flagged.count { it.first != PairLabel.DIFFERENT }
            ThresholdRow(
                threshold = threshold,
                flagged = flagged.size,
                truePositives = truePositives,
                falsePositives = flagged.size - truePositives,
                precision = if (flagged.isEmpty()) null else truePositives.toDouble() / flagged.size,
                recall = if (duplicates.isEmpty()) null else truePositives.toDouble() / duplicates.size,
                sameRecall = if (same.isEmpty()) null else same.count { it.second >= threshold }.toDouble() / same.size,
            )
        }
        return BudgetReport(
            tokenBudget = budget,
            labelled = labelled.size,
            duplicates = duplicates.size,
            different = different.size,
            lowestSame = same.minOfOrNull { it.second },
            lowestNearDuplicate = labelled.filter { it.first == PairLabel.NEAR_DUPLICATE }.minOfOrNull { it.second },
            highestDifferent = highestDifferent,
            recommendedThreshold = highestDifferent?.let { h -> GRID.firstOrNull { it > h } },
            rows = rows,
        )
    }

    companion object {
        /** 0.700 to 0.995 in steps of 0.005. */
        val GRID: List<Double> = (0..59).map { 0.7 + it * 0.005 }.map { Math.round(it * 1000) / 1000.0 }
    }
}
