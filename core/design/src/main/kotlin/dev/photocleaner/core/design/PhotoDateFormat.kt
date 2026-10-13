package dev.photocleaner.core.design

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.abs

/**
 * Formats when a photo was taken. A camera whose clock was never set stamps its factory
 * default (1 Jan 1980, the old DOS/FAT date zero, or 1 Jan 1970); such a date is not
 * when the photo was taken, so it is shown as "Date unknown" instead.
 */
class PhotoDateFormat(pattern: String, zone: ZoneId = ZoneId.systemDefault()) {
    private val formatter = DateTimeFormatter.ofPattern(pattern).withZone(zone)

    fun format(takenAtMs: Long): String =
        if (isCameraDefault(takenAtMs)) UNKNOWN else formatter.format(Instant.ofEpochMilli(takenAtMs))

    companion object {
        const val UNKNOWN = "Date unknown"

        /** Midnight UTC of the factory-default dates; cameras write them in local time, hence the slack. */
        private val DEFAULTS_MS = listOf(0L, 315_532_800_000L)

        /** Time zones span UTC−12 to UTC+14. */
        private const val ANY_TIME_ZONE_MS = 14 * 3_600_000L

        fun isCameraDefault(takenAtMs: Long): Boolean = DEFAULTS_MS.any { abs(takenAtMs - it) <= ANY_TIME_ZONE_MS }
    }
}
