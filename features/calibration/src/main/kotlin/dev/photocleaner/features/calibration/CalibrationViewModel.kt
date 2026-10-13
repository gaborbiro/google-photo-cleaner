package dev.photocleaner.features.calibration

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.photocleaner.core.design.PhotoDateFormat
import dev.photocleaner.features.calibration.model.BudgetReport
import dev.photocleaner.features.calibration.model.CalibrationPrepProgress
import dev.photocleaner.features.calibration.model.CalibrationView
import dev.photocleaner.features.calibration.model.ScoredPair
import dev.photocleaner.features.calibration.usecase.LabelCalibrationPairUseCase
import dev.photocleaner.features.calibration.usecase.LoadCalibrationUseCase
import dev.photocleaner.features.calibration.usecase.PrepareCalibrationUseCase
import dev.photocleaner.features.calibration.usecase.UndoLastCalibrationLabelUseCase
import dev.photocleaner.features.shared.previews.FetchPreviewUseCase
import dev.photocleaner.repositories.analysis.domain.PairLabel
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.services.connector.domain.ConnectorException
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.jetbrains.skia.Image

class CalibrationViewModel(
    private val prepare: PrepareCalibrationUseCase,
    private val load: LoadCalibrationUseCase,
    private val label: LabelCalibrationPairUseCase,
    private val undoLast: UndoLastCalibrationLabelUseCase,
    private val fetchPreview: FetchPreviewUseCase,
) : ViewModel() {

    private val mutableState = MutableStateFlow(CalibrationUiState.Initial)
    val state: StateFlow<CalibrationUiState> = mutableState.asStateFlow()

    private var view: CalibrationView? = null
    private var prepJob: Job? = null
    private var prepText: String? = null
    private var busy = false
    private val previews = LinkedHashMap<String, ImageBitmap>()
    private val previewErrors = mutableMapOf<String, String>()
    private val timeFormat = PhotoDateFormat("d MMM yyyy, HH:mm:ss")

    init {
        viewModelScope.launch { reload() }
    }

    fun onPrepareClicked(fresh: Boolean) {
        if (prepJob?.isActive == true) {
            prepJob?.cancel()
            prepText = "Paused. “Resume preparing” continues where it stopped."
            publish()
            return
        }
        prepJob = viewModelScope.launch {
            try {
                prepare.execute(fresh).collect { progress ->
                    prepText = prepTextOf(progress)
                    publish()
                }
            } finally {
                reload()
            }
        }
        publish()
    }

    fun onLabel(choice: PairLabel) {
        val current = view?.nextUnlabelled ?: return
        // One decision at a time: a second press before the next pair is shown must not relabel this one.
        if (busy) return
        busy = true
        viewModelScope.launch {
            try {
                label.execute(current.pair.pairId, choice)
                reload()
            } finally {
                busy = false
            }
        }
    }

    fun onUndo() {
        if (busy) return
        busy = true
        viewModelScope.launch {
            try {
                undoLast.execute()
                reload()
            } finally {
                busy = false
            }
        }
    }

    private suspend fun reload() {
        val loaded = load.execute()
        view = loaded
        publish()
        // Current pair first, then the next one, so labelling never waits on the network.
        val upcoming = loaded.pairs.filter { it.pair.label == null && it.itemA != null && it.itemB != null && it.scores.values.all { s -> s != null } }.take(2)
        upcoming.flatMap { listOfNotNull(it.itemA, it.itemB) }.forEach { loadPreview(it) }
    }

    private suspend fun loadPreview(item: InventoryItem) {
        if (item.mediaKey in previews || item.mediaKey in previewErrors) return
        try {
            val bytes = fetchPreview.execute(item, DISPLAY_SIZE_PX).image.bytes
            previews[item.mediaKey] = Image.makeFromEncoded(bytes).toComposeImageBitmap()
            while (previews.size > PREVIEW_CACHE) previews.remove(previews.keys.first())
        } catch (e: ConnectorException) {
            previewErrors[item.mediaKey] = "Preview unavailable (${e.javaClass.simpleName})"
        } catch (e: IllegalArgumentException) {
            previewErrors[item.mediaKey] = "Preview could not be decoded"
        }
        publish()
    }

    private fun publish() {
        val v = view
        val running = prepJob?.isActive == true
        val total = v?.pairs?.size ?: 0
        // Pairs still waiting for their photos to be analysed; once there are none, preparing is done.
        val notReady = v?.pairs?.count { it.itemA == null || it.itemB == null || it.scores.values.any { s -> s == null } } ?: 0
        val labelled = v?.labelled ?: 0
        mutableState.value = CalibrationUiState(
            prepareLabel = when {
                running -> "Pause"
                total == 0 -> "Prepare pairs"
                else -> "Resume preparing ($notReady pairs not ready)"
            },
            prepareVisible = running || total == 0 || notReady > 0,
            restartLabel = if (labelled > 0) "Start over with new pairs (discards your $labelled labels)" else "Start over with new pairs",
            restartVisible = !running && total > 0,
            prepText = prepText,
            counterText = if (total == 0) null else "Labelled ${v?.labelled ?: 0} of $total pairs",
            current = v?.nextUnlabelled?.let(::pairUi),
            undoEnabled = (v?.labelled ?: 0) > 0,
            tabStatus = if (total > 0 && labelled == total) "done" else null,
            reports = v?.reports?.filter { it.labelled > 0 }?.map(::reportUi).orEmpty(),
        )
    }

    private fun pairUi(pair: ScoredPair): PairUi {
        val a = checkNotNull(pair.itemA) { "Next pair must have both photos" }
        val b = checkNotNull(pair.itemB) { "Next pair must have both photos" }
        return PairUi(
            pairId = pair.pair.pairId,
            imageA = previews[a.mediaKey],
            imageB = previews[b.mediaKey],
            errorA = previewErrors[a.mediaKey],
            errorB = previewErrors[b.mediaKey],
            captionA = timeFormat.format(a.takenAtMs),
            captionB = timeFormat.format(b.takenAtMs),
            gapText = "Taken ${gapText(pair.pair.takenGapMs)} apart",
        )
    }

    private fun reportUi(report: BudgetReport): ReportUi {
        fun score(value: Double?) = value?.let { "%.3f".format(it) } ?: "–"
        fun percent(value: Double?) = value?.let { "%.0f%%".format(it * 100) } ?: "–"
        val shown = report.rows.filter { it.threshold >= 0.8 && (Math.round(it.threshold * 1000) % 10 == 0L || it.threshold == report.recommendedThreshold) }
        return ReportUi(
            title = "Detail ${report.tokenBudget} (image tokens per photo)",
            summaryLines = listOf(
                "${report.labelled} labelled: ${report.duplicates} same/near-duplicate, ${report.different} different",
                "Lowest score of a same-photo pair: ${score(report.lowestSame)}; of a near-duplicate pair: ${score(report.lowestNearDuplicate)}",
                "Highest score of a different pair: ${score(report.highestDifferent)}",
                "Suggested similarity threshold (no different pair at or above it): ${score(report.recommendedThreshold)}",
            ),
            rows = shown.map {
                ThresholdRowUi(
                    threshold = "%.3f".format(it.threshold),
                    flagged = it.flagged.toString(),
                    precision = percent(it.precision),
                    recall = percent(it.recall),
                    sameRecall = percent(it.sameRecall),
                    fontWeight = if (it.threshold == report.recommendedThreshold) FontWeight.Bold else FontWeight.Normal,
                )
            },
        )
    }

    private fun prepTextOf(progress: CalibrationPrepProgress): String = when (progress) {
        is CalibrationPrepProgress.Selecting -> "Choosing pairs from ${progress.photos} photos…"
        is CalibrationPrepProgress.Embedding -> with(progress.stats) {
            "Embedding photos for ${progress.pairs} pairs: ${alreadyStored + embedded} of $total done" +
                (if (failed > 0) ", $failed failed" else "") + " (%.1f photos/s)".format(photosPerSecond)
        }
        is CalibrationPrepProgress.Stopped -> progress.reason
        is CalibrationPrepProgress.Ready -> "Ready: ${progress.pairs} pairs" +
            if (progress.stats.failed > 0) " (${progress.stats.failed} photos could not be embedded; their pairs are skipped)" else ""
    }

    private fun gapText(ms: Long): String = when {
        ms < 60_000 -> "${ms / 1000} s"
        ms < 3_600_000 -> "${ms / 60_000} min"
        ms < 86_400_000 -> "${ms / 3_600_000} h"
        else -> "${ms / 86_400_000} days"
    }

    private companion object {
        const val DISPLAY_SIZE_PX = 480
        const val PREVIEW_CACHE = 12
    }
}

data class CalibrationUiState(
    val prepareLabel: String,
    /** Hidden once every pair is ready: there is nothing left to prepare. */
    val prepareVisible: Boolean,
    val restartLabel: String,
    val restartVisible: Boolean,
    val prepText: String?,
    val counterText: String?,
    val current: PairUi?,
    val undoEnabled: Boolean,
    val reports: List<ReportUi>,
    /** "done" once every pair is labelled; shown after the tab's name. */
    val tabStatus: String?,
) {
    companion object {
        val Initial = CalibrationUiState("Prepare pairs", false, "Start over with new pairs", false, null, null, null, false, emptyList(), null)
    }
}

data class PairUi(
    val pairId: String,
    val imageA: ImageBitmap?,
    val imageB: ImageBitmap?,
    val errorA: String?,
    val errorB: String?,
    val captionA: String,
    val captionB: String,
    val gapText: String,
)

data class ReportUi(val title: String, val summaryLines: List<String>, val rows: List<ThresholdRowUi>)

data class ThresholdRowUi(
    val threshold: String,
    val flagged: String,
    val precision: String,
    val recall: String,
    val sameRecall: String,
    val fontWeight: FontWeight,
)
