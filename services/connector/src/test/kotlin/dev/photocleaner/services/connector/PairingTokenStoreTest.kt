package dev.photocleaner.services.connector

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class PairingTokenStoreTest {

    private val file = Files.createTempDirectory("pc-token").resolve("pairing-token")

    @Test
    fun `persists the token across restarts`() {
        val first = PairingTokenStore(file).token.value
        assertEquals(first, PairingTokenStore(file).token.value)
        assertTrue(first.length >= 43)
    }

    @Test
    fun `regenerating replaces the token on disk`() {
        val store = PairingTokenStore(file)
        val old = store.token.value
        store.regenerate()
        assertNotEquals(old, store.token.value)
        assertEquals(store.token.value, PairingTokenStore(file).token.value)
        assertFalse(store.matches(old))
        assertTrue(store.matches(store.token.value))
    }

    @Test
    fun `refuses a corrupt token file`() {
        Files.createDirectories(file.parent)
        Files.writeString(file, "short")
        assertFailsWith<IllegalStateException> { PairingTokenStore(file) }
    }
}
