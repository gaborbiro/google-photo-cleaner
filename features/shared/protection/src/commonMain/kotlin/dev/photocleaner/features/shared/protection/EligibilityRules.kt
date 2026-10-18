package dev.photocleaner.features.shared.protection

import dev.photocleaner.features.shared.protection.model.AlbumIssue
import dev.photocleaner.features.shared.protection.model.AlbumIssueKind
import dev.photocleaner.features.shared.protection.model.ClassifiedItem
import dev.photocleaner.features.shared.protection.model.CoverageEvidence
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.features.shared.protection.model.PhaseEvidence
import dev.photocleaner.features.shared.protection.model.ProtectionChoices
import dev.photocleaner.features.shared.protection.model.ProtectionReason
import dev.photocleaner.features.shared.protection.model.SourceAgreement
import dev.photocleaner.features.shared.protection.model.UnknownReason
import dev.photocleaner.repositories.inventory.domain.AlbumReread
import dev.photocleaner.repositories.inventory.domain.AlbumStatus
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.InventorySnapshot
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.ScanPhase

/**
 * The product rules, in one place.
 *
 * - Positive evidence protects on its own: favourite flag, favourites listing,
 *   any album entry with the same dedupKey, archived flag, or archive listing.
 * - Eligibility needs proof of the negative: a complete, fresh inventory and
 *   explicit `false` flags on the item.
 * - Anything else is UNKNOWN, with every reason recorded.
 * - Who uploaded a photo doesn't matter: one saved from someone else's share is in the
 *   library by the user's own act, like one they took, and judged the same way.
 */
internal object EligibilityRules {

    private val TOP_LEVEL_PHASES = listOf(ScanPhase.LIBRARY, ScanPhase.FAVOURITES, ScanPhase.ARCHIVE, ScanPhase.ALBUM_LIST)

    fun coverage(snapshot: InventorySnapshot, nowMs: Long, maxAgeMs: Long): CoverageEvidence {
        val run = snapshot.run
        val phases = TOP_LEVEL_PHASES.map { phase ->
            val cursor = snapshot.cursors.firstOrNull { it.phase == phase && it.scope == "" }
            PhaseEvidence(
                name = phase.name,
                completed = cursor?.completed == true,
                pages = cursor?.pagesDone ?: 0,
                entries = cursor?.entriesSeen ?: 0,
                duplicates = cursor?.duplicateEntries ?: 0,
            )
        }
        val (issues, warnings) = snapshot.albums.mapNotNull(::albumIssue).partition { it.kind.blocksTrashing }
        val finishedAt = run.finishedAtMs
        // A scan that finished "in the future" means the clock moved back: its age is unknown, so it proves nothing.
        val stale = finishedAt == null || finishedAt > nowMs || nowMs - finishedAt > maxAgeMs
        val complete = run.status == RunStatus.COMPLETED &&
            phases.all { it.completed } &&
            issues.isEmpty()
        val favouriteFlagged = snapshot.items.filter { it.isFavourite == true }.map { it.dedupKey }.toSet()
        val archiveFlagged = snapshot.items.filter { it.isArchived == true }.map { it.dedupKey }.toSet()
        return CoverageEvidence(
            favourites = SourceAgreement(
                listed = snapshot.favouriteDedupKeys.size,
                flagged = favouriteFlagged.size,
                flaggedButNotListed = (favouriteFlagged - snapshot.favouriteDedupKeys).size,
                listedButNotFlagged = (snapshot.favouriteDedupKeys - favouriteFlagged).size,
            ),
            archive = SourceAgreement(
                listed = snapshot.archivedDedupKeys.size,
                flagged = archiveFlagged.size,
                flaggedButNotListed = (archiveFlagged - snapshot.archivedDedupKeys).size,
                listedButNotFlagged = (snapshot.archivedDedupKeys - archiveFlagged).size,
            ),
            runStatus = run.status,
            runStatusReason = run.statusReason,
            startedAtMs = run.startedAtMs,
            finishedAtMs = finishedAt,
            phases = phases,
            albumsListed = snapshot.albums.size,
            albumsFullyRead = snapshot.albums.count { albumIssue(it) == null },
            albumIssues = issues,
            albumWarnings = warnings,
            isStale = stale,
            isComplete = complete,
        )
    }

    /**
     * Only the protections the user [chose] count. A photo whose only protection was turned off is
     * then judged like any other: eligible if its flags were all read, otherwise unknown.
     */
    fun classify(item: InventoryItem, snapshot: InventorySnapshot, coverage: CoverageEvidence, chosen: ProtectionChoices): ClassifiedItem {
        val protection = buildSet {
            if (item.isFavourite == true || item.dedupKey in snapshot.favouriteDedupKeys) add(ProtectionReason.FAVOURITE)
            if (snapshot.albumMembership[item.dedupKey].orEmpty().isNotEmpty()) add(ProtectionReason.IN_ALBUM)
            if (item.isArchived == true || item.dedupKey in snapshot.archivedDedupKeys) add(ProtectionReason.ARCHIVED)
        }.filter(chosen::covers).toSet()
        if (protection.isNotEmpty()) return ClassifiedItem(item, Eligibility.PROTECTED, protection, emptySet())

        val unknown = buildSet {
            if (!coverage.isComplete) add(UnknownReason.INVENTORY_INCOMPLETE)
            if (coverage.isStale) add(UnknownReason.INVENTORY_STALE)
            if (item.isFavourite == null) add(UnknownReason.FAVOURITE_FLAG_MISSING)
            if (item.isArchived == null) add(UnknownReason.ARCHIVE_FLAG_MISSING)
            if (item.mediaType == null) add(UnknownReason.MEDIA_TYPE_UNKNOWN)
        }
        return if (unknown.isEmpty()) {
            ClassifiedItem(item, Eligibility.ELIGIBLE, emptySet(), emptySet())
        } else {
            ClassifiedItem(item, Eligibility.UNKNOWN, emptySet(), unknown)
        }
    }

    private fun albumIssue(status: AlbumStatus): AlbumIssue? {
        val title = status.album.title
        val reported = status.album.reportedItemCount
        val failure = status.failureReason
        return when {
            failure != null -> AlbumIssue(title, AlbumIssueKind.FAILED, failure)
            !status.membersComplete -> AlbumIssue(title, AlbumIssueKind.NOT_FINISHED, "${status.membersSeen} entries read so far")
            reported == null -> AlbumIssue(title, AlbumIssueKind.COUNT_MISSING, "Google reported no item count; ${status.membersSeen} entries read")
            reported == status.membersSeen -> null
            status.reread == AlbumReread.SAME_ENTRIES ->
                AlbumIssue(title, AlbumIssueKind.COUNT_MISMATCH_READ_TWICE, "Google reports $reported entries; ${status.membersSeen} read, the same ones on a second read")
            status.reread == AlbumReread.DIFFERENT_ENTRIES ->
                AlbumIssue(title, AlbumIssueKind.COUNT_MISMATCH, "Google reports $reported entries; ${status.membersSeen} read, and a second read found different ones")
            else -> AlbumIssue(title, AlbumIssueKind.COUNT_MISMATCH, "Google reports $reported entries; ${status.membersSeen} read")
        }
    }
}
