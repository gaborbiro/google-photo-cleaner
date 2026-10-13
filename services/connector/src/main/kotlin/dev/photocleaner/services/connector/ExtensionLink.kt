package dev.photocleaner.services.connector

import dev.photocleaner.services.connector.domain.BridgeState
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.services.connector.wire.CommandMessage
import dev.photocleaner.services.connector.wire.OpErrorDto
import dev.photocleaner.services.connector.wire.OpResultDto
import dev.photocleaner.services.connector.wire.wireJson
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.WebSocketSession
import io.ktor.websocket.close
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import org.slf4j.LoggerFactory

/** The single authenticated extension connection and its in-flight requests. */
class ExtensionLink(private val requestTimeoutMs: Long) {

    private val log = LoggerFactory.getLogger(ExtensionLink::class.java)
    private val mutex = Mutex()
    private var session: WebSocketSession? = null
    private val pending = ConcurrentHashMap<String, CompletableDeferred<OpResultDto>>()
    private val nextId = AtomicLong()
    private val mutableState = MutableStateFlow<BridgeState>(BridgeState.Starting)

    val state: StateFlow<BridgeState> = mutableState.asStateFlow()

    internal fun markListening() {
        mutableState.value = BridgeState.WaitingForExtension
    }

    internal fun markFailed(reason: String) {
        mutableState.value = BridgeState.Failed(reason)
    }

    internal suspend fun attach(newSession: WebSocketSession, extensionVersion: String) {
        val previous = mutex.withLock {
            session.also { session = newSession }
        }
        previous?.close(CloseReason(CloseReason.Codes.NORMAL, "Replaced by a newer connection"))
        failPending("Extension connection was replaced")
        mutableState.value = BridgeState.ExtensionConnected(extensionVersion)
        log.info("Extension connected (version {})", extensionVersion)
    }

    internal suspend fun detach(closedSession: WebSocketSession) {
        val wasCurrent = mutex.withLock {
            (session === closedSession).also { if (it) session = null }
        }
        if (wasCurrent) {
            failPending("Extension disconnected")
            mutableState.value = BridgeState.WaitingForExtension
            log.info("Extension disconnected")
        }
    }

    internal suspend fun disconnect(reason: String) {
        val current = mutex.withLock { session.also { session = null } }
        current?.close(CloseReason(CloseReason.Codes.NORMAL, reason))
        failPending(reason)
        if (current != null) mutableState.value = BridgeState.WaitingForExtension
    }

    internal fun complete(id: String, result: OpResultDto) {
        pending.remove(id)?.complete(result)
    }

    /** Sends one read-only command and returns its data, or throws a [ConnectorException]. */
    suspend fun request(op: String, params: JsonObject): JsonElement {
        val current = mutex.withLock { session } ?: throw ConnectorException.NotConnected()
        val id = nextId.incrementAndGet().toString()
        val deferred = CompletableDeferred<OpResultDto>()
        pending[id] = deferred
        try {
            current.send(Frame.Text(wireJson.encodeToString(CommandMessage.serializer(), CommandMessage(id, op, params))))
            val result = withTimeout(requestTimeoutMs) { deferred.await() }
            if (result.ok) {
                return result.data ?: throw ConnectorException.ProtocolMismatch("Successful $op result without data")
            }
            throw result.error?.toException()
                ?: throw ConnectorException.ProtocolMismatch("Failed $op result without an error")
        } catch (e: TimeoutCancellationException) {
            throw ConnectorException.Timeout(op)
        } finally {
            pending.remove(id)
        }
    }

    private fun failPending(reason: String) {
        val failed = pending.values.toList()
        pending.clear()
        failed.forEach { it.completeExceptionally(ConnectorException.NotConnected(reason)) }
    }
}

internal fun OpErrorDto.toException(): ConnectorException = when (kind) {
    "NO_PHOTOS_TAB" -> ConnectorException.NoPhotosTab(message)
    "SESSION" -> ConnectorException.SessionExpired(message, httpStatus)
    "RATE_LIMIT" -> ConnectorException.RateLimited(message, httpStatus, rpcCode)
    "TRANSIENT" -> ConnectorException.Transient(message, httpStatus)
    "RPC_ERROR" -> ConnectorException.RpcFailed(message, httpStatus, rpcCode)
    "PROTOCOL" -> ConnectorException.ProtocolMismatch(message)
    "PREVIEW_UNAVAILABLE" -> ConnectorException.PreviewUnavailable(message, httpStatus)
    "BAD_REQUEST" -> ConnectorException.BadRequest(message)
    else -> ConnectorException.ProtocolMismatch("Unknown error kind from extension")
}
