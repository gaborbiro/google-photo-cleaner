package dev.photocleaner.core.design

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * Feedback for the last key press or click. [sequence] changes with every message, also
 * when the same text is said again, so the toast can show and glow each time.
 */
data class NoticeUi(val text: String, val tone: StatusTone, val sequence: Int)

/** Hands out [NoticeUi]s with a fresh sequence number each time; kept by view models. */
class NoticeSource {
    private var sequence = 0

    fun next(text: String, tone: StatusTone): NoticeUi = NoticeUi(text, tone, ++sequence)
}

/**
 * The latest [notice] as a toast in the bottom-right corner, over the content: it never
 * pushes the screen down, and it fades out after a few seconds, so an old message cannot
 * linger once it no longer applies. A repeat of the same message shows and glows again.
 */
@Composable
fun BoxScope.NoticeToast(notice: NoticeUi?) {
    var shown by remember { mutableStateOf<NoticeUi?>(null) }
    var visible by remember { mutableStateOf(false) }
    val glow = remember { Animatable(0f) }
    LaunchedEffect(notice?.sequence) {
        if (notice == null) {
            visible = false
            return@LaunchedEffect
        }
        shown = notice
        visible = true
        glow.snapTo(1f)
        glow.animateTo(0f, tween(durationMillis = GLOW_MS))
        // Longer messages stay a little longer.
        delay((BASE_VISIBLE_MS + notice.text.length * PER_CHAR_MS).coerceAtMost(MAX_VISIBLE_MS))
        visible = false
    }
    AnimatedVisibility(
        visible = visible,
        modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
        enter = fadeIn() + slideInVertically { it / 2 },
        exit = fadeOut(),
    ) {
        val current = shown ?: return@AnimatedVisibility
        val colour = current.tone.color()
        val shape = RoundedCornerShape(10.dp)
        Text(
            current.text,
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier
                .widthIn(max = 480.dp)
                // Opaque, as it sits over photos; tinted by the message's tone.
                .background(MaterialTheme.colorScheme.surfaceContainerHigh, shape)
                .background(colour.copy(alpha = 0.18f + 0.30f * glow.value), shape)
                .border(BorderStroke(1.5.dp, colour), shape)
                .padding(horizontal = 16.dp, vertical = 12.dp),
        )
    }
}

private const val GLOW_MS = 900
private const val BASE_VISIBLE_MS = 2_500L
private const val PER_CHAR_MS = 40L
private const val MAX_VISIBLE_MS = 7_000L
