package dev.photocleaner.features.scan

import dev.photocleaner.features.scan.model.ScanTiming
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class ScanSpeedTextTest {

    private val mapper = ScanUiMapper()

    @Test
    fun `shows where the scan's time went`() {
        val timing = ScanTiming(requests = 10, googleMs = 6_800, pauseMs = 3_000, elapsedMs = 10_000)
        assertEquals(
            "Where the time goes: waiting for Google 68% (0.7 s per answer) · pause between requests 30% · this computer 2%",
            mapper.speedText(timing),
        )
        assertNotNull(mapper.speedHint(timing), "a network-bound scan says so")
    }

    @Test
    fun `does not blame the network when this computer took the time`() {
        val timing = ScanTiming(requests = 10, googleMs = 3_000, pauseMs = 3_000, elapsedMs = 10_000)
        assertEquals(
            "Where the time goes: waiting for Google 30% (0.3 s per answer) · pause between requests 30% · this computer 40%",
            mapper.speedText(timing),
        )
        assertNull(mapper.speedHint(timing))
    }

    @Test
    fun `nothing is said before a scan ran long enough to measure`() {
        assertNull(mapper.speedText(null))
        assertNull(mapper.speedText(ScanTiming(requests = 2, googleMs = 500, pauseMs = 600, elapsedMs = 1_200)))
        assertNull(mapper.speedHint(ScanTiming(requests = 0, googleMs = 0, pauseMs = 0, elapsedMs = 60_000)))
    }
}
