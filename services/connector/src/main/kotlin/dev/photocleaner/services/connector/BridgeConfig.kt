package dev.photocleaner.services.connector

data class BridgeConfig(
    val port: Int = DEFAULT_PORT,
    /** Fixed by the `key` in extension/static/manifest.json. */
    val extensionId: String = EXTENSION_ID,
    val requestTimeoutMs: Long = 120_000,
    val helloTimeoutMs: Long = 5_000,
    /** Host headers accepted, which blocks DNS-rebinding pages from reaching the bridge. */
    val allowedHosts: Set<String> = setOf("$LOOPBACK_HOST:$port", "localhost:$port"),
) {
    val allowedOrigin: String get() = "chrome-extension://$extensionId"

    companion object {
        const val DEFAULT_PORT = 47613
        const val EXTENSION_ID = "klibpopmmfopimbjeelnndddjpdgcgjf"

        /** Must equal `version` in extension/static/manifest.json (checked by a unit test). */
        const val EXPECTED_EXTENSION_VERSION = "0.3.0"
        const val LOOPBACK_HOST = "127.0.0.1"
    }
}
