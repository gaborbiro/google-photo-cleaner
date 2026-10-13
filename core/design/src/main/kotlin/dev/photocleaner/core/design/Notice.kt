package dev.photocleaner.core.design

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Feedback for the last key press or click. [sequence] changes with every message, also
 * when the same text is said again, so the card can glow each time.
 */
data class NoticeUi(val text: String, val tone: StatusTone, val sequence: Int)

/** Hands out [NoticeUi]s with a fresh sequence number each time; kept by view models. */
class NoticeSource {
    private var sequence = 0

    fun next(text: String, tone: StatusTone): NoticeUi = NoticeUi(text, tone, ++sequence)
}

/**
 * A short message in a tinted card. Each new [notice] (a new message, or the same one
 * again) makes the card glow briefly and fade back, so every key press is answered.
 */
@Composable
fun Notice(notice: NoticeUi) {
    val glow = remember { Animatable(0f) }
    LaunchedEffect(notice.sequence) {
        glow.snapTo(1f)
        glow.animateTo(0f, tween(durationMillis = 1_200))
    }
    val colour = notice.tone.color()
    val shape = RoundedCornerShape(8.dp)
    Text(
        notice.text,
        fontWeight = FontWeight.SemiBold,
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier
            .fillMaxWidth()
            .background(colour.copy(alpha = 0.12f + 0.33f * glow.value), shape)
            .border(BorderStroke(1.dp, colour.copy(alpha = 0.6f)), shape)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    )
}
