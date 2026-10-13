package dev.photocleaner.features.sample.usecase

import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.features.shared.previews.FetchPreviewUseCase
import dev.photocleaner.services.connector.domain.PreviewImage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

sealed interface SampleEvent {
    data class Planned(val sampleSize: Int, val eligiblePhotos: Int) : SampleEvent
    data class Loaded(val item: InventoryItem, val image: PreviewImage, val stats: SampleStats) : SampleEvent
    data class Failed(val item: InventoryItem, val reason: String, val stats: SampleStats) : SampleEvent

    /** Stopped early because of a problem that needs the user (session, connection, rate limit). */
    data class Stopped(val reason: String, val stats: SampleStats) : SampleEvent
    data class Finished(val stats: SampleStats) : SampleEvent

    /** No eligible photos: the inventory is missing, incomplete or stale, or nothing is loose. */
    data class NothingEligible(val reason: String) : SampleEvent
}

data class SampleStats(
    val loaded: Int,
    val failed: Int,
    val refreshedUrls: Int,
    val bytes: Long,
    val elapsedMs: Long,
    val previewsPerSecond: Double,
)

/**
 * Fetches previews for a bounded, evenly spread sample of eligible photos, one
 * at a time. Items in [alreadyLoaded] are skipped, so calling again resumes.
 * Preview bytes are only held in memory by the caller.
 */
class PreviewSampleUseCase(
    private val classify: ClassifyInventoryUseCase,
    private val fetchPreview: FetchPreviewUseCase,
    private val clock: () -> Long = System::currentTimeMillis,
) {

    fun execute(alreadyLoaded: Set<String>, sampleSize: Int = DEFAULT_SAMPLE_SIZE): Flow<SampleEvent> = flow {
        val classification = classify.execute()
        if (classification == null) {
            emit(SampleEvent.NothingEligible("No inventory yet. Run a scan first."))
            return@flow
        }
        val eligible = classification.items
            .filter { it.eligibility == Eligibility.ELIGIBLE && it.item.mediaType == StoredMediaType.PHOTO }
            .map { it.item }
            .sortedByDescending { it.takenAtMs }
        if (eligible.isEmpty()) {
            val coverage = classification.report.coverage
            val reason = when {
                !coverage.isComplete -> "The inventory is incomplete, so no photo is eligible yet."
                coverage.isStale -> "The inventory is too old to rely on. Run the scan again."
                else -> "The inventory found no loose photos."
            }
            emit(SampleEvent.NothingEligible(reason))
            return@flow
        }
        val sample = spread(eligible, sampleSize)
        emit(SampleEvent.Planned(sample.size, eligible.size))

        val started = clock()
        var loaded = 0
        var failed = 0
        var refreshed = 0
        var bytes = 0L
        fun stats(): SampleStats {
            val elapsed = (clock() - started).coerceAtLeast(1)
            return SampleStats(loaded, failed, refreshed, bytes, elapsed, loaded * 1000.0 / elapsed)
        }

        for (item in sample) {
            if (item.mediaKey in alreadyLoaded) continue
            try {
                val fetched = fetchPreview.execute(item, PREVIEW_SIZE_PX)
                loaded++
                bytes += fetched.image.bytes.size
                if (fetched.urlRefreshed) refreshed++
                emit(SampleEvent.Loaded(item, fetched.image, stats()))
            } catch (e: ConnectorException.PreviewUnavailable) {
                failed++
                emit(SampleEvent.Failed(item, "Preview unavailable (HTTP ${e.httpStatus ?: "?"})", stats()))
            } catch (e: ConnectorException.Transient) {
                failed++
                emit(SampleEvent.Failed(item, "Network problem", stats()))
            } catch (e: ConnectorException.Timeout) {
                failed++
                emit(SampleEvent.Failed(item, "No answer from the extension", stats()))
            } catch (e: ConnectorException) {
                emit(SampleEvent.Stopped(stopReason(e), stats()))
                return@flow
            }
        }
        emit(SampleEvent.Finished(stats()))
    }

    private fun stopReason(e: ConnectorException): String = when (e) {
        is ConnectorException.SessionExpired -> "The Google Photos session ended. Reload photos.google.com, then resume."
        is ConnectorException.NotConnected -> "The browser extension disconnected. Reconnect it, then resume."
        is ConnectorException.NoPhotosTab -> "${e.message}. Then resume."
        is ConnectorException.RateLimited -> "Google is limiting requests. Resume later."
        else -> "Stopped: ${e.message}"
    }

    private fun <T> spread(list: List<T>, count: Int): List<T> {
        if (list.size <= count) return list
        return (0 until count).map { list[(it.toLong() * (list.size - 1) / (count - 1)).toInt()] }.distinct()
    }

    companion object {
        const val DEFAULT_SAMPLE_SIZE = 48
        const val PREVIEW_SIZE_PX = 256
    }
}
