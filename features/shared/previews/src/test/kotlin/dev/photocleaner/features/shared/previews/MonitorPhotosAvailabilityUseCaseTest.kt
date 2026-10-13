package dev.photocleaner.features.shared.previews

import dev.photocleaner.services.connector.domain.BridgeController
import dev.photocleaner.services.connector.domain.BridgeState
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.services.connector.domain.fake.FakePhotosConnector
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest

class MonitorPhotosAvailabilityUseCaseTest {

    private class FakeBridge(initial: BridgeState) : BridgeController {
        val mutable = MutableStateFlow(initial)
        override val state: StateFlow<BridgeState> = mutable
        override val pairingToken: StateFlow<String> = MutableStateFlow("t")
        override val port = 1
        override val extensionId = "x"
        override val expectedExtensionVersion = "0.3.0"
        override suspend fun regeneratePairingToken() = Unit
    }

    private val connector = FakePhotosConnector(emptyList())

    @Test
    fun `waiting until the extension connects, then ready`() = runTest {
        val bridge = FakeBridge(BridgeState.WaitingForExtension)
        val monitor = MonitorPhotosAvailabilityUseCase(bridge, connector, intervalMs = 1_000)
        val seen = mutableListOf<PhotosAvailability>()
        val job = launch { monitor.execute().take(2).toList(seen) }
        advanceTimeBy(10)
        bridge.mutable.value = BridgeState.ExtensionConnected("0.3.0")
        job.join()
        assertEquals(listOf(PhotosAvailability.WaitingForExtension, PhotosAvailability.Ready(1)), seen)
    }

    @Test
    fun `a missing Photos tab and a signed-out session are told apart`() = runTest {
        val bridge = FakeBridge(BridgeState.ExtensionConnected("0.3.0"))
        connector.failure = { _, _ -> ConnectorException.NoPhotosTab("Open photos.google.com") }
        assertEquals(PhotosAvailability.NoPhotosTab("Open photos.google.com"), MonitorPhotosAvailabilityUseCase(bridge, connector).execute().first())
        connector.failure = { _, _ -> ConnectorException.SessionExpired("signed out", 401) }
        assertEquals(PhotosAvailability.SignedOut, MonitorPhotosAvailabilityUseCase(bridge, connector).execute().first())
    }

    @Test
    fun `recovery is noticed at the next check`() = runTest {
        val bridge = FakeBridge(BridgeState.ExtensionConnected("0.3.0"))
        var failing = true
        connector.failure = { _, _ -> if (failing) ConnectorException.NoPhotosTab("Open photos.google.com") else null }
        val seen = mutableListOf<PhotosAvailability>()
        val job = launch { MonitorPhotosAvailabilityUseCase(bridge, connector, intervalMs = 1_000).execute().take(2).toList(seen) }
        advanceTimeBy(10)
        failing = false
        job.join()
        assertEquals(PhotosAvailability.Ready(1), seen.last())
        assertNull(seen.last().pausedReason())
    }

    @Test
    fun `connection problems are retried, real failures are not`() {
        assertEquals(true, ConnectorException.NotConnected().isTransient())
        assertEquals(true, ConnectorException.SessionExpired("x", null).isTransient())
        assertEquals(false, ConnectorException.PreviewUnavailable("gone", 404).isTransient())
    }
}
