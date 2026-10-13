package dev.photocleaner.core.design

import androidx.compose.ui.InternalComposeUiApi
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// The KeyEvent(Key, KeyEventType) test constructor is marked internal to compose-ui; fine for a test pinned to one version.
@OptIn(InternalComposeUiApi::class)
class KeyRouterTest {

    private fun down(key: Key, ctrl: Boolean = false) = KeyEvent(key, KeyEventType.KeyDown, isCtrlPressed = ctrl)

    private fun up(key: Key, ctrl: Boolean = false) = KeyEvent(key, KeyEventType.KeyUp, isCtrlPressed = ctrl)

    private fun KeyRouter.tap(key: Key, ctrl: Boolean = false): Boolean {
        val handled = dispatch(down(key, ctrl))
        dispatch(up(key, ctrl))
        return handled
    }

    @Test
    fun `the newest shortcuts get the keys, and the earlier ones get them back when it leaves`() {
        val router = KeyRouter()
        val screen = mutableListOf<Key>()
        val viewer = mutableListOf<Key>()
        val screenOwner = Any()
        val viewerOwner = Any()
        router.register(screenOwner) { screen += it; true }
        router.register(viewerOwner) { viewer += it; true }

        router.tap(Key.DirectionRight)
        router.unregister(viewerOwner)
        router.tap(Key.DirectionRight)

        assertEquals(listOf(Key.DirectionRight), viewer)
        assertEquals(listOf(Key.DirectionRight), screen)
    }

    @Test
    fun `holding a key counts once`() {
        val router = KeyRouter()
        var presses = 0
        router.register(Any()) { presses++; true }
        repeat(5) { router.dispatch(down(Key.D)) }
        router.dispatch(up(Key.D))
        router.tap(Key.D)
        assertEquals(2, presses)
    }

    @Test
    fun `typing in a text field and ctrl combinations are left alone`() {
        val router = KeyRouter()
        var presses = 0
        router.register(Any()) { presses++; true }

        assertFalse(router.tap(Key.C, ctrl = true))
        router.setTyping(true)
        assertFalse(router.tap(Key.D))
        router.setTyping(false)
        assertTrue(router.tap(Key.D))
        assertEquals(1, presses)
    }
}
