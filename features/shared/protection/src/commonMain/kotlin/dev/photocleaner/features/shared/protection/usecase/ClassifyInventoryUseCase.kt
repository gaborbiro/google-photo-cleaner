package dev.photocleaner.features.shared.protection.usecase

import dev.photocleaner.features.shared.protection.InventoryClassifier
import dev.photocleaner.features.shared.protection.currentTimeMs
import dev.photocleaner.features.shared.protection.model.InventoryClassification
import dev.photocleaner.repositories.inventory.domain.InventoryRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Classifies every item of the latest scan run. Returns null when no scan has been started. */
class ClassifyInventoryUseCase(
    private val repository: InventoryRepository,
    private val clock: () -> Long = ::currentTimeMs,
    private val maxAgeMs: Long = DEFAULT_MAX_AGE_MS,
) {

    suspend fun execute(): InventoryClassification? {
        val run = repository.latestRun() ?: return null
        val snapshot = repository.snapshot(run.id)
        return withContext(Dispatchers.Default) { InventoryClassifier.classify(snapshot, clock(), maxAgeMs) }
    }

    companion object {
        /** An inventory older than this no longer proves anything is unprotected. */
        const val DEFAULT_MAX_AGE_MS = InventoryClassifier.DEFAULT_MAX_AGE_MS
    }
}
