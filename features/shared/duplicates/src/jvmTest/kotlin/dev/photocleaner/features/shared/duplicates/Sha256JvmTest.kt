package dev.photocleaner.features.shared.duplicates

import java.security.MessageDigest
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertContentEquals

/** Group ids must never change (decisions are saved under them): the same digest as java.security's. */
class Sha256JvmTest {

    @Test
    fun matches_java_for_every_length_across_block_boundaries() {
        val random = Random(7)
        for (length in 0..300) {
            val message = random.nextBytes(length)
            assertContentEquals(MessageDigest.getInstance("SHA-256").digest(message), Sha256.digest(message), "length $length")
        }
    }
}
