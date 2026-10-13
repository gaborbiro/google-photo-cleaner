package dev.photocleaner.features.scan.usecase

import dev.photocleaner.repositories.inventory.domain.InventoryRepository
import dev.photocleaner.repositories.inventory.domain.RunStatus

/** Abandons the latest unfinished run, so the next scan starts from scratch. */
class DiscardScanUseCase(
    private val repository: InventoryRepository,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    suspend fun execute() {
        val run = repository.latestRun() ?: return
        if (run.status == RunStatus.RUNNING || run.status == RunStatus.PAUSED || run.status == RunStatus.FAILED) {
            repository.updateRunStatus(run.id, RunStatus.CANCELLED, "Discarded", clock())
        }
    }
}
