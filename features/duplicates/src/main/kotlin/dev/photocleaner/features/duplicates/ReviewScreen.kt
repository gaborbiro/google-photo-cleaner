package dev.photocleaner.features.duplicates

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.photocleaner.core.design.focusRing
import dev.photocleaner.core.design.Banner
import dev.photocleaner.core.design.HoverExpandButton
import dev.photocleaner.core.design.NewBadge
import dev.photocleaner.core.design.KeyShortcuts
import dev.photocleaner.core.design.ActionBar
import dev.photocleaner.core.design.focusPop
import dev.photocleaner.core.design.StatusTone
import dev.photocleaner.core.design.color
import dev.photocleaner.core.design.noKeyboardFocus
import dev.photocleaner.features.shared.viewer.PhotoViewerOverlay

/**
 * Window-wide, so the keys keep working wherever keyboard focus went.
 * Left hand on A S D F, Z below; K and U remain as aliases from the original layout.
 * Arrows move the focus ring, Enter views large, Space switches keep/trash.
 */
@Composable
internal fun ReviewShortcuts(viewModel: ReviewViewModel) {
    KeyShortcuts { key ->
        when (key) {
            Key.D -> viewModel.onApprove()
            Key.F, Key.K -> viewModel.onKeep()
            Key.S -> viewModel.onDefer()
            Key.A -> viewModel.onFocusAll()
            Key.Z, Key.U -> viewModel.onUndo()
            Key.DirectionLeft -> viewModel.onFocusMove(-1, 0)
            Key.DirectionRight -> viewModel.onFocusMove(1, 0)
            Key.DirectionUp -> viewModel.onFocusMove(0, -1)
            Key.DirectionDown -> viewModel.onFocusMove(0, 1)
            Key.Enter -> viewModel.onOpenFocused()
            Key.Spacebar -> viewModel.onToggleFocused()
            else -> return@KeyShortcuts false
        }
        true
    }
}

/** Pinned above the photos: the actions, with the group's selection count on their right. */
@Composable
internal fun ReviewBar(state: ReviewUiState, viewModel: ReviewViewModel, onOpenScan: () -> Unit) {
    Column(Modifier.padding(top = 12.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // Every reason groups cannot be shown is fixed on the Scan library tab.
        state.blockedText?.let { Banner(it, StatusTone.CAUTION, actionLabel = "Open Scan library", onAction = onOpenScan) }
        ActionBar(
            status = {
                state.group?.let { group ->
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        group.warningText?.let { Text(it, color = StatusTone.NEGATIVE.color(), fontWeight = FontWeight.Bold) }
                        Text(group.selectionText, fontWeight = FontWeight.SemiBold)
                    }
                }
            },
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(modifier = Modifier.noKeyboardFocus(), onClick = viewModel::onApprove) { Text("D · Trash selected") }
                OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = viewModel::onKeep) { Text("F · Keep all") }
                OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = viewModel::onDefer) { Text("S · Skip") }
                OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = viewModel::onFocusAll) { Text("A · Focus all") }
                OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = viewModel::onToggleFocused) { Text("Space · Toggle trash") }
                OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = viewModel::onUndo) { Text("Z · Undo") }
                OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = viewModel::onSearchMoreLike) { Text("Search more like these") }
            }
        }
        state.previewsPausedText?.let { Text(it, color = StatusTone.CAUTION.color(), fontWeight = FontWeight.SemiBold) }
    }
}

/** The current group's photos; this is the part that scrolls. */
@Composable
internal fun ReviewContent(state: ReviewUiState, viewModel: ReviewViewModel) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        state.loadingText?.let { Text(it) }
        state.emptyText?.let { Text(it) }
        state.group?.let { GroupTiles(it, viewModel) }
    }
}

@Composable
internal fun ReviewViewer(state: ReviewUiState, viewModel: ReviewViewModel) {
    val viewer by viewModel.viewerState.collectAsState()
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

@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
private fun GroupTiles(group: GroupUi, viewModel: ReviewViewModel) {
    val uriHandler = LocalUriHandler.current
    val density = LocalDensity.current
    Card {
        FlowRow(
            Modifier.padding(16.dp).onSizeChanged { with(density) { viewModel.onGridWidthMeasured(it.width.toDp().value) } },
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            group.tiles.forEach { tile ->
                val hover = remember { MutableInteractionSource() }
                val hovered by hover.collectIsHoveredAsState()
                val bringIntoView = remember { BringIntoViewRequester() }
                LaunchedEffect(tile.focusRingDp) { if (tile.focusRingDp > 0) bringIntoView.bringIntoView() }
                Column(
                    Modifier.width(300.dp).bringIntoViewRequester(bringIntoView),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Box(
                        Modifier
                            .size(300.dp)
                            .focusPop(tile.focusRingDp > 0)
                            .focusRing(tile.focusRingDp)
                            .border(BorderStroke(3.dp, tile.tone.color()))
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .hoverable(hover)
                            .noKeyboardFocus()
                            // Any photo can be focused; only those that may go are switched (others are kept by rule).
                            .clickable {
                                viewModel.onTileFocused(tile.mediaKey)
                                if (tile.selectable) viewModel.onToggle(tile.mediaKey)
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        when {
                            tile.image != null -> Image(tile.image, contentDescription = tile.caption, modifier = Modifier.size(288.dp), contentScale = ContentScale.Fit)
                            tile.error != null -> Text(tile.error)
                            else -> Text("Loading…")
                        }
                        if (tile.newBadge) NewBadge(Modifier.align(Alignment.TopStart).padding(6.dp))
                        HoverExpandButton(visible = hovered) { viewModel.onOpenViewer(tile.mediaKey) }
                    }
                    Text(tile.label, color = tile.tone.color(), fontWeight = FontWeight.Bold)
                    tile.similarityText?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    tile.reasons.forEach { Text("· $it", style = MaterialTheme.typography.bodySmall) }
                    Text(tile.caption, style = MaterialTheme.typography.bodySmall)
                    TextButton(modifier = Modifier.noKeyboardFocus(), onClick = { uriHandler.openUri(tile.link) }) { Text("Open in Google Photos") }
                }
            }
        }
    }
}
