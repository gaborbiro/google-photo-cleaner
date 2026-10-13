package dev.photocleaner.features.duplicates.usecase

import dev.photocleaner.features.shared.embeddings.EmbedPhotosUseCase
import dev.photocleaner.features.shared.embeddings.EmbedProgress
import dev.photocleaner.features.shared.embeddings.EmbeddingSettings
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.analysis.domain.EmbeddingRepository
import dev.photocleaner.repositories.analysis.domain.PhotoInfo
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.services.connector.domain.LibraryPage
import dev.photocleaner.services.connector.domain.MediaType
import dev.photocleaner.services.connector.domain.PhotosConnector
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

data class LibraryEmbedProgress(
    val state: State,
    val photos: Int,
    val embedded: Int,
    val failed: Int,
    val pagesRead: Int,
    val photosPerSecond: Double,
    val etaSeconds: Long?,
    val reason: String?,
    /** Share of the time (0..1) the AI model was analysing; near 1 means this computer sets the speed. */
    val modelBusyShare: Double,
) {
    enum class State { RUNNING, STOPPED, FINISHED }
}

/**
 * Embeds every photo of the latest inventory at the chosen token budget. The
 * library is re-read page by page so preview links are always fresh; photos
 * already embedded are skipped, so running again resumes. Also records each
 * photo's upload time and original size for keeper recommendation.
 */
class EmbedLibraryUseCase(
    private val classify: ClassifyInventoryUseCase,
    private val connector: PhotosConnector,
    private val embedPhotos: EmbedPhotosUseCase,
    private val embeddings: EmbeddingRepository,
    private val clock: () -> Long = System::currentTimeMillis,
    private val tokenBudget: Int = DEFAULT_TOKEN_BUDGET,
    private val pageRetryDelayMs: Long = 5_000,
) {

    fun execute(): Flow<LibraryEmbedProgress> = flow {
        val classification = classify.execute()
        if (classification == null) {
            emit(LibraryEmbedProgress(LibraryEmbedProgress.State.STOPPED, 0, 0, 0, 0, 0.0, null, "The library has not been scanned yet. Start on the Scan library tab.", 0.0))
            return@flow
        }
        val photoKeys = classification.items.filter { it.item.mediaType == StoredMediaType.PHOTO }.map { it.item.mediaKey }.toSet()
        val account = classification.report.accountFingerprint
        val modelId = EmbeddingSettings.modelKey(tokenBudget).id
        val alreadyStored = embeddings.storedKeys(modelId).intersect(photoKeys).size
        val started = clock()
        var embeddedNow = 0
        var failed = 0
        var pages = 0
        var modelBusyMs = 0L

        fun progress(state: LibraryEmbedProgress.State, reason: String? = null): LibraryEmbedProgress {
            val elapsed = (clock() - started).coerceAtLeast(1)
            val rate = embeddedNow * 1000.0 / elapsed
            val remaining = photoKeys.size - alreadyStored - embeddedNow - failed
            return LibraryEmbedProgress(
                state, photoKeys.size, alreadyStored + embeddedNow, failed, pages, rate,
                if (rate > 0 && remaining > 0) (remaining / rate).toLong() else null, reason,
                modelBusyShare = (modelBusyMs.toDouble() / elapsed).coerceIn(0.0, 1.0),
            )
        }

        emit(progress(LibraryEmbedProgress.State.RUNNING))
        var token: String? = null
        do {
            val page = try {
                readPage(token)
            } catch (e: ConnectorException) {
                emit(progress(LibraryEmbedProgress.State.STOPPED, "Reading the library failed (${e.javaClass.simpleName}). Resume when the connection is back."))
                return@flow
            }
            if (page.accountFingerprint != account) {
                emit(progress(LibraryEmbedProgress.State.STOPPED, "The Photos tab is signed in to a different account than the inventory."))
                return@flow
            }
            val photos = page.items.filter { it.mediaKey in photoKeys && it.mediaType == MediaType.PHOTO }
            embeddings.savePhotoInfo(photos.map { PhotoInfo(it.mediaKey, it.uploadedAtMs, it.width, it.height) })
            val stored = embeddings.storedKeys(modelId)
            val todo = photos.filter { it.mediaKey !in stored }.map {
                InventoryItem(it.mediaKey, it.dedupKey, it.takenAtMs, StoredMediaType.PHOTO, it.isFavourite, it.isArchived, it.isOwned, it.width, it.height, it.thumbUrl)
            }
            if (todo.isNotEmpty()) {
                val before = embeddedNow to failed
                val busyBefore = modelBusyMs
                var stop: String? = null
                embedPhotos.execute(todo, listOf(tokenBudget)).collect { p ->
                    when (p) {
                        is EmbedProgress.Running -> {
                            embeddedNow = before.first + p.stats.embedded
                            failed = before.second + p.stats.failed
                            modelBusyMs = busyBefore + p.stats.modelBusyMs
                            emit(progress(LibraryEmbedProgress.State.RUNNING))
                        }
                        is EmbedProgress.Stopped -> stop = p.reason
                        is EmbedProgress.Finished -> {
                            embeddedNow = before.first + p.stats.embedded
                            failed = before.second + p.stats.failed
                            modelBusyMs = busyBefore + p.stats.modelBusyMs
                        }
                    }
                }
                stop?.let {
                    emit(progress(LibraryEmbedProgress.State.STOPPED, it))
                    return@flow
                }
            }
            pages++
            emit(progress(LibraryEmbedProgress.State.RUNNING))
            token = page.nextPageToken
        } while (token != null)
        emit(progress(LibraryEmbedProgress.State.FINISHED))
    }

    /** One page, retried a few times on network blips. */
    private suspend fun readPage(token: String?): LibraryPage {
        repeat(PAGE_ATTEMPTS - 1) {
            try {
                return connector.libraryPage(token)
            } catch (e: ConnectorException.Transient) {
                delay(pageRetryDelayMs)
            } catch (e: ConnectorException.Timeout) {
                delay(pageRetryDelayMs)
            }
        }
        return connector.libraryPage(token)
    }

    companion object {
        /** Chosen by calibration on the user's library (2026-10-12). */
        const val DEFAULT_TOKEN_BUDGET = 280
        private const val PAGE_ATTEMPTS = 3
    }
}
