package dev.photocleaner.features.calibration.model

import dev.photocleaner.features.shared.embeddings.EmbedStats
import dev.photocleaner.repositories.analysis.domain.CalibrationPair
import dev.photocleaner.repositories.inventory.domain.InventoryItem

sealed interface CalibrationPrepProgress {
    data class Selecting(val photos: Int) : CalibrationPrepProgress
    data class Embedding(val pairs: Int, val stats: EmbedStats) : CalibrationPrepProgress
    data class Stopped(val reason: String) : CalibrationPrepProgress
    data class Ready(val pairs: Int, val stats: EmbedStats) : CalibrationPrepProgress
}

/** A calibration pair with its photos and the similarity score per token budget (null when not embedded). */
data class ScoredPair(
    val pair: CalibrationPair,
    val itemA: InventoryItem?,
    val itemB: InventoryItem?,
    val scores: Map<Int, Double?>,
)

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

data class CalibrationView(
    val pairs: List<ScoredPair>,
    val labelled: Int,
    val nextUnlabelled: ScoredPair?,
    val reports: List<BudgetReport>,
)
