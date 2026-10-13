package dev.photocleaner.features.scan.usecase

import dev.photocleaner.features.scan.model.ScanPolicy
import dev.photocleaner.features.scan.model.ScanProgress
import dev.photocleaner.features.scan.model.ScanState
import dev.photocleaner.features.scan.model.ScanTiming
import dev.photocleaner.repositories.inventory.domain.AlbumStatus
import dev.photocleaner.repositories.inventory.domain.InventoryRepository
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.ScanPhase
import dev.photocleaner.repositories.inventory.domain.ScanRun
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.services.connector.domain.PhotosConnector
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import org.slf4j.LoggerFactory

/**
 * Enumerates the library, favourites, album list and every album's entries,
 * one page at a time, persisting each page with its resume point. Resumes the
 * latest unfinished run if there is one; otherwise starts a new run.
 *
 * Cancelling the collecting coroutine pauses the run; it can be resumed later,
 * including after an app restart.
 */
class ScanInventoryUseCase(
    private val connector: PhotosConnector,
    private val repository: InventoryRepository,
    private val clock: () -> Long = System::currentTimeMillis,
    private val policy: ScanPolicy = ScanPolicy(),
) {
    fun execute(): Flow<ScanProgress> = flow {
        ScanSession(connector, repository, clock, policy, this).execute()
    }
}

/** Stops the scan; the run becomes [state] (PAUSED or FAILED) with [message] as the reason. */
private class ScanStop(val state: ScanState, message: String, cause: Throwable? = null) : Exception(message, cause)

private class ScanSession(
    private val connector: PhotosConnector,
    private val repository: InventoryRepository,
    private val clock: () -> Long,
    private val policy: ScanPolicy,
    private val out: FlowCollector<ScanProgress>,
) {
    private val log = LoggerFactory.getLogger(ScanInventoryUseCase::class.java)
    private val progress = ScanProgressReader(repository)
    private lateinit var run: ScanRun
    private var phase: ScanPhase? = null
    private var notice: String? = null

    // Where the time goes, for the speed line on the Scan library tab.
    private val startedAtMs = clock()
    private var requests = 0
    private var googleMs = 0L
    private var pauseMs = 0L

    // Log lines carry run ids, phases, counts and the user-facing reasons only:
    // never keys, titles, URLs or tokens.
    suspend fun execute() {
        val session = try {
            request("session check") { google { connector.sessionStatus() } }
        } catch (stop: ScanStop) {
            log.warn("Scan not started: {}", stop.message)
            out.emit(ScanProgress.none(stop.message))
            return
        }

        val unfinished = repository.latestRun()?.takeIf { it.status == RunStatus.RUNNING || it.status == RunStatus.PAUSED }
        if (unfinished != null && unfinished.accountFingerprint != session.accountFingerprint) {
            log.warn("Scan run {} not resumed: the Photos tab is signed in to a different account", unfinished.id)
            out.emit(
                progress.read(
                    unfinished, ScanState.PAUSED, null,
                    "The unfinished scan belongs to a different Google account than the open Photos tab. " +
                        "Switch the tab back to that account, or discard the scan and start a new one.",
                ),
            )
            return
        }
        run = unfinished ?: repository.createRun(session.accountFingerprint, clock())
        repository.updateRunStatus(run.id, RunStatus.RUNNING, null, null)
        log.info(if (unfinished != null) "Scan run {} resumed" else "Scan run {} started", run.id)

        try {
            emitProgress()
            libraryPhase()
            favouritesPhase()
            archivePhase()
            albumListPhase()
            albumMembersPhase()
            phase = null
            notice = null
            repository.updateRunStatus(run.id, RunStatus.COMPLETED, null, clock())
            repository.deleteOtherRuns(run.id)
            val done = progress.read(run, ScanState.COMPLETED, null, null).copy(timing = timing())
            log.info(
                "Scan run {} completed: {} library entries, {} favourites, {} archived, {} albums ({} unreadable)",
                run.id, done.libraryEntries, done.favouriteEntries, done.archiveEntries, done.albumsListed, done.albumsFailed,
            )
            out.emit(done)
        } catch (stop: ScanStop) {
            val failed = stop.state == ScanState.FAILED
            repository.updateRunStatus(run.id, if (failed) RunStatus.FAILED else RunStatus.PAUSED, stop.message, if (failed) clock() else null)
            log.warn("Scan run {} {} during {}: {}", run.id, if (failed) "failed" else "paused", phase, stop.message)
            notice = stop.message
            emitProgress(stop.state)
        } catch (e: CancellationException) {
            withContext(NonCancellable) { repository.updateRunStatus(run.id, RunStatus.PAUSED, "Paused", null) }
            log.info("Scan run {} paused by the user during {}", run.id, phase)
            throw e
        }
    }

    // region phases

    private suspend fun libraryPhase() {
        phase = ScanPhase.LIBRARY
        pagedPhase(ScanPhase.LIBRARY, "", "library") { token ->
            val page = google { connector.libraryPage(token) }
            verifyAccount(page.accountFingerprint)
            repository.saveLibraryPage(run.id, page.items.map { it.toInventoryItem() }, page.nextPageToken)
            page.nextPageToken
        }
    }

    private suspend fun favouritesPhase() {
        phase = ScanPhase.FAVOURITES
        pagedPhase(ScanPhase.FAVOURITES, "", "favourites") { token ->
            val page = google { connector.favouritesPage(token) }
            verifyAccount(page.accountFingerprint)
            repository.saveFavouritesPage(run.id, page.items.map { it.toFavouriteEntry() }, page.nextPageToken)
            page.nextPageToken
        }
    }

    private suspend fun archivePhase() {
        phase = ScanPhase.ARCHIVE
        pagedPhase(ScanPhase.ARCHIVE, "", "archive") { token ->
            val page = google { connector.archivePage(token) }
            verifyAccount(page.accountFingerprint)
            repository.saveArchivePage(run.id, page.items.map { it.toArchiveEntry() }, page.nextPageToken)
            page.nextPageToken
        }
    }

    private suspend fun albumListPhase() {
        phase = ScanPhase.ALBUM_LIST
        pagedPhase(ScanPhase.ALBUM_LIST, "", "album list") { token ->
            val page = google { connector.albumsPage(token) }
            verifyAccount(page.accountFingerprint)
            repository.saveAlbumsPage(run.id, page.albums.map { it.toRecord() }, page.nextPageToken)
            page.nextPageToken
        }
    }

    private suspend fun albumMembersPhase() {
        phase = ScanPhase.ALBUM_MEMBERS
        for (status in repository.albums(run.id)) {
            if (status.membersComplete && status.failureReason == null) continue
            if (status.failureReason != null) repository.resetPhase(run.id, ScanPhase.ALBUM_MEMBERS, status.album.albumKey)
            readAlbum(status)
        }
    }

    private suspend fun readAlbum(status: AlbumStatus) {
        val album = status.album
        try {
            pagedPhase(ScanPhase.ALBUM_MEMBERS, album.albumKey, "album contents") { token ->
                val page = google { connector.albumItemsPage(album.albumKey, album.authKey, token) }
                verifyAccount(page.accountFingerprint)
                repository.saveAlbumMembersPage(run.id, album.albumKey, page.items.map { it.toEntry() }, page.nextPageToken)
                page.nextPageToken
            }
        } catch (e: ConnectorException.RpcFailed) {
            repository.markAlbumFailed(run.id, album.albumKey, "Google returned error code ${e.rpcCode ?: e.httpStatus ?: "?"}")
            log.warn("Scan run {}: an album could not be read (error code {})", run.id, e.rpcCode ?: e.httpStatus)
            emitProgress()
        } catch (stop: ScanStop) {
            // Google reports some inaccessible shared albums as "permission denied", which looks
            // like a lost session. Only a fresh session check can tell the two apart.
            if (stop.cause !is ConnectorException.SessionExpired || !sessionStillValid()) throw stop
            repository.markAlbumFailed(run.id, album.albumKey, "Access denied while the session is valid")
            log.warn("Scan run {}: an album was denied while the session is valid", run.id)
            emitProgress()
        }
    }

    /**
     * Pages through one phase from its saved resume point. A saved page token that
     * Google no longer accepts restarts the phase from the beginning, once.
     */
    private suspend fun pagedPhase(phase: ScanPhase, scope: String, label: String, fetchAndSave: suspend (String?) -> String?) {
        val cursor = repository.cursor(run.id, phase, scope)
        if (cursor?.completed == true) return
        var token = cursor?.nextPageToken
        var usingSavedToken = token != null
        while (true) {
            val next = try {
                request(label) { fetchAndSave(token) }
            } catch (e: ConnectorException.RpcFailed) {
                if (!usingSavedToken) {
                    if (phase == ScanPhase.ALBUM_MEMBERS) throw e
                    throw ScanStop(ScanState.PAUSED, "Google kept returning error code ${e.rpcCode ?: e.httpStatus ?: "?"} while reading the $label.", e)
                }
                notice = "The saved position in the $label expired; reading it again from the start."
                repository.resetPhase(run.id, phase, scope)
                token = null
                usingSavedToken = false
                continue
            }
            usingSavedToken = false
            emitProgress()
            token = next ?: return
        }
    }

    // endregion

    // region request policy

    private suspend fun <T> request(label: String, block: suspend () -> T): T {
        var transientFailures = 0
        var rateLimits = 0
        var rpcFailures = 0
        while (true) {
            pause(policy.pacingMs)
            try {
                return block().also {
                    if (transientFailures > 0 || rateLimits > 0) notice = null
                }
            } catch (e: ConnectorException.Transient) {
                transientFailures = retryTransient(label, transientFailures, e)
            } catch (e: ConnectorException.Timeout) {
                transientFailures = retryTransient(label, transientFailures, e)
            } catch (e: ConnectorException.RateLimited) {
                rateLimits++
                if (rateLimits > policy.maxRateLimitRetries) {
                    throw ScanStop(ScanState.PAUSED, "Google is limiting requests. Resume the scan later.", e)
                }
                notice = "Google is limiting requests; waiting before retrying ($rateLimits/${policy.maxRateLimitRetries})."
                log.warn("Rate limited on the {} request ({}/{})", label, rateLimits, policy.maxRateLimitRetries)
                emitProgressIfStarted()
                pause(policy.rateLimitBaseDelayMs shl (rateLimits - 1))
            } catch (e: ConnectorException.RpcFailed) {
                rpcFailures++
                if (rpcFailures > policy.maxRpcRetries) throw e
                pause(policy.transientBaseDelayMs)
            } catch (e: ConnectorException.SessionExpired) {
                throw ScanStop(ScanState.PAUSED, "The Google Photos session ended. Reload photos.google.com, check you are signed in, then resume.", e)
            } catch (e: ConnectorException.NoPhotosTab) {
                throw ScanStop(ScanState.PAUSED, "${e.message}. Then resume the scan.", e)
            } catch (e: ConnectorException.NotConnected) {
                throw ScanStop(ScanState.PAUSED, "The browser extension disconnected. Reconnect it, then resume.", e)
            } catch (e: ConnectorException.ProtocolMismatch) {
                throw ScanStop(ScanState.FAILED, "Google's response to the $label request was not understood (${e.message}). The connector needs updating.", e)
            } catch (e: ConnectorException.BadRequest) {
                throw ScanStop(ScanState.FAILED, "The extension rejected the $label request (${e.message}).", e)
            } catch (e: ConnectorException.PreviewUnavailable) {
                throw ScanStop(ScanState.FAILED, "Unexpected preview failure during the $label request.", e)
            }
        }
    }

    private suspend fun retryTransient(label: String, failuresSoFar: Int, e: ConnectorException): Int {
        val failures = failuresSoFar + 1
        if (failures > policy.maxTransientRetries) {
            throw ScanStop(ScanState.PAUSED, "Repeated network problems while reading the $label. Resume when the connection is stable.", e)
        }
        notice = "Network problem while reading the $label; retrying ($failures/${policy.maxTransientRetries})."
        log.warn("Retrying the {} request after {} ({}/{})", label, e.javaClass.simpleName, failures, policy.maxTransientRetries)
        emitProgressIfStarted()
        pause(policy.transientBaseDelayMs shl (failures - 1))
        return failures
    }

    private suspend fun sessionStillValid(): Boolean = try {
        connector.sessionStatus().accountFingerprint == run.accountFingerprint
    } catch (e: ConnectorException) {
        false
    }

    private fun verifyAccount(fingerprint: String) {
        if (fingerprint != run.accountFingerprint) {
            throw ScanStop(ScanState.PAUSED, "The Photos tab is now signed in to a different Google account. Switch back to the scanned account, then resume.")
        }
    }

    // endregion

    private suspend fun emitProgress(state: ScanState = ScanState.RUNNING) {
        out.emit(progress.read(run, state, phase, notice).copy(timing = timing()))
    }

    /** Times a call to Google: the part of the scan this computer cannot speed up. */
    private suspend fun <T> google(block: suspend () -> T): T {
        val start = clock()
        try {
            return block()
        } finally {
            googleMs += clock() - start
            requests++
        }
    }

    /** A deliberate wait (pacing or retry back-off). */
    private suspend fun pause(ms: Long) {
        delay(ms)
        pauseMs += ms
    }

    private fun timing() = ScanTiming(requests, googleMs, pauseMs, clock() - startedAtMs)

    private suspend fun emitProgressIfStarted() {
        if (::run.isInitialized) emitProgress()
    }
}
