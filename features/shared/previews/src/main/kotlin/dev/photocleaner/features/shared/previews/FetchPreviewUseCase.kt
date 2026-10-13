package dev.photocleaner.features.shared.previews

import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.services.connector.domain.PhotosConnector
import dev.photocleaner.services.connector.domain.PreviewImage
import kotlinx.coroutines.delay

class FetchedPreview(val image: PreviewImage, val urlRefreshed: Boolean)

/**
 * Fetches one preview through the extension. A missing or expired preview URL is
 * refreshed once from the library listing at the photo's taken time (a single
 * bulk listing request), then retried. Other connector failures propagate.
 */
class FetchPreviewUseCase(
    private val connector: PhotosConnector,
    private val pacingMs: Long = 250,
) {
    suspend fun execute(item: InventoryItem, sizePx: Int): FetchedPreview {
        val url = item.thumbUrl ?: return refreshAndFetch(item, sizePx)
        delay(pacingMs)
        return try {
            FetchedPreview(connector.preview(url, sizePx), urlRefreshed = false)
        } catch (e: ConnectorException.PreviewUnavailable) {
            refreshAndFetch(item, sizePx)
        }
    }

    private suspend fun refreshAndFetch(item: InventoryItem, sizePx: Int): FetchedPreview {
        delay(pacingMs)
        val page = connector.libraryPage(pageToken = null, takenAtOrBeforeMs = item.takenAtMs)
        val fresh = page.items.firstOrNull { it.mediaKey == item.mediaKey }?.thumbUrl
            ?: throw ConnectorException.PreviewUnavailable("Photo no longer listed at its taken time", null)
        delay(pacingMs)
        return FetchedPreview(connector.preview(fresh, sizePx), urlRefreshed = true)
    }
}
