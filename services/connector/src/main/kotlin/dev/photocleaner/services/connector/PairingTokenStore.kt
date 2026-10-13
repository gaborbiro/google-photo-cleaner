package dev.photocleaner.services.connector

import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** The shared secret the extension presents. Persisted so pairing survives restarts. */
class PairingTokenStore(private val file: Path) {

    private val current = MutableStateFlow(loadOrCreate())

    val token: StateFlow<String> = current.asStateFlow()

    fun matches(candidate: String): Boolean =
        MessageDigest.isEqual(candidate.toByteArray(Charsets.UTF_8), current.value.toByteArray(Charsets.UTF_8))

    fun regenerate() {
        val token = newToken()
        write(token)
        current.value = token
    }

    private fun loadOrCreate(): String {
        if (Files.exists(file)) {
            val stored = Files.readString(file).trim()
            check(stored.length >= MIN_TOKEN_LENGTH) { "Pairing token file is corrupt: $file" }
            return stored
        }
        return newToken().also(::write)
    }

    private fun write(token: String) {
        Files.createDirectories(file.parent)
        Files.writeString(file, token)
    }

    private fun newToken(): String {
        val bytes = ByteArray(TOKEN_BYTES).also(SecureRandom()::nextBytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private companion object {
        const val TOKEN_BYTES = 32
        const val MIN_TOKEN_LENGTH = 32
    }
}
