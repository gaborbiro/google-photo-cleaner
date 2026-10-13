package dev.photocleaner.services.inference

import dev.photocleaner.services.inference.domain.EmbedResult
import dev.photocleaner.services.inference.domain.EmbeddedImage
import dev.photocleaner.services.inference.domain.FailedImage
import dev.photocleaner.services.inference.domain.ImageQuality
import dev.photocleaner.services.inference.domain.InferenceException
import dev.photocleaner.services.inference.domain.InferenceWorker
import dev.photocleaner.services.inference.domain.WorkerImage
import dev.photocleaner.services.inference.domain.WorkerInfo
import java.io.BufferedWriter
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import java.nio.file.Path
import java.util.Base64
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.slf4j.LoggerFactory

/**
 * Runs the Python worker (`worker/`) as a child process speaking JSON lines on
 * stdin/stdout. One request is in flight at a time. The process starts on first
 * use and is restarted after a crash; Hugging Face is kept offline so inference
 * never reaches the network.
 */
class ProcessInferenceWorker(
    private val config: WorkerConfig,
) : InferenceWorker, AutoCloseable {

    private val log = LoggerFactory.getLogger(ProcessInferenceWorker::class.java)
    private val json = Json { ignoreUnknownKeys = true }
    private val mutex = Mutex()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var running: RunningWorker? = null
    private var nextId = 0L

    override suspend fun info(): WorkerInfo {
        val data = request("info", buildJsonObject { }, config.startupTimeoutMs)
        return decode(WorkerInfoDto.serializer(), data).let {
            WorkerInfo(it.model, it.revision, it.device, it.gpu, it.dtype, it.torch)
        }
    }

    override suspend fun embed(images: List<WorkerImage>, tokenBudget: Int): EmbedResult {
        require(images.isNotEmpty() && images.size <= InferenceWorker.MAX_IMAGES_PER_REQUEST) { "1..${InferenceWorker.MAX_IMAGES_PER_REQUEST} images per request" }
        require(tokenBudget in InferenceWorker.TOKEN_BUDGETS) { "Unsupported token budget $tokenBudget" }
        val encoder = Base64.getEncoder()
        val params = buildJsonObject {
            put("tokenBudget", tokenBudget)
            put("images", buildJsonArray {
                images.forEach { image ->
                    add(buildJsonObject {
                        put("key", image.key)
                        put("base64", encoder.encodeToString(image.bytes))
                    })
                }
            })
        }
        // The first call also loads the model.
        val timeout = if (running == null) config.startupTimeoutMs + config.requestTimeoutMs else config.requestTimeoutMs
        val dto = decode(EmbedResultDto.serializer(), request("embed", params, timeout))
        return EmbedResult(
            items = dto.items.map { item ->
                EmbeddedImage(
                    key = item.key,
                    vector = decodeHalfFloats(item.embedding),
                    quality = item.quality.let { ImageQuality(it.sharpness, it.brightness, it.clipped_dark, it.clipped_bright, it.width, it.height) },
                )
            },
            failed = dto.failed.map { FailedImage(it.key, it.reason) },
        )
    }

    override suspend fun embedText(texts: List<String>): List<FloatArray> {
        require(texts.isNotEmpty() && texts.size <= 16) { "1..16 texts per request" }
        val params = buildJsonObject { put("texts", buildJsonArray { texts.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } }) }
        val timeout = if (running == null) config.startupTimeoutMs + config.requestTimeoutMs else config.requestTimeoutMs
        return decode(TextVectorsDto.serializer(), request("embedText", params, timeout)).vectors.map(::decodeHalfFloats)
    }

    override fun close() {
        running?.let { stop(it) }
        running = null
    }

    private suspend fun request(op: String, params: JsonObject, timeoutMs: Long): JsonElement = mutex.withLock {
        val worker = running?.takeIf { it.process.isAlive } ?: start().also { running = it }
        val id = ++nextId
        val line = buildJsonObject {
            put("id", id)
            put("op", op)
            put("params", params)
        }.toString()
        try {
            withContext(Dispatchers.IO) {
                worker.stdin.write(line)
                worker.stdin.newLine()
                worker.stdin.flush()
            }
        } catch (e: IOException) {
            stop(worker)
            running = null
            throw InferenceException.Crashed("The worker stopped accepting requests (${worker.exitDescription()})")
        }
        // withTimeoutOrNull only reacts to its own deadline; a caller's cancellation
        // (pause, an outer timeout) propagates and leaves the worker running.
        val response = withTimeoutOrNull(timeoutMs) { awaitResponse(worker, id) } ?: run {
            stop(worker)
            running = null
            throw InferenceException.Crashed("The worker did not answer $op within ${timeoutMs / 1000} s and was stopped")
        }
        if (response.ok) {
            return response.data ?: throw InferenceException.Crashed("Successful $op response without data")
        }
        val error = response.error ?: throw InferenceException.Crashed("Failed $op response without an error")
        throw when (error.kind) {
            "BAD_REQUEST" -> InferenceException.BadRequest(error.message)
            else -> InferenceException.Internal(error.message)
        }
    }

    /**
     * Reads responses until the one for [id]. A caller that was cancelled (e.g. the user
     * paused) leaves its answer unread; such stale answers have lower ids and are skipped.
     */
    private suspend fun awaitResponse(worker: RunningWorker, id: Long): ResponseDto {
        while (true) {
            val line = worker.stdout.receive()
            if (line == null) {
                running = null
                throw InferenceException.Crashed("The worker exited (${worker.exitDescription()})")
            }
            val response = try {
                json.decodeFromString(ResponseDto.serializer(), line)
            } catch (e: SerializationException) {
                stop(worker)
                running = null
                throw InferenceException.Crashed("The worker wrote something that is not a protocol response")
            }
            val responseId = response.id
            when {
                responseId == id -> return response
                responseId != null && responseId < id -> log.debug("Discarded the answer to abandoned request {}", responseId)
                else -> {
                    stop(worker)
                    running = null
                    throw InferenceException.Crashed("The worker answered request $responseId instead of $id")
                }
            }
        }
    }

    private fun start(): RunningWorker {
        val python = config.pythonExecutable
        if (!Files.isRegularFile(python)) {
            throw InferenceException.Unavailable("Worker environment not found at $python. Set it up as described in worker/README.md.")
        }
        val process = try {
            ProcessBuilder(python.toString(), "-m", "photocleaner_worker")
                .directory(config.workerDir.toFile())
                .also { builder ->
                    builder.environment()["HF_HUB_OFFLINE"] = "1"
                    builder.environment()["HF_HUB_DISABLE_TELEMETRY"] = "1"
                    builder.environment()["PYTHONUNBUFFERED"] = "1"
                    builder.environment()["PYTHONIOENCODING"] = "utf-8"
                    if (config.fakeEmbedder) {
                        builder.environment()["PHOTOCLEANER_FAKE_EMBEDDER"] = "1"
                        builder.environment()["PHOTOCLEANER_FAKE_DELAY_MS"] = config.fakeDelayMs.toString()
                    }
                }
                .start()
        } catch (e: IOException) {
            throw InferenceException.Unavailable("Could not start the worker: ${e.message}", e)
        }
        log.info("Inference worker started (pid {})", process.pid())
        val lines = Channel<String?>(Channel.UNLIMITED)
        scope.launch {
            process.inputStream.bufferedReader(Charsets.UTF_8).useLines { sequence -> sequence.forEach { lines.send(it) } }
            lines.send(null)
        }
        scope.launch {
            process.errorStream.bufferedReader(Charsets.UTF_8).useLines { sequence ->
                sequence.forEach { line ->
                    if (line.contains("Error") || line.contains("Traceback")) log.warn("worker: {}", line.take(500)) else log.debug("worker: {}", line.take(500))
                }
            }
        }
        return RunningWorker(process, process.outputStream.bufferedWriter(Charsets.UTF_8), lines)
    }

    private fun stop(worker: RunningWorker) {
        worker.process.destroy()
        if (!worker.process.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)) worker.process.destroyForcibly()
        log.info("Inference worker stopped ({})", worker.exitDescription())
    }

    private fun <T> decode(serializer: kotlinx.serialization.KSerializer<T>, data: JsonElement): T = try {
        json.decodeFromJsonElement(serializer, data)
    } catch (e: SerializationException) {
        throw InferenceException.Crashed("Unexpected worker data (${e.javaClass.simpleName})")
    }

    private class RunningWorker(val process: Process, val stdin: BufferedWriter, val stdout: Channel<String?>) {
        fun exitDescription(): String = if (process.isAlive) "still running" else "exit code ${process.exitValue()}"
    }

    @Serializable
    private data class ResponseDto(val id: Long? = null, val ok: Boolean, val data: JsonElement? = null, val error: ErrorDto? = null)

    @Serializable
    private data class ErrorDto(val kind: String, val message: String)

    @Serializable
    private data class WorkerInfoDto(val model: String, val revision: String, val device: String, val gpu: String? = null, val dtype: String, val torch: String)

    @Serializable
    private data class EmbedResultDto(val items: List<ItemDto>, val failed: List<FailedDto>)

    @Serializable
    private data class ItemDto(val key: String, val embedding: String, val quality: QualityDto)

    @Suppress("PropertyName")
    @Serializable
    private data class QualityDto(
        val sharpness: Double,
        val brightness: Double,
        val clipped_dark: Double,
        val clipped_bright: Double,
        val width: Int,
        val height: Int,
    )

    @Serializable
    private data class TextVectorsDto(val vectors: List<String>)

    @Serializable
    private data class FailedDto(val key: String? = null, val reason: String)

    companion object {
        /** Little-endian IEEE half floats, as written by the worker. */
        fun decodeHalfFloats(base64: String): FloatArray {
            val bytes = Base64.getDecoder().decode(base64)
            check(bytes.size % 2 == 0) { "Odd number of embedding bytes" }
            val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
            return FloatArray(buffer.remaining()) { java.lang.Float.float16ToFloat(buffer.get(it)) }
        }
    }
}

data class WorkerConfig(
    val workerDir: Path,
    val startupTimeoutMs: Long = 5 * 60_000,
    val requestTimeoutMs: Long = 5 * 60_000,
    /** Test only: the worker answers with deterministic vectors without loading a model. */
    val fakeEmbedder: Boolean = false,
    /** Test only: how long the fake embedder takes per request. */
    val fakeDelayMs: Long = 0,
) {
    val pythonExecutable: Path get() = workerDir.resolve(".venv").resolve("Scripts").resolve("python.exe")
}
