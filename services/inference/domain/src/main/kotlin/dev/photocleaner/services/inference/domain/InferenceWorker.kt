package dev.photocleaner.services.inference.domain

/** Local image embedding and quality measurement. Image bytes are only held in memory. */
interface InferenceWorker {

    suspend fun info(): WorkerInfo

    /** Embeds up to [MAX_IMAGES_PER_REQUEST] images; undecodable images are reported in [EmbedResult.failed]. */
    suspend fun embed(images: List<WorkerImage>, tokenBudget: Int): EmbedResult

    /** Search-query vectors in the same space as image embeddings, one per text (L2-normalised). */
    suspend fun embedText(texts: List<String>): List<FloatArray>

    companion object {
        const val MAX_IMAGES_PER_REQUEST = 64
        val TOKEN_BUDGETS = listOf(70, 140, 280, 560, 1120)
    }
}

data class WorkerInfo(
    val model: String,
    val revision: String,
    val device: String,
    val gpu: String?,
    val dtype: String,
    val torch: String,
)

class WorkerImage(val key: String, val bytes: ByteArray)

data class ImageQuality(
    val sharpness: Double,
    val brightness: Double,
    val clippedDark: Double,
    val clippedBright: Double,
    val width: Int,
    val height: Int,
)

/** [vector] is L2-normalised. */
class EmbeddedImage(val key: String, val vector: FloatArray, val quality: ImageQuality)

data class FailedImage(val key: String?, val reason: String)

class EmbedResult(val items: List<EmbeddedImage>, val failed: List<FailedImage>)

sealed class InferenceException(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** The worker could not be started (missing environment, Python error at start-up). */
    class Unavailable(message: String, cause: Throwable? = null) : InferenceException(message, cause)
    class BadRequest(message: String) : InferenceException(message)

    /** The worker reported an error while processing, e.g. out of GPU memory. */
    class Internal(message: String) : InferenceException(message)

    /** The worker process exited or produced output that is not protocol. */
    class Crashed(message: String) : InferenceException(message)
}
