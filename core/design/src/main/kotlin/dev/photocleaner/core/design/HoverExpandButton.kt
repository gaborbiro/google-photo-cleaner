package dev.photocleaner.core.design

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.unit.dp

/** The small "view large" button shown in a photo tile's corner while the mouse is over it. */
@Composable
fun BoxScope.HoverExpandButton(visible: Boolean, onClick: () -> Unit) {
    if (!visible) return
    Box(
        Modifier
            .align(Alignment.TopEnd)
            .padding(6.dp)
            .size(30.dp)
            .background(Color(0xCC000000), RoundedCornerShape(6.dp))
            .noKeyboardFocus()
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        ExpandIcon(Modifier.size(16.dp))
    }
}

/**
 * Two arrows pointing out to opposite corners. Drawn rather than typed: a text glyph
 * ("⤢") sits off-centre in its box, depending on the font.
 */
@Composable
private fun ExpandIcon(modifier: Modifier) {
    Canvas(modifier) {
        val stroke = 2.dp.toPx()
        val head = size.minDimension * 0.4f
        fun arrowTo(tip: Offset, towardsX: Float, towardsY: Float) {
            drawLine(Color.White, tip, Offset(tip.x + towardsX * head, tip.y), stroke, StrokeCap.Round)
            drawLine(Color.White, tip, Offset(tip.x, tip.y + towardsY * head), stroke, StrokeCap.Round)
        }
        val topRight = Offset(size.width, 0f)
        val bottomLeft = Offset(0f, size.height)
        drawLine(Color.White, topRight, bottomLeft, stroke, StrokeCap.Round)
        arrowTo(topRight, towardsX = -1f, towardsY = 1f)
        arrowTo(bottomLeft, towardsX = 1f, towardsY = -1f)
    }
}

/**
 * For buttons and photo tiles on keyboard-driven screens: they must not take keyboard
 * focus, otherwise Space or Enter would "press" whatever was clicked last (e.g. approve
 * again). The screens handle their own keys instead.
 */
fun Modifier.noKeyboardFocus(): Modifier = focusProperties { canFocus = false }

/** Colour of the keyboard focus ring around a photo tile. */
val FocusRingColor = Color.White
