package dev.photocleaner.core.design

import androidx.compose.ui.graphics.Color

/** Semantic tone of a status line; screens pick the colour through [color]. */
enum class StatusTone { POSITIVE, CAUTION, NEGATIVE, NEUTRAL }

fun StatusTone.color(): Color = when (this) {
    StatusTone.POSITIVE -> OutcomeColors.positive
    StatusTone.CAUTION -> OutcomeColors.caution
    StatusTone.NEGATIVE -> OutcomeColors.negative
    StatusTone.NEUTRAL -> OutcomeColors.neutral
}
