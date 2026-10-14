package dev.photocleaner.spikes.browserai

import dev.photocleaner.app.StableSqliteLibrary
import dev.photocleaner.core.storage.AppPaths
import dev.photocleaner.features.calibration.usecase.LoadCalibrationUseCase
import dev.photocleaner.features.duplicates.model.GroupingSettings
import dev.photocleaner.features.shared.embeddings.EmbeddingSettings
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.analysis.SqlAnalysisRepository
import dev.photocleaner.repositories.inventory.SqlInventoryRepository
import java.nio.file.Files
import java.nio.file.Path
import kotlinx.coroutines.runBlocking

/**
 * Browser AI test, step 1: saves the photos of every labelled calibration pair, as the
 * desktop app embeds them (512 px previews), with the labels and the desktop vectors.
 * The browser test page embeds the same files and compares.
 *
 * Writes to spikes/browser-ai/data (git-ignored: these are personal photos). Photos get
 * neutral names (p001…); no Google keys or URLs are written.
 *
 * Needs the browser extension connected, so the desktop app must be closed while it runs:
 * `.\gradlew.bat :spikes:browser-ai-export:exportCalibrationPhotos`
 */
fun main(args: Array<String>) = runBlocking {
    val out = Path.of(args.firstOrNull() ?: error("Output folder argument missing (the Gradle task passes it)"))
    val paths = AppPaths.forCurrentUser()
    StableSqliteLibrary.install(paths.nativeLibrariesDir)

    val analysis = SqlAnalysisRepository.open(paths.analysisDatabase)
    val classify = ClassifyInventoryUseCase(SqlInventoryRepository.open(paths.inventoryDatabase))
    val view = LoadCalibrationUseCase(classify, analysis, analysis).execute()
    val labelled = view.pairs.filter { it.pair.label != null && it.itemA != null && it.itemB != null }
    check(labelled.isNotEmpty()) { "No labelled calibration pairs with both photos in the inventory" }
    println("${labelled.size} labelled pairs")

    // The budget and threshold the Duplicates tab uses.
    val grouping = GroupingSettings()
    val budget = grouping.tokenBudget
    val modelKey = EmbeddingSettings.modelKey(budget)
    val items = labelled.flatMap { listOf(checkNotNull(it.itemA), checkNotNull(it.itemB)) }.distinctBy { it.mediaKey }
    val vectors = analysis.find(modelKey.id, items.map { it.mediaKey })
    val missing = items.count { it.mediaKey !in vectors }
    check(missing == 0) { "$missing photos have no desktop embedding for $modelKey; run the calibration preparation first" }

    val ids = items.mapIndexed { index, item -> item.mediaKey to "p%03d".format(index + 1) }.toMap()
    val files = savePreviews(paths, out, items.map { ids.getValue(it.mediaKey) to it })
    val photos = items.joinToString(",\n") { item ->
        val id = ids.getValue(item.mediaKey)
        """    {"id": "$id", "file": "${files.getValue(id)}", "desktopVector": ${jsonArray(vectors.getValue(item.mediaKey).vector)}}"""
    }

    val pairs = labelled.joinToString(",\n") { scored ->
        val a = ids.getValue(checkNotNull(scored.itemA).mediaKey)
        val b = ids.getValue(checkNotNull(scored.itemB).mediaKey)
        val score = checkNotNull(scored.scores[budget]) { "Pair ${scored.pair.pairId} has no desktop score at budget $budget" }
        """    {"a": "$a", "b": "$b", "label": "${scored.pair.label}", "kind": "${scored.pair.kind}", "desktopScore": $score}"""
    }
    val manifest = """
        |{
        |  "model": "${modelKey.model}",
        |  "revision": "${modelKey.revision}",
        |  "tokenBudget": $budget,
        |  "previewSizePx": ${modelKey.previewSizePx},
        |  "desktopThreshold": ${grouping.threshold},
        |  "photos": [
        |$photos
        |  ],
        |  "pairs": [
        |$pairs
        |  ]
        |}
        |
    """.trimMargin()
    Files.writeString(out.resolve("manifest.json"), manifest)
    println("Wrote ${items.size} photos and ${labelled.size} pairs to $out")
}
