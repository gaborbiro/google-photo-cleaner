package dev.photocleaner.features.shared.duplicates.model

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

/** What the analysis measured for one photo, with what the library listing says about the original file. */
class PhotoAnalysis(
    /** L2-normalised. */
    val vector: FloatArray,
    val sharpness: Double,
    /** Share of clipped pixels, dark plus bright. */
    val clipped: Double,
    val analysedAtMs: Long,
    val uploadedAtMs: Long?,
    /** The original's size; null when the listing didn't say. */
    val width: Int?,
    val height: Int?,
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

    /** Eligible and proposed for the trash. */
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
    /**
     * Already part of a decision the user made (kept, or trashed from). Set by the review
     * queue; grouping itself knows nothing of decisions.
     */
    val previouslyReviewed: Boolean = false,
)

data class DuplicateGroup(
    /** Stable for the same set of photos. */
    val id: String,
    val members: List<GroupMember>,
    val takenAtMs: Long,
) {
    val keeper: GroupMember get() = members.first { it.role == MemberRole.KEEPER }
}

/** Why no photo can be proposed yet; each app says it in its own words. */
enum class GroupsBlocked {
    NOT_SCANNED,
    SCAN_UNFINISHED,
    SCAN_STALE,
}

data class DuplicateGroupsResult(
    /** Null when groups are available; otherwise why not. */
    val blocked: GroupsBlocked?,
    val groups: List<DuplicateGroup>,
    val photosCompared: Int,
    val photosWithoutEmbedding: Int,
    /** When the most recently analysed photo was analysed; null when none is. */
    val analysedAtMs: Long?,
    /** The rules the groups were built with, so the screen can say what counts as a duplicate. */
    val settings: GroupingSettings,
)
