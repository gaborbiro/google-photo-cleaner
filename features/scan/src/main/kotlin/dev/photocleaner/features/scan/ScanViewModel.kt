package dev.photocleaner.features.scan

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.photocleaner.core.design.StatusTone
import dev.photocleaner.features.scan.model.ScanProgress
import dev.photocleaner.features.scan.model.ScanState
import dev.photocleaner.features.scan.usecase.DiscardScanUseCase
import dev.photocleaner.features.scan.usecase.GetScanStatusUseCase
import dev.photocleaner.features.scan.usecase.ScanInventoryUseCase
import dev.photocleaner.features.shared.protection.model.InventoryReport
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.services.connector.domain.BridgeController
import dev.photocleaner.services.connector.domain.BridgeState
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class ScanViewModel(
    bridge: BridgeController,
    private val getStatus: GetScanStatusUseCase,
    private val scanInventory: ScanInventoryUseCase,
    private val discardScan: DiscardScanUseCase,
    private val classify: ClassifyInventoryUseCase,
) : ViewModel() {

    private val mapper = ScanUiMapper()
    private val progress = MutableStateFlow(ScanProgress.none())
    private val report = MutableStateFlow<InventoryReport?>(null)
    private val scanning = MutableStateFlow(false)

    /** Scans that ran to the end in this session; other tabs reload what they show after each. */
    private val completedScans = MutableStateFlow(0)
    private var job: Job? = null

    val state: StateFlow<ScanUiState> = combine(bridge.state, progress, report, scanning, completedScans) { bridgeState, progress, report, scanning, completed ->
        val connected = bridgeState is BridgeState.ExtensionConnected
        val (title, tone) = mapper.statusTitle(progress, scanning)
        ScanUiState(
            statusTitle = title,
            statusTone = tone,
            progressLines = mapper.progressLines(progress),
            notice = progress.notice ?: if (!connected && !scanning) "Connect the browser extension to scan." else null,
            primaryLabel = mapper.primaryLabel(progress, scanning),
            primaryEnabled = scanning || connected,
            discardVisible = !scanning && (progress.state == ScanState.PAUSED || progress.state == ScanState.FAILED),
            report = report?.let(mapper::report),
            speedText = mapper.speedText(progress.timing),
            speedHint = mapper.speedHint(progress.timing),
            tabStatus = mapper.tabStatus(report, scanning),
            completedScans = completed,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, ScanUiState.Initial)

    init {
        viewModelScope.launch { refresh() }
        // A scan goes out of date a day after it finished, also while the app stays open.
        viewModelScope.launch {
            while (true) {
                delay(STALE_CHECK_MS)
                if (!scanning.value) report.value = classify.execute()?.report
            }
        }
    }

    fun onPrimaryClicked() {
        if (scanning.value) {
            job?.cancel()
            return
        }
        scanning.value = true
        job = viewModelScope.launch {
            try {
                scanInventory.execute().collect { progress.value = it }
            } finally {
                if (progress.value.state == ScanState.COMPLETED) completedScans.value++
                scanning.value = false
                launch { refresh() }
            }
        }
    }

    fun onDiscardClicked() {
        if (scanning.value) return
        viewModelScope.launch {
            discardScan.execute()
            refresh(forgetTiming = true)
        }
    }

    /** Reloads the saved status; the speed measured by a scan in this session stays on show unless [forgetTiming]. */
    private companion object {
        const val STALE_CHECK_MS = 10 * 60_000L
    }

    private suspend fun refresh(forgetTiming: Boolean = false) {
        val timing = if (forgetTiming) null else progress.value.timing
        progress.value = getStatus.execute().let { it.copy(timing = it.timing ?: timing) }
        report.value = classify.execute()?.report
    }
}

data class ScanUiState(
    val statusTitle: String,
    val statusTone: StatusTone,
    val progressLines: List<String>,
    val notice: String?,
    val primaryLabel: String,
    val primaryEnabled: Boolean,
    val discardVisible: Boolean,
    val report: ReportUi?,
    /** Where the last scan's time went; null before a scan ran in this session. */
    val speedText: String?,
    /** What sets the speed, when the measurements support saying so. */
    val speedHint: String?,
    /** Shown after the tab's name: "done", "out of date", "needed" or "scanning". */
    val tabStatus: String,
    /** Scans that ran to the end in this session; Duplicates rebuilds its groups after each. */
    val completedScans: Int,
) {
    companion object {
        val Initial = ScanUiState("No scan yet", StatusTone.NEUTRAL, emptyList(), null, "Start scan", false, false, null, null, null, "needed", 0)
    }
}

data class ReportUi(
    val coverageTitle: String,
    val coverageTone: StatusTone,
    val coverageLines: List<String>,
    val issueLines: List<String>,
    val tables: List<CountsTableUi>,
)

data class CountsTableUi(val title: String, val rows: List<CountRowUi>)

data class CountRowUi(val label: String, val value: String, val startPaddingDp: Int)
