package dev.photocleaner.core.design

import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type

/**
 * Turns raw key events into one action per physical press: auto-repeat events
 * of a held key are ignored until the key is released, so holding a key can
 * never trigger an action twice.
 */
class KeyRepeatGuard {
    private val held = mutableSetOf<Key>()

    /** Returns the key when this event is a fresh press that should trigger an action, otherwise null. */
    fun press(event: KeyEvent): Key? = when (event.type) {
        KeyEventType.KeyDown -> if (held.add(event.key)) event.key else null
        KeyEventType.KeyUp -> {
            held.remove(event.key)
            null
        }
        else -> null
    }

    /** Forget held keys, e.g. when the window loses focus and key-up events may be missed. */
    fun reset() = held.clear()
}
