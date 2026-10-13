package dev.photocleaner.features.sweep

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import androidx.lifecycle.ViewModel
import dev.photocleaner.core.design.NoticeSource
import dev.photocleaner.core.design.NoticeUi
import dev.photocleaner.core.design.PhotoDateFormat
import dev.photocleaner.core.design.StatusTone
import androidx.lifecycle.viewModelScope
import dev.photocleaner.features.shared.previews.FetchPreviewUseCase
import dev.photocleaner.features.shared.previews.PhotosAvailability
import dev.photocleaner.features.shared.previews.pausedReason
import dev.photocleaner.features.shared.viewer.PhotoViewerController
import dev.photocleaner.features.shared.viewer.PhotoViewerUi
import dev.photocleaner.features.shared.viewer.ViewerPhoto
import dev.photocleaner.features.sweep.usecase.ApproveSweepUseCase
import dev.photocleaner.features.sweep.usecase.SearchPhotosUseCase
import dev.photocleaner.features.sweep.usecase.SweepHit
import dev.photocleaner.features.sweep.usecase.SweepQuery
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.services.inference.domain.InferenceException
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.jetbrains.skia.Image

/**
 * Search, select a range, approve. Selection starts empty: every photo that goes
 * to the trash queue was picked by the user, and approval asks for confirmation.
 */
class SweepViewModel(
    private val search: SearchPhotosUseCase,
    private val approve: ApproveSweepUseCase,
    private val fetchPreview: FetchPreviewUseCase,
    availability: StateFlow<PhotosAvailability>,
) : ViewModel() {

    private val log = org.slf4j.LoggerFactory.getLogger(SweepViewModel::class.java)
    private val mutableState = MutableStateFlow(SweepUiState.Initial)
    val state: StateFlow<SweepUiState> = mutableState.asStateFlow()

    private var queryText = ""
    private var lastQuery: SweepQuery? = null
    private var limit = PAGE
    /** Every result of the search, strongest first; [hits] is the same list in the chosen order. */
    private var results: List<SweepHit> = emptyList()
    private var hits: List<SweepHit> = emptyList()
    private var sort = SweepSort.BEST_MATCH
    private val selected = linkedSetOf<String>()
    private var anchor: Int? = null
    private var hiddenText: String? = null
    private var blockedText: String? = null
    private var blockedByScan = false
    private val notices = NoticeSource()
    private var notice: NoticeUi? = null
    private var searching = false
    private var searchedOnce = false
    private var confirming = false
    private val previews = LinkedHashMap<String, ImageBitmap>()
    private val requested = mutableSetOf<String>()
    private val fetchPermits = Semaphore(FETCH_CONCURRENCY)
    private val dateFormat = PhotoDateFormat("d MMM yyyy")

    private val viewer = PhotoViewerController(fetchPreview, viewModelScope)
    val viewerState: StateFlow<PhotoViewerUi?> = viewer.state

    private var photos: PhotosAvailability = availability.value

    init {
        viewModelScope.launch { viewer.state.collect { publish() } }
        viewModelScope.launch {
            availability.collect { now ->
                val cameBack = now is PhotosAvailability.Ready && photos !is PhotosAvailability.Ready
                photos = now
                if (cameBack) {
                    // Thumbnails that could not load while disconnected are fetched again, top of the list first.
                    hits.indices.take(RETRY_AFTER_RECONNECT).filter { hits[it].item.mediaKey !in previews }.forEach(::onTileVisible)
                    viewer.retry()
                }
                publish()
            }
        }
    }

    // region keyboard focus in the results grid

    private var focusedIndex = 0
    private var columns = 1

    /** The grid reports how many columns it shows, so up/down move by a whole row. */
    fun onColumnsMeasured(count: Int) {
        columns = count.coerceAtLeast(1)
    }

    /** The white outline shows only while the user steers with the arrow keys; a click hides it. */
    private var ringVisible = false

    /** Whether the user has picked the focused photo (click or arrows) since these results appeared. */
    private var focusChosen = false

    /** New results, or the same ones re-sorted: start at the top with nothing focused yet. */
    private fun resetFocus() {
        focusedIndex = 0
        ringVisible = false
        focusChosen = false
        anchor = null
    }

    fun onFocusMove(dx: Int, dy: Int) {
        if (noResultsSaid()) return
        // Nothing picked yet: the first arrow press shows where the outline is, on the first photo.
        if (focusChosen) {
            val moved = (focusedIndex + dx + dy * columns).coerceIn(0, hits.size - 1)
            if (ringVisible && moved == focusedIndex) {
                say(if (dx < 0 || dy < 0) "Already at the first photo." else "Already at the last photo.", StatusTone.NEUTRAL)
            }
            focusedIndex = moved
        }
        ringVisible = true
        focusChosen = true
        publish()
    }

    /** Del: switch the focused photo between keep and trash. */
    fun onToggleFocused() {
        if (noResultsSaid()) return
        if (!focusChosen) {
            // Never act on a photo the user cannot see marked: show the outline first.
            ringVisible = true
            focusChosen = true
            say("Del switches the outlined photo between keep and trash. Press it again, or move with the arrows first.", StatusTone.NEUTRAL)
            publish()
            return
        }
        val key = hits[focusedIndex].item.mediaKey
        if (!selected.add(key)) selected.remove(key)
        anchor = focusedIndex
        publish()
    }

    /** Enter: confirm a pending approval, otherwise view the focused photo large. */
    fun onEnter() {
        when {
            confirming -> onConfirm()
            noResultsSaid() -> Unit
            else -> onOpenViewer(focusedIndex)
        }
    }

    /** True (after saying so) when there are no results for a key to act on. */
    private fun noResultsSaid(): Boolean {
        if (hits.isNotEmpty()) return false
        say(if (lastQuery == null) "No results yet. Describe the photos above and press Enter." else "No results to act on.", StatusTone.CAUTION)
        publish()
        return true
    }

    private fun say(text: String, tone: StatusTone) {
        notice = notices.next(text, tone)
    }

    // endregion

    /** The expand icon (or Enter): view a photo large, stepping through the current results. */
    fun onOpenViewer(index: Int) {
        focusedIndex = index
        viewer.open(hits.map { hit -> ViewerPhoto(hit.item, captionOf(hit), linkOf(hit)) }, index) { previews[it] }
    }

    fun onViewerNext() = viewer.next()

    fun onViewerPrevious() = viewer.previous()

    /** Closing the viewer leaves the grid focus on the photo that was last shown. */
    fun onViewerClose() {
        viewer.state.value?.mediaKey?.let { key -> hits.indexOfFirst { it.item.mediaKey == key }.takeIf { it >= 0 }?.let { focusedIndex = it } }
        // Coming back from the viewer (a keyboard flow) shows where the outline is.
        ringVisible = true
        focusChosen = true
        viewer.close()
        publish()
    }

    fun onViewerToggle() {
        val key = viewer.state.value?.mediaKey ?: return
        if (!selected.add(key)) selected.remove(key)
        publish()
    }

    fun onQueryChange(text: String) {
        queryText = text
        publish()
    }

    fun onSearch() {
        val text = queryText.trim()
        if (text.isEmpty()) return
        run(SweepQuery.Text(text), reset = true)
    }

    /** Finds photos that look like [mediaKeys], e.g. a group sent from the Duplicates tab. */
    fun onSearchLike(mediaKeys: Set<String>) {
        if (searching) {
            say("A search is still running. Try again when it has finished.", StatusTone.CAUTION)
            publish()
            return
        }
        queryText = ""
        run(SweepQuery.LikePhotos(mediaKeys), reset = true)
        say("Searching for photos like the ${mediaKeys.size} from the duplicate group.", StatusTone.NEUTRAL)
        publish()
    }

    /** Finds photos that look like the current selection. */
    fun onMoreLikeSelected() {
        if (selected.isEmpty()) {
            say("Select a few example photos first.", StatusTone.CAUTION)
            publish()
            return
        }
        run(SweepQuery.LikePhotos(selected.toSet()), reset = true)
    }

    fun onShowMore() {
        val query = lastQuery ?: return
        limit += PAGE
        run(query, reset = false)
    }

    /** Click toggles one photo; shift-click selects everything between it and the previous click. */
    fun onTileClicked(index: Int, shift: Boolean) {
        val key = hits.getOrNull(index)?.item?.mediaKey ?: return
        focusedIndex = index
        // A click picks the photo for Del and Enter, without the keyboard outline.
        ringVisible = false
        focusChosen = true
        val from = anchor
        if (shift && from != null) {
            (minOf(from, index)..maxOf(from, index)).forEach { selected += hits[it].item.mediaKey }
        } else if (!selected.add(key)) {
            selected.remove(key)
        }
        anchor = index
        publish()
    }

    /** A: selects everything shown; when everything shown is already selected, deselects it all. */
    fun onSelectOrDeselectAll() {
        if (noResultsSaid()) return
        val shown = hits.map { it.item.mediaKey }
        if (selected.containsAll(shown)) {
            selected.removeAll(shown.toSet())
            anchor = null
            say("Deselected all ${shown.size} photo(s) shown.", StatusTone.NEUTRAL)
        } else {
            selected += shown
            say("Selected all ${shown.size} photo(s) shown for the trash. D trashes them; A again deselects them.", StatusTone.NEUTRAL)
        }
        publish()
    }

    /**
     * Arranges the same results differently. Focus goes back to the top, hidden: following the
     * focused photo to its new place would jump far out of sight. Trash marks belong to photos and stay.
     */
    fun onSortSelected(sort: SweepSort) {
        if (sort == this.sort) return
        this.sort = sort
        hits = sorted(results)
        resetFocus()
        publish()
    }

    private fun sorted(list: List<SweepHit>): List<SweepHit> = when (sort) {
        SweepSort.NEWEST -> list.sortedByDescending { it.item.takenAtMs }
        SweepSort.OLDEST -> list.sortedBy { it.item.takenAtMs }
        SweepSort.BEST_MATCH -> list.sortedBy { it.rank }
    }

    fun onApproveClicked() {
        when {
            selected.isEmpty() -> say("Nothing is selected for the trash. Click photos, or press A to select all shown.", StatusTone.CAUTION)
            // Pressing D again while asking: the card is already there, so point at it.
            confirming -> say("Press Enter to move them to the trash, or Esc to cancel.", StatusTone.CAUTION)
            else -> confirming = true
        }
        publish()
    }

    fun onConfirm() {
        if (!confirming) return
        confirming = false
        val keys = selected.toSet()
        val label = (lastQuery as? SweepQuery.Text)?.text ?: "similar photos"
        viewModelScope.launch {
            try {
                val count = approve.execute(label, keys)
                results = results.filter { it.item.mediaKey !in keys }
                hits = hits.filter { it.item.mediaKey !in keys }
                focusedIndex = focusedIndex.coerceAtMost((hits.size - 1).coerceAtLeast(0))
                selected.clear()
                anchor = null
                say("Moved $count photo(s) to the trash queue. Z on the 3 · Duplicates tab undoes it.", StatusTone.POSITIVE)
            } catch (e: IllegalArgumentException) {
                say(e.message ?: "Moving to the trash was refused.", StatusTone.NEGATIVE)
            } catch (e: IllegalStateException) {
                say(e.message ?: "Moving to the trash failed.", StatusTone.NEGATIVE)
            }
            publish()
        }
        publish()
    }

    fun onCancelConfirm() {
        confirming = false
        publish()
    }

    /** Called by each visible tile; previews are fetched a few at a time and kept in memory. */
    fun onTileVisible(index: Int) {
        val item = hits.getOrNull(index)?.item ?: return
        if (!requested.add(item.mediaKey)) return
        viewModelScope.launch {
            fetchPermits.withPermit {
                try {
                    val bytes = fetchPreview.execute(item, THUMB_PX).image.bytes
                    previews[item.mediaKey] = Image.makeFromEncoded(bytes).toComposeImageBitmap()
                    while (previews.size > PREVIEW_CACHE) {
                        val oldest = previews.keys.first()
                        previews.remove(oldest)
                        requested.remove(oldest)
                    }
                } catch (e: ConnectorException) {
                    requested.remove(item.mediaKey) // retried when the tile is shown again
                    log.warn("Preview failed: {}", e.javaClass.simpleName)
                } catch (e: IllegalArgumentException) {
                    log.warn("Preview could not be decoded")
                }
            }
            publish()
        }
    }

    private fun run(query: SweepQuery, reset: Boolean) {
        if (searching) return
        searching = true
        if (reset) {
            limit = PAGE
            selected.clear()
            anchor = null
        }
        notice = null
        publish()
        viewModelScope.launch {
            try {
                val result = search.execute(query, limit)
                val focusedKey = hits.getOrNull(focusedIndex)?.item?.mediaKey
                lastQuery = query
                results = result.hits.sortedBy { it.rank }
                hits = sorted(results)
                // A new search starts at the top; "Show more" stays on the photo that was focused.
                if (reset) resetFocus() else focusedIndex = hits.indexOfFirst { it.item.mediaKey == focusedKey }.coerceAtLeast(0)
                blockedText = result.blockedReason
                blockedByScan = result.scanNeeded
                hiddenText = listOfNotNull(
                    result.protectedOrUnknownHidden.takeIf { it > 0 }?.let { "$it protected or unknown photo(s) hidden" },
                    result.alreadyApprovedHidden.takeIf { it > 0 }?.let { "$it already in the trash queue hidden" },
                ).joinToString(" · ").ifEmpty { null }
            } catch (e: InferenceException) {
                say("The inference worker failed: ${e.message}", StatusTone.NEGATIVE)
            } finally {
                searching = false
                searchedOnce = true
                publish()
            }
        }
    }

    private fun publish() {
        mutableState.value = SweepUiState(
            query = queryText,
            searching = searching,
            progressText = when {
                !searching -> null
                !searchedOnce -> "Searching… the first search also loads the AI model onto the GPU (about 10–20 s)."
                else -> "Searching…"
            },
            resultText = if (lastQuery == null) null else "${hits.size} best matches · ${selected.size} selected for the trash",
            sort = sort,
            hiddenText = hiddenText,
            blockedText = blockedText,
            blockedByScan = blockedByScan,
            previewsPausedText = photos.pausedReason(),
            notice = notice,
            focusedIndex = focusedIndex,
            tiles = hits.mapIndexed { index, hit ->
                SweepTileUi(
                    index = index,
                    mediaKey = hit.item.mediaKey,
                    image = previews[hit.item.mediaKey],
                    selected = hit.item.mediaKey in selected,
                    borderDp = if (hit.item.mediaKey in selected) 4 else 1,
                    borderTone = if (hit.item.mediaKey in selected) StatusTone.NEGATIVE else StatusTone.NEUTRAL,
                    focusRingDp = if (ringVisible && index == focusedIndex) FOCUS_RING_DP else 0,
                    caption = captionOf(hit),
                    link = linkOf(hit),
                )
            },
            showMoreVisible = hits.size >= limit,
            viewerSelectionText = viewer.state.value?.let { if (it.mediaKey in selected) "Selected for the trash" else "Kept (not selected)" },
            viewerSelectionTone = if (viewer.state.value?.mediaKey in selected) StatusTone.NEGATIVE else StatusTone.POSITIVE,
            confirmText = if (confirming) "Move ${selected.size} photo(s) to the trash? (Simulated: nothing is sent to Google.)" else null,
        )
    }

    private fun captionOf(hit: SweepHit) = "${dateFormat.format(hit.item.takenAtMs)} · match #${hit.rank}"

    private fun linkOf(hit: SweepHit) = "https://photos.google.com/photo/${hit.item.mediaKey}"

    private companion object {
        const val PAGE = 300
        const val FOCUS_RING_DP = 3
        const val RETRY_AFTER_RECONNECT = 150
        const val THUMB_PX = 200
        const val FETCH_CONCURRENCY = 6
        const val PREVIEW_CACHE = 900
    }
}

data class SweepUiState(
    val query: String,
    val searching: Boolean,
    /** Shown with a spinner while a search runs; null otherwise. */
    val progressText: String?,
    val resultText: String?,
    val sort: SweepSort,
    val hiddenText: String?,
    /** Why the search could not run; shown as a banner. */
    val blockedText: String?,
    /** The block is fixed by scanning the library, so the banner offers the way there. */
    val blockedByScan: Boolean,
    val previewsPausedText: String?,
    /** Feedback for the last key press; null when there is nothing to say. */
    val notice: NoticeUi?,
    val focusedIndex: Int,
    val tiles: List<SweepTileUi>,
    val showMoreVisible: Boolean,
    val viewerSelectionText: String?,
    val viewerSelectionTone: StatusTone,
    val confirmText: String?,
) {
    companion object {
        val Initial = SweepUiState("", false, null, null, SweepSort.BEST_MATCH, null, null, false, null, null, 0, emptyList(), false, null, StatusTone.NEUTRAL, null)
    }
}

/** How the matches are arranged; the set of matches is the same in every order. */
enum class SweepSort(val label: String) {
    BEST_MATCH("Best match"),
    NEWEST("Newest"),
    OLDEST("Oldest"),
}

data class SweepTileUi(
    val index: Int,
    val mediaKey: String,
    val image: ImageBitmap?,
    val selected: Boolean,
    val borderDp: Int,
    val borderTone: StatusTone,
    /** 0 when not focused. */
    val focusRingDp: Int,
    val caption: String,
    val link: String,
)
