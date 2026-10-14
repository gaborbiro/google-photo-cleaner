package dev.photocleaner.features.shared.duplicates

object Vectors {
    /** Cosine similarity of two L2-normalised vectors. */
    fun cosine(a: FloatArray, b: FloatArray): Double {
        require(a.size == b.size) { "Vectors differ in length (${a.size} vs ${b.size})" }
        var sum = 0.0
        for (i in a.indices) sum += a[i] * b[i]
        return sum
    }
}
