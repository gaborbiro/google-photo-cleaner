package dev.photocleaner.core.design

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * A border [widthDp] wide, or none at all for 0. Compose treats a 0 dp border as a
 * one-pixel hairline (Dp.Hairline), which drew a faint white line around every photo.
 */
fun Modifier.optionalBorder(widthDp: Int, color: Color): Modifier =
    if (widthDp > 0) border(widthDp.dp, color) else this

/** The white keyboard-focus ring outside a tile's own border; nothing when [widthDp] is 0. */
fun Modifier.focusRing(widthDp: Int): Modifier =
    if (widthDp > 0) border(widthDp.dp, FocusRingColor).padding(widthDp.dp) else this
