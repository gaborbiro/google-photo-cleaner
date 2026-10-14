package dev.photocleaner.features.shared.duplicates.calibration

import dev.photocleaner.repositories.analysis.domain.PairLabel
import kotlin.math.round

/** One labelled calibration pair and how similar the AI finds it at one detail. */
data class LabelledScore(val label: PairLabel, val score: Double)

data class ThresholdRow(
    val threshold: Double,
    val flagged: Int,
    val truePositives: Int,
    val falsePositives: Int,
    /** Of the pairs at or above the threshold, the share that are SAME or NEAR_DUPLICATE; null when none are flagged. */
    val precision: Double?,
    /** Of the SAME or NEAR_DUPLICATE pairs, the share at or above the threshold. */
    val recall: Double?,
    /** Of the SAME pairs only, the share at or above the threshold. */
    val sameRecall: Double?,
)

data class BudgetReport(
    val tokenBudget: Int,
    val labelled: Int,
    val duplicates: Int,
    val different: Int,
    val lowestSame: Double?,
    val lowestNearDuplicate: Double?,
    val highestDifferent: Double?,
    /** Lowest grid threshold with no DIFFERENT pair at or above it; null without DIFFERENT labels. */
    val recommendedThreshold: Double?,
    val rows: List<ThresholdRow>,
)

/** How well each threshold separates the user's labelled pairs, and the threshold to use. */
object CalibrationReports {

    /** 0.700 to 0.995 in steps of 0.005. */
    val GRID: List<Double> = (0..59).map { round((0.7 + it * 0.005) * 1000) / 1000.0 }

    fun report(tokenBudget: Int, labelled: List<LabelledScore>): BudgetReport {
        val duplicates = labelled.filter { it.label != PairLabel.DIFFERENT }
        val same = labelled.filter { it.label == PairLabel.SAME }
        val different = labelled.filter { it.label == PairLabel.DIFFERENT }
        val highestDifferent = different.maxOfOrNull { it.score }
        val rows = GRID.map { threshold ->
            val flagged = labelled.filter { it.score >= threshold }
            val truePositives = flagged.count { it.label != PairLabel.DIFFERENT }
            ThresholdRow(
                threshold = threshold,
                flagged = flagged.size,
                truePositives = truePositives,
                falsePositives = flagged.size - truePositives,
                precision = if (flagged.isEmpty()) null else truePositives.toDouble() / flagged.size,
                recall = if (duplicates.isEmpty()) null else truePositives.toDouble() / duplicates.size,
                sameRecall = if (same.isEmpty()) null else same.count { it.score >= threshold }.toDouble() / same.size,
            )
        }
        return BudgetReport(
            tokenBudget = tokenBudget,
            labelled = labelled.size,
            duplicates = duplicates.size,
            different = different.size,
            lowestSame = same.minOfOrNull { it.score },
            lowestNearDuplicate = labelled.filter { it.label == PairLabel.NEAR_DUPLICATE }.minOfOrNull { it.score },
            highestDifferent = highestDifferent,
            recommendedThreshold = highestDifferent?.let { h -> GRID.firstOrNull { it > h } },
            rows = rows,
        )
    }
}
