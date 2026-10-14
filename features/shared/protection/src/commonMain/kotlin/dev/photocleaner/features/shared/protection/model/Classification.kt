package dev.photocleaner.features.shared.protection.model

import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.StoredMediaType

enum class Eligibility { PROTECTED, ELIGIBLE, UNKNOWN }

enum class ProtectionReason { FAVOURITE, IN_ALBUM, ARCHIVED }

enum class UnknownReason {
    /** The scan did not finish every phase, or an album could not be fully read. */
    INVENTORY_INCOMPLETE,

    /** The inventory is older than the freshness limit. */
    INVENTORY_STALE,
    FAVOURITE_FLAG_MISSING,
    ARCHIVE_FLAG_MISSING,

    /** Not uploaded by this account (saved from a share) and not matched to an album. */
    NOT_OWNED,
    MEDIA_TYPE_UNKNOWN,
}

data class ClassifiedItem(
    val item: InventoryItem,
    val eligibility: Eligibility,
    val protectionReasons: Set<ProtectionReason>,
    val unknownReasons: Set<UnknownReason>,
)

enum class AlbumIssueKind { FAILED, NOT_FINISHED, COUNT_MISMATCH, COUNT_MISSING }

data class AlbumIssue(
    val albumTitle: String?,
    val kind: AlbumIssueKind,
    val detail: String,
)

data class PhaseEvidence(
    val name: String,
    val completed: Boolean,
    val pages: Int,
    val entries: Int,
    val duplicates: Int,
)

/**
 * How a per-item flag compares with Google's bulk listing of the same property.
 * Both sources protect; disagreement shows that one of them is unreliable.
 */
data class SourceAgreement(
    val listed: Int,
    val flagged: Int,
    val flaggedButNotListed: Int,
    val listedButNotFlagged: Int,
)

/** Why the protection inventory can or cannot be trusted. */
data class CoverageEvidence(
    val favourites: SourceAgreement,
    val archive: SourceAgreement,
    val runStatus: RunStatus,
    val runStatusReason: String?,
    val startedAtMs: Long,
    val finishedAtMs: Long?,
    val phases: List<PhaseEvidence>,
    val albumsListed: Int,
    val albumsFullyRead: Int,
    val albumIssues: List<AlbumIssue>,
    val isStale: Boolean,
    val isComplete: Boolean,
)

data class TypeCounts(
    val mediaType: StoredMediaType?,
    val total: Int,
    val protectedTotal: Int,
    val protectedByFavourite: Int,
    val protectedByAlbum: Int,
    val protectedByArchive: Int,
    val protectedByFavouriteAndAlbum: Int,
    val eligible: Int,
    val unknown: Int,
    val unknownByReason: Map<UnknownReason, Int>,
)

data class InventoryReport(
    val runId: Long,
    /** Account the inventory was taken from; later reads must come from the same account. */
    val accountFingerprint: String,
    val coverage: CoverageEvidence,
    /** Photos, videos, and items of unknown type, in that order. */
    val counts: List<TypeCounts>,
)

data class InventoryClassification(
    val report: InventoryReport,
    val items: List<ClassifiedItem>,
)
