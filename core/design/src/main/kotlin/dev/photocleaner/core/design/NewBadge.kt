package dev.photocleaner.core.design

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** Mustard, like a supermarket "NEW" sticker. */
private val NewBadgeColor = Color(0xFFC9BE5C)

/** An old-school starburst "NEW" sticker, for a photo that has just turned up. */
@Composable
fun NewBadge(modifier: Modifier = Modifier, diameter: Dp = 60.dp) {
    Box(modifier.size(diameter), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(diameter)) {
            val points = 14
            val outer = size.minDimension / 2
            val inner = outer * 0.8f
            val star = Path().apply {
                for (i in 0 until points * 2) {
                    val radius = if (i % 2 == 0) outer else inner
                    val angle = (PI * i / points - PI / 2).toFloat()
                    val x = center.x + radius * cos(angle)
                    val y = center.y + radius * sin(angle)
                    if (i == 0) moveTo(x, y) else lineTo(x, y)
                }
                close()
            }
            drawPath(star, NewBadgeColor)
        }
        DisableSelection {
            Text(
                "NEW",
                color = Color.White,
                fontWeight = FontWeight.Black,
                fontSize = (diameter.value * 0.27f).sp,
                modifier = Modifier.rotate(-24f),
            )
        }
    }
}
