package dev.photocleaner.features.shared.protection

import dev.photocleaner.features.shared.protection.model.ClassifiedItem
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.features.shared.protection.model.InventoryClassification
import dev.photocleaner.features.shared.protection.model.InventoryReport
import dev.photocleaner.features.shared.protection.model.ProtectionChoices
import dev.photocleaner.features.shared.protection.model.ProtectionReason
import dev.photocleaner.features.shared.protection.model.TypeCounts
import dev.photocleaner.features.shared.protection.model.UnknownReason
import dev.photocleaner.repositories.inventory.domain.InventorySnapshot
import dev.photocleaner.repositories.inventory.domain.StoredMediaType

/**
 * Classifies every item of one scan run and counts the outcome, by [EligibilityRules].
 * Pure: the extension calls it with a snapshot from IndexedDB, and every check (the groups,
 * Search, the trash queue) goes through it, so they can never disagree on what is protected.
 */
object InventoryClassifier {

    /** An inventory older than this no longer proves anything is unprotected. */
    const val DEFAULT_MAX_AGE_MS = 24L * 60 * 60 * 1000

    /** [chosen]: the protections the user wants; the counts follow them too. */
    fun classify(
        snapshot: InventorySnapshot,
        nowMs: Long,
        maxAgeMs: Long = DEFAULT_MAX_AGE_MS,
        chosen: ProtectionChoices = ProtectionChoices.ALL,
    ): InventoryClassification {
        val coverage = EligibilityRules.coverage(snapshot, nowMs, maxAgeMs)
        val items = snapshot.items.map { EligibilityRules.classify(it, snapshot, coverage, chosen) }
        val counts = listOf(StoredMediaType.PHOTO, StoredMediaType.VIDEO, null).map { type ->
            countsOf(type, items.filter { it.item.mediaType == type })
        }
        return InventoryClassification(InventoryReport(snapshot.run.id, snapshot.run.accountFingerprint, coverage, counts), items)
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
}
