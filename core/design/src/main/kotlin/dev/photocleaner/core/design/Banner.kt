package dev.photocleaner.core.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * A condition that stops the screen from doing its job, with the way out next to it:
 * strongly tinted, bold, full width, unlike the lighter feedback [Notice].
 */
@Composable
fun Banner(text: String, tone: StatusTone, actionLabel: String? = null, onAction: (() -> Unit)? = null) {
    val colour = tone.color()
    val shape = RoundedCornerShape(8.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .background(colour.copy(alpha = 0.28f), shape)
            .border(2.dp, colour, shape)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("⚠", style = MaterialTheme.typography.titleLarge, color = colour)
        Text(text, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        if (actionLabel != null && onAction != null) {
            Button(
                modifier = Modifier.noKeyboardFocus(),
                onClick = onAction,
                colors = ButtonDefaults.buttonColors(containerColor = colour, contentColor = Color.Black),
            ) { Text(actionLabel) }
        }
    }
}
