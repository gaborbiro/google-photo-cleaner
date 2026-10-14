package dev.photocleaner.repositories.analysis.domain

/** Identifies how an embedding was produced; embeddings are only comparable within one key. */
data class EmbeddingModelKey(val model: String, val revision: String, val tokenBudget: Int, val previewSizePx: Int) {
    val id: String get() = "$model@${revision.take(12)}/t$tokenBudget/p$previewSizePx"
}

data class StoredQuality(
    val sharpness: Double,
    val brightness: Double,
    val clippedDark: Double,
    val clippedBright: Double,
    val width: Int,
    val height: Int,
)

class StoredEmbedding(
    val mediaKey: String,
    val dedupKey: String,
    val modelKeyId: String,
    /** L2-normalised. */
    val vector: FloatArray,
    val quality: StoredQuality,
    val createdAtMs: Long,
)

/** Facts about the original file, from the library listing. */
data class PhotoInfo(val mediaKey: String, val uploadedAtMs: Long?, val width: Int?, val height: Int?)

enum class PairKind {
    /** Consecutive photos taken close together: where duplicates live. */
    NEAR,

    /** Photos taken far apart: a baseline of clearly different pairs. */
    FAR,
}

enum class PairLabel {
    /** The same photo: identical, re-saved, resized or lightly edited. */
    SAME,

    /** The same moment (burst, retake); only one is worth keeping. */
    NEAR_DUPLICATE,

    /** Different photos; keep both. */
    DIFFERENT,
}

data class CalibrationPair(
    val pairId: String,
    val mediaKeyA: String,
    val mediaKeyB: String,
    val kind: PairKind,
    val takenGapMs: Long,
    /** Random presentation order, so labels are not given in score order. */
    val order: Int,
    val label: PairLabel?,
    val labelledAtMs: Long?,
)
