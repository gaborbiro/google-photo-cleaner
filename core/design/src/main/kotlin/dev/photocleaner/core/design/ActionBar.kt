package dev.photocleaner.core.design

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.dp

/**
 * The screen's [buttons] with a short [status] on the right of the same line. When the
 * window is too narrow for both, the status moves above the buttons instead of squeezing them.
 */
@Composable
fun ActionBar(modifier: Modifier = Modifier, status: @Composable () -> Unit, buttons: @Composable () -> Unit) {
    Layout(contents = listOf(buttons, status), modifier = modifier) { (buttonMeasurables, statusMeasurables), constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val buttonsPlaced = buttonMeasurables.map { it.measure(loose) }
        val statusPlaced = statusMeasurables.map { it.measure(loose) }
        val buttonsWidth = buttonsPlaced.maxOfOrNull { it.width } ?: 0
        val buttonsHeight = buttonsPlaced.maxOfOrNull { it.height } ?: 0
        val statusWidth = statusPlaced.maxOfOrNull { it.width } ?: 0
        val statusHeight = statusPlaced.maxOfOrNull { it.height } ?: 0
        val gap = GAP.roundToPx()
        val width = if (constraints.hasBoundedWidth) constraints.maxWidth else buttonsWidth + gap + statusWidth
        val oneLine = statusPlaced.isEmpty() || buttonsWidth + gap + statusWidth <= width
        if (oneLine) {
            val height = maxOf(buttonsHeight, statusHeight)
            layout(width, height) {
                buttonsPlaced.forEach { it.place(0, (height - it.height) / 2) }
                statusPlaced.forEach { it.place(width - it.width, (height - it.height) / 2) }
            }
        } else {
            val spacing = ROW_SPACING.roundToPx()
            layout(width, statusHeight + spacing + buttonsHeight) {
                statusPlaced.forEach { it.place(0, 0) }
                buttonsPlaced.forEach { it.place(0, statusHeight + spacing) }
            }
        }
    }
}

private val GAP = 24.dp
private val ROW_SPACING = 8.dp
