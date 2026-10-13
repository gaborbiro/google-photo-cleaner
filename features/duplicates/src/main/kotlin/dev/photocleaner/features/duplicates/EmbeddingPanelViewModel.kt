package dev.photocleaner.features.duplicates

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.photocleaner.features.duplicates.usecase.EmbedLibraryUseCase
import dev.photocleaner.features.duplicates.usecase.LibraryEmbedProgress
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Runs and reports the whole-library embedding pass. */
class EmbeddingPanelViewModel(private val embedLibrary: EmbedLibraryUseCase) : ViewModel() {

    private val mutableState = MutableStateFlow(EmbeddingPanelUiState(START_LABEL, null, null, null, null, 0))
    val state: StateFlow<EmbeddingPanelUiState> = mutableState.asStateFlow()
    private var job: Job? = null
    private var last: LibraryEmbedProgress? = null
    private var finishedScans = 0

    fun onStartOrPauseClicked() {
        if (job?.isActive == true) {
            job?.cancel()
            return
        }
        job = viewModelScope.launch {
            try {
                embedLibrary.execute().collect {
                    last = it
                    publish(running = true)
                }
            } finally {
                if (last?.state == LibraryEmbedProgress.State.FINISHED) finishedScans++
                publish(running = false)
            }
        }
        publish(running = true)
    }

    private fun publish(running: Boolean) {
        val p = last
        mutableState.value = EmbeddingPanelUiState(
            buttonLabel = when {
                running -> "Pause"
                p == null || p.state == LibraryEmbedProgress.State.FINISHED -> START_LABEL
                else -> "Resume scan"
            },
            progressText = p?.let {
                buildString {
                    append("Analysed %,d of %,d photos".format(it.embedded, it.photos))
                    if (it.failed > 0) append(" · %,d failed (retried next time)".format(it.failed))
                    it.etaSeconds?.takeIf { running }?.let { eta -> append(" · about ${eta / 60} min left") }
                }
            },
            // The speed of the run (live, then the last run's) and what sets it.
            speedText = p?.takeIf { it.photosPerSecond > 0 }?.let {
                "Speed: %.1f photos/s · AI model busy %d%% of the time".format(it.photosPerSecond, (it.modelBusyShare * 100).toInt())
            },
            speedHint = p?.takeIf { it.photosPerSecond > 0 }?.let {
                if (it.modelBusyShare >= COMPUTER_BOUND_SHARE) {
                    "The AI model is rarely idle, so this computer (mainly its graphics card) sets the speed here, not the internet."
                } else {
                    "The AI model often waits for photos to arrive from Google, so right now your connection and Google limit the speed."
                }
            },
            notice = when {
                p?.reason != null -> p.reason
                !running && p?.state == LibraryEmbedProgress.State.RUNNING -> "Paused. Resume to continue where it stopped."
                p?.state == LibraryEmbedProgress.State.FINISHED -> "Duplicate scan complete."
                else -> null
            },
            finishedScans = finishedScans,
        )
    }

    private companion object {
        const val START_LABEL = "Scan for duplicates"

        /** Busy at least this share of the time: the model, not the downloads, sets the pace. */
        const val COMPUTER_BOUND_SHARE = 0.7
    }
}

data class EmbeddingPanelUiState(
    val buttonLabel: String,
    val progressText: String?,
    /** "Speed: 10.2 photos/s · AI model busy 93% of the time"; null until photos were analysed this session. */
    val speedText: String?,
    /** What sets the speed, as the measurements show it. */
    val speedHint: String?,
    val notice: String?,
    /** How many scans ran to the end this session; the groups are rebuilt after each. */
    val finishedScans: Int,
)
