package dev.photocleaner.features.shared.duplicates

import kotlin.math.abs
import kotlin.math.floor

/** "86.1": one decimal, halves rounded up, as the desktop's "%.1f" printed it (no locale grouping). */
internal fun oneDecimal(value: Double): String {
    val tenths = floor(abs(value) * 10 + 0.5).toLong()
    val sign = if (value < 0 && tenths != 0L) "-" else ""
    return "$sign${tenths / 10}.${tenths % 10}"
}

/** Lowercase hex, two digits per byte. */
internal fun ByteArray.hex(): String = joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
