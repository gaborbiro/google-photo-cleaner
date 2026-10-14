package dev.photocleaner.app

import dev.photocleaner.core.storage.AppPaths
import dev.photocleaner.features.calibration.usecase.LoadCalibrationUseCase
import dev.photocleaner.features.shared.duplicates.model.MemberRole
import dev.photocleaner.features.duplicates.text
import dev.photocleaner.features.duplicates.usecase.BuildDuplicateGroupsUseCase
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.analysis.SqlAnalysisRepository
import dev.photocleaner.repositories.analysis.domain.PairKind
import dev.photocleaner.repositories.inventory.SqlInventoryRepository
import kotlinx.coroutines.runBlocking

/**
 * Prints reports with the same rules the app uses. Counts and scores only: album
 * titles, keys and URLs are not printed.
 * `.\gradlew.bat :app:printInventoryReport` or `:app:printCalibrationReport`.
 */
fun main(args: Array<String>) = runBlocking {
    val paths = AppPaths.forCurrentUser()
    StableSqliteLibrary.install(paths.nativeLibrariesDir)
    val classify = ClassifyInventoryUseCase(SqlInventoryRepository.open(paths.inventoryDatabase))
    when (args.firstOrNull()) {
        "calibration" -> printCalibration(classify, SqlAnalysisRepository.open(paths.analysisDatabase))
        "groups" -> printGroups(classify, SqlAnalysisRepository.open(paths.analysisDatabase))
        else -> printInventory(classify)
    }
}

private suspend fun printGroups(classify: ClassifyInventoryUseCase, analysis: SqlAnalysisRepository) {
    val started = System.currentTimeMillis()
    val result = BuildDuplicateGroupsUseCase(classify, analysis).execute()
    println("Built in ${System.currentTimeMillis() - started} ms")
    result.blocked?.let { println("Blocked: ${it.text()}") }
    println("Photos compared: ${result.photosCompared}, without embedding: ${result.photosWithoutEmbedding}")
    val groups = result.groups
    val proposed = groups.flatMap { g -> g.members.filter { it.role == MemberRole.PROPOSED } }
    println("Groups: ${groups.size}, photos in groups: ${groups.sumOf { it.members.size }}, proposed for the trash: ${proposed.size}")
    println("Group sizes: " + groups.groupingBy { it.members.size }.eachCount().toSortedMap())
    println("Groups with a protected keeper: ${groups.count { it.keeper.photo.eligibility.name == "PROTECTED" }}, with references: ${groups.count { g -> g.members.any { it.role == MemberRole.REFERENCE } }}")
    println("Keeper reasons: " + groups.flatMap { it.keeper.reasons }.map { it.substringBefore(" (").substringBefore(":") }.groupingBy { it }.eachCount())
    println("Reasons proposed for the trash: " + proposed.flatMap { it.reasons.drop(1) }.map { it.substringBefore(" (") }.groupingBy { it }.eachCount())
    val similarities = proposed.map { it.similarity }.sorted()
    if (similarities.isNotEmpty()) {
        println("Similarity of proposals to keeper: min=%.3f p10=%.3f median=%.3f".format(similarities.first(), similarities[similarities.size / 10], similarities[similarities.size / 2]))
    }
    println("Groups per year: " + groups.groupingBy { java.time.Instant.ofEpochMilli(it.takenAtMs).atZone(java.time.ZoneId.systemDefault()).year }.eachCount().toSortedMap())
}

private suspend fun printInventory(classify: ClassifyInventoryUseCase) {
    val classification = classify.execute()
    if (classification == null) {
        println("No inventory yet.")
        return
    }
    val report = classification.report
    val coverage = report.coverage
    println("Run ${report.runId}: ${coverage.runStatus}, complete=${coverage.isComplete}, stale=${coverage.isStale}")
    println("Started ${coverage.startedAtMs}, finished ${coverage.finishedAtMs}, duration ${coverage.finishedAtMs?.minus(coverage.startedAtMs)?.div(1000)} s")
    coverage.phases.forEach { println("  ${it.name}: pages=${it.pages} entries=${it.entries} duplicates=${it.duplicates} completed=${it.completed}") }
    println("  Albums: listed=${coverage.albumsListed} fullyRead=${coverage.albumsFullyRead}")
    println("  Favourites agreement: ${coverage.favourites}")
    println("  Archive agreement: ${coverage.archive}")
    coverage.albumIssues.groupingBy { it.kind }.eachCount().forEach { (kind, count) -> println("  Album issue $kind: $count") }
    report.counts.forEach { c ->
        println("${c.mediaType ?: "UNKNOWN_TYPE"}: total=${c.total} protected=${c.protectedTotal} (favourite=${c.protectedByFavourite}, album=${c.protectedByAlbum}, archived=${c.protectedByArchive}, favourite+album=${c.protectedByFavouriteAndAlbum}) eligible=${c.eligible} unknown=${c.unknown} ${c.unknownByReason}")
    }
}

private suspend fun printCalibration(classify: ClassifyInventoryUseCase, analysis: SqlAnalysisRepository) {
    val view = LoadCalibrationUseCase(classify, analysis, analysis).execute()
    println("Pairs: ${view.pairs.size}, labelled: ${view.labelled}")
    // Score distribution per label and pair kind, for every budget.
    view.reports.forEach { report ->
        val budget = report.tokenBudget
        println("\n=== Token budget $budget ===")
        println("labelled=${report.labelled} duplicates=${report.duplicates} different=${report.different}")
        println("lowestSame=${report.lowestSame} lowestNearDuplicate=${report.lowestNearDuplicate} highestDifferent=${report.highestDifferent} recommended=${report.recommendedThreshold}")
        view.pairs.filter { it.pair.label != null && it.scores[budget] != null }
            .groupBy { "${it.pair.label}/${it.pair.kind}" }
            .toSortedMap()
            .forEach { (group, pairs) ->
                val scores = pairs.mapNotNull { it.scores[budget] }.sorted()
                println("  %-24s n=%3d  min=%.3f  p10=%.3f  median=%.3f  max=%.3f".format(
                    group, scores.size, scores.first(), scores[scores.size / 10], scores[scores.size / 2], scores.last(),
                ))
            }
        val near = view.pairs.filter { it.pair.kind == PairKind.NEAR && it.pair.label != null && it.scores[budget] != null }
        println("  Sorted NEAR scores with labels (S=same, N=near-duplicate, D=different):")
        println("  " + near.sortedBy { it.scores[budget] }.joinToString(" ") { "%.3f%s".format(it.scores[budget], it.pair.label!!.name.first()) })
        report.rows.filter { it.threshold >= 0.8 }.forEach {
            println("  t=%.3f flagged=%3d tp=%3d fp=%3d precision=%s recall=%s sameRecall=%s".format(
                it.threshold, it.flagged, it.truePositives, it.falsePositives,
                it.precision?.let { p -> "%.2f".format(p) }, it.recall?.let { r -> "%.2f".format(r) }, it.sameRecall?.let { r -> "%.2f".format(r) },
            ))
        }
    }
}
