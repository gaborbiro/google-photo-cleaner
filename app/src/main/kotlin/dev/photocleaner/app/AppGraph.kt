package dev.photocleaner.app

import dev.photocleaner.core.storage.AppPaths
import dev.photocleaner.features.calibration.usecase.LabelCalibrationPairUseCase
import dev.photocleaner.features.calibration.usecase.LoadCalibrationUseCase
import dev.photocleaner.features.calibration.usecase.PrepareCalibrationUseCase
import dev.photocleaner.features.calibration.usecase.UndoLastCalibrationLabelUseCase
import dev.photocleaner.features.duplicates.usecase.EmbedLibraryUseCase
import dev.photocleaner.features.probe.usecase.RunProbeUseCase
import dev.photocleaner.features.probe.usecase.SaveProbeReportUseCase
import dev.photocleaner.features.sample.usecase.PreviewSampleUseCase
import dev.photocleaner.features.scan.usecase.DiscardScanUseCase
import dev.photocleaner.features.scan.usecase.GetScanStatusUseCase
import dev.photocleaner.features.scan.usecase.ScanInventoryUseCase
import dev.photocleaner.features.shared.embeddings.EmbedPhotosUseCase
import dev.photocleaner.features.shared.previews.FetchPreviewUseCase
import dev.photocleaner.features.shared.previews.MonitorPhotosAvailabilityUseCase
import dev.photocleaner.features.shared.previews.PhotosAvailability
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.analysis.SqlAnalysisRepository
import dev.photocleaner.repositories.inventory.SqlInventoryRepository
import dev.photocleaner.repositories.inventory.domain.InventoryRepository
import dev.photocleaner.services.connector.BridgeConfig
import dev.photocleaner.services.connector.ExtensionLink
import dev.photocleaner.services.connector.ExtensionPhotosConnector
import dev.photocleaner.services.connector.KtorBridgeServer
import dev.photocleaner.services.connector.PairingTokenStore
import dev.photocleaner.services.connector.domain.BridgeController
import dev.photocleaner.services.connector.domain.PhotosConnector
import dev.photocleaner.services.inference.ProcessInferenceWorker
import dev.photocleaner.services.inference.WorkerConfig
import dev.photocleaner.features.duplicates.usecase.BuildDuplicateGroupsUseCase
import dev.photocleaner.features.duplicates.usecase.DecideGroupUseCase
import dev.photocleaner.features.duplicates.usecase.LoadReviewQueueUseCase
import dev.photocleaner.features.duplicates.usecase.ProcessTrashQueueUseCase
import dev.photocleaner.features.duplicates.usecase.TrashQueueStatus
import dev.photocleaner.features.duplicates.usecase.UndoLastDecisionUseCase
import dev.photocleaner.features.sweep.usecase.ApproveSweepUseCase
import dev.photocleaner.features.sweep.usecase.SearchPhotosUseCase
import dev.photocleaner.repositories.review.SqlReviewRepository
import dev.photocleaner.services.trash.SimulatedTrashService
import dev.photocleaner.services.trash.domain.TrashService
import java.nio.file.Path
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory

/** Manual composition root. */
class AppGraph(paths: AppPaths, workerDir: Path) {
    private val config = BridgeConfig()
    private val link = ExtensionLink(config.requestTimeoutMs)
    private val server = KtorBridgeServer(config, PairingTokenStore(paths.pairingTokenFile), link)
    private val inventory: InventoryRepository = SqlInventoryRepository.open(paths.inventoryDatabase)
    private val analysis = SqlAnalysisRepository.open(paths.analysisDatabase)
    private val worker = ProcessInferenceWorker(WorkerConfig(workerDir))

    val bridge: BridgeController = server
    val connector: PhotosConnector = ExtensionPhotosConnector(link)

    val runProbe = RunProbeUseCase(connector)
    val saveProbeReport = SaveProbeReportUseCase(paths.probeReportsDir)

    val classifyInventory = ClassifyInventoryUseCase(inventory)
    val scanInventory = ScanInventoryUseCase(connector, inventory)
    val getScanStatus = GetScanStatusUseCase(inventory)
    val discardScan = DiscardScanUseCase(inventory)
    val fetchPreview = FetchPreviewUseCase(connector)
    val previewSample = PreviewSampleUseCase(classifyInventory, fetchPreview)

    // Bulk analysis paces each download less than the interactive screens do; concurrency is capped in the use case.
    private val embedPhotos = EmbedPhotosUseCase(FetchPreviewUseCase(connector, pacingMs = 100), worker, analysis)
    val prepareCalibration = PrepareCalibrationUseCase(classifyInventory, analysis, embedPhotos)
    val loadCalibration = LoadCalibrationUseCase(classifyInventory, analysis, analysis)
    val labelCalibrationPair = LabelCalibrationPairUseCase(analysis)
    val undoCalibrationLabel = UndoLastCalibrationLabelUseCase(analysis)
    val embedLibrary = EmbedLibraryUseCase(classifyInventory, connector, embedPhotos, analysis)

    private val review = SqlReviewRepository.open(paths.reviewDatabase)
    private val trash: TrashService = SimulatedTrashService(paths.simulatedTrashFile)
    private val buildGroups = BuildDuplicateGroupsUseCase(classifyInventory, analysis)
    val loadReviewQueue = LoadReviewQueueUseCase(buildGroups, review)
    val decideGroup = DecideGroupUseCase(review)
    val undoLastDecision = UndoLastDecisionUseCase(review)
    private val processTrashQueue = ProcessTrashQueueUseCase(review, trash, classifyInventory)
    val searchPhotos = SearchPhotosUseCase(classifyInventory, analysis, worker, review)
    val approveSweep = ApproveSweepUseCase(classifyInventory, review)

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val monitorPhotos = MonitorPhotosAvailabilityUseCase(server, connector)
    private val mutablePhotosAvailability = MutableStateFlow<PhotosAvailability>(PhotosAvailability.WaitingForExtension)

    /** Whether Google Photos is reachable end to end; screens pause and resume previews on it. */
    val photosAvailability: StateFlow<PhotosAvailability> = mutablePhotosAvailability.asStateFlow()
    private val mutableQueueStatus = MutableStateFlow<TrashQueueStatus?>(null)
    val trashQueueStatus: StateFlow<TrashQueueStatus?> = mutableQueueStatus.asStateFlow()
    private val log = LoggerFactory.getLogger(AppGraph::class.java)

    fun start() {
        server.start()
        appScope.launch {
            monitorPhotos.execute().collect {
                if (it != mutablePhotosAvailability.value) log.info("Google Photos availability: {}", it.javaClass.simpleName)
                mutablePhotosAvailability.value = it
            }
        }
        // The trash queue runs for the app's lifetime and restarts after an unexpected error.
        appScope.launch {
            while (isActive) {
                try {
                    processTrashQueue.execute().collect { mutableQueueStatus.value = it }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    log.error("Trash queue stopped unexpectedly; restarting in 10 s", e)
                    delay(10_000)
                }
            }
        }
    }

    fun stop() {
        appScope.cancel()
        server.stop()
        worker.close()
    }
}
