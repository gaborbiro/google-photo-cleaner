package dev.photocleaner.core.design

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

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
        Text("⤢", color = Color.White, fontSize = 18.sp)
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
