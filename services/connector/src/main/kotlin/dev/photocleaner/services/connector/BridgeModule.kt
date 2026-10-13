package dev.photocleaner.services.connector

import dev.photocleaner.services.connector.wire.HelloMessage
import dev.photocleaner.services.connector.wire.OpErrorDto
import dev.photocleaner.services.connector.wire.OpResultDto
import dev.photocleaner.services.connector.wire.ResultMessage
import dev.photocleaner.services.connector.wire.WelcomeMessage
import dev.photocleaner.services.connector.wire.wireJson
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.createRouteScopedPlugin
import io.ktor.server.application.install
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import io.ktor.server.websocket.WebSockets
import io.ktor.server.websocket.pingPeriod
import io.ktor.server.websocket.timeout
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.slf4j.LoggerFactory

internal const val TOKEN_REJECTED_CODE: Short = 4401
internal const val APP_VERSION = "0.1.0"

private val log = LoggerFactory.getLogger("dev.photocleaner.services.connector.Bridge")

/** Rejects anything that is not the pinned extension talking to the loopback host. */
private fun originGuard(config: BridgeConfig) = createRouteScopedPlugin("ExtensionOriginGuard") {
    onCall { call ->
        val origin = call.request.headers[HttpHeaders.Origin]
        val host = call.request.headers[HttpHeaders.Host]
        if (origin != config.allowedOrigin || host !in config.allowedHosts) {
            log.warn("Rejected bridge connection: unexpected origin or host")
            call.respond(HttpStatusCode.Forbidden)
        }
    }
}

fun Application.bridgeModule(config: BridgeConfig, tokens: PairingTokenStore, link: ExtensionLink) {
    install(WebSockets) {
        pingPeriod = 15.seconds
        timeout = 45.seconds
        maxFrameSize = 32L * 1024 * 1024
    }
    routing {
        // Lets the extension check, without a WebSocket error, whether the app is running.
        // Carries no data; the Host check still blocks DNS-rebinding pages.
        get("/health") {
            if (call.request.headers[HttpHeaders.Host] in config.allowedHosts) {
                call.respondText("ok")
            } else {
                call.respond(HttpStatusCode.Forbidden)
            }
        }
        route("/bridge") {
            install(originGuard(config))
            webSocket {
                val hello = withTimeoutOrNull(config.helloTimeoutMs) {
                    (incoming.receiveCatching().getOrNull() as? Frame.Text)?.readText()
                }?.let { text ->
                    try {
                        wireJson.decodeFromString(HelloMessage.serializer(), text).takeIf { it.t == "hello" }
                    } catch (e: SerializationException) {
                        null
                    }
                }
                if (hello == null || !tokens.matches(hello.token)) {
                    log.warn("Rejected bridge connection: missing or wrong pairing token")
                    close(CloseReason(TOKEN_REJECTED_CODE, "Pairing token rejected"))
                    return@webSocket
                }

                link.attach(this, hello.extensionVersion)
                try {
                    send(Frame.Text(wireJson.encodeToString(WelcomeMessage.serializer(), WelcomeMessage(APP_VERSION))))
                    for (frame in incoming) {
                        if (frame !is Frame.Text) continue
                        val text = frame.readText()
                        val type = try {
                            wireJson.parseToJsonElement(text).jsonObject["t"]?.jsonPrimitive?.content
                        } catch (e: SerializationException) {
                            log.warn("Ignored a malformed message from the extension")
                            continue
                        } catch (e: IllegalArgumentException) {
                            log.warn("Ignored a malformed message from the extension")
                            continue
                        }
                        when (type) {
                            "result" -> try {
                                val result = wireJson.decodeFromString(ResultMessage.serializer(), text)
                                link.complete(result.id, result.result)
                            } catch (e: SerializationException) {
                                log.warn("Malformed result from the extension: {}", e.javaClass.simpleName)
                                val id = wireJson.parseToJsonElement(text).jsonObject["id"]?.jsonPrimitive?.content
                                if (id != null) {
                                    link.complete(id, OpResultDto(ok = false, error = OpErrorDto("PROTOCOL", "Result did not match the expected shape")))
                                }
                            }
                            "keepalive" -> Unit
                            else -> log.warn("Ignored an unknown message type from the extension")
                        }
                    }
                } finally {
                    link.detach(this)
                }
            }
        }
    }
}
