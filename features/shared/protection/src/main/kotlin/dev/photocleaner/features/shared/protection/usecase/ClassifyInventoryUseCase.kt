package dev.photocleaner.features.shared.protection.usecase

import dev.photocleaner.features.shared.protection.EligibilityRules
import dev.photocleaner.features.shared.protection.model.ClassifiedItem
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.features.shared.protection.model.InventoryClassification
import dev.photocleaner.features.shared.protection.model.InventoryReport
import dev.photocleaner.features.shared.protection.model.ProtectionReason
import dev.photocleaner.features.shared.protection.model.TypeCounts
import dev.photocleaner.features.shared.protection.model.UnknownReason
import dev.photocleaner.repositories.inventory.domain.InventoryRepository
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Classifies every item of the latest scan run. Returns null when no scan has been started. */
class ClassifyInventoryUseCase(
    private val repository: InventoryRepository,
    private val clock: () -> Long = System::currentTimeMillis,
    private val maxAgeMs: Long = DEFAULT_MAX_AGE_MS,
) {

    suspend fun execute(): InventoryClassification? {
        val run = repository.latestRun() ?: return null
        val snapshot = repository.snapshot(run.id)
        return withContext(Dispatchers.Default) {
            val coverage = EligibilityRules.coverage(snapshot, clock(), maxAgeMs)
            val items = snapshot.items.map { EligibilityRules.classify(it, snapshot, coverage) }
            val counts = listOf(StoredMediaType.PHOTO, StoredMediaType.VIDEO, null).map { type ->
                countsOf(type, items.filter { it.item.mediaType == type })
            }
            InventoryClassification(InventoryReport(run.id, run.accountFingerprint, coverage, counts), items)
        }
    }

    private fun countsOf(type: StoredMediaType?, items: List<ClassifiedItem>): TypeCounts {
        val protected = items.filter { it.eligibility == Eligibility.PROTECTED }
        val unknown = items.filter { it.eligibility == Eligibility.UNKNOWN }
        return TypeCounts(
            mediaType = type,
            total = items.size,
            protectedTotal = protected.size,
            protectedByFavourite = protected.count { ProtectionReason.FAVOURITE in it.protectionReasons },
            protectedByAlbum = protected.count { ProtectionReason.IN_ALBUM in it.protectionReasons },
            protectedByArchive = protected.count { ProtectionReason.ARCHIVED in it.protectionReasons },
            protectedByFavouriteAndAlbum = protected.count {
                ProtectionReason.FAVOURITE in it.protectionReasons && ProtectionReason.IN_ALBUM in it.protectionReasons
            },
            eligible = items.count { it.eligibility == Eligibility.ELIGIBLE },
            unknown = unknown.size,
            unknownByReason = UnknownReason.entries.associateWith { reason -> unknown.count { reason in it.unknownReasons } }
                .filterValues { it > 0 },
        )
    }

    companion object {
        /** An inventory older than this no longer proves anything is unprotected. */
        const val DEFAULT_MAX_AGE_MS = 24L * 60 * 60 * 1000
    }
}
