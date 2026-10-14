package dev.photocleaner.features.shared.duplicates

/**
 * SHA-256 (FIPS 180-4), written out so group ids are the same on every platform: the desktop
 * used java.security.MessageDigest, which JavaScript doesn't have synchronously.
 */
internal object Sha256 {
    private val K = intArrayOf(
        0x428a2f98, 0x71374491, 0xb5c0fbcfL.toInt(), 0xe9b5dba5L.toInt(),
        0x3956c25b, 0x59f111f1, 0x923f82a4L.toInt(), 0xab1c5ed5L.toInt(),
        0xd807aa98L.toInt(), 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1feL.toInt(), 0x9bdc06a7L.toInt(), 0xc19bf174L.toInt(),
        0xe49b69c1L.toInt(), 0xefbe4786L.toInt(), 0x0fc19dc6, 0x240ca1cc,
        0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152L.toInt(), 0xa831c66dL.toInt(), 0xb00327c8L.toInt(), 0xbf597fc7L.toInt(),
        0xc6e00bf3L.toInt(), 0xd5a79147L.toInt(), 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92eL.toInt(), 0x92722c85L.toInt(),
        0xa2bfe8a1L.toInt(), 0xa81a664bL.toInt(), 0xc24b8b70L.toInt(), 0xc76c51a3L.toInt(),
        0xd192e819L.toInt(), 0xd6990624L.toInt(), 0xf40e3585L.toInt(), 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
        0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814L.toInt(), 0x8cc70208L.toInt(),
        0x90befffaL.toInt(), 0xa4506cebL.toInt(), 0xbef9a3f7L.toInt(), 0xc67178f2L.toInt(),
    )

    fun digest(message: ByteArray): ByteArray {
        val h = intArrayOf(0x6a09e667, 0xbb67ae85L.toInt(), 0x3c6ef372, 0xa54ff53aL.toInt(), 0x510e527f, 0x9b05688cL.toInt(), 0x1f83d9ab, 0x5be0cd19)
        val bitLength = message.size.toLong() * 8
        val padded = ByteArray(((message.size + 8) / 64 + 1) * 64)
        message.copyInto(padded)
        padded[message.size] = 0x80.toByte()
        for (i in 0 until 8) padded[padded.size - 1 - i] = (bitLength ushr (8 * i)).toByte()
        val w = IntArray(64)
        for (block in padded.indices step 64) {
            for (t in 0 until 16) {
                val o = block + t * 4
                w[t] = (padded[o].toInt() and 0xff shl 24) or (padded[o + 1].toInt() and 0xff shl 16) or
                    (padded[o + 2].toInt() and 0xff shl 8) or (padded[o + 3].toInt() and 0xff)
            }
            for (t in 16 until 64) {
                val s0 = w[t - 15].rotateRight(7) xor w[t - 15].rotateRight(18) xor (w[t - 15] ushr 3)
                val s1 = w[t - 2].rotateRight(17) xor w[t - 2].rotateRight(19) xor (w[t - 2] ushr 10)
                w[t] = w[t - 16] + s0 + w[t - 7] + s1
            }
            var a = h[0]; var b = h[1]; var c = h[2]; var d = h[3]
            var e = h[4]; var f = h[5]; var g = h[6]; var hh = h[7]
            for (t in 0 until 64) {
                val s1 = e.rotateRight(6) xor e.rotateRight(11) xor e.rotateRight(25)
                val ch = (e and f) xor (e.inv() and g)
                val temp1 = hh + s1 + ch + K[t] + w[t]
                val s0 = a.rotateRight(2) xor a.rotateRight(13) xor a.rotateRight(22)
                val maj = (a and b) xor (a and c) xor (b and c)
                val temp2 = s0 + maj
                hh = g; g = f; f = e; e = d + temp1
                d = c; c = b; b = a; a = temp1 + temp2
            }
            h[0] += a; h[1] += b; h[2] += c; h[3] += d
            h[4] += e; h[5] += f; h[6] += g; h[7] += hh
        }
        return ByteArray(32) { i -> (h[i / 4] ushr (24 - 8 * (i % 4))).toByte() }
    }
}
