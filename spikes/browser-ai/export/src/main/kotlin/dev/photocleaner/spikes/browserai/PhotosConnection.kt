package dev.photocleaner.spikes.browserai

import dev.photocleaner.core.storage.AppPaths
import dev.photocleaner.features.shared.embeddings.EmbeddingSettings
import dev.photocleaner.features.shared.previews.FetchPreviewUseCase
import dev.photocleaner.features.shared.previews.MonitorPhotosAvailabilityUseCase
import dev.photocleaner.features.shared.previews.PhotosAvailability
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.services.connector.BridgeConfig
import dev.photocleaner.services.connector.ExtensionLink
import dev.photocleaner.services.connector.ExtensionPhotosConnector
import dev.photocleaner.services.connector.KtorBridgeServer
import dev.photocleaner.services.connector.PairingTokenStore
import java.nio.file.Files
import java.nio.file.Path
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Starts the app's bridge, waits until the extension and a signed-in Photos tab are ready,
 * and saves each item's 512 px preview (as the desktop app embeds them) as `<id>.<ext>`.
 * The desktop app must be closed: it owns the same port.
 */
internal suspend fun savePreviews(paths: AppPaths, out: Path, items: List<Pair<String, InventoryItem>>): Map<String, String> {
    val config = BridgeConfig()
    val link = ExtensionLink(config.requestTimeoutMs)
    val server = KtorBridgeServer(config, PairingTokenStore(paths.pairingTokenFile), link)
    val connector = ExtensionPhotosConnector(link)
    server.start()
    try {
        println("Waiting for the browser extension and a signed-in photos.google.com tab…")
        val ready = withTimeoutOrNull(120_000) {
            MonitorPhotosAvailabilityUseCase(server, connector).execute().first { it is PhotosAvailability.Ready }
        }
        checkNotNull(ready) { "Google Photos did not become ready within 2 minutes (is the desktop app still running?)" }
        Files.createDirectories(out)
        val fetchPreview = FetchPreviewUseCase(connector, pacingMs = 100)
        val files = LinkedHashMap<String, String>()
        items.forEachIndexed { index, (id, item) ->
            val bytes = fetchPreview.execute(item, EmbeddingSettings.PREVIEW_SIZE_PX).image.bytes
            val file = "$id.${extensionOf(bytes)}"
            Files.write(out.resolve(file), bytes)
            files[id] = file
            print("\rSaved ${index + 1} of ${items.size} photos")
        }
        println()
        return files
    } finally {
        server.stop()
    }
}

private fun extensionOf(bytes: ByteArray): String = when {
    bytes.size > 3 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte() -> "jpg"
    bytes.size > 12 && String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP" -> "webp"
    bytes.size > 4 && bytes[0] == 0x89.toByte() && String(bytes, 1, 3, Charsets.US_ASCII) == "PNG" -> "png"
    else -> error("Unknown image format (first bytes ${bytes.take(4)})")
}

internal fun jsonArray(vector: FloatArray): String = vector.joinToString(",", "[", "]") { it.toString() }
