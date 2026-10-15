package dev.photocleaner.core.design

import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.test.Test
import kotlin.test.assertEquals

class PhotoDateFormatTest {

    private val format = PhotoDateFormat("d MMM yyyy", ZoneId.of("Europe/London"))

    private fun ms(text: String) = ZonedDateTime.parse(text).toInstant().toEpochMilli()

    @Test
    fun `a camera's unset clock is never shown as a date`() {
        // Seen in the library: 1 Jan 1980 00:00 written in UTC+1, which is 31 Dec 1979 in London.
        assertEquals("Date unknown", format.format(ms("1980-01-01T00:00:04+01:00")))
        assertEquals("Date unknown", format.format(ms("1980-01-01T00:00:00-10:00")))
        assertEquals("Date unknown", format.format(ms("1970-01-01T00:00:00Z")))
    }

    @Test
    fun `real dates are shown`() {
        assertEquals("24 May 2025", format.format(ms("2025-05-24T21:00:07+01:00")))
        // A midnight-adjacent instant distinguishes the configured zone from UTC.
        assertEquals("25 May 2025", format.format(ms("2025-05-25T00:30:00+01:00")))
        assertEquals("3 Jan 1980", format.format(ms("1980-01-03T12:00:00Z")))
    }
}
