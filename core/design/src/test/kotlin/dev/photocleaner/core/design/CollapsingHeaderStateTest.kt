package dev.photocleaner.core.design

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import kotlin.test.Test
import kotlin.test.assertEquals

class CollapsingHeaderStateTest {

    private val state = CollapsingHeaderState().apply { headerHeightPx = 200 }
    private val user = NestedScrollSource.UserInput

    // Scrolling down moves content up: negative y.
    private fun scrollDown(px: Float) = state.connection.onPreScroll(Offset(0f, -px), user)

    @Test
    fun `scrolling down hides the header before the content moves`() {
        val used = scrollDown(50f)
        assertEquals(Offset(0f, -50f), used)
        assertEquals(50f, state.hiddenPx)
    }

    @Test
    fun `once the header is gone the content gets the whole scroll`() {
        scrollDown(150f)
        val used = scrollDown(100f)
        assertEquals(Offset(0f, -50f), used, "only the last 50 px of header were left")
        assertEquals(200f, state.hiddenPx)
        assertEquals(Offset.Zero, scrollDown(30f))
    }

    @Test
    fun `scrolling up does not bring the header back while the content can still scroll up`() {
        scrollDown(200f)
        // The content consumed the whole upward scroll, nothing is left over.
        state.connection.onPreScroll(Offset(0f, 40f), user)
        state.connection.onPostScroll(Offset(0f, 40f), Offset.Zero, user)
        assertEquals(200f, state.hiddenPx)
    }

    @Test
    fun `scrolling up past the top of the content brings the header back`() {
        scrollDown(200f)
        val used = state.connection.onPostScroll(Offset.Zero, Offset(0f, 120f), user)
        assertEquals(Offset(0f, 120f), used)
        assertEquals(80f, state.hiddenPx)
        state.connection.onPostScroll(Offset.Zero, Offset(0f, 500f), user)
        assertEquals(0f, state.hiddenPx)
    }
}
