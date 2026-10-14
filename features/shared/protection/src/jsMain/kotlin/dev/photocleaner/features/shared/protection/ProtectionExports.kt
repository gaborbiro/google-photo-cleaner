@file:OptIn(ExperimentalJsExport::class)

package dev.photocleaner.features.shared.protection

import dev.photocleaner.features.shared.protection.model.InventoryClassification
import dev.photocleaner.repositories.inventory.domain.AlbumRecord
import dev.photocleaner.repositories.inventory.domain.AlbumStatus
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.InventorySnapshot
import dev.photocleaner.repositories.inventory.domain.PhaseCursor
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.ScanPhase
import dev.photocleaner.repositories.inventory.domain.ScanRun
import dev.photocleaner.repositories.inventory.domain.StoredMediaType

/**
 * The protection rules for the browser extension. Takes a scan snapshot as JSON (the shape of
 * [InventorySnapshot]; see extension/src/app/scan/snapshot.ts) and returns the classification
 * as JSON: the report and, per item, its eligibility and reasons. Malformed input throws.
 */
@JsExport
fun classifyInventoryJson(snapshotJson: String, nowMs: Double, maxAgeMs: Double): String {
    val snapshot = snapshotFrom(JSON.parse(snapshotJson))
    val result = InventoryClassifier.classify(snapshot, nowMs.toLong(), maxAgeMs.toLong())
    return JSON.stringify(toJs(result))
}

/** The freshness limit the desktop app uses, so the extension can't drift from it. */
@JsExport
fun defaultMaxAgeMs(): Double = InventoryClassifier.DEFAULT_MAX_AGE_MS.toDouble()

// --- reading: every field is checked; a missing required one is an error, not a default ---

private fun field(o: dynamic, name: String): dynamic {
    val value = o[name]
    if (value === undefined) throw IllegalArgumentException("Snapshot field '$name' is missing")
    return value
}

// `dynamic` values are first held as `Any?`, so the checks below are Kotlin checks, not JavaScript calls.
private fun value(o: dynamic, name: String): Any? = field(o, name)

private fun string(o: dynamic, name: String): String = value(o, name) as? String ?: throw IllegalArgumentException("'$name' must be a string")
private fun stringOrNull(o: dynamic, name: String): String? {
    val v = value(o, name) ?: return null
    return v as? String ?: throw IllegalArgumentException("'$name' must be a string")
}
private fun long(o: dynamic, name: String): Long = (value(o, name) as? Number ?: throw IllegalArgumentException("'$name' must be a number")).toLong()
private fun longOrNull(o: dynamic, name: String): Long? {
    val v = value(o, name) ?: return null
    return (v as? Number ?: throw IllegalArgumentException("'$name' must be a number")).toLong()
}
private fun int(o: dynamic, name: String): Int = long(o, name).toInt()
private fun intOrNull(o: dynamic, name: String): Int? = longOrNull(o, name)?.toInt()
private fun bool(o: dynamic, name: String): Boolean = value(o, name) as? Boolean ?: throw IllegalArgumentException("'$name' must be true or false")
private fun boolOrNull(o: dynamic, name: String): Boolean? {
    val v = value(o, name) ?: return null
    return v as? Boolean ?: throw IllegalArgumentException("'$name' must be true or false")
}
private fun array(o: dynamic, name: String): Array<dynamic> = value(o, name) as? Array<dynamic> ?: throw IllegalArgumentException("'$name' must be a list")
private fun strings(o: dynamic, name: String): Set<String> =
    array(o, name).map { e -> (e as Any?) as? String ?: throw IllegalArgumentException("'$name' must hold strings") }.toSet()

private fun snapshotFrom(raw: dynamic): InventorySnapshot {
    val run = field(raw, "run")
    val membership = field(raw, "albumMembership")
    return InventorySnapshot(
        run = ScanRun(
            id = long(run, "id"),
            accountFingerprint = string(run, "accountFingerprint"),
            startedAtMs = long(run, "startedAtMs"),
            finishedAtMs = longOrNull(run, "finishedAtMs"),
            status = RunStatus.valueOf(string(run, "status")),
            statusReason = stringOrNull(run, "statusReason"),
        ),
        cursors = array(raw, "cursors").map { c ->
            PhaseCursor(
                phase = ScanPhase.valueOf(string(c, "phase")),
                scope = string(c, "scope"),
                nextPageToken = stringOrNull(c, "nextPageToken"),
                pagesDone = int(c, "pagesDone"),
                entriesSeen = int(c, "entriesSeen"),
                duplicateEntries = int(c, "duplicateEntries"),
                completed = bool(c, "completed"),
            )
        },
        items = array(raw, "items").map { i ->
            InventoryItem(
                mediaKey = string(i, "mediaKey"),
                dedupKey = string(i, "dedupKey"),
                takenAtMs = long(i, "takenAtMs"),
                mediaType = stringOrNull(i, "mediaType")?.let { StoredMediaType.valueOf(it) },
                isFavourite = boolOrNull(i, "isFavourite"),
                isArchived = boolOrNull(i, "isArchived"),
                isOwned = boolOrNull(i, "isOwned"),
                width = intOrNull(i, "width"),
                height = intOrNull(i, "height"),
                thumbUrl = stringOrNull(i, "thumbUrl"),
            )
        },
        favouriteDedupKeys = strings(raw, "favouriteDedupKeys"),
        archivedDedupKeys = strings(raw, "archivedDedupKeys"),
        albums = array(raw, "albums").map { s ->
            val a = field(s, "album")
            AlbumStatus(
                album = AlbumRecord(
                    albumKey = string(a, "albumKey"),
                    title = stringOrNull(a, "title"),
                    ownerActorId = stringOrNull(a, "ownerActorId"),
                    isShared = boolOrNull(a, "isShared"),
                    kindCode = intOrNull(a, "kindCode"),
                    reportedItemCount = intOrNull(a, "reportedItemCount"),
                    authKey = stringOrNull(a, "authKey"),
                ),
                membersSeen = int(s, "membersSeen"),
                membersComplete = bool(s, "membersComplete"),
                failureReason = stringOrNull(s, "failureReason"),
            )
        },
        albumMembership = js("Object").keys(membership).unsafeCast<Array<String>>().associateWith { key ->
            val albums = (membership[key] as Any?) as? Array<*> ?: throw IllegalArgumentException("albumMembership values must be lists")
            albums.map { e -> e as? String ?: throw IllegalArgumentException("albumMembership must hold album keys") }.toSet()
        },
    )
}

// --- writing ---

private fun obj(vararg pairs: Pair<String, Any?>): dynamic {
    val o: dynamic = js("({})")
    for ((k, v) in pairs) o[k] = v
    return o
}

private fun toJs(result: InventoryClassification): dynamic {
    val report = result.report
    val c = report.coverage
    return obj(
        "report" to obj(
            "accountFingerprint" to report.accountFingerprint,
            "coverage" to obj(
                "isComplete" to c.isComplete,
                "isStale" to c.isStale,
                "runStatus" to c.runStatus.name,
                "runStatusReason" to c.runStatusReason,
                "startedAtMs" to c.startedAtMs.toDouble(),
                "finishedAtMs" to c.finishedAtMs?.toDouble(),
                "phases" to c.phases.map {
                    obj("name" to it.name, "completed" to it.completed, "pages" to it.pages, "entries" to it.entries, "duplicates" to it.duplicates)
                }.toTypedArray(),
                "albumsListed" to c.albumsListed,
                "albumsFullyRead" to c.albumsFullyRead,
                "albumIssues" to c.albumIssues.map { obj("albumTitle" to it.albumTitle, "kind" to it.kind.name, "detail" to it.detail) }.toTypedArray(),
                "favourites" to agreement(c.favourites),
                "archive" to agreement(c.archive),
            ),
            "counts" to report.counts.map { t ->
                obj(
                    "mediaType" to t.mediaType?.name,
                    "total" to t.total,
                    "protectedTotal" to t.protectedTotal,
                    "protectedByFavourite" to t.protectedByFavourite,
                    "protectedByAlbum" to t.protectedByAlbum,
                    "protectedByArchive" to t.protectedByArchive,
                    "protectedByFavouriteAndAlbum" to t.protectedByFavouriteAndAlbum,
                    "eligible" to t.eligible,
                    "unknown" to t.unknown,
                    "unknownByReason" to obj(*t.unknownByReason.map { (reason, n) -> reason.name to n }.toTypedArray()),
                )
            }.toTypedArray(),
        ),
        "items" to result.items.map {
            obj(
                "mediaKey" to it.item.mediaKey,
                "eligibility" to it.eligibility.name,
                "protectionReasons" to it.protectionReasons.map { r -> r.name }.toTypedArray(),
                "unknownReasons" to it.unknownReasons.map { r -> r.name }.toTypedArray(),
            )
        }.toTypedArray(),
    )
}

private fun agreement(a: dev.photocleaner.features.shared.protection.model.SourceAgreement): dynamic =
    obj("listed" to a.listed, "flagged" to a.flagged, "flaggedButNotListed" to a.flaggedButNotListed, "listedButNotFlagged" to a.listedButNotFlagged)
