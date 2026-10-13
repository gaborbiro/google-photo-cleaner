package dev.photocleaner.services.inference

import dev.photocleaner.services.inference.domain.InferenceException
import dev.photocleaner.services.inference.domain.WorkerImage
import java.awt.Color
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.nio.file.Path
import javax.imageio.ImageIO
import kotlin.math.sqrt
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Runs the real worker process from `worker/.venv` with its fake embedder, so the
 * protocol, process handling and float16 decoding are exercised without a GPU.
 */
class ProcessInferenceWorkerTest {

    private val workerDir = Path.of("../../worker").toAbsolutePath().normalize()
    private val worker = ProcessInferenceWorker(WorkerConfig(workerDir, startupTimeoutMs = 60_000, requestTimeoutMs = 60_000, fakeEmbedder = true))

    @AfterTest
    fun stop() = worker.close()

    private fun png(colour: Color): ByteArray {
        val image = BufferedImage(16, 12, BufferedImage.TYPE_INT_RGB)
        val g = image.createGraphics()
        g.color = colour
        g.fillRect(0, 0, 16, 12)
        g.dispose()
        return ByteArrayOutputStream().also { ImageIO.write(image, "png", it) }.toByteArray()
    }

    @Test
    fun `reports worker info`(): Unit = runBlocking {
        assertEquals("fake", worker.info().model)
    }

    @Test
    fun `embeds images into unit vectors with quality and reports undecodable ones`(): Unit = runBlocking {
        val result = worker.embed(
            listOf(
                WorkerImage("red", png(Color.RED)),
                WorkerImage("red-again", png(Color.RED)),
                WorkerImage("blue", png(Color.BLUE)),
                WorkerImage("junk", "not an image".toByteArray()),
            ),
            tokenBudget = 70,
        )
        val vectors = result.items.associate { it.key to it.vector }
        assertEquals(setOf("red", "red-again", "blue"), vectors.keys)
        assertEquals("junk", result.failed.single().key)
        val norm = sqrt(vectors.getValue("red").sumOf { (it * it).toDouble() })
        assertTrue(kotlin.math.abs(norm - 1.0) < 0.01)
        val same = dot(vectors.getValue("red"), vectors.getValue("red-again"))
        val different = dot(vectors.getValue("red"), vectors.getValue("blue"))
        assertTrue(same > 0.999 && different < same)
        assertEquals(16, result.items.first().quality.width)
    }

    @Test
    fun `text queries land in the image space`(): Unit = runBlocking {
        val images = worker.embed(listOf(WorkerImage("red", png(Color.RED)), WorkerImage("blue", png(Color.BLUE))), tokenBudget = 70)
            .items.associate { it.key to it.vector }
        val (query) = worker.embedText(listOf("red things"))
        assertTrue(dot(query, images.getValue("red")) > dot(query, images.getValue("blue")))
    }

    @Test
    fun `the worker keeps serving after a bad request`(): Unit = runBlocking {
        worker.info()
        assertFailsWith<IllegalArgumentException> { worker.embed(listOf(WorkerImage("a", png(Color.RED))), tokenBudget = 99) }
        assertEquals("fake", worker.info().model)
    }

    @Test
    fun `a request abandoned mid-flight does not break the next one`(): Unit = runBlocking {
        // Reproduces pausing the analysis while the GPU is busy, then resuming.
        val slow = ProcessInferenceWorker(WorkerConfig(workerDir, 60_000, 60_000, fakeEmbedder = true, fakeDelayMs = 1_500))
        try {
            slow.info()
            val abandoned = withTimeoutOrNull(300) { slow.embed(listOf(WorkerImage("a", png(Color.RED))), tokenBudget = 70) }
            assertEquals(null, abandoned)
            assertEquals("fake", slow.info().model)
            val result = slow.embed(listOf(WorkerImage("b", png(Color.BLUE))), tokenBudget = 70)
            assertEquals(listOf("b"), result.items.map { it.key })
        } finally {
            slow.close()
        }
    }

    @Test
    fun `a missing environment is reported as unavailable`(): Unit = runBlocking {
        val missing = ProcessInferenceWorker(WorkerConfig(Files.createTempDirectory("no-worker")))
        assertFailsWith<InferenceException.Unavailable> { missing.info() }
    }

    @Test
    fun `half floats decode exactly`() {
        // 1.0 = 0x3C00, -2.0 = 0xC000, 0.5 = 0x3800 (little endian)
        val bytes = byteArrayOf(0x00, 0x3C, 0x00, 0xC0.toByte(), 0x00, 0x38)
        val decoded = ProcessInferenceWorker.decodeHalfFloats(java.util.Base64.getEncoder().encodeToString(bytes))
        assertEquals(listOf(1.0f, -2.0f, 0.5f), decoded.toList())
    }

    private fun dot(a: FloatArray, b: FloatArray) = a.indices.sumOf { (a[it] * b[it]).toDouble() }
}
