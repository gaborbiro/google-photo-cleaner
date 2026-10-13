package dev.photocleaner.services.connector

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import dev.photocleaner.services.connector.domain.BridgeState
import dev.photocleaner.services.connector.domain.ConnectorException
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.http.HttpHeaders
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.slf4j.LoggerFactory

class BridgeModuleTest {

    private val config = BridgeConfig(port = 47613, helloTimeoutMs = 2_000)
    private val tokens = PairingTokenStore(Files.createTempDirectory("pc-test").resolve("token"))
    private val link = ExtensionLink(requestTimeoutMs = 5_000)
    private val logs = ListAppender<ILoggingEvent>()
    private val rootLogger = LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME) as Logger

    @BeforeTest
    fun captureLogs() {
        logs.start()
        rootLogger.addAppender(logs)
    }

    @AfterTest
    fun releaseLogs() {
        rootLogger.detachAppender(logs)
        val text = logs.list.joinToString("\n") { it.formattedMessage }
        assertTrue(tokens.token.value !in text, "pairing token must never be logged")
        assertTrue("WRONG-TOKEN" !in text, "presented tokens must never be logged")
    }

    private fun bridgeTest(block: suspend ApplicationTestBuilder.() -> Unit) = testApplication {
        application { bridgeModule(config, tokens, link) }
        block()
    }

    private fun ApplicationTestBuilder.wsClient() = createClient { install(WebSockets) }

    private fun HttpRequestBuilder.extension(host: String = "127.0.0.1:${config.port}") {
        header(HttpHeaders.Origin, config.allowedOrigin)
        header(HttpHeaders.Host, host)
    }

    private fun hello(token: String) ="""{"t":"hello","token":"$token","extensionVersion":"0.1.0"}"""

    @Test
    fun `health answers on loopback and refuses foreign hosts`() = bridgeTest {
        val ok = client.get("/health") { header(HttpHeaders.Host, "127.0.0.1:${config.port}") }
        assertEquals(HttpStatusCode.OK, ok.status)
        assertEquals("ok", ok.bodyAsText())
        val foreign = client.get("/health") { header(HttpHeaders.Host, "rebind.example:${config.port}") }
        assertEquals(HttpStatusCode.Forbidden, foreign.status)
    }

    @Test
    fun `rejects an unexpected origin`() = bridgeTest {
        assertFailsWith<Exception> {
            wsClient().webSocket("/bridge", request = { header(HttpHeaders.Origin, "https://evil.example") }) {
                send(Frame.Text(hello(tokens.token.value)))
                incoming.receive()
            }
        }
        assertEquals(BridgeState.Starting, link.state.value)
    }

    @Test
    fun `rejects a foreign host even with the right origin`() = bridgeTest {
        assertFailsWith<Exception> {
            wsClient().webSocket("/bridge", request = { extension(host = "rebind.example:${config.port}") }) {
                send(Frame.Text(hello(tokens.token.value)))
                incoming.receive()
            }
        }
        assertEquals(BridgeState.Starting, link.state.value)
    }

    @Test
    fun `rejects a missing origin`() = bridgeTest {
        assertFailsWith<Exception> {
            wsClient().webSocket("/bridge") { incoming.receive() }
        }
    }

    @Test
    fun `closes the connection when the token is wrong`() = bridgeTest {
        wsClient().webSocket("/bridge", request = { extension() }) {
            send(Frame.Text(hello("WRONG-TOKEN")))
            val reason = closeReason.await()
            assertEquals(TOKEN_REJECTED_CODE, reason?.code)
        }
        assertIs<BridgeState.Starting>(link.state.value)
    }

    @Test
    fun `closes the connection when no hello arrives`() = bridgeTest {
        wsClient().webSocket("/bridge", request = { extension() }) {
            assertEquals(TOKEN_REJECTED_CODE, closeReason.await()?.code)
        }
    }

    @Test
    fun `round-trips a command after pairing`() = bridgeTest {
        wsClient().webSocket("/bridge", request = { extension() }) {
            send(Frame.Text(hello(tokens.token.value)))
            assertTrue((incoming.receive() as Frame.Text).readText().contains("welcome"))
            assertIs<BridgeState.ExtensionConnected>(link.state.value)

            coroutineScope {
                val response = async { link.request("status", buildJsonObject { put("x", 1) }) }
                val command = (incoming.receive() as Frame.Text).readText()
                val id = kotlinx.serialization.json.Json.parseToJsonElement(command).jsonObject["id"]!!.jsonPrimitive.content
                send(Frame.Text("""{"t":"result","id":"$id","result":{"ok":true,"data":{"answer":42}}}"""))
                assertEquals("42", response.await().jsonObject["answer"]!!.jsonPrimitive.content)
            }
        }
    }

    @Test
    fun `maps extension errors to connector exceptions`() = bridgeTest {
        wsClient().webSocket("/bridge", request = { extension() }) {
            send(Frame.Text(hello(tokens.token.value)))
            incoming.receive()
            coroutineScope {
                val response = async { runCatching { link.request("listLibraryPage", buildJsonObject { }) } }
                val command = (incoming.receive() as Frame.Text).readText()
                val id = kotlinx.serialization.json.Json.parseToJsonElement(command).jsonObject["id"]!!.jsonPrimitive.content
                send(Frame.Text("""{"t":"result","id":"$id","result":{"ok":false,"error":{"kind":"RATE_LIMIT","message":"HTTP 429","httpStatus":429}}}"""))
                val error = response.await().exceptionOrNull()
                assertIs<ConnectorException.RateLimited>(error)
                assertEquals(429, error.httpStatus)
            }
        }
    }

    @Test
    fun `fails a malformed result instead of waiting for the timeout`() = bridgeTest {
        wsClient().webSocket("/bridge", request = { extension() }) {
            send(Frame.Text(hello(tokens.token.value)))
            incoming.receive()
            coroutineScope {
                val response = async { runCatching { link.request("status", buildJsonObject { }) } }
                val command = (incoming.receive() as Frame.Text).readText()
                val id = kotlinx.serialization.json.Json.parseToJsonElement(command).jsonObject["id"]!!.jsonPrimitive.content
                send(Frame.Text("""{"t":"result","id":"$id","result":{"ok":"maybe"}}"""))
                assertIs<ConnectorException.ProtocolMismatch>(response.await().exceptionOrNull())
            }
        }
    }

    @Test
    fun `fails pending requests when the extension disconnects`() = bridgeTest {
        coroutineScope {
            val testScope = this
            wsClient().webSocket("/bridge", request = { extension() }) {
                send(Frame.Text(hello(tokens.token.value)))
                incoming.receive()
                // Launched outside the client session's scope, which closing the socket cancels.
                val response = testScope.async { runCatching { link.request("status", buildJsonObject { }) } }
                incoming.receive() // the command
                close()
                assertIs<ConnectorException.NotConnected>(response.await().exceptionOrNull())
            }
        }
    }

    @Test
    fun `requests fail fast when no extension is connected`() = bridgeTest {
        assertFailsWith<ConnectorException.NotConnected> { link.request("status", buildJsonObject { }) }
    }

    @Test
    fun `a regenerated token disconnects the extension and rejects the old token`() = bridgeTest {
        val oldToken = tokens.token.value
        wsClient().webSocket("/bridge", request = { extension() }) {
            send(Frame.Text(hello(oldToken)))
            incoming.receive()
            KtorBridgeServer(config, tokens, link).regeneratePairingToken()
            closeReason.await()
        }
        wsClient().webSocket("/bridge", request = { extension() }) {
            send(Frame.Text(hello(oldToken)))
            assertEquals(TOKEN_REJECTED_CODE, closeReason.await()?.code)
        }
    }
}
