package dev.photocleaner.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.window.LocalWindowExceptionHandlerFactory
import androidx.compose.ui.window.WindowExceptionHandler
import androidx.compose.ui.window.WindowExceptionHandlerFactory
import androidx.compose.runtime.Composable
import androidx.compose.foundation.text.selection.DisableSelection
import dev.photocleaner.core.design.SelectableContent
import dev.photocleaner.core.design.noKeyboardFocus
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Card
import androidx.compose.material3.OutlinedButton
import dev.photocleaner.core.design.StatusTone
import dev.photocleaner.core.design.color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.photocleaner.core.design.KeyRouter
import dev.photocleaner.core.design.LocalKeyRouter
import dev.photocleaner.core.design.PhotoCleanerTheme
import androidx.compose.runtime.DisposableEffect
import java.awt.event.WindowAdapter
import java.awt.event.WindowEvent
import dev.photocleaner.core.storage.AppPaths
import dev.photocleaner.features.calibration.CalibrationScreen
import dev.photocleaner.features.calibration.CalibrationViewModel
import dev.photocleaner.features.connection.ConnectionScreen
import dev.photocleaner.features.duplicates.DuplicatesScreen
import dev.photocleaner.features.duplicates.EmbeddingPanelViewModel
import dev.photocleaner.features.duplicates.ReviewViewModel
import dev.photocleaner.features.connection.ConnectionViewModel
import dev.photocleaner.features.scan.ScanScreen
import dev.photocleaner.features.scan.ScanViewModel
import dev.photocleaner.features.sweep.SweepScreen
import dev.photocleaner.features.sweep.SweepViewModel
import androidx.compose.runtime.key
import androidx.compose.foundation.layout.Box
import dev.photocleaner.core.design.CollapsingHeaderLayout

/**
 * The tabs, in order; the numbered ones are the steps to follow the first time. Remembered by name.
 * The milestone-1 Sample and Probe screens are no longer shown; their modules stay in the project.
 */
private enum class AppTab(val label: String) {
    SCAN("1 · Scan library"),
    CALIBRATION("2 · Calibration"),
    DUPLICATES("3 · Duplicates"),
    SEARCH("Search");

    /** The label with the step's status, e.g. "1 · Scan library (done)". */
    fun title(status: String?): String = if (status == null) label else "$label ($status)"
}

@OptIn(ExperimentalComposeUiApi::class) // LocalWindowExceptionHandlerFactory: keep the window open on errors
fun main() {
    val paths = AppPaths.forCurrentUser().ensureCreated()
    System.setProperty("photocleaner.logDir", paths.logsDir.toString())
    StableSqliteLibrary.install(paths.nativeLibrariesDir)
    AppErrors.installThreadHandler()
    StagedRunLock.holdIfStaged()
    val workerDir = System.getProperty("photocleaner.workerDir")?.let { java.nio.file.Path.of(it) }
    checkNotNull(workerDir) { "photocleaner.workerDir is not set (the Gradle run task sets it)" }
    val graph = AppGraph(paths, workerDir)
    graph.start()
    val windowStore = WindowPlacementStore(paths.windowPlacementFile)
    val savedPlacement = windowStore.load()

    application {
        CompositionLocalProvider(
            LocalWindowExceptionHandlerFactory provides WindowExceptionHandlerFactory { _ ->
                WindowExceptionHandler { error -> AppErrors.report("the window", error) }
            },
        ) {
        val windowState = rememberWindowState(
            placement = savedPlacement.placement,
            position = savedPlacement.position,
            size = savedPlacement.size,
        )
        var placement by remember { mutableStateOf(savedPlacement) }
        val keys = remember { KeyRouter() }
        // Remember position, size and maximised state, saved shortly after each change.
        LaunchedEffect(windowState) {
            snapshotFlow { Triple(windowState.placement, windowState.position, windowState.size) }
                .collectLatest { (mode, position, size) ->
                    placement = placement.updatedWith(mode, position, size)
                    delay(500)
                    windowStore.save(placement)
                }
        }
        Window(
            onCloseRequest = {
                windowStore.save(placement)
                graph.stop()
                exitApplication()
            },
            title = "Photo Cleaner",
            state = windowState,
            // Shortcuts are handled for the whole window, so they work wherever keyboard focus is.
            onPreviewKeyEvent = keys::dispatch,
        ) {
            // Key-ups are missed while another window (the photo viewer, another app) has the keyboard.
            DisposableEffect(window) {
                val listener = object : WindowAdapter() {
                    override fun windowLostFocus(e: WindowEvent) = keys.reset()
                }
                window.addWindowFocusListener(listener)
                onDispose { window.removeWindowFocusListener(listener) }
            }
            CompositionLocalProvider(LocalKeyRouter provides keys) {
            PhotoCleanerTheme {
                Surface(Modifier.fillMaxSize()) {
                    val connection = viewModel {
                        ConnectionViewModel(graph.bridge, graph.photosAvailability, workerDir.resolveSibling("extension").resolve("dist"))
                    }
                    val scan = viewModel {
                        ScanViewModel(graph.bridge, graph.getScanStatus, graph.scanInventory, graph.discardScan, graph.classifyInventory)
                    }
                    val calibration = viewModel {
                        CalibrationViewModel(graph.prepareCalibration, graph.loadCalibration, graph.labelCalibrationPair, graph.undoCalibrationLabel, graph.fetchPreview)
                    }
                    val embeddingPanel = viewModel { EmbeddingPanelViewModel(graph.embedLibrary) }
                    val review = viewModel {
                        ReviewViewModel(graph.loadReviewQueue, graph.decideGroup, graph.undoLastDecision, graph.fetchPreview, graph.trashQueueStatus, graph.photosAvailability)
                    }
                    val sweep = viewModel { SweepViewModel(graph.searchPhotos, graph.approveSweep, graph.fetchPreview, graph.photosAvailability) }
                    // The step tabs show their status ("done", "out of date", …) in their titles.
                    val scanState by scan.state.collectAsState()
                    val calibrationState by calibration.state.collectAsState()
                    // The last open tab comes back on the next launch.
                    var selectedTab by remember { mutableStateOf(AppTab.entries.firstOrNull { it.name == savedPlacement.tab } ?: AppTab.SCAN) }
                    fun openTab(tab: AppTab) {
                        selectedTab = tab
                        placement = placement.copy(tab = tab.name)
                        windowStore.save(placement)
                    }

                    val error by AppErrors.message.collectAsState()
                    // All text in the window can be selected and copied (Ctrl+C).
                    SelectableContent {
                        // The connection panel rises out of the way as a tab's content scrolls down;
                        // the tabs stay pinned at the top. Scrolling up past the top brings it back.
                        CollapsingHeaderLayout(
                            modifier = Modifier.fillMaxSize(),
                            header = {
                                Column(Modifier.padding(start = 24.dp, end = 24.dp, top = 24.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                                    ConnectionScreen(connection)
                                    HorizontalDivider()
                                }
                            },
                            pinned = {
                                Column(Modifier.padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    // Errors stay in view even with the header scrolled away.
                                    error?.let { ErrorBanner(it, AppErrors::dismiss) }
                                    DisableSelection {
                                        PrimaryTabRow(selectedTabIndex = selectedTab.ordinal) {
                                            AppTab.entries.forEach { tab ->
                                                Tab(
                                                    // Tabs never keep keyboard focus, so keys go to the shortcuts, not to the last tab clicked.
                                                    modifier = Modifier.noKeyboardFocus(),
                                                    selected = selectedTab == tab,
                                                    onClick = { openTab(tab) },
                                                    text = {
                                                        Text(
                                                            tab.title(
                                                                when (tab) {
                                                                    AppTab.SCAN -> scanState.tabStatus
                                                                    AppTab.CALIBRATION -> calibrationState.tabStatus
                                                                    AppTab.DUPLICATES, AppTab.SEARCH -> null
                                                                },
                                                            ),
                                                        )
                                                    },
                                                )
                                            }
                                        }
                                    }
                                }
                            },
                        ) {
                            // Each tab opens at its top.
                            key(selectedTab) {
                                when (selectedTab) {
                                    AppTab.SCAN -> ScrollingPage { ScanScreen(scan) }
                                    AppTab.CALIBRATION -> ScrollingPage { CalibrationScreen(calibration) }
                                    // These two scroll themselves: their inputs fold away and their buttons stay pinned.
                                    AppTab.DUPLICATES -> Box(Modifier.fillMaxSize().padding(horizontal = 24.dp)) {
                                        DuplicatesScreen(
                                            embeddingPanel,
                                            review,
                                            onSearchMoreLike = { photos ->
                                                sweep.onSearchLike(photos)
                                                openTab(AppTab.SEARCH)
                                            },
                                            onOpenScan = { openTab(AppTab.SCAN) },
                                            libraryScans = scanState.completedScans,
                                        )
                                    }
                                    AppTab.SEARCH -> Box(Modifier.fillMaxSize().padding(horizontal = 24.dp)) { SweepScreen(sweep, onOpenScan = { openTab(AppTab.SCAN) }) }
                                }
                            }
                        }
                    }
                }
            }
            }
        }
        }
    }
}

@Composable
private fun ScrollingPage(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) { content() }
}

@Composable
private fun ErrorBanner(message: String, onDismiss: () -> Unit) {
    Card {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(message, color = StatusTone.NEGATIVE.color(), modifier = Modifier.weight(1f))
            OutlinedButton(onClick = onDismiss) { Text("Dismiss") }
        }
    }
}
