package dev.photocleaner.core.design

import androidx.compose.animation.core.animate
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.onPointerEvent
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Constraints
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * How much of the header is scrolled away, in pixels. Pure scroll mechanics, like a
 * scroll state: it only changes in response to the user scrolling.
 */
class CollapsingHeaderState {
    /** Pixels of the header currently hidden; 0 is fully shown. */
    var hiddenPx by mutableFloatStateOf(0f)
        private set

    /** The header's full height, known after the first layout. */
    var headerHeightPx = 0
        internal set

    private var animation: Job? = null

    /** Hides [px] more of the header (negative shows it again); returns the part used. */
    internal fun hideBy(px: Float): Float {
        animation?.cancel()
        val used = px.coerceIn(-hiddenPx, headerHeightPx - hiddenPx)
        hiddenPx += used
        return used
    }

    /** Slides the header fully open or fully away. */
    internal fun animateTo(scope: CoroutineScope, shown: Boolean) {
        val target = if (shown) 0f else headerHeightPx.toFloat()
        if (hiddenPx == target) return
        animation?.cancel()
        animation = scope.launch { animate(hiddenPx, target) { value, _ -> hiddenPx = value } }
    }

    internal val connection = object : NestedScrollConnection {
        // Scrolling down: the header rises away first, then the content scrolls.
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset =
            if (available.y < 0) consumed(hideBy(-available.y)) else Offset.Zero

        // Scrolling up: only once the content is back at its top does the header come back.
        override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset =
            if (available.y > 0) consumed(hideBy(-available.y)) else Offset.Zero

        /** Hiding moves the header up, the same direction as the scroll it uses. */
        private fun consumed(hiddenPx: Float) = if (hiddenPx == 0f) Offset.Zero else Offset(0f, -hiddenPx)
    }
}

/**
 * A [header] that rises and fades away as the [content] scrolls down, a [pinned] bar
 * below it that always stays visible, and the [content], which fills the rest and must
 * scroll itself. The header only comes back when the user scrolls up past the top of the
 * content; switching to shorter content does not bring it back.
 */
@OptIn(ExperimentalComposeUiApi::class) // onPointerEvent
@Composable
fun CollapsingHeaderLayout(
    modifier: Modifier = Modifier,
    state: CollapsingHeaderState = remember { CollapsingHeaderState() },
    header: @Composable () -> Unit,
    pinned: @Composable () -> Unit,
    content: @Composable () -> Unit,
) {
    val scope = rememberCoroutineScope()
    Column(
        modifier
            .nestedScroll(state.connection)
            // A wheel turn nothing scrolled (content too short to scroll, or the pointer
            // over the header or tabs) still moves the header, so it can always be brought back.
            .onPointerEvent(PointerEventType.Scroll, PointerEventPass.Final) { event ->
                val change = event.changes.firstOrNull() ?: return@onPointerEvent
                if (change.isConsumed) return@onPointerEvent
                when {
                    change.scrollDelta.y < 0 -> state.animateTo(scope, shown = true)
                    change.scrollDelta.y > 0 -> state.animateTo(scope, shown = false)
                }
            },
    ) {
        Box(
            Modifier
                .clipToBounds()
                .layout { measurable, constraints ->
                    val placeable = measurable.measure(constraints.copy(minHeight = 0, maxHeight = Constraints.Infinity))
                    state.headerHeightPx = placeable.height
                    val hidden = state.hiddenPx.roundToInt().coerceIn(0, placeable.height)
                    layout(placeable.width, placeable.height - hidden) { placeable.place(0, -hidden) }
                }
                .graphicsLayer {
                    alpha = if (state.headerHeightPx == 0) 1f else 1f - (state.hiddenPx / state.headerHeightPx).coerceIn(0f, 1f)
                },
        ) { header() }
        pinned()
        Box(Modifier.weight(1f)) { content() }
    }
}
