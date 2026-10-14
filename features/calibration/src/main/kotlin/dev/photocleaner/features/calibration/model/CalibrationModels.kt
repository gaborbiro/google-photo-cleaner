package dev.photocleaner.features.calibration.model

import dev.photocleaner.features.shared.duplicates.calibration.BudgetReport
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

data class CalibrationView(
    val pairs: List<ScoredPair>,
    val labelled: Int,
    val nextUnlabelled: ScoredPair?,
    val reports: List<BudgetReport>,
)
