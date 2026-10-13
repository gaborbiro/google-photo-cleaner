package dev.photocleaner.features.scan

import dev.photocleaner.core.design.PhotoDateFormat
import dev.photocleaner.core.design.StatusTone
import dev.photocleaner.features.scan.model.ScanProgress
import dev.photocleaner.features.scan.model.ScanState
import dev.photocleaner.features.scan.model.ScanTiming
import dev.photocleaner.features.shared.protection.model.AlbumIssueKind
import dev.photocleaner.features.shared.protection.model.InventoryReport
import dev.photocleaner.features.shared.protection.model.SourceAgreement
import dev.photocleaner.features.shared.protection.model.TypeCounts
import dev.photocleaner.features.shared.protection.model.UnknownReason
import dev.photocleaner.repositories.inventory.domain.ScanPhase
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

internal class ScanUiMapper {

    private val timeFormat = DateTimeFormatter.ofPattern("d MMM yyyy HH:mm").withZone(ZoneId.systemDefault())

    fun statusTitle(progress: ScanProgress, scanning: Boolean): Pair<String, StatusTone> = when {
        scanning -> "Scanning: ${phaseName(progress.phase)}" to StatusTone.CAUTION
        else -> when (progress.state) {
            ScanState.NONE -> "No scan yet" to StatusTone.NEUTRAL
            ScanState.RUNNING -> "Scanning" to StatusTone.CAUTION
            ScanState.PAUSED -> "Scan paused" to StatusTone.CAUTION
            ScanState.COMPLETED -> "Scan complete" to StatusTone.POSITIVE
            ScanState.FAILED -> "Scan failed" to StatusTone.NEGATIVE
            ScanState.CANCELLED -> "Scan discarded" to StatusTone.NEUTRAL
        }
    }

    private val dateFormat = PhotoDateFormat("d MMM yyyy")

    fun progressLines(progress: ScanProgress): List<String> = if (progress.state == ScanState.NONE) emptyList() else listOf(
        "Library: ${n(progress.libraryEntries)} entries in ${n(progress.libraryPages)} pages" +
            // Only meaningful while the library is being read, newest to oldest: afterwards it is just the
            // oldest date in the library, which can be a camera's factory default (1 Jan 1980).
            (progress.scannedBackToMs?.takeIf { progress.phase == ScanPhase.LIBRARY && progress.state != ScanState.COMPLETED && !PhotoDateFormat.isCameraDefault(it) }
                ?.let { ", reached photos from ${dateFormat.format(it)}" } ?: ""),
        "Favourite photos: ${n(progress.favouriteEntries)} entries",
        "Archived photos: ${n(progress.archiveEntries)} entries",
        "Albums: ${n(progress.albumsRead)} of ${n(progress.albumsListed)} read" +
            if (progress.albumsFailed > 0) ", ${progress.albumsFailed} could not be read" else "",
    )

    /**
     * Where the scan's time went, so it is clear what sets its speed: waiting for Google,
     * the deliberate pause between requests, or work on this computer.
     */
    fun speedText(timing: ScanTiming?): String? {
        val shares = shares(timing) ?: return null
        val perAnswer = "%.1f".format(shares.secondsPerAnswer)
        return "Where the time goes: waiting for Google ${shares.google}% ($perAnswer s per answer) · " +
            "pause between requests ${shares.pause}% · this computer ${shares.computer}%"
    }

    /** Only said when the measurements back it up. */
    fun speedHint(timing: ScanTiming?): String? = shares(timing)?.takeIf { it.computer < COMPUTER_SHARE_FOR_HINT }?.let {
        "A library scan's speed is set by your internet connection and Google's servers, not by this computer. " +
            "The short pause between requests keeps Google from limiting the scan."
    }

    private class Shares(val google: Int, val pause: Int, val computer: Int, val secondsPerAnswer: Double)

    private fun shares(timing: ScanTiming?): Shares? {
        if (timing == null || timing.elapsedMs < MIN_TIMED_MS || timing.requests == 0) return null
        fun share(ms: Long) = (ms * 100 / timing.elapsedMs).toInt().coerceIn(0, 100)
        val google = share(timing.googleMs)
        val pause = share(timing.pauseMs).coerceAtMost(100 - google)
        return Shares(google, pause, 100 - google - pause, timing.googleMs / 1000.0 / timing.requests)
    }

    /** For the tab: whether the library scan is usable, the same check that allows trashing. */
    fun tabStatus(report: InventoryReport?, scanning: Boolean): String = when {
        scanning -> "scanning"
        report == null || !report.coverage.isComplete -> "needed"
        report.coverage.isStale -> "out of date"
        else -> "done"
    }

    fun primaryLabel(progress: ScanProgress, scanning: Boolean): String = when {
        scanning -> "Pause"
        progress.state == ScanState.PAUSED -> "Resume scan"
        progress.state == ScanState.COMPLETED -> "Scan again"
        else -> "Start scan"
    }

    fun report(report: InventoryReport): ReportUi {
        val coverage = report.coverage
        val (title, tone) = when {
            !coverage.isComplete -> "Protection coverage incomplete: no photo is eligible" to StatusTone.NEGATIVE
            coverage.isStale -> "The last scan is more than a day old: no photo can be trashed until you scan again" to StatusTone.CAUTION
            else -> "Protection coverage complete" to StatusTone.POSITIVE
        }
        val coverageLines = buildList {
            add("Scan started ${time(coverage.startedAtMs)}" + (coverage.finishedAtMs?.let { ", finished ${time(it)}" } ?: ", not finished"))
            coverage.runStatusReason?.let { add("Last stop: $it") }
            coverage.phases.forEach { phase ->
                add(
                    "${phaseLabel(phase.name)}: ${n(phase.entries)} entries in ${n(phase.pages)} pages" +
                        (if (phase.duplicates > 0) ", ${n(phase.duplicates)} repeated" else "") +
                        if (phase.completed) ", read to the end" else ", not finished",
                )
            }
            add("Albums: ${n(coverage.albumsFullyRead)} of ${n(coverage.albumsListed)} fully read and matching Google's counts")
            add(agreementLine("Favourites", coverage.favourites))
            add(agreementLine("Archive", coverage.archive))
        }
        val issueLines = coverage.albumIssues.map { issue ->
            val what = when (issue.kind) {
                AlbumIssueKind.FAILED -> "could not be read"
                AlbumIssueKind.NOT_FINISHED -> "not finished"
                AlbumIssueKind.COUNT_MISMATCH -> "count mismatch"
                AlbumIssueKind.COUNT_MISSING -> "no count from Google"
            }
            "Album “${issue.albumTitle ?: "untitled"}” $what: ${issue.detail}"
        }
        return ReportUi(title, tone, coverageLines, issueLines, report.counts.filter { it.total > 0 }.map(::table))
    }

    private fun table(counts: TypeCounts): CountsTableUi {
        val title = when (counts.mediaType) {
            StoredMediaType.PHOTO -> "Photos"
            StoredMediaType.VIDEO -> "Videos (outside cleanup scope)"
            null -> "Items of unknown type"
        }
        val rows = buildList {
            add(CountRowUi("Enumerated", n(counts.total), startPaddingDp = 0))
            add(CountRowUi("Protected (each counted once)", n(counts.protectedTotal), startPaddingDp = 0))
            add(CountRowUi("favourite", n(counts.protectedByFavourite), startPaddingDp = 16))
            add(CountRowUi("in an album", n(counts.protectedByAlbum), startPaddingDp = 16))
            add(CountRowUi("archived", n(counts.protectedByArchive), startPaddingDp = 16))
            add(CountRowUi("favourite and in an album", n(counts.protectedByFavouriteAndAlbum), startPaddingDp = 16))
            add(CountRowUi("Eligible", n(counts.eligible), startPaddingDp = 0))
            add(CountRowUi("Unknown (excluded)", n(counts.unknown), startPaddingDp = 0))
            counts.unknownByReason.forEach { (reason, count) -> add(CountRowUi(reasonLabel(reason), n(count), startPaddingDp = 16)) }
        }
        return CountsTableUi(title, rows)
    }

    private fun agreementLine(name: String, agreement: SourceAgreement) =
        "$name: ${n(agreement.listed)} in Google's listing, ${n(agreement.flagged)} flagged on library items" +
            if (agreement.flaggedButNotListed == 0 && agreement.listedButNotFlagged == 0) {
                ", sources agree"
            } else {
                " (${n(agreement.flaggedButNotListed)} flagged but not listed, ${n(agreement.listedButNotFlagged)} listed but not flagged; both are protected)"
            }

    private fun reasonLabel(reason: UnknownReason) = when (reason) {
        UnknownReason.INVENTORY_INCOMPLETE -> "inventory incomplete"
        UnknownReason.INVENTORY_STALE -> "inventory out of date"
        UnknownReason.FAVOURITE_FLAG_MISSING -> "favourite flag missing"
        UnknownReason.ARCHIVE_FLAG_MISSING -> "archive flag missing"
        UnknownReason.NOT_OWNED -> "not uploaded by you, no album match"
        UnknownReason.MEDIA_TYPE_UNKNOWN -> "media type unknown"
    }

    private fun phaseName(phase: ScanPhase?) = when (phase) {
        null -> "starting"
        ScanPhase.LIBRARY -> "library"
        ScanPhase.FAVOURITES -> "favourites"
        ScanPhase.ARCHIVE -> "archive"
        ScanPhase.ALBUM_LIST -> "album list"
        ScanPhase.ALBUM_MEMBERS -> "album contents"
    }

    private fun phaseLabel(name: String) = when (name) {
        ScanPhase.LIBRARY.name -> "Library"
        ScanPhase.FAVOURITES.name -> "Favourite photos"
        ScanPhase.ARCHIVE.name -> "Archived photos"
        ScanPhase.ALBUM_LIST.name -> "Album list"
        else -> name
    }

    private fun time(ms: Long) = timeFormat.format(Instant.ofEpochMilli(ms))

    private fun n(value: Int) = "%,d".format(value)

    private companion object {
        /** Shorter scans have too few samples to say where the time went. */
        const val MIN_TIMED_MS = 3_000L

        /** Below this share of the time spent on this computer, the network and Google set the pace. */
        const val COMPUTER_SHARE_FOR_HINT = 25
    }
}
