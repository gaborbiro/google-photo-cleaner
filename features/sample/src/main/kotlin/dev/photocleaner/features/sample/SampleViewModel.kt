package dev.photocleaner.features.sample

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.photocleaner.features.sample.usecase.PreviewSampleUseCase
import dev.photocleaner.features.sample.usecase.SampleEvent
import dev.photocleaner.features.sample.usecase.SampleStats
import dev.photocleaner.services.connector.domain.BridgeController
import dev.photocleaner.services.connector.domain.BridgeState
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import org.jetbrains.skia.Image

class SampleViewModel(
    bridge: BridgeController,
    private val previewSample: PreviewSampleUseCase,
) : ViewModel() {

    private val sample = MutableStateFlow(SampleState())
    private var job: Job? = null
    private val dateFormat = dev.photocleaner.core.design.PhotoDateFormat("d MMM yyyy")

    val state: StateFlow<SampleUiState> = combine(bridge.state, sample) { bridgeState, s ->
        val connected = bridgeState is BridgeState.ExtensionConnected
        SampleUiState(
            loadLabel = if (s.tiles.isEmpty()) "Load sample" else "Resume",
            loadEnabled = connected && !s.running && !s.finished,
            pauseEnabled = s.running,
            clearEnabled = !s.running && s.tiles.isNotEmpty(),
            statusText = s.status ?: if (connected) null else "Connect the browser extension to load previews.",
            tiles = s.tiles,
            failureLines = s.failures,
            statsText = s.stats?.let(::statsText),
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, SampleUiState.Initial)

    fun onLoadClicked() {
        if (job?.isActive == true) return
        sample.value = sample.value.copy(running = true, status = "Loading previews…")
        job = viewModelScope.launch {
            try {
                previewSample.execute(sample.value.tiles.map { it.key }.toSet()).collect(::onEvent)
            } finally {
                sample.value = sample.value.copy(running = false)
            }
        }
    }

    fun onPauseClicked() {
        job?.cancel()
        sample.value = sample.value.copy(running = false, status = "Paused. Resume to continue.")
    }

    fun onClearClicked() {
        job?.cancel()
        sample.value = SampleState()
    }

    private fun onEvent(event: SampleEvent) {
        val s = sample.value
        sample.value = when (event) {
            is SampleEvent.Planned -> s.copy(planned = event.sampleSize, eligible = event.eligiblePhotos, status = progressText(s.tiles.size, event.sampleSize, event.eligiblePhotos))
            is SampleEvent.Loaded -> {
                val image = try {
                    Image.makeFromEncoded(event.image.bytes).toComposeImageBitmap()
                } catch (e: IllegalArgumentException) {
                    sample.value = s.copy(failures = s.failures + "A preview could not be decoded (${event.image.contentType})", stats = event.stats)
                    return
                }
                val tiles = s.tiles + SampleTileUi(
                    key = event.item.mediaKey,
                    image = image,
                    link = "https://photos.google.com/photo/${event.item.mediaKey}",
                    caption = dateFormat.format(event.item.takenAtMs),
                )
                s.copy(tiles = tiles, stats = event.stats, status = progressText(tiles.size, s.planned, s.eligible))
            }
            is SampleEvent.Failed -> s.copy(failures = s.failures + event.reason, stats = event.stats)
            is SampleEvent.Stopped -> s.copy(status = event.reason, stats = event.stats)
            is SampleEvent.Finished -> s.copy(finished = true, stats = event.stats, status = "Sample complete: ${s.tiles.size} previews of ${s.eligible} eligible photos.")
            is SampleEvent.NothingEligible -> s.copy(status = event.reason)
        }
    }

    private fun progressText(loaded: Int, planned: Int, eligible: Int) = "Loaded $loaded of $planned previews (sampled from $eligible eligible photos)."

    private fun statsText(stats: SampleStats) =
        "Throughput: %.1f previews/s · %d KB fetched · %d expired links refreshed · %d failed".format(
            stats.previewsPerSecond, stats.bytes / 1024, stats.refreshedUrls, stats.failed,
        )

    private data class SampleState(
        val running: Boolean = false,
        val finished: Boolean = false,
        val planned: Int = 0,
        val eligible: Int = 0,
        val tiles: List<SampleTileUi> = emptyList(),
        val failures: List<String> = emptyList(),
        val stats: SampleStats? = null,
        val status: String? = null,
    )
}

data class SampleUiState(
    val loadLabel: String,
    val loadEnabled: Boolean,
    val pauseEnabled: Boolean,
    val clearEnabled: Boolean,
    val statusText: String?,
    val tiles: List<SampleTileUi>,
    val failureLines: List<String>,
    val statsText: String?,
) {
    companion object {
        val Initial = SampleUiState("Load sample", false, false, false, null, emptyList(), emptyList(), null)
    }
}

data class SampleTileUi(
    val key: String,
    val image: ImageBitmap,
    val link: String,
    val caption: String,
)
