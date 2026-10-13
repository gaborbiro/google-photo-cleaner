package dev.photocleaner.core.design

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed

/**
 * Window-wide keyboard shortcuts. The window passes every key event here, and the
 * screen currently shown handles it, so shortcuts keep working wherever keyboard
 * focus happens to be (after closing a dialog, clicking a tab, selecting text…).
 * While a text field is being typed in, and for Ctrl/Alt combinations such as
 * Ctrl+C, keys are left alone.
 */
class KeyRouter {
    private val guard = KeyRepeatGuard()

    /** Registered handlers, newest last; only the newest gets keys (an open viewer over its screen). */
    private val handlers = mutableListOf<Pair<Any, (Key) -> Boolean>>()
    private var typing = false

    fun dispatch(event: KeyEvent): Boolean {
        if (typing) return false
        // Every event goes through the guard so key-ups are always seen.
        val key = guard.press(event) ?: return false
        if (event.isCtrlPressed || event.isAltPressed || event.isMetaPressed) return false
        return handlers.lastOrNull()?.second?.invoke(key) ?: false
    }

    /** Forget held keys, e.g. when the window loses focus and key-ups may be missed. */
    fun reset() = guard.reset()

    internal fun setTyping(typing: Boolean) {
        this.typing = typing
        guard.reset()
    }

    internal fun register(owner: Any, handler: (Key) -> Boolean) {
        handlers += owner to handler
        guard.reset()
    }

    internal fun unregister(owner: Any) {
        handlers.removeAll { it.first === owner }
    }
}

val LocalKeyRouter = staticCompositionLocalOf<KeyRouter> { error("No KeyRouter provided") }

/**
 * Makes [onKey] receive the window's key presses while this composable is shown, taking
 * them over from shortcuts registered earlier (a viewer opened over a screen) until it
 * leaves. Return true when the key was handled. Holding a key down counts once.
 */
@Composable
fun KeyShortcuts(onKey: (Key) -> Boolean) {
    val router = LocalKeyRouter.current
    val current = rememberUpdatedState(onKey)
    DisposableEffect(router) {
        val owner = Any()
        router.register(owner) { current.value(it) }
        onDispose { router.unregister(owner) }
    }
}

/** For text fields: while this field has focus, letters and arrows type and edit instead of acting as shortcuts. */
@Composable
fun Modifier.pausesShortcutsWhileTyping(): Modifier {
    val router = LocalKeyRouter.current
    DisposableEffect(router) { onDispose { router.setTyping(false) } }
    return onFocusChanged { router.setTyping(it.isFocused) }
}
