package dev.photocleaner.features.probe.usecase

import dev.photocleaner.features.probe.model.ProbeReport
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json

/** Writes a probe report as JSON into [directory] and returns the file. */
class SaveProbeReportUseCase(private val directory: Path) {

    private val json = Json { prettyPrint = true }
    private val fileStamp = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneId.systemDefault())

    suspend fun execute(report: ProbeReport): Path = withContext(Dispatchers.IO) {
        Files.createDirectories(directory)
        val file = directory.resolve("probe-${fileStamp.format(Instant.ofEpochMilli(report.finishedAtMs))}.json")
        Files.writeString(file, json.encodeToString(ProbeReport.serializer(), report))
        file
    }
}
