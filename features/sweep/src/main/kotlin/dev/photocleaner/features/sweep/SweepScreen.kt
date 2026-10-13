package dev.photocleaner.features.sweep

import androidx.compose.foundation.Image
import androidx.compose.foundation.VerticalScrollbar
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.rememberScrollbarAdapter
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.isShiftPressed
import androidx.compose.ui.input.pointer.onPointerEvent
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import dev.photocleaner.core.design.Banner
import dev.photocleaner.core.design.CollapsingHeaderLayout
import dev.photocleaner.core.design.focusRing
import dev.photocleaner.core.design.optionalBorder
import dev.photocleaner.core.design.HoverExpandButton
import dev.photocleaner.core.design.KeyShortcuts
import dev.photocleaner.core.design.NoticeToast
import dev.photocleaner.core.design.ActionBar
import dev.photocleaner.core.design.focusPop
import dev.photocleaner.core.design.StatusTone
import dev.photocleaner.core.design.color
import dev.photocleaner.core.design.noKeyboardFocus
import dev.photocleaner.core.design.pausesShortcutsWhileTyping
import dev.photocleaner.features.shared.viewer.PhotoViewerOverlay

/**
 * The search box on top, which folds away as the results scroll; the result count, sort
 * order, action buttons and feedback stay pinned above the photos.
 */
@OptIn(ExperimentalComposeUiApi::class) // onPointerEvent; LocalWindowInfo.keyboardModifiers, for shift-click
@Composable
fun SweepScreen(viewModel: SweepViewModel, onOpenScan: () -> Unit) {
    val state by viewModel.state.collectAsState()
    val viewer by viewModel.viewerState.collectAsState()
    val gridState = rememberLazyGridState()
    val gridFocus = remember { FocusRequester() }
    val windowInfo = LocalWindowInfo.current
    val uriHandler = LocalUriHandler.current
    // After a search, keys go to the results instead of the search box.
    LaunchedEffect(state.resultText != null && !state.searching) { if (state.tiles.isNotEmpty()) gridFocus.requestFocus() }
    // Up/down move by a whole row: the grid reports its column count.
    LaunchedEffect(gridState) { snapshotFlow { gridState.layoutInfo.maxSpan }.collect(viewModel::onColumnsMeasured) }
    // A new sort order starts at the top.
    LaunchedEffect(state.sort) { gridState.scrollToItem(0) }
    // Keep the focused photo on screen when moving with the keyboard.
    LaunchedEffect(state.focusedIndex) {
        if (gridState.layoutInfo.visibleItemsInfo.none { it.index == state.focusedIndex && it.offset.y >= 0 }) {
            gridState.scrollToItem(state.focusedIndex)
        }
    }

    // Window-wide, so the keys keep working wherever keyboard focus went (except while typing a search).
    KeyShortcuts { key ->
        when (key) {
            Key.A -> viewModel.onFocusAll()
            Key.D -> viewModel.onApproveClicked()
            Key.Enter -> viewModel.onEnter()
            Key.Spacebar -> viewModel.onToggleFocused()
            Key.DirectionLeft -> viewModel.onFocusMove(-1, 0)
            Key.DirectionRight -> viewModel.onFocusMove(1, 0)
            Key.DirectionUp -> viewModel.onFocusMove(0, -1)
            Key.DirectionDown -> viewModel.onFocusMove(0, 1)
            Key.Escape -> viewModel.onCancelConfirm()
            else -> return@KeyShortcuts false
        }
        true
    }

    Box(Modifier.fillMaxSize()) {
        CollapsingHeaderLayout(
            modifier = Modifier.fillMaxSize(),
            header = { SearchInputs(state, viewModel) },
            pinned = {
                // Clicking here takes the keyboard away from the search box, so letters act as shortcuts again.
                Box(Modifier.onPointerEvent(PointerEventType.Press, PointerEventPass.Initial) { gridFocus.requestFocus() }) {
                    SearchBar(state, viewModel, onOpenScan)
                }
            },
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .focusRequester(gridFocus)
                    .focusable()
                    .onPointerEvent(PointerEventType.Press, PointerEventPass.Initial) { gridFocus.requestFocus() },
            ) {
                LazyVerticalGrid(
                    state = gridState,
                    modifier = Modifier.fillMaxSize().padding(end = 14.dp),
                    columns = GridCells.Adaptive(160.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    items(state.tiles, key = { it.mediaKey }) { tile ->
                        LaunchedEffect(tile.mediaKey) { viewModel.onTileVisible(tile.index) }
                        val hover = remember { MutableInteractionSource() }
                        val hovered by hover.collectIsHoveredAsState()
                        Column {
                            Box(
                                Modifier
                                    .size(160.dp)
                                    .focusPop(tile.focusRingDp > 0)
                                    .focusRing(tile.focusRingDp)
                                    .optionalBorder(tile.borderDp, tile.borderTone.color())
                                    .background(MaterialTheme.colorScheme.surfaceVariant)
                                    .hoverable(hover)
                                    .noKeyboardFocus()
                                    .clickable { viewModel.onTileClicked(tile.index, windowInfo.keyboardModifiers.isShiftPressed) },
                                contentAlignment = Alignment.Center,
                            ) {
                                tile.image?.let { Image(it, contentDescription = tile.caption, modifier = Modifier.size(150.dp), contentScale = ContentScale.Crop) }
                                    ?: Text("…")
                                HoverExpandButton(visible = hovered) { viewModel.onOpenViewer(tile.index) }
                            }
                            Text(
                                tile.caption,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.noKeyboardFocus().clickable { uriHandler.openUri(tile.link) },
                            )
                        }
                    }
                    if (state.showMoreVisible) {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            Box(Modifier.fillMaxWidth().padding(vertical = 16.dp), contentAlignment = Alignment.Center) {
                                OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = viewModel::onShowMore, enabled = !state.searching) { Text("Show more") }
                            }
                        }
                    }
                }
                VerticalScrollbar(adapter = rememberScrollbarAdapter(gridState), modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight())
            }
        }
        // Feedback floats over the photos instead of pushing them down.
        NoticeToast(state.notice)
    }

    viewer?.let { ui ->
        PhotoViewerOverlay(
            ui = ui,
            selectionText = state.viewerSelectionText,
            selectionTone = state.viewerSelectionTone,
            onClose = viewModel::onViewerClose,
            onPrevious = viewModel::onViewerPrevious,
            onNext = viewModel::onViewerNext,
            onToggle = viewModel::onViewerToggle,
        )
    }
}

@Composable
private fun SearchInputs(state: SweepUiState, viewModel: SweepViewModel) {
    Column(Modifier.padding(top = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            "Describe what to search for (e.g. \"meal prep boxes in plastic containers\", \"printed documents\", \"screenshots\"). " +
                "The strongest matches among photos that are not protected are shown: favourites, photos in albums, archived " +
                "photos and photos of unknown status never appear. Click to select, shift-click to select a range. " +
                "Arrows move between photos, Enter or ⤢ (on hover) views large.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = state.query,
                onValueChange = viewModel::onQueryChange,
                label = { Text("Describe the photos") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { viewModel.onSearch() }),
                modifier = Modifier.width(520.dp)
                    .pausesShortcutsWhileTyping()
                    .onPreviewKeyEvent { if (it.key == Key.Enter && it.type == KeyEventType.KeyDown) { viewModel.onSearch(); true } else false },
            )
            Button(modifier = Modifier.noKeyboardFocus(), onClick = viewModel::onSearch, enabled = !state.searching) { Text("Search") }
            OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = viewModel::onMoreLikeSelected, enabled = !state.searching) { Text("More like selected") }
        }
        state.progressText?.let { text ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Text(text)
            }
        }
        state.hiddenText?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
}

/** Pinned above the photos: the actions, with how many matched and their order on the right. */
@Composable
private fun SearchBar(state: SweepUiState, viewModel: SweepViewModel, onOpenScan: () -> Unit) {
    Column(Modifier.padding(top = 12.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        state.blockedText?.let { text ->
            if (state.blockedByScan) Banner(text, StatusTone.CAUTION, actionLabel = "Open Scan library", onAction = onOpenScan)
            else Banner(text, StatusTone.CAUTION)
        }
        ActionBar(
            status = {
                state.resultText?.let { text ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text(text, fontWeight = FontWeight.SemiBold)
                        SingleChoiceSegmentedButtonRow {
                            SweepSort.entries.forEachIndexed { index, sort ->
                                SegmentedButton(
                                    selected = state.sort == sort,
                                    onClick = { viewModel.onSortSelected(sort) },
                                    shape = SegmentedButtonDefaults.itemShape(index, SweepSort.entries.size),
                                    modifier = Modifier.noKeyboardFocus(),
                                    // No checkmark: the filled segment already shows the choice, and labels stay on one line.
                                    icon = {},
                                ) { Text(sort.label, maxLines = 1, softWrap = false) }
                            }
                        }
                    }
                }
            },
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(modifier = Modifier.noKeyboardFocus(), onClick = viewModel::onApproveClicked) { Text("D · Trash selected") }
                OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = viewModel::onFocusAll) { Text("A · Focus all") }
                OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = viewModel::onToggleFocused) { Text("Space · Toggle trash") }
            }
        }
        state.confirmText?.let { text ->
            Card {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(text, color = StatusTone.NEGATIVE.color(), fontWeight = FontWeight.Bold)
                    Button(modifier = Modifier.noKeyboardFocus(), onClick = viewModel::onConfirm) { Text("Enter · Move to trash") }
                    OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = viewModel::onCancelConfirm) { Text("Esc · Cancel") }
                }
            }
        }
        state.previewsPausedText?.let { Text(it, color = StatusTone.CAUTION.color(), fontWeight = FontWeight.SemiBold) }
    }
}
