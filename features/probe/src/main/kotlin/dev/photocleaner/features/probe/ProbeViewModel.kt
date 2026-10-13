package dev.photocleaner.features.probe

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.photocleaner.features.probe.model.ProbeCheck
import dev.photocleaner.features.probe.model.ProbeOutcome
import dev.photocleaner.features.probe.usecase.RunProbeUseCase
import dev.photocleaner.features.probe.usecase.SaveProbeReportUseCase
import dev.photocleaner.services.connector.domain.BridgeController
import dev.photocleaner.services.connector.domain.BridgeState
import java.io.IOException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class ProbeViewModel(
    bridge: BridgeController,
    private val runProbe: RunProbeUseCase,
    private val saveReport: SaveProbeReportUseCase,
) : ViewModel() {

    private val run = MutableStateFlow(RunState())

    val state: StateFlow<ProbeUiState> = combine(bridge.state, run) { bridgeState, run ->
        val connected = bridgeState is BridgeState.ExtensionConnected
        ProbeUiState(
            runEnabled = connected && !run.running,
            runLabel = if (run.running) "Probing…" else "Run probe",
            hint = if (connected) null else "Connect the browser extension to run the probe.",
            runningText = run.runningTitle?.let { "Checking: $it" },
            checks = run.checks.map(::toUi),
            resultText = run.resultText,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, ProbeUiState.Initial)

    fun onRunClicked() {
        if (run.value.running) return
        run.value = RunState(running = true)
        viewModelScope.launch {
            runProbe.execute().collect { progress ->
                run.value = run.value.copy(checks = progress.checks, runningTitle = progress.runningTitle)
                val report = progress.report ?: return@collect
                val resultText = try {
                    "Report saved to ${saveReport.execute(report)}"
                } catch (e: IOException) {
                    "Probe finished, but the report could not be saved: ${e.message}"
                }
                run.value = run.value.copy(running = false, runningTitle = null, resultText = resultText)
            }
        }
    }

    private fun toUi(check: ProbeCheck) = ProbeCheckUi(
        title = check.title,
        outcome = check.outcome,
        outcomeLabel = when (check.outcome) {
            ProbeOutcome.PASS -> "PASS"
            ProbeOutcome.WARN -> "CHECK"
            ProbeOutcome.FAIL -> "FAIL"
            ProbeOutcome.SKIPPED -> "SKIPPED"
        },
        summary = check.summary,
        facts = check.facts.map { ProbeFactUi(it.label, it.value) },
    )

    private data class RunState(
        val running: Boolean = false,
        val runningTitle: String? = null,
        val checks: List<ProbeCheck> = emptyList(),
        val resultText: String? = null,
    )
}

data class ProbeUiState(
    val runEnabled: Boolean,
    val runLabel: String,
    val hint: String?,
    val runningText: String?,
    val checks: List<ProbeCheckUi>,
    val resultText: String?,
) {
    companion object {
        val Initial = ProbeUiState(false, "Run probe", null, null, emptyList(), null)
    }
}

data class ProbeCheckUi(
    val title: String,
    val outcome: ProbeOutcome,
    val outcomeLabel: String,
    val summary: String,
    val facts: List<ProbeFactUi>,
)

data class ProbeFactUi(val label: String, val value: String)
