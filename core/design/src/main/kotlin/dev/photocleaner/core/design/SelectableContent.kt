package dev.photocleaner.core.design

import androidx.compose.foundation.ContextMenuArea
import androidx.compose.foundation.ContextMenuItem
import androidx.compose.foundation.ContextMenuRepresentation
import androidx.compose.foundation.ContextMenuState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.LocalContextMenuRepresentation
import androidx.compose.foundation.text.LocalTextContextMenu
import androidx.compose.foundation.text.TextContextMenu
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember

/**
 * Makes all text in [content] selectable and copyable (drag, then Ctrl+C or right-click → Copy).
 *
 * Use it once, around the whole window: a second selection area inside it is what froze the
 * window. Context menus and dialogs are separate layers, yet they inherit the selection area;
 * a click on their text then started a selection across two layers and threw. Menus are kept
 * out of selection here, and a right-click only opens the menu when there is text to copy, so
 * right-clicking a photo does nothing.
 */
@OptIn(ExperimentalFoundationApi::class) // LocalTextContextMenu: the desktop hook for the text menu
@Composable
fun SelectableContent(content: @Composable () -> Unit) {
    val base = LocalContextMenuRepresentation.current
    CompositionLocalProvider(
        LocalContextMenuRepresentation provides remember(base) { UnselectableMenus(base) },
        LocalTextContextMenu provides CopyWhenSelected,
    ) {
        SelectionContainer(content = content)
    }
}

/** Menu text is never part of a selection. */
private class UnselectableMenus(private val base: ContextMenuRepresentation) : ContextMenuRepresentation {
    @Composable
    override fun Representation(state: ContextMenuState, items: () -> List<ContextMenuItem>) {
        DisableSelection { base.Representation(state, items) }
    }
}

/**
 * Selected text gets a "Copy" menu; elsewhere a right-click does nothing. Text fields keep
 * the full cut / copy / paste menu.
 */
@OptIn(ExperimentalFoundationApi::class)
private object CopyWhenSelected : TextContextMenu {
    @Composable
    override fun Area(textManager: TextContextMenu.TextManager, state: ContextMenuState, content: @Composable () -> Unit) {
        if (textManager.paste != null) {
            TextContextMenu.Default.Area(textManager, state, content)
            return
        }
        val copy = textManager.copy?.takeIf { it.enabled }
        ContextMenuArea(
            items = { listOfNotNull(copy?.let { ContextMenuItem("Copy", it.execute) }) },
            state = state,
            enabled = copy != null,
            content = content,
        )
    }
}
