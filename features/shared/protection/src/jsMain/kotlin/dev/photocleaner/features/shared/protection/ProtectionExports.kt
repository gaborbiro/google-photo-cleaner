package dev.photocleaner.features.shared.protection

import dev.photocleaner.features.shared.protection.model.AlbumIssue
import dev.photocleaner.features.shared.protection.model.InventoryClassification
import dev.photocleaner.features.shared.protection.model.SourceAgreement

/**
 * The protection rules for the browser extension, exported to JavaScript by
 * features:shared:duplicates (the extension's one entry point into the shared rules).
 */
object ProtectionJs {
    /**
     * Takes a scan snapshot as JSON (the shape of [InventorySnapshot]; see
     * extension/src/app/scan/snapshot.ts) and the user's protection choices (`{favourites, albums,
     * archived}`), and returns the classification as JSON: the report and, per item, its
     * eligibility and reasons. Malformed input throws.
     */
    fun classifyInventoryJson(snapshotJson: String, nowMs: Double, maxAgeMs: Double, choicesJson: String): String {
        val snapshot = JsJson.inventorySnapshot(JSON.parse(snapshotJson))
        val result = InventoryClassifier.classify(snapshot, JsJson.millis(nowMs, "nowMs"), JsJson.millis(maxAgeMs, "maxAgeMs"), JsJson.protectionChoices(JSON.parse(choicesJson)))
        return JSON.stringify(toJs(result))
    }

    /** The freshness limit of the shared rules, so the extension can't drift from it. */
    fun defaultMaxAgeMs(): Double = InventoryClassifier.DEFAULT_MAX_AGE_MS.toDouble()
}

private fun obj(vararg pairs: Pair<String, Any?>): dynamic = JsJson.obj(*pairs)

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
                "albumIssues" to c.albumIssues.map(::albumIssue).toTypedArray(),
                "albumWarnings" to c.albumWarnings.map(::albumIssue).toTypedArray(),
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
                "dedupKey" to it.item.dedupKey,
                "mediaType" to it.item.mediaType?.name,
                "eligibility" to it.eligibility.name,
                "protectionReasons" to it.protectionReasons.map { r -> r.name }.toTypedArray(),
                "unknownReasons" to it.unknownReasons.map { r -> r.name }.toTypedArray(),
            )
        }.toTypedArray(),
    )
}

private fun albumIssue(i: AlbumIssue): dynamic = obj("albumTitle" to i.albumTitle, "kind" to i.kind.name, "detail" to i.detail)

private fun agreement(a: SourceAgreement): dynamic =
    JsJson.obj("listed" to a.listed, "flagged" to a.flagged, "flaggedButNotListed" to a.flaggedButNotListed, "listedButNotFlagged" to a.listedButNotFlagged)
