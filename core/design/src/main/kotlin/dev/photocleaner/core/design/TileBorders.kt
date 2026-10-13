package dev.photocleaner.core.design

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp

/**
 * A border [widthDp] wide, or none at all for 0. Compose treats a 0 dp border as a
 * one-pixel hairline (Dp.Hairline), which drew a faint white line around every photo.
 */
fun Modifier.optionalBorder(widthDp: Int, color: Color): Modifier =
    if (widthDp > 0) border(widthDp.dp, color) else this

/**
 * The white keyboard-focus ring outside a tile's own border, drawn when [widthDp] is above 0.
 * Its space is always reserved, so the photo does not shift when focus arrives or leaves.
 */
fun Modifier.focusRing(widthDp: Int): Modifier =
    (if (widthDp > 0) border(widthDp.dp, FocusRingColor) else this).padding(FOCUS_RING_SPACE)

private val FOCUS_RING_SPACE = 3.dp

/**
 * A quick "pop" when a tile gains focus: the eye notices movement far better than a new
 * outline, so it finds the focused photo at once.
 */
@Composable
fun Modifier.focusPop(focused: Boolean): Modifier {
    val scale = remember { Animatable(1f) }
    LaunchedEffect(focused) {
        if (focused) {
            scale.snapTo(POP_SCALE)
            scale.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessMediumLow))
        }
    }
    return graphicsLayer {
        scaleX = scale.value
        scaleY = scale.value
    }
}

private const val POP_SCALE = 1.05f
