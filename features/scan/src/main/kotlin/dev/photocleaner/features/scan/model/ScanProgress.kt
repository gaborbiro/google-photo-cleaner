package dev.photocleaner.features.scan.model

import dev.photocleaner.repositories.inventory.domain.ScanPhase

enum class ScanState {
    /** No scan has been started. */
    NONE,
    RUNNING,

    /** Resumable: paused by the user, by a recoverable problem, or interrupted by an app restart. */
    PAUSED,
    COMPLETED,
    FAILED,
    CANCELLED,
}

data class ScanProgress(
    val state: ScanState,
    val phase: ScanPhase?,
    val libraryEntries: Int,
    val libraryPages: Int,
    /** Taken time of the oldest library item read so far: the library is read newest first. */
    val scannedBackToMs: Long?,
    val favouriteEntries: Int,
    val archiveEntries: Int,
    val albumsListed: Int,
    val albumsRead: Int,
    val albumsFailed: Int,
    /** Why the scan stopped, or what it is waiting on. Never contains keys, titles or tokens. */
    val notice: String?,
    /** Where the time went while scanning in this session; null when no scan ran since the app started. */
    val timing: ScanTiming?,
) {
    companion object {
        fun none(notice: String? = null) = ScanProgress(ScanState.NONE, null, 0, 0, null, 0, 0, 0, 0, 0, notice, null)
    }
}

data class ScanPolicy(
    val pacingMs: Long = 300,
    val maxTransientRetries: Int = 4,
    val transientBaseDelayMs: Long = 2_000,
    val maxRateLimitRetries: Int = 3,
    val rateLimitBaseDelayMs: Long = 30_000,
    val maxRpcRetries: Int = 2,
)

/**
 * Where a scan's time went. The scan mostly waits: for Google's answers, and for the
 * short deliberate pause between requests that keeps it under Google's rate limit.
 */
data class ScanTiming(
    /** Requests answered by Google. */
    val requests: Int,
    /** Time spent waiting for Google's answers. */
    val googleMs: Long,
    /** Deliberate pauses between requests and before retries. */
    val pauseMs: Long,
    /** Wall-clock time of the scan in this session. */
    val elapsedMs: Long,
)
