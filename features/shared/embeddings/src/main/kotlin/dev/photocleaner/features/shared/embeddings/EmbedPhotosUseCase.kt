package dev.photocleaner.features.shared.embeddings

import dev.photocleaner.features.shared.previews.FetchPreviewUseCase
import dev.photocleaner.repositories.analysis.domain.EmbeddingRepository
import dev.photocleaner.repositories.analysis.domain.StoredEmbedding
import dev.photocleaner.repositories.analysis.domain.StoredQuality
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.services.inference.domain.InferenceException
import dev.photocleaner.services.inference.domain.InferenceWorker
import dev.photocleaner.services.inference.domain.WorkerImage
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.channels.produce
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.slf4j.LoggerFactory

sealed interface EmbedProgress {
    data class Running(val stats: EmbedStats) : EmbedProgress

    /** Stopped early by a problem that needs the user (session, connection, worker). */
    data class Stopped(val reason: String, val stats: EmbedStats) : EmbedProgress
    data class Finished(val stats: EmbedStats) : EmbedProgress
}

data class EmbedStats(
    val total: Int,
    val alreadyStored: Int,
    val embedded: Int,
    val failed: Int,
    val elapsedMs: Long,
    val photosPerSecond: Double,
    /** Time the AI model spent analysing; the rest went to fetching previews and bookkeeping. */
    val modelBusyMs: Long,
)

/**
 * Makes sure every item has an embedding for each budget in [budgets]. Items
 * already stored are skipped, so calling again resumes. Previews are fetched one
 * at a time, embedded in batches and discarded; only vectors and quality
 * measurements are stored.
 */
class EmbedPhotosUseCase(
    private val fetchPreview: FetchPreviewUseCase,
    private val worker: InferenceWorker,
    private val embeddings: EmbeddingRepository,
    private val clock: () -> Long = System::currentTimeMillis,
    private val batchSize: Int = 16,
    /**
     * Previews downloaded in parallel. 10 keeps an RTX 5060 at budget 280 (~9.5 photos/s)
     * busy; rate limiting from Google pauses the run rather than failing it.
     */
    private val fetchConcurrency: Int = 10,
) {
    private val log = LoggerFactory.getLogger(EmbedPhotosUseCase::class.java)

    @OptIn(ExperimentalCoroutinesApi::class) // produce: a one-batch prefetch buffer
    fun execute(items: List<InventoryItem>, budgets: List<Int>): Flow<EmbedProgress> = flow {
        require(budgets.isNotEmpty()) { "At least one token budget" }
        val keys = budgets.associateWith { EmbeddingSettings.modelKey(it).id }
        val stored = keys.mapValues { (_, id) -> embeddings.storedKeys(id) }
        val todo = items.distinctBy { it.mediaKey }.filter { item -> stored.values.any { item.mediaKey !in it } }
        val started = clock()
        var embedded = 0
        var failed = 0
        var modelBusyMs = 0L
        fun stats(): EmbedStats {
            val elapsed = (clock() - started).coerceAtLeast(1)
            return EmbedStats(items.size, items.size - todo.size, embedded, failed, elapsed, embedded * 1000.0 / elapsed, modelBusyMs)
        }

        val info = try {
            worker.info()
        } catch (e: InferenceException) {
            log.warn("Inference worker not available: {}", e.message)
            emit(EmbedProgress.Stopped("The inference worker is not available: ${e.message}", stats()))
            return@flow
        }
        if (info.revision != EmbeddingSettings.REVISION) {
            emit(EmbedProgress.Stopped("The worker runs model revision ${info.revision.take(12)}, expected ${EmbeddingSettings.REVISION.take(12)}", stats()))
            return@flow
        }
        log.info("Embedding {} photos ({} already stored) on {} {}", todo.size, items.size - todo.size, info.device, info.gpu ?: "")
        emit(EmbedProgress.Running(stats()))

        // Downloading the next batch overlaps with embedding the current one; the
        // channel holds at most one batch ahead, so memory stays bounded.
        val permits = Semaphore(fetchConcurrency)
        var stop: String? = null
        coroutineScope {
            val batches = produce(capacity = 1) {
                for (batch in todo.chunked(batchSize)) {
                    val fetched = batch.map { item -> async { permits.withPermit { fetch(item) } } }.awaitAll()
                    send(fetched)
                    if (fetched.any { it.stop != null }) return@produce
                }
            }
            for (fetched in batches) {
                fetched.firstNotNullOfOrNull { it.stop }?.let { e ->
                    log.warn("Embedding stopped: {}", e.javaClass.simpleName)
                    stop = stopReason(e)
                }
                if (stop != null) break
                failed += fetched.count { it.failed }
                val images = fetched.mapNotNull { it.image }
                if (images.isEmpty()) {
                    emit(EmbedProgress.Running(stats()))
                    continue
                }
                val byKey = images.associate { it.first.mediaKey to it.first }
                val failedKeys = mutableSetOf<String>()
                for ((budget, keyId) in keys) {
                    val needed = images.filter { it.first.mediaKey !in stored.getValue(budget) }
                    if (needed.isEmpty()) continue
                    val modelStart = clock()
                    val result = try {
                        worker.embed(needed.map { WorkerImage(it.first.mediaKey, it.second) }, budget)
                    } catch (e: InferenceException) {
                        log.warn("Embedding stopped by the worker: {}", e.message)
                        stop = "The inference worker failed: ${e.message}"
                        break
                    }
                    modelBusyMs += clock() - modelStart
                    failedKeys += result.failed.mapNotNull { it.key }
                    embeddings.save(result.items.map { e ->
                        StoredEmbedding(
                            mediaKey = e.key,
                            dedupKey = byKey.getValue(e.key).dedupKey,
                            modelKeyId = keyId,
                            vector = e.vector,
                            quality = e.quality.let { StoredQuality(it.sharpness, it.brightness, it.clippedDark, it.clippedBright, it.width, it.height) },
                            createdAtMs = clock(),
                        )
                    })
                }
                if (stop != null) break
                failed += failedKeys.size
                embedded += images.size - failedKeys.size
                emit(EmbedProgress.Running(stats()))
            }
            batches.cancel()
        }
        stop?.let {
            emit(EmbedProgress.Stopped(it, stats()))
            return@flow
        }
        log.info("Embedding finished: {} embedded, {} failed", embedded, failed)
        emit(EmbedProgress.Finished(stats()))
    }

    private class Fetched(val image: Pair<InventoryItem, ByteArray>? = null, val failed: Boolean = false, val stop: ConnectorException? = null)

    /** Per-item failures (unavailable preview, network blip) skip the item; anything else stops the run. */
    private suspend fun fetch(item: InventoryItem): Fetched = try {
        Fetched(image = item to fetchPreview.execute(item, EmbeddingSettings.PREVIEW_SIZE_PX).image.bytes)
    } catch (e: ConnectorException.PreviewUnavailable) {
        Fetched(failed = true)
    } catch (e: ConnectorException.Transient) {
        Fetched(failed = true)
    } catch (e: ConnectorException.Timeout) {
        Fetched(failed = true)
    } catch (e: ConnectorException) {
        Fetched(stop = e)
    }

    private fun stopReason(e: ConnectorException): String = when (e) {
        is ConnectorException.SessionExpired -> "The Google Photos session ended. Reload photos.google.com, then resume."
        is ConnectorException.NotConnected -> "The browser extension disconnected. Reconnect it, then resume."
        is ConnectorException.NoPhotosTab -> "${e.message}. Then resume."
        is ConnectorException.RateLimited -> "Google is limiting requests. Resume later."
        else -> "Stopped: ${e.message}"
    }
}
