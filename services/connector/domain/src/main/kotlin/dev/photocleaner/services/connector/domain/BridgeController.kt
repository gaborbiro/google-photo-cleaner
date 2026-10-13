package dev.photocleaner.services.connector.domain

import kotlinx.coroutines.flow.StateFlow

/** The loopback bridge the extension connects to, and its pairing secret. */
interface BridgeController {
    val state: StateFlow<BridgeState>
    val pairingToken: StateFlow<String>
    val port: Int
    val extensionId: String

    /** The extension version this app was built against; an older one lacks operations the app needs. */
    val expectedExtensionVersion: String

    /** Issues a new token and drops the current extension connection. */
    suspend fun regeneratePairingToken()
}

sealed interface BridgeState {
    data object Starting : BridgeState
    data object WaitingForExtension : BridgeState
    data class ExtensionConnected(val extensionVersion: String) : BridgeState
    data class Failed(val reason: String) : BridgeState
}
