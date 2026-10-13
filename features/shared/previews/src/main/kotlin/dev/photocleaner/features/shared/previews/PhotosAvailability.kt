package dev.photocleaner.features.shared.previews

import dev.photocleaner.services.connector.domain.BridgeController
import dev.photocleaner.services.connector.domain.BridgeState
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.services.connector.domain.PhotosConnector
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf

/** Whether Google Photos can actually be reached through the extension right now. */
sealed interface PhotosAvailability {
    data object WaitingForExtension : PhotosAvailability
    data class NoPhotosTab(val message: String) : PhotosAvailability
    data object SignedOut : PhotosAvailability
    data class Problem(val message: String) : PhotosAvailability
    data class Ready(val photosTabCount: Int) : PhotosAvailability
}

/**
 * Checks the whole chain (app → extension → Photos tab → Google) right after the
 * extension connects and then every [intervalMs], so "connected" means usable.
 */
class MonitorPhotosAvailabilityUseCase(
    private val bridge: BridgeController,
    private val connector: PhotosConnector,
    private val intervalMs: Long = 15_000,
) {
    @OptIn(ExperimentalCoroutinesApi::class)
    fun execute(): Flow<PhotosAvailability> = bridge.state
        .flatMapLatest<BridgeState, PhotosAvailability> { state ->
            if (state is BridgeState.ExtensionConnected) {
                flow {
                    while (true) {
                        emit(check())
                        delay(intervalMs)
                    }
                }
            } else {
                flowOf(PhotosAvailability.WaitingForExtension)
            }
        }
        .distinctUntilChanged()

    private suspend fun check(): PhotosAvailability = try {
        PhotosAvailability.Ready(connector.sessionStatus().photosTabCount)
    } catch (e: ConnectorException.NotConnected) {
        PhotosAvailability.WaitingForExtension
    } catch (e: ConnectorException.NoPhotosTab) {
        PhotosAvailability.NoPhotosTab(e.message ?: "Open photos.google.com")
    } catch (e: ConnectorException.SessionExpired) {
        PhotosAvailability.SignedOut
    } catch (e: ConnectorException) {
        PhotosAvailability.Problem(e.message ?: e.javaClass.simpleName)
    }
}

/** User-facing explanation of why previews cannot load, or null when they can. */
fun PhotosAvailability.pausedReason(): String? = when (this) {
    is PhotosAvailability.Ready -> null
    PhotosAvailability.WaitingForExtension ->
        "Previews paused: waiting for the browser extension. Opening its popup or a photos.google.com tab reconnects it."
    is PhotosAvailability.NoPhotosTab -> "Previews paused: open photos.google.com in Chrome."
    PhotosAvailability.SignedOut -> "Previews paused: sign in to Google Photos in Chrome."
    is PhotosAvailability.Problem -> "Previews paused: $message"
}

/** Failures that clear up by themselves once the connection is back; such previews are retried, not marked failed. */
fun ConnectorException.isTransient(): Boolean = when (this) {
    is ConnectorException.NotConnected,
    is ConnectorException.NoPhotosTab,
    is ConnectorException.SessionExpired,
    is ConnectorException.Transient,
    is ConnectorException.Timeout,
    is ConnectorException.RateLimited -> true
    is ConnectorException.PreviewUnavailable,
    is ConnectorException.RpcFailed,
    is ConnectorException.ProtocolMismatch,
    is ConnectorException.BadRequest -> false
}
