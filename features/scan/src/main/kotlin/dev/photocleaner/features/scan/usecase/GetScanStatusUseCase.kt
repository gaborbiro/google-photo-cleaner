package dev.photocleaner.features.scan.usecase

import dev.photocleaner.features.scan.model.ScanProgress
import dev.photocleaner.features.scan.model.ScanState
import dev.photocleaner.repositories.inventory.domain.InventoryRepository
import dev.photocleaner.repositories.inventory.domain.RunStatus

/** Status of the latest run as persisted, for showing before (or without) scanning in this session. */
class GetScanStatusUseCase(private val repository: InventoryRepository) {

    private val progress = ScanProgressReader(repository)

    suspend fun execute(): ScanProgress {
        val run = repository.latestRun() ?: return ScanProgress.none()
        return when (run.status) {
            // Nothing is scanning when this is called, so a RUNNING run was interrupted by an exit or crash.
            RunStatus.RUNNING -> progress.read(run, ScanState.PAUSED, null, "The previous scan was interrupted. Resume to continue where it stopped.")
            RunStatus.PAUSED -> progress.read(run, ScanState.PAUSED, null, run.statusReason)
            RunStatus.COMPLETED -> progress.read(run, ScanState.COMPLETED, null, null)
            RunStatus.FAILED -> progress.read(run, ScanState.FAILED, null, run.statusReason)
            RunStatus.CANCELLED -> progress.read(run, ScanState.CANCELLED, null, null)
        }
    }
}
