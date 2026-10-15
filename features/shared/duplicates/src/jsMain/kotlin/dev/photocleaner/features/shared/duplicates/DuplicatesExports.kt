@file:OptIn(ExperimentalJsExport::class)

package dev.photocleaner.features.shared.duplicates

import dev.photocleaner.features.shared.duplicates.calibration.BudgetReport
import dev.photocleaner.features.shared.duplicates.calibration.CalibrationReports
import dev.photocleaner.features.shared.duplicates.calibration.LabelledScore
import dev.photocleaner.features.shared.duplicates.model.DuplicateGroup
import dev.photocleaner.features.shared.duplicates.model.GroupingSettings
import dev.photocleaner.features.shared.duplicates.model.PhotoAnalysis
import dev.photocleaner.features.shared.protection.InventoryClassifier
import dev.photocleaner.features.shared.protection.JsJson
import dev.photocleaner.features.shared.protection.ProtectionJs
import dev.photocleaner.repositories.analysis.domain.PairLabel
import dev.photocleaner.repositories.review.domain.Decision
import dev.photocleaner.repositories.review.domain.DecisionItem
import dev.photocleaner.repositories.review.domain.DecisionKind

// The extension's one entry point into the shared Kotlin rules: protection and duplicates.

/** See [ProtectionJs.classifyInventoryJson]. */
@JsExport
fun classifyInventoryJson(snapshotJson: String, nowMs: Double, maxAgeMs: Double, choicesJson: String): String =
    ProtectionJs.classifyInventoryJson(snapshotJson, nowMs, maxAgeMs, choicesJson)

/** The freshness limit the desktop app uses, so the extension can't drift from it. */
@JsExport
fun defaultMaxAgeMs(): Double = ProtectionJs.defaultMaxAgeMs()

/**
 * What a decision on a group records for the trash (see [decisionItems]): [membersJson] is the group's
 * members as the review queue returned them (`[{mediaKey, dedupKey, selectable}]`), [selectedJson] the
 * selected media keys. Returns `[{mediaKey, dedupKey}]`; a selection the rules refuse throws.
 */
@JsExport
fun decisionItemsJson(membersJson: String, kind: String, selectedJson: String): String {
    val selectable = JsJson.list(JSON.parse(membersJson), "members")
        .filter { JsJson.bool(it, "selectable") }
        .associate { JsJson.string(it, "mediaKey") to JsJson.string(it, "dedupKey") }
    val selected = JsJson.list(JSON.parse(selectedJson), "selected")
        .map { (it as Any?) as? String ?: throw IllegalArgumentException("selected must hold media keys") }.toSet()
    val items = decisionItems(selectable, DecisionKind.valueOf(kind), selected)
    return JSON.stringify(items.map { JsJson.obj("mediaKey" to it.mediaKey, "dedupKey" to it.dedupKey) }.toTypedArray())
}

/**
 * The duplicate review queue for the browser extension, by the same rules as the desktop app.
 *
 * - [snapshotJson]: the latest library scan (as for classifyInventoryJson), or null before any scan.
 * - [photosJson]: one entry per analysed photo, `{mediaKey, sharpness, clipped, analysedAtMs,
 *   uploadedAtMs, width, height}`, in the same order as [vectors] (their fingerprints).
 * - [decisionsJson]: the decisions not undone, newest first, `{id, groupId, kind, items: [{mediaKey,
 *   dedupKey}], members: [mediaKey], createdAtMs}`.
 * - [settingsJson]: `{threshold, windowMs, maxGroupSize, tokenBudget}`.
 * - [choicesJson]: the user's protection choices, `{favourites, albums, archived}`.
 *
 * Returns the queue as JSON (see extension/src/app/duplicates/rules.ts). Malformed input throws.
 */
@JsExport
fun reviewQueueJson(
    snapshotJson: String?,
    nowMs: Double,
    maxAgeMs: Double,
    photosJson: String,
    vectors: Array<FloatArray>,
    decisionsJson: String,
    settingsJson: String,
    choicesJson: String,
): String {
    val chosen = JsJson.protectionChoices(JSON.parse(choicesJson))
    val classification = snapshotJson?.let { InventoryClassifier.classify(JsJson.inventorySnapshot(JSON.parse(it)), JsJson.millis(nowMs, "nowMs"), JsJson.millis(maxAgeMs, "maxAgeMs"), chosen) }
    val photos = JsJson.list(JSON.parse(photosJson), "photos")
    require(photos.size == vectors.size) { "photos and vectors differ in length (${photos.size} vs ${vectors.size})" }
    val analyses = photos.withIndex().associate { (index, p) ->
        JsJson.string(p, "mediaKey") to PhotoAnalysis(
            vector = vectors[index],
            sharpness = JsJson.double(p, "sharpness"),
            clipped = JsJson.double(p, "clipped"),
            analysedAtMs = JsJson.long(p, "analysedAtMs"),
            uploadedAtMs = JsJson.longOrNull(p, "uploadedAtMs"),
            width = JsJson.intOrNull(p, "width"),
            height = JsJson.intOrNull(p, "height"),
        )
    }
    val decisions = JsJson.list(JSON.parse(decisionsJson), "decisions").map { d ->
        Decision(
            id = JsJson.long(d, "id"),
            groupId = JsJson.string(d, "groupId"),
            kind = DecisionKind.valueOf(JsJson.string(d, "kind")),
            items = JsJson.array(d, "items").map { i -> DecisionItem(JsJson.string(i, "mediaKey"), JsJson.string(i, "dedupKey")) },
            members = JsJson.strings(d, "members"),
            createdAtMs = JsJson.long(d, "createdAtMs"),
            undoneAtMs = null,
        )
    }
    val s = JSON.parse<dynamic>(settingsJson)
    val settings = GroupingSettings(
        threshold = JsJson.double(s, "threshold"),
        windowMs = JsJson.long(s, "windowMs"),
        maxGroupSize = JsJson.int(s, "maxGroupSize"),
        tokenBudget = JsJson.int(s, "tokenBudget"),
    )
    val queue = ReviewQueues.build(DuplicateGrouper.build(classification, analyses, settings), decisions)
    return JSON.stringify(
        JsJson.obj(
            "blocked" to queue.blocked?.name,
            "pending" to queue.pending.map(::groupToJs).toTypedArray(),
            "deferredIds" to queue.deferredIds.toTypedArray(),
            "totalGroups" to queue.totalGroups,
            "decidedGroups" to queue.decidedGroups,
            "analysedAtMs" to queue.analysedAtMs?.toDouble(),
            "photosAnalysed" to queue.photosAnalysed,
            "photosNotAnalysed" to queue.photosNotAnalysed,
            "settings" to JsJson.obj("threshold" to queue.settings.threshold, "windowMs" to queue.settings.windowMs.toDouble()),
        ),
    )
}

/**
 * How well each threshold separates the user's labelled pairs at one detail, and the threshold to
 * use. [labelledJson] holds `{label: "SAME" | "NEAR_DUPLICATE" | "DIFFERENT", score}` per pair.
 */
@JsExport
fun calibrationReportJson(labelledJson: String, tokenBudget: Int): String {
    val labelled = JsJson.list(JSON.parse(labelledJson), "labelled pairs").map { p ->
        LabelledScore(PairLabel.valueOf(JsJson.string(p, "label")), JsJson.double(p, "score"))
    }
    return JSON.stringify(reportToJs(CalibrationReports.report(tokenBudget, labelled)))
}

private fun groupToJs(group: DuplicateGroup): dynamic {
    val selectable = group.selectableMembers().map { it.photo.item.mediaKey }.toSet()
    return JsJson.obj(
        "id" to group.id,
        "takenAtMs" to group.takenAtMs.toDouble(),
        "defaultSelection" to group.defaultSelection().toTypedArray(),
        "members" to group.members.map { m ->
            val item = m.photo.item
            JsJson.obj(
                "mediaKey" to item.mediaKey,
                "dedupKey" to item.dedupKey,
                "takenAtMs" to item.takenAtMs.toDouble(),
                "thumbUrl" to item.thumbUrl,
                "role" to m.role.name,
                "similarity" to m.similarity,
                "reasons" to m.reasons.toTypedArray(),
                "previouslyReviewed" to m.previouslyReviewed,
                "selectable" to (item.mediaKey in selectable),
                "eligibility" to m.photo.eligibility.name,
                "protectionReasons" to m.photo.protectionReasons.sorted().map { it.name }.toTypedArray(),
                "pixels" to m.photo.pixels?.toDouble(),
            )
        }.toTypedArray(),
    )
}

private fun reportToJs(r: BudgetReport): dynamic = JsJson.obj(
    "tokenBudget" to r.tokenBudget,
    "labelled" to r.labelled,
    "duplicates" to r.duplicates,
    "different" to r.different,
    "lowestSame" to r.lowestSame,
    "lowestNearDuplicate" to r.lowestNearDuplicate,
    "highestDifferent" to r.highestDifferent,
    "recommendedThreshold" to r.recommendedThreshold,
    "rows" to r.rows.map {
        JsJson.obj(
            "threshold" to it.threshold, "flagged" to it.flagged, "truePositives" to it.truePositives, "falsePositives" to it.falsePositives,
            "precision" to it.precision, "recall" to it.recall, "sameRecall" to it.sameRecall,
        )
    }.toTypedArray(),
)
