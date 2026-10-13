package dev.photocleaner.features.scan.usecase

import dev.photocleaner.features.scan.model.ScanProgress
import dev.photocleaner.features.scan.model.ScanState
import dev.photocleaner.repositories.inventory.domain.InventoryRepository
import dev.photocleaner.repositories.inventory.domain.ScanPhase
import dev.photocleaner.repositories.inventory.domain.ScanRun

/** Builds progress figures from what has been persisted for a run. */
internal class ScanProgressReader(private val repository: InventoryRepository) {

    suspend fun read(run: ScanRun, state: ScanState, phase: ScanPhase?, notice: String?): ScanProgress {
        val library = repository.cursor(run.id, ScanPhase.LIBRARY)
        val favourites = repository.cursor(run.id, ScanPhase.FAVOURITES)
        val archive = repository.cursor(run.id, ScanPhase.ARCHIVE)
        val albums = repository.albums(run.id)
        return ScanProgress(
            state = state,
            phase = phase,
            libraryEntries = library?.entriesSeen ?: 0,
            libraryPages = library?.pagesDone ?: 0,
            scannedBackToMs = repository.oldestTakenAtMs(run.id),
            favouriteEntries = favourites?.entriesSeen ?: 0,
            archiveEntries = archive?.entriesSeen ?: 0,
            albumsListed = albums.size,
            albumsRead = albums.count { it.membersComplete && it.failureReason == null },
            albumsFailed = albums.count { it.failureReason != null },
            notice = notice,
            timing = null,
        )
    }
}
