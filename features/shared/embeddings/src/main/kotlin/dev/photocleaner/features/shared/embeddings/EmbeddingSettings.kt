package dev.photocleaner.features.shared.embeddings

import dev.photocleaner.repositories.analysis.domain.EmbeddingModelKey

object EmbeddingSettings {
    const val MODEL = "google/embeddinggemma-2"

    /** Must match MODEL_REVISION in worker/photocleaner_worker/embedder.py; checked against the worker at run time. */
    const val REVISION = "914f7f89142e33e77833254d9c9b90c3cef7303b"

    /** Longest side of the previews that are embedded. */
    const val PREVIEW_SIZE_PX = 512

    /** Budgets compared during calibration. */
    val CALIBRATION_BUDGETS = listOf(70, 280)

    fun modelKey(tokenBudget: Int) = EmbeddingModelKey(MODEL, REVISION, tokenBudget, PREVIEW_SIZE_PX)
}

object Vectors {
    /** Cosine similarity of two L2-normalised vectors. */
    fun cosine(a: FloatArray, b: FloatArray): Double {
        require(a.size == b.size) { "Vectors differ in length (${a.size} vs ${b.size})" }
        var sum = 0.0
        for (i in a.indices) sum += a[i] * b[i]
        return sum
    }
}
