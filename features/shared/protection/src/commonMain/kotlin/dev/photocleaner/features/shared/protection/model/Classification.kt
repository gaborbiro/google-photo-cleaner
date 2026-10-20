package dev.photocleaner.features.shared.protection.model

import dev.photocleaner.repositories.inventory.domain.AlbumReread
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
    MEDIA_TYPE_UNKNOWN,
}

data class ClassifiedItem(
    val item: InventoryItem,
    val eligibility: Eligibility,
    val protectionReasons: Set<ProtectionReason>,
    val unknownReasons: Set<UnknownReason>,
)

enum class AlbumIssueKind(
    /** Whether the album's entries can't be trusted, so no photo may be trashed. */
    val blocksTrashing: Boolean,
) {
    FAILED(true),
    NOT_FINISHED(true),
    COUNT_MISMATCH(true),
    COUNT_MISSING(true),

    /**
     * The entries don't add up to Google's count, but the album was read to the end twice with the
     * same entries both times. Google's count can include entries this account can't see (in a
     * shared album, for example); a page lost or a list cut short would hardly repeat identically.
     */
    COUNT_MISMATCH_READ_TWICE(false),
}

data class AlbumIssue(
    val albumTitle: String?,
    val kind: AlbumIssueKind,
    val detail: String,
    /**
     * The album as numbers and flags, without its title: for diagnosing an issue in a problem
     * report (Google's count, the entries read, the second read's outcome, shared, kind).
     */
    val facts: AlbumFacts,
)

data class AlbumFacts(
    val reportedCount: Int?,
    val entriesRead: Int,
    val reread: AlbumReread?,
    val isShared: Boolean?,
    val kindCode: Int?,
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
    /** Albums whose entries can't be trusted: any one makes the coverage incomplete. */
    val albumIssues: List<AlbumIssue>,
    /** Albums worth knowing about that don't block trashing. */
    val albumWarnings: List<AlbumIssue>,
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
