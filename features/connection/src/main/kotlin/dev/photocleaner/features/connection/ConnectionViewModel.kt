package dev.photocleaner.features.connection

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.photocleaner.features.shared.previews.PhotosAvailability
import dev.photocleaner.services.connector.domain.BridgeController
import dev.photocleaner.services.connector.domain.BridgeState
import java.nio.file.Path
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Green only when the whole chain works: app, extension (expected version),
 * a photos.google.com tab, and a signed-in Google session.
 */
class ConnectionViewModel(
    private val bridge: BridgeController,
    availability: StateFlow<PhotosAvailability>,
    /** The built extension folder, chosen in Chrome's "Load unpacked". */
    extensionDir: Path,
) : ViewModel() {

    private val tokenVisible = MutableStateFlow(false)

    /** Null until the user shows or hides the setup steps; until then they show while not connected. */
    private val setupChoice = MutableStateFlow<Boolean?>(null)

    private val extensionPath = extensionDir.toAbsolutePath().toString()

    val state: StateFlow<ConnectionUiState> =
        combine(bridge.state, availability, bridge.pairingToken, tokenVisible, setupChoice) { bridgeState, photos, token, visible, setup ->
            val (status, text) = statusOf(bridgeState, photos)
            val setupVisible = setup ?: (bridgeState !is BridgeState.ExtensionConnected)
            ConnectionUiState(
                status = status,
                statusText = text,
                token = token,
                displayedToken = if (visible) token else MASK,
                toggleTokenLabel = if (visible) "Hide" else "Show",
                portText = "Port ${bridge.port}",
                extensionIdText = "Chrome extension ID ${bridge.extensionId}",
                setupToggleLabel = if (setupVisible) "Hide setup steps" else "How to set up the Chrome extension",
                setupSteps = if (setupVisible) setupSteps() else emptyList(),
                extensionPath = extensionPath,
            )
        }.stateIn(viewModelScope, SharingStarted.Eagerly, ConnectionUiState.Initial)

    fun onToggleTokenClicked() {
        tokenVisible.value = !tokenVisible.value
    }

    fun onToggleSetupClicked() {
        setupChoice.value = state.value.setupSteps.isEmpty()
    }

    fun onRegenerateClicked() {
        viewModelScope.launch { bridge.regeneratePairingToken() }
    }

    private fun setupSteps() = listOf(
        "1. In Chrome, open chrome://extensions and turn on “Developer mode” (top right).",
        "2. Click “Load unpacked” and choose this folder (Copy path below): $extensionPath",
        "3. Click the puzzle icon in Chrome's toolbar and pin “Photo Cleaner Connector”, then click its icon.",
        "4. Click “Copy” next to the pairing token here, paste it into the extension and click “Save and connect”.",
        "5. Open photos.google.com in the same Chrome profile, signed in to your Google account.",
        "Once done, the status above turns green. Chrome keeps the extension installed, so this is needed only once per computer " +
            "(and again with “New token”).",
    )

    private fun statusOf(state: BridgeState, photos: PhotosAvailability): Pair<ConnectionStatus, String> = when (state) {
        BridgeState.Starting -> ConnectionStatus.PENDING to "Starting the local bridge…"
        BridgeState.WaitingForExtension -> ConnectionStatus.PENDING to
            "Waiting for the Chrome extension. Opening its popup or a photos.google.com tab reconnects it within seconds."
        is BridgeState.Failed -> ConnectionStatus.FAILED to "Bridge failed: ${state.reason}"
        is BridgeState.ExtensionConnected -> when {
            state.extensionVersion != bridge.expectedExtensionVersion -> ConnectionStatus.OUTDATED to
                "Extension ${state.extensionVersion} is connected, but this app expects ${bridge.expectedExtensionVersion}. " +
                "Rebuild it (npm run build) and reload it in chrome://extensions."
            else -> when (photos) {
                is PhotosAvailability.Ready -> ConnectionStatus.CONNECTED to
                    "Google Photos ready (extension ${state.extensionVersion}, ${photos.photosTabCount} Photos tab(s))"
                is PhotosAvailability.NoPhotosTab -> ConnectionStatus.PENDING to
                    "Extension connected, but no photos.google.com tab is open in Chrome."
                PhotosAvailability.SignedOut -> ConnectionStatus.FAILED to
                    "Extension connected, but Google Photos is signed out. Sign in in Chrome."
                is PhotosAvailability.Problem -> ConnectionStatus.PENDING to "Extension connected, but: ${photos.message}"
                PhotosAvailability.WaitingForExtension -> ConnectionStatus.PENDING to "Extension connected; checking Google Photos…"
            }
        }
    }

    private companion object {
        const val MASK = "••••••••••••••••"
    }
}

enum class ConnectionStatus { PENDING, CONNECTED, OUTDATED, FAILED }

data class ConnectionUiState(
    val status: ConnectionStatus,
    val statusText: String,
    val token: String,
    val displayedToken: String,
    val toggleTokenLabel: String,
    val portText: String,
    val extensionIdText: String,
    val setupToggleLabel: String,
    /** Empty while the steps are hidden. */
    val setupSteps: List<String>,
    val extensionPath: String,
) {
    companion object {
        val Initial = ConnectionUiState(ConnectionStatus.PENDING, "Starting the local bridge…", "", "", "Show", "", "", "How to set up the Chrome extension", emptyList(), "")
    }
}
