package dev.photocleaner.services.connector

import dev.photocleaner.services.connector.domain.BridgeController
import dev.photocleaner.services.connector.domain.BridgeState
import io.ktor.server.cio.CIO
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import kotlinx.coroutines.flow.StateFlow
import org.slf4j.LoggerFactory

/** Embedded Ktor server bound to the loopback interface only. */
class KtorBridgeServer(
    private val config: BridgeConfig,
    private val tokens: PairingTokenStore,
    private val link: ExtensionLink,
) : BridgeController {

    private val log = LoggerFactory.getLogger(KtorBridgeServer::class.java)
    private var server: EmbeddedServer<*, *>? = null

    override val state: StateFlow<BridgeState> = link.state
    override val pairingToken: StateFlow<String> = tokens.token
    override val port: Int get() = config.port
    override val extensionId: String get() = config.extensionId
    override val expectedExtensionVersion: String get() = BridgeConfig.EXPECTED_EXTENSION_VERSION

    fun start() {
        check(server == null) { "Bridge already started" }
        try {
            server = embeddedServer(CIO, port = config.port, host = BridgeConfig.LOOPBACK_HOST) {
                bridgeModule(config, tokens, link)
            }.start(wait = false)
            link.markListening()
            log.info("Bridge listening on {}:{}", BridgeConfig.LOOPBACK_HOST, config.port)
        } catch (e: java.io.IOException) {
            log.error("Bridge could not start on port {}", config.port, e)
            link.markFailed("Could not listen on ${BridgeConfig.LOOPBACK_HOST}:${config.port} (${e.message})")
        }
    }

    fun stop() {
        server?.stop(gracePeriodMillis = 500, timeoutMillis = 2_000)
        server = null
    }

    override suspend fun regeneratePairingToken() {
        tokens.regenerate()
        link.disconnect("Pairing token changed")
    }
}
