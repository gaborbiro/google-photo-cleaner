package dev.photocleaner.services.connector

import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Keeps the app's expectations in line with the extension it ships with. */
class ExtensionManifestTest {

    private val manifest = Json.parseToJsonElement(
        Files.readString(Path.of("../../extension/static/manifest.json")),
    ).jsonObject

    @Test
    fun `expected extension version matches the manifest`() {
        assertEquals(manifest["version"]!!.jsonPrimitive.content, BridgeConfig.EXPECTED_EXTENSION_VERSION)
    }

    @Test
    fun `pinned extension id matches the manifest key`() {
        val der = java.util.Base64.getDecoder().decode(manifest["key"]!!.jsonPrimitive.content)
        val hex = java.security.MessageDigest.getInstance("SHA-256").digest(der).joinToString("") { "%02x".format(it) }
        val id = hex.take(32).map { 'a' + it.digitToInt(16) }.joinToString("")
        assertEquals(id, BridgeConfig.EXTENSION_ID)
    }

    @Test
    fun `pairing rejection code matches what the extension understands`() {
        val background = Files.readString(Path.of("../../extension/src/background/main.ts"))
        val code = Regex("TOKEN_REJECTED_CODE = ([0-9]+)").find(background)!!.groupValues[1].toShort()
        assertEquals(code, TOKEN_REJECTED_CODE)
    }
}
