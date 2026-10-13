package dev.photocleaner.features.shared.viewer

import dev.photocleaner.core.design.noKeyboardFocus
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.onPointerEvent
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.ui.window.DialogProperties
import dev.photocleaner.core.design.KeyRepeatGuard
import dev.photocleaner.core.design.KeyShortcuts
import dev.photocleaner.core.design.StatusTone
import dev.photocleaner.core.design.color

/**
 * Full-window photo viewer. Esc or right-click closes, ←/→ step through the list,
 * Del switches the photo between keep and trash when [onToggle] is given.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun PhotoViewerOverlay(
    ui: PhotoViewerUi,
    selectionText: String?,
    selectionTone: StatusTone,
    onClose: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onToggle: (() -> Unit)?,
) {
    val focus = remember { FocusRequester() }
    val guard = remember { KeyRepeatGuard() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val onKey: (Key) -> Boolean = { key ->
        when (key) {
            Key.Escape -> onClose()
            Key.DirectionLeft -> onPrevious()
            Key.DirectionRight -> onNext()
            Key.Delete -> onToggle?.invoke()
            // Every other key is swallowed while the viewer is open, so the grid underneath stays put.
            else -> Unit
        }
        true
    }
    // The dialog is drawn inside the main window, whose shortcuts see keys first:
    // while open, the viewer takes them over.
    KeyShortcuts(onKey)

    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        // The dialog is its own layer: selecting its text through the window's selection area would throw.
        DisableSelection { ViewerContent(ui, selectionText, selectionTone, onClose, onPrevious, onNext, onToggle, focus, guard, onKey) }
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun ViewerContent(
    ui: PhotoViewerUi,
    selectionText: String?,
    selectionTone: StatusTone,
    onClose: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onToggle: (() -> Unit)?,
    focus: FocusRequester,
    guard: KeyRepeatGuard,
    onKey: (Key) -> Boolean,
) {
    val uriHandler = LocalUriHandler.current
    Column(
        Modifier
            .fillMaxSize()
            .background(Color(0xF0101010))
            .focusRequester(focus)
            .focusable()
            .onFocusChanged { if (!it.hasFocus) guard.reset() }
            // Fallback for when the dialog gets a window of its own and the main window never sees the keys.
            .onPreviewKeyEvent { event -> guard.press(event)?.let(onKey) ?: false }
            .onPointerEvent(PointerEventType.Press) { if (it.buttons.isSecondaryPressed) onClose() }
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
            ui.image?.let { image ->
                // The frame hugs the photo: red trash, green kept, grey always kept.
                Image(
                    image,
                    contentDescription = ui.caption,
                    modifier = Modifier
                        .aspectRatio(ui.aspectRatio ?: 1f)
                        .border(BorderStroke(2.dp, selectionTone.color())),
                    contentScale = ContentScale.Fit,
                )
            } ?: Text("Loading…", color = Color.White)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("${ui.positionText} · ${ui.caption}", color = Color.White)
            selectionText?.let { Text(it, color = selectionTone.color(), fontWeight = FontWeight.Bold) }
            ui.statusText?.let { Text(it, color = Color.LightGray) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = onPrevious) { Text("← Previous") }
            OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = onNext) { Text("Next →") }
            onToggle?.let { Button(modifier = Modifier.noKeyboardFocus(), onClick = it) { Text("Del · Keep / trash") } }
            OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = { uriHandler.openUri(ui.link) }) { Text("Open in Google Photos") }
            Button(modifier = Modifier.noKeyboardFocus(), onClick = onClose) { Text("Esc · Close") }
        }
    }
}
