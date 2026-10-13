package dev.photocleaner.features.duplicates

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.photocleaner.core.design.NoticeSource
import dev.photocleaner.core.design.NoticeUi
import dev.photocleaner.core.design.PhotoDateFormat
import dev.photocleaner.core.design.StatusTone
import dev.photocleaner.features.duplicates.model.DuplicateGroup
import dev.photocleaner.features.duplicates.model.GroupMember
import dev.photocleaner.features.duplicates.model.MemberRole
import dev.photocleaner.features.shared.protection.model.Eligibility
import dev.photocleaner.features.shared.protection.model.ProtectionReason
import dev.photocleaner.features.duplicates.usecase.DecideGroupUseCase
import dev.photocleaner.features.duplicates.usecase.LoadReviewQueueUseCase
import dev.photocleaner.features.duplicates.usecase.TrashQueueStatus
import dev.photocleaner.features.duplicates.usecase.UndoLastDecisionUseCase
import dev.photocleaner.features.duplicates.usecase.selectableMembers
import dev.photocleaner.features.shared.previews.FetchPreviewUseCase
import dev.photocleaner.features.shared.previews.PhotosAvailability
import dev.photocleaner.features.shared.previews.isTransient
import dev.photocleaner.features.shared.previews.pausedReason
import dev.photocleaner.features.shared.viewer.PhotoViewerController
import dev.photocleaner.features.shared.viewer.PhotoViewerUi
import dev.photocleaner.features.shared.viewer.ViewerPhoto
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.review.domain.DecisionKind
import dev.photocleaner.repositories.review.domain.TrashJobState
import dev.photocleaner.services.connector.domain.ConnectorException
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.jetbrains.skia.Image
import org.slf4j.LoggerFactory

/**
 * One group at a time. A decision is recorded and the next (already preloaded)
 * group is shown immediately; trashing happens in the background queue.
 */
class ReviewViewModel(
    private val loadQueue: LoadReviewQueueUseCase,
    private val decide: DecideGroupUseCase,
    private val undoLast: UndoLastDecisionUseCase,
    private val fetchPreview: FetchPreviewUseCase,
    queueStatus: StateFlow<TrashQueueStatus?>,
    availability: StateFlow<PhotosAvailability>,
) : ViewModel() {

    private val log = LoggerFactory.getLogger(ReviewViewModel::class.java)
    private val mutableState = MutableStateFlow(ReviewUiState.Initial)
    val state: StateFlow<ReviewUiState> = mutableState.asStateFlow()

    private var pending: MutableList<DuplicateGroup> = mutableListOf()
    private var deferredIds: Set<String> = emptySet()
    private var totalGroups = 0
    private var decidedGroups = 0
    private var blockedReason: String? = null
    private var loaded = false
    private var busy = false
    private var analysedAtMs: Long? = null
    private var photosAnalysed = 0
    private var photosNotAnalysed = 0
    private var handledScans = 0
    private val notices = NoticeSource()
    private var notice: NoticeUi? = null
    private var queue: TrashQueueStatus? = null
    private val selections = mutableMapOf<String, MutableSet<String>>()
    private val previews = LinkedHashMap<String, ImageBitmap>()
    private val previewErrors = mutableMapOf<String, String>()
    private val timeFormat = PhotoDateFormat("d MMM yyyy, HH:mm:ss")

    private val viewer = PhotoViewerController(fetchPreview, viewModelScope)
    val viewerState: StateFlow<PhotoViewerUi?> = viewer.state

    private var photos: PhotosAvailability = availability.value

    init {
        viewModelScope.launch { queueStatus.collect { queue = it; publish() } }
        viewModelScope.launch { viewer.state.collect { publish() } }
        viewModelScope.launch {
            availability.collect { now ->
                val cameBack = now is PhotosAvailability.Ready && photos !is PhotosAvailability.Ready
                photos = now
                if (cameBack) {
                    // Previews that could not load while disconnected are fetched again.
                    preload()
                    viewer.retry()
                }
                publish()
            }
        }
    }

    // region keyboard focus in the group grid

    private var focusedIndex = 0
    private var columns = 1

    /** After A, the whole group is focused (white outline on every photo) until the user moves or clicks. */
    private var allFocused = false

    /** The white outline shows only while the user steers with the arrow keys; a click hides it. */
    private var ringVisible = false

    /** Whether the user has picked the focused photo (click or arrows) since the group appeared. */
    private var focusChosen = false

    /** A new group (or a reload that moved to one) starts with nothing focused yet. */
    private fun resetFocus() {
        focusedIndex = 0
        allFocused = false
        ringVisible = false
        focusChosen = false
    }

    /** The grid reports its width so up/down can move by a whole row. */
    fun onGridWidthMeasured(widthDp: Float) {
        columns = ((widthDp + TILE_GAP_DP) / (TILE_DP + TILE_GAP_DP)).toInt().coerceAtLeast(1)
    }

    fun onFocusMove(dx: Int, dy: Int) {
        val count = currentGroupOrSay()?.members?.size ?: return
        when {
            // The first arrow press returns to the single outline where the user was.
            allFocused -> allFocused = false
            // Nothing picked yet: the first arrow press shows where the outline is, on the first photo.
            !focusChosen -> Unit
            else -> {
                val moved = (focusedIndex + dx + dy * columns).coerceIn(0, count - 1)
                if (ringVisible && moved == focusedIndex) {
                    say(if (dx < 0 || dy < 0) "Already at the first photo." else "Already at the last photo.", StatusTone.NEUTRAL)
                }
                focusedIndex = moved
            }
        }
        ringVisible = true
        focusChosen = true
        publish()
    }

    /** A click picks the photo for Del and Enter, without the keyboard outline. */
    fun onTileFocused(mediaKey: String) {
        val index = pending.firstOrNull()?.members?.indexOfFirst { it.photo.item.mediaKey == mediaKey } ?: return
        if (index >= 0) focusedIndex = index
        allFocused = false
        ringVisible = false
        focusChosen = true
        publish()
    }

    /** Del: switch the focused photo between keep and trash; with the whole group focused, flip them all. */
    fun onToggleFocused() {
        val group = currentGroupOrSay() ?: return
        if (allFocused) {
            val selectable = group.selectableMembers().map { it.photo.item.mediaKey }
            val selected = selectionOf(group)
            if (selected.containsAll(selectable)) selected.removeAll(selectable.toSet()) else selected.addAll(selectable)
            publish()
            return
        }
        if (!focusChosen) {
            // Never act on a photo the user cannot see marked: show the outline first.
            ringVisible = true
            focusChosen = true
            say("Del switches the outlined photo between keep and trash. Press it again, or move with the arrows first.", StatusTone.NEUTRAL)
            publish()
            return
        }
        val member = group.members.getOrNull(focusedIndex) ?: return
        toggleOrExplain(member.photo.item.mediaKey)
    }

    /** Enter: view the focused photo large. */
    fun onOpenFocused() {
        currentGroupOrSay()?.members?.getOrNull(focusedIndex)?.let { onOpenViewer(it.photo.item.mediaKey) }
    }

    /** The group on screen; when there is none, says why so the key press is not met with silence. */
    private fun currentGroupOrSay(): DuplicateGroup? = pending.firstOrNull().also {
        if (it == null) {
            say(
                if (!loaded) "The duplicate groups are still loading." else blockedReason ?: "No groups left to review.",
                StatusTone.CAUTION,
            )
            publish()
        }
    }

    private fun say(text: String, tone: StatusTone) {
        notice = notices.next(text, tone)
    }

    private fun toggleOrExplain(mediaKey: String) {
        val group = pending.firstOrNull() ?: return
        if (group.selectableMembers().none { it.photo.item.mediaKey == mediaKey }) {
            val member = group.members.first { it.photo.item.mediaKey == mediaKey }
            say("This photo ${whyKept(member)}, so it is always kept.", StatusTone.CAUTION)
            publish()
        } else {
            onToggle(mediaKey)
        }
    }

    // endregion

    /** The expand icon (or Enter): view the group's photos large. */
    fun onOpenViewer(mediaKey: String) {
        val group = pending.firstOrNull() ?: return
        val members = group.members
        val photos = members.map { m ->
            ViewerPhoto(m.photo.item, "${roleText(m)} · ${timeFormat.format(m.photo.item.takenAtMs)}", "https://photos.google.com/photo/${m.photo.item.mediaKey}")
        }
        viewer.open(photos, members.indexOfFirst { it.photo.item.mediaKey == mediaKey }) { previews[it] }
    }

    fun onViewerNext() = viewer.next()

    fun onViewerPrevious() = viewer.previous()

    /** Closing the viewer leaves the grid focus on the photo that was last shown. */
    fun onViewerClose() {
        viewer.state.value?.mediaKey?.let(::onTileFocused)
        // Coming back from the viewer (a keyboard flow) shows where the outline is.
        ringVisible = true
        viewer.close()
        publish()
    }

    fun onViewerToggle() {
        viewer.state.value?.mediaKey?.let(::toggleOrExplain)
    }

    private fun roleText(member: GroupMember) = when (member.role) {
        MemberRole.KEEPER -> "Recommended keeper"
        MemberRole.PROPOSED -> "Proposed for the trash"
        MemberRole.REFERENCE -> "Always kept: ${keepReasonLabel(member)}"
    }

    /** Short reason a photo can never be selected, for its label: "protected (in an album)" or "status unknown". */
    private fun keepReasonLabel(member: GroupMember): String = when (member.photo.eligibility) {
        Eligibility.PROTECTED -> "protected (" + protectionWords(member) + ")"
        else -> "status unknown"
    }

    /** Sentence fragment: "is in an album", "is a favourite", "has an unknown status". */
    private fun whyKept(member: GroupMember): String = when (member.photo.eligibility) {
        Eligibility.PROTECTED -> "is " + member.photo.protectionReasons.sorted().joinToString(" and ") {
            when (it) {
                ProtectionReason.FAVOURITE -> "a favourite"
                ProtectionReason.IN_ALBUM -> "in an album"
                ProtectionReason.ARCHIVED -> "archived"
            }
        }
        else -> "has an unknown status (uploaded by someone else and not matched to an album, or missing data)"
    }

    private fun protectionWords(member: GroupMember): String = member.photo.protectionReasons.sorted().joinToString(", ") {
        when (it) {
            ProtectionReason.FAVOURITE -> "favourite"
            ProtectionReason.IN_ALBUM -> "in an album"
            ProtectionReason.ARCHIVED -> "archived"
        }
    }

    /**
     * The tab was opened, or a library scan finished while it was open: groups are (re)built,
     * so photos trashed from Search, protection changes and new photos show without a button press.
     */
    fun onShown() = refresh()

    /** A duplicate scan finished ([count] so far this session): rebuild the groups once per finished scan. */
    fun onScansFinished(count: Int) {
        if (count <= handledScans) return
        handledScans = count
        refresh()
    }

    /** A reload asked for while busy runs as soon as the current work is done, so none is lost. */
    private var refreshAgain = false

    private fun refresh() {
        if (busy) {
            refreshAgain = true
            return
        }
        busy = true
        publish()
        viewModelScope.launch {
            try {
                reload()
            } finally {
                becomeIdle()
                publish()
            }
        }
    }

    private fun becomeIdle() {
        busy = false
        if (refreshAgain) {
            refreshAgain = false
            refresh()
        }
    }

    fun onToggle(mediaKey: String) {
        val group = pending.firstOrNull() ?: return
        if (group.selectableMembers().none { it.photo.item.mediaKey == mediaKey }) return
        val selected = selectionOf(group)
        if (!selected.add(mediaKey)) selected.remove(mediaKey)
        publish()
    }

    /**
     * A: selects every photo that can go (the keeper too, when it is not protected) and
     * outlines the whole group. D still confirms; Del then flips them all.
     */
    fun onSelectAll() {
        val group = currentGroupOrSay() ?: return
        val selectable = group.selectableMembers().map { it.photo.item.mediaKey }
        selectionOf(group).addAll(selectable)
        allFocused = true
        val keeperStays = group.keeper.photo.item.mediaKey !in selectable
        say(
            "Selected all ${selectable.size} photo(s) that can go for the trash" +
                (if (keeperStays) ". The keeper ${whyKept(group.keeper)}, so it always stays" else ", the keeper included") +
                ". D trashes them; Del flips them all; arrows go back to single photos.",
            StatusTone.NEUTRAL,
        )
        publish()
    }

    fun onApprove() {
        val group = currentGroupOrSay() ?: return
        val selected = selectionOf(group).toSet()
        if (selected.isEmpty()) {
            say("Nothing is selected for the trash. Press F to keep the whole group.", StatusTone.CAUTION)
            publish()
            return
        }
        decideCurrent(DecisionKind.APPROVED, selected)
    }

    fun onKeep() {
        currentGroupOrSay() ?: return
        decideCurrent(DecisionKind.KEPT, emptySet())
    }

    private val searchRequests = MutableSharedFlow<Set<String>>(extraBufferCapacity = 1)

    /** The photos of a group to use as examples on the Search tab; the window switches tabs when one arrives. */
    val searchMoreLike: SharedFlow<Set<String>> = searchRequests.asSharedFlow()

    /** Finds more photos like the whole current group, e.g. the rest of a series taken over many days. */
    fun onSearchMoreLike() {
        val group = currentGroupOrSay() ?: return
        searchRequests.tryEmit(group.members.map { it.photo.item.mediaKey }.toSet())
    }

    fun onDefer() {
        currentGroupOrSay() ?: return
        decideCurrent(DecisionKind.DEFERRED, emptySet())
    }

    fun onUndo() {
        if (busy) return
        busy = true
        viewModelScope.launch {
            try {
                val undone = undoLast.execute()
                if (undone == null) {
                    say("Nothing to undo.", StatusTone.CAUTION)
                } else {
                    reload()
                    // Show the group that was just undone first, with its previous selection.
                    pending.indexOfFirst { it.id == undone.groupId }.takeIf { it > 0 }?.let { pending.add(0, pending.removeAt(it)) }
                    if (undone.kind == DecisionKind.APPROVED) selections[undone.groupId] = undone.items.map { it.mediaKey }.toMutableSet()
                    val text = when (undone.kind) {
                        DecisionKind.APPROVED -> "Undid the trashing: photos not yet sent are cancelled and any already trashed are restored"
                        DecisionKind.KEPT -> "Undid “keep”"
                        DecisionKind.DEFERRED -> "Undid “skip”"
                    }
                    say(text, StatusTone.POSITIVE)
                    preload()
                }
            } finally {
                becomeIdle()
                publish()
            }
        }
    }

    private fun decideCurrent(kind: DecisionKind, selected: Set<String>) {
        if (busy) return
        val group = pending.firstOrNull() ?: return
        busy = true
        viewModelScope.launch {
            try {
                decide.execute(group, kind, selected)
                pending.removeAt(0)
                resetFocus()
                if (kind == DecisionKind.DEFERRED) {
                    pending.add(group)
                    deferredIds = deferredIds + group.id
                } else {
                    decidedGroups++
                }
                // The next group appearing is the feedback; a message about the old one would mislead.
                notice = null
                preload()
            } catch (e: IllegalArgumentException) {
                say(e.message ?: "The decision was refused.", StatusTone.NEGATIVE)
            } finally {
                becomeIdle()
                publish()
            }
        }
    }

    private suspend fun reload() {
        val shownBefore = pending.firstOrNull()?.id
        val queue = loadQueue.execute()
        pending = queue.pending.toMutableList()
        // Coming back to the same group (e.g. returning to the tab) keeps the place in it.
        if (pending.firstOrNull()?.id != shownBefore) {
            resetFocus()
        }
        focusedIndex = focusedIndex.coerceAtMost((pending.firstOrNull()?.members?.size ?: 1) - 1)
        deferredIds = queue.deferredIds
        totalGroups = queue.totalGroups
        decidedGroups = queue.decidedGroups
        blockedReason = queue.blockedReason
        analysedAtMs = queue.analysedAtMs
        photosAnalysed = queue.photosAnalysed
        photosNotAnalysed = queue.photosNotAnalysed
        loaded = true
        publish()
        preload()
    }

    /** Previews for the current group and the next two, so deciding never waits on the network. */
    private fun preload() {
        val items = pending.take(3).flatMap { group -> group.members.map { it.photo.item } }
        viewModelScope.launch {
            items.forEach { loadPreview(it) }
        }
    }

    private suspend fun loadPreview(item: InventoryItem) {
        if (item.mediaKey in previews || item.mediaKey in previewErrors) return
        try {
            val bytes = fetchPreview.execute(item, PREVIEW_PX).image.bytes
            previews[item.mediaKey] = Image.makeFromEncoded(bytes).toComposeImageBitmap()
            while (previews.size > PREVIEW_CACHE) previews.remove(previews.keys.first())
        } catch (e: ConnectorException) {
            // Connection problems are retried when Google Photos is reachable again; only real failures stick.
            if (!e.isTransient()) previewErrors[item.mediaKey] = "Preview unavailable"
            log.warn("Preview failed: {}", e.javaClass.simpleName)
        } catch (e: IllegalArgumentException) {
            previewErrors[item.mediaKey] = "Preview could not be decoded"
        }
        publish()
    }

    /** Starts with the proposals, except photos the user already decided on in an earlier version of this moment. */
    private fun selectionOf(group: DuplicateGroup): MutableSet<String> = selections.getOrPut(group.id) {
        group.members.filter { it.role == MemberRole.PROPOSED && !it.previouslyReviewed }.map { it.photo.item.mediaKey }.toMutableSet()
    }

    private fun publish() {
        val group = pending.firstOrNull()
        mutableState.value = ReviewUiState(
            loadingText = if (!loaded && busy) "Finding duplicate groups…" else null,
            groupsText = if (!loaded) null else "%,d groups".format(totalGroups) +
                (analysedAtMs?.let { " · last analysed ${timeFormat.format(it)}" } ?: ""),
            progressText = if (!loaded) null else "%,d decided · %,d to go".format(decidedGroups, pending.size) +
                if (deferredIds.isNotEmpty()) " (%,d skipped)".format(deferredIds.size) else "",
            // Answers "do I need to scan for duplicates again?" after a new library scan.
            analysisText = when {
                !loaded || blockedReason != null -> null
                photosNotAnalysed == 0 -> "All %,d photos are analysed. A duplicate scan is only needed after new photos are added.".format(photosAnalysed)
                else -> "%,d photos are not analysed yet: new since the last duplicate scan, or their preview could not be loaded. Scan for duplicates to include them.".format(photosNotAnalysed)
            },
            analysisTone = if (photosNotAnalysed > 0) StatusTone.CAUTION else StatusTone.POSITIVE,
            blockedText = blockedReason,
            emptyText = if (loaded && blockedReason == null && group == null) "No groups left to review." else null,
            queueText = queueText(queue),
            queueWaitingText = queue?.waitingReason,
            previewsPausedText = photos.pausedReason(),
            group = group?.let(::groupUi),
            notice = notice,
            viewerSelectionText = viewerSelection(group)?.first,
            viewerSelectionTone = viewerSelection(group)?.second ?: StatusTone.NEUTRAL,
        )
    }

    private fun viewerSelection(group: DuplicateGroup?): Pair<String, StatusTone>? {
        val key = viewer.state.value?.mediaKey ?: return null
        group ?: return null
        return when {
            key in selectionOf(group) -> "Selected for the trash" to StatusTone.NEGATIVE
            group.selectableMembers().any { it.photo.item.mediaKey == key } -> "Kept (not selected)" to StatusTone.POSITIVE
            else -> "Always kept" to StatusTone.NEUTRAL
        }
    }

    private fun groupUi(group: DuplicateGroup): GroupUi {
        val selected = selectionOf(group)
        val selectable = group.selectableMembers().map { it.photo.item.mediaKey }.toSet()
        // A moment decided before that gained photos: the new ones carry a badge.
        val returning = group.members.any { it.previouslyReviewed }
        val newCount = group.members.count { !it.previouslyReviewed }
        return GroupUi(
            title = "${timeFormat.format(group.takenAtMs)} · ${group.members.size} photos" +
                (if (returning) " · $newCount new since you decided this moment" else "") +
                if (group.id in deferredIds) " · skipped earlier" else "",
            selectionText = "${selected.size} of ${group.members.size} photo(s) selected for the trash",
            warningText = if (selected.size == group.members.size) "No photo of this moment will be kept." else null,
            tiles = group.members.mapIndexed { index, member ->
                tileUi(
                    member,
                    selected = member.photo.item.mediaKey in selected,
                    selectable = member.photo.item.mediaKey in selectable,
                    focused = allFocused || (ringVisible && index == focusedIndex),
                    newBadge = returning && !member.previouslyReviewed,
                )
            },
        )
    }

    private fun tileUi(member: GroupMember, selected: Boolean, selectable: Boolean, focused: Boolean, newBadge: Boolean): TileUi {
        val item = member.photo.item
        val (label, tone) = when {
            !selectable -> "KEEP · ${keepReasonLabel(member)}" to StatusTone.NEUTRAL
            member.role == MemberRole.KEEPER && selected -> "TRASH (was the recommended keeper)" to StatusTone.NEGATIVE
            member.role == MemberRole.KEEPER -> "KEEP (recommended)" to StatusTone.POSITIVE
            selected -> "TRASH" to StatusTone.NEGATIVE
            member.previouslyReviewed -> "KEEP (you kept it before)" to StatusTone.POSITIVE
            // Colour says what will happen: green is kept, whoever decided it.
            else -> "KEEP (your choice)" to StatusTone.POSITIVE
        }
        return TileUi(
            mediaKey = item.mediaKey,
            image = previews[item.mediaKey],
            error = previewErrors[item.mediaKey],
            label = label,
            tone = tone,
            selectable = selectable,
            focusRingDp = if (focused) FOCUS_RING_DP else 0,
            newBadge = newBadge,
            similarityText = if (member.role == MemberRole.KEEPER) null else "%.1f%% similar".format(member.similarity * 100),
            reasons = member.reasons,
            caption = timeFormat.format(item.takenAtMs) +
                (member.photo.pixels?.let { " · %.1f MP".format(it / 1e6) } ?: ""),
            link = "https://photos.google.com/photo/${item.mediaKey}",
        )
    }

    private fun queueText(status: TrashQueueStatus?): String? {
        status ?: return null
        val c = status.counts
        fun n(state: TrashJobState) = c[state] ?: 0
        val prefix = if (status.simulated) "Trash queue (SIMULATED, nothing is sent to Google)" else "Trash queue"
        return "$prefix: %,d queued · %,d in trash · %,d blocked · %,d failed · %,d cancelled · %,d restored".format(
            n(TrashJobState.QUEUED) + n(TrashJobState.SENDING) + n(TrashJobState.UNCERTAIN),
            n(TrashJobState.COMPLETED),
            n(TrashJobState.BLOCKED),
            n(TrashJobState.FAILED),
            n(TrashJobState.CANCELLED),
            n(TrashJobState.RESTORED) + n(TrashJobState.RESTORE_REQUESTED),
        )
    }

    private companion object {
        const val TILE_DP = 300f
        const val TILE_GAP_DP = 12f
        const val FOCUS_RING_DP = 3
        const val PREVIEW_PX = 400
        const val PREVIEW_CACHE = 60
    }
}

data class ReviewUiState(
    /** Shown while the groups are built for the first time. */
    val loadingText: String?,
    /** "2,156 groups · last analysed …" */
    val groupsText: String?,
    /** "386 decided · 1,731 to go" */
    val progressText: String?,
    /** Whether a duplicate scan is needed: all photos analysed, or how many are not. */
    val analysisText: String?,
    val analysisTone: StatusTone,
    val blockedText: String?,
    val emptyText: String?,
    val queueText: String?,
    val queueWaitingText: String?,
    val previewsPausedText: String?,
    val group: GroupUi?,
    /** Feedback for the last key press; null when there is nothing to say. */
    val notice: NoticeUi?,
    val viewerSelectionText: String?,
    val viewerSelectionTone: StatusTone,
) {
    companion object {
        val Initial = ReviewUiState(null, null, null, null, StatusTone.NEUTRAL, null, null, null, null, null, null, null, null, StatusTone.NEUTRAL)
    }
}

data class GroupUi(val title: String, val selectionText: String, val warningText: String?, val tiles: List<TileUi>)

data class TileUi(
    val mediaKey: String,
    val image: ImageBitmap?,
    val error: String?,
    val label: String,
    val tone: StatusTone,
    val selectable: Boolean,
    /** 0 when not focused. */
    val focusRingDp: Int,
    /** A photo new to a moment the user decided before. */
    val newBadge: Boolean,
    val similarityText: String?,
    val reasons: List<String>,
    val caption: String,
    val link: String,
)
