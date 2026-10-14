package dev.photocleaner.spikes.browserai.search

import dev.photocleaner.app.StableSqliteLibrary
import dev.photocleaner.core.storage.AppPaths
import dev.photocleaner.features.duplicates.model.GroupingSettings
import dev.photocleaner.features.shared.embeddings.EmbeddingSettings
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.analysis.SqlAnalysisRepository
import dev.photocleaner.repositories.inventory.SqlInventoryRepository
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import dev.photocleaner.repositories.review.SqlReviewRepository
import dev.photocleaner.repositories.review.domain.DecisionKind
import dev.photocleaner.spikes.browserai.jsonArray
import dev.photocleaner.spikes.browserai.savePreviews
import java.nio.file.Files
import java.nio.file.Path
import kotlin.random.Random
import kotlinx.coroutines.runBlocking

/**
 * Browser AI test, search part: saves the photos of every Search sweep the user approved
 * (each sweep = a set of photos the user confirmed belong together) plus [OTHERS] random
 * other photos, with the desktop vectors (detail 280). The search test page asks "more
 * like these" and text questions at lower detail and checks how much of each sweep comes back.
 *
 * Writes to spikes/browser-ai/data/search (git-ignored); photos get neutral names (s0001…).
 * The desktop app must be closed. `.\gradlew.bat :spikes:browser-ai-export:exportSearchPhotos`
 */
fun main(args: Array<String>) = runBlocking {
    val out = Path.of(args.firstOrNull() ?: error("Output folder argument missing (the Gradle task passes it)")).resolve("search")
    val paths = AppPaths.forCurrentUser()
    StableSqliteLibrary.install(paths.nativeLibrariesDir)

    val classified = checkNotNull(ClassifyInventoryUseCase(SqlInventoryRepository.open(paths.inventoryDatabase)).execute()) { "No inventory" }
    val photos = classified.items.map { it.item }.filter { it.mediaType == StoredMediaType.PHOTO }.associateBy { it.mediaKey }
    val sweeps = SqlReviewRepository.open(paths.reviewDatabase).activeDecisions()
        .filter { it.groupId.startsWith("sweep:") && it.kind == DecisionKind.APPROVED }
        .sortedBy { it.id }
        .map { decision -> decision.items.map { it.mediaKey }.filter { it in photos } }
        .filter { it.isNotEmpty() }
    check(sweeps.isNotEmpty()) { "No approved Search sweeps to test with" }

    val modelKey = EmbeddingSettings.modelKey(GroupingSettings().tokenBudget)
    val analysis = SqlAnalysisRepository.open(paths.analysisDatabase)
    val vectors = analysis.find(modelKey.id, photos.keys)
    val sweepOf = sweeps.flatMapIndexed { index, keys -> keys.map { it to index + 1 } }.toMap()
    val others = photos.keys.filter { it !in sweepOf && it in vectors }.shuffled(Random(SEED)).take(OTHERS)
    val keys = sweeps.flatten().distinct().filter { it in vectors } + others
    println("Sweeps: ${sweeps.map { it.size }}, random others: ${others.size}, total ${keys.size}")

    val ids = keys.mapIndexed { index, key -> key to "s%04d".format(index + 1) }.toMap()
    val files = savePreviews(paths, out, keys.map { ids.getValue(it) to photos.getValue(it) })

    val entries = keys.joinToString(",\n") { key ->
        val id = ids.getValue(key)
        val sweep = sweepOf[key]?.toString() ?: "null"
        """    {"id": "$id", "file": "${files.getValue(id)}", "sweep": $sweep, "desktopVector": ${jsonArray(vectors.getValue(key).vector)}}"""
    }
    Files.writeString(
        out.resolve("manifest.json"),
        "{\n  \"desktopTokenBudget\": ${modelKey.tokenBudget},\n  \"sweepSizes\": ${sweeps.map { it.size }},\n  \"photos\": [\n$entries\n  ]\n}\n",
    )
    println("Wrote ${keys.size} photos to $out")
}

private const val OTHERS = 1_000
private const val SEED = 42
