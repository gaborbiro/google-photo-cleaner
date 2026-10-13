package dev.photocleaner.features.calibration.usecase

import dev.photocleaner.repositories.analysis.domain.CalibrationRepository
import dev.photocleaner.repositories.analysis.domain.PairLabel

/** Records a label for a pair, or clears it with a null label. */
class LabelCalibrationPairUseCase(
    private val calibration: CalibrationRepository,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    suspend fun execute(pairId: String, label: PairLabel?) {
        calibration.setLabel(pairId, label, label?.let { clock() })
    }
}

/** Clears the most recently given label; returns the pair id it cleared, or null when nothing is labelled. */
class UndoLastCalibrationLabelUseCase(private val calibration: CalibrationRepository) {
    suspend fun execute(): String? {
        val last = calibration.pairs().filter { it.labelledAtMs != null }.maxByOrNull { it.labelledAtMs!! } ?: return null
        calibration.setLabel(last.pairId, null, null)
        return last.pairId
    }
}
