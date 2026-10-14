package dev.photocleaner.features.shared.duplicates

import dev.photocleaner.features.shared.duplicates.calibration.CalibrationReports
import dev.photocleaner.features.shared.duplicates.calibration.LabelledScore
import dev.photocleaner.repositories.analysis.domain.PairLabel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SmallRulesTest {

    @Test
    fun sha256_matches_the_standard_test_vectors() {
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", Sha256.digest(ByteArray(0)).hex())
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", Sha256.digest("abc".encodeToByteArray()).hex())
        // 56 bytes: the length no longer fits in the first block.
        assertEquals(
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
            Sha256.digest("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".encodeToByteArray()).hex(),
        )
    }

    @Test
    fun one_decimal_rounds_like_the_desktop_printed() {
        assertEquals("98.5", oneDecimal(98.4807753))
        assertEquals("92.5", oneDecimal(92.5))
        assertEquals("12.0", oneDecimal(12.0))
        assertEquals("0.0", oneDecimal(0.04))
        assertEquals("100.0", oneDecimal(99.96))
        assertEquals("-1.5", oneDecimal(-1.46))
    }

    @Test
    fun the_threshold_grid_runs_from_0_700_to_0_995() {
        assertEquals(60, CalibrationReports.GRID.size)
        assertEquals(0.7, CalibrationReports.GRID.first())
        assertEquals(0.995, CalibrationReports.GRID.last())
        assertEquals(0.925, CalibrationReports.GRID[45])
    }

    @Test
    fun the_recommended_threshold_is_the_first_one_above_every_different_pair() {
        val labelled = listOf(
            LabelledScore(PairLabel.SAME, 0.99), LabelledScore(PairLabel.NEAR_DUPLICATE, 0.95), LabelledScore(PairLabel.NEAR_DUPLICATE, 0.91),
            LabelledScore(PairLabel.DIFFERENT, 0.912), LabelledScore(PairLabel.DIFFERENT, 0.80),
        )
        val report = CalibrationReports.report(140, labelled)
        assertEquals(0.915, report.recommendedThreshold)
        val row = report.rows.single { it.threshold == 0.915 }
        assertEquals(0, row.falsePositives)
        assertEquals(1.0, row.precision)
        assertEquals(2.0 / 3, row.recall)
        assertEquals(1.0, row.sameRecall)
        assertEquals(0.99, report.lowestSame)
        assertEquals(0.91, report.lowestNearDuplicate)
        assertTrue(report.rows.single { it.threshold == 0.91 }.falsePositives == 1)
    }

    @Test
    fun without_different_labels_there_is_no_recommendation() {
        assertNull(CalibrationReports.report(140, listOf(LabelledScore(PairLabel.SAME, 0.99))).recommendedThreshold)
    }
}
