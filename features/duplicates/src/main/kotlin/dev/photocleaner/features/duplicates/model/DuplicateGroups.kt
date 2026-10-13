package dev.photocleaner.features.duplicates.model

import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.features.shared.protection.model.ProtectionReason
import dev.photocleaner.repositories.inventory.domain.InventoryItem

data class GroupingSettings(
    /** Calibrated on the user's labels (2026-10-12): 99% precision, 88% recall at budget 280. */
    val threshold: Double = 0.925,
    /** Only photos taken this close together are compared; calibration covered gaps up to 2 minutes. */
    val windowMs: Long = 120_000,
    val maxGroupSize: Int = 12,
    val tokenBudget: Int = 280,
    /** An "edited copy": same instant, very similar, uploaded at least this much later than its original. */
    val editedCopyMinUploadGapMs: Long = 60_000,
    val editedCopyMaxTakenGapMs: Long = 2_000,
    val editedCopyMinSimilarity: Double = 0.95,
)

data class PhotoFacts(
    val item: InventoryItem,
    val eligibility: Eligibility,
    val protectionReasons: Set<ProtectionReason>,
    val sharpness: Double,
    val clipped: Double,
    val pixels: Long?,
    val uploadedAtMs: Long?,
)

enum class MemberRole {
    /** The recommended photo to keep. */
    KEEPER,

    /** Eligible and proposed for deletion. */
    PROPOSED,

    /** Protected or of unknown status: always kept, shown for reference. */
    REFERENCE,
}

data class GroupMember(
    val photo: PhotoFacts,
    val role: MemberRole,
    /** Similarity to the keeper (1.0 for the keeper itself). */
    val similarity: Double,
    val reasons: List<String>,
)

data class DuplicateGroup(
    /** Stable for the same set of photos. */
    val id: String,
    val members: List<GroupMember>,
    val takenAtMs: Long,
) {
    val keeper: GroupMember get() = members.first { it.role == MemberRole.KEEPER }
}

data class DuplicateGroupsResult(
    /** Null when groups are available; otherwise why not (e.g. the inventory is incomplete or stale). */
    val blockedReason: String?,
    val groups: List<DuplicateGroup>,
    val photosCompared: Int,
    val photosWithoutEmbedding: Int,
    /** When the most recently analysed photo was analysed; null when none is. */
    val analysedAtMs: Long?,
)
