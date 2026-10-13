package dev.photocleaner.features.shared.viewer

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import dev.photocleaner.features.shared.previews.FetchPreviewUseCase
import dev.photocleaner.features.shared.previews.isTransient
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.services.connector.domain.ConnectorException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.jetbrains.skia.Image
import org.slf4j.LoggerFactory

data class ViewerPhoto(val item: InventoryItem, val caption: String, val link: String)

data class PhotoViewerUi(
    val mediaKey: String,
    val image: ImageBitmap?,
    /** Width / height of [image], so the frame can hug the photo. */
    val aspectRatio: Float?,
    val statusText: String?,
    val caption: String,
    val positionText: String,
    val link: String,
)

/**
 * Shows one photo large, with previous/next through a list. Large previews are
 * fetched on demand and kept in memory for the photos around the current one.
 * Owned by a view model, which passes its own scope.
 */
class PhotoViewerController(
    private val fetchPreview: FetchPreviewUseCase,
    private val scope: CoroutineScope,
) {
    private val log = LoggerFactory.getLogger(PhotoViewerController::class.java)
    private val mutableState = MutableStateFlow<PhotoViewerUi?>(null)
    val state: StateFlow<PhotoViewerUi?> = mutableState.asStateFlow()

    private var photos: List<ViewerPhoto> = emptyList()
    private var index = 0
    private var placeholder: (String) -> ImageBitmap? = { null }
    private val large = LinkedHashMap<String, ImageBitmap>()
    private val failed = mutableSetOf<String>()
    private var loadJob: Job? = null

    val isOpen: Boolean get() = mutableState.value != null

    fun open(list: List<ViewerPhoto>, startIndex: Int, thumbnail: (String) -> ImageBitmap?) {
        if (list.isEmpty()) return
        photos = list
        index = startIndex.coerceIn(list.indices)
        placeholder = thumbnail
        show()
    }

    fun next() = move(+1)

    fun previous() = move(-1)

    /** Loads the current photo again, e.g. once the connection is back. */
    fun retry() {
        if (isOpen) show()
    }

    fun close() {
        loadJob?.cancel()
        mutableState.value = null
    }

    private fun move(step: Int) {
        if (!isOpen || photos.isEmpty()) return
        index = (index + step).coerceIn(photos.indices)
        show()
    }

    private fun show() {
        publish()
        loadJob?.cancel()
        val current = photos[index]
        loadJob = scope.launch {
            load(current.item)
            // The neighbours, so stepping through is instant.
            photos.getOrNull(index + 1)?.let { load(it.item) }
            photos.getOrNull(index - 1)?.let { load(it.item) }
        }
    }

    private suspend fun load(item: InventoryItem) {
        if (item.mediaKey in large || item.mediaKey in failed) return
        try {
            val bytes = fetchPreview.execute(item, LARGE_PX).image.bytes
            large[item.mediaKey] = Image.makeFromEncoded(bytes).toComposeImageBitmap()
            while (large.size > CACHE) large.remove(large.keys.first())
        } catch (e: ConnectorException) {
            // Connection problems are retried via retry(); only real failures are remembered.
            if (!e.isTransient()) failed += item.mediaKey
            log.warn("Large preview failed: {}", e.javaClass.simpleName)
        } catch (e: IllegalArgumentException) {
            failed += item.mediaKey
            log.warn("Large preview could not be decoded")
        }
        publish()
    }

    private fun publish() {
        if (photos.isEmpty()) return
        val current = photos[index]
        val key = current.item.mediaKey
        val image = large[key] ?: placeholder(key)
        mutableState.value = PhotoViewerUi(
            mediaKey = key,
            image = image,
            aspectRatio = image?.let { it.width.toFloat() / it.height.coerceAtLeast(1) },
            statusText = when {
                key in large -> null
                key in failed -> "The large preview could not be loaded; showing the thumbnail."
                else -> "Loading the large preview…"
            },
            caption = current.caption,
            positionText = "${index + 1} of ${photos.size}",
            link = current.link,
        )
    }

    private companion object {
        /** The largest size the extension serves. */
        const val LARGE_PX = 1024
        const val CACHE = 12
    }
}
