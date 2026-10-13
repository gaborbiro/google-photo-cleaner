package dev.photocleaner.features.probe.usecase

import dev.photocleaner.features.probe.model.ProbeCheck
import dev.photocleaner.features.probe.model.ProbeFact
import dev.photocleaner.features.probe.model.ProbeOutcome
import dev.photocleaner.features.probe.model.ProbeProgress
import dev.photocleaner.features.probe.model.ProbeReport
import dev.photocleaner.services.connector.domain.Album
import dev.photocleaner.services.connector.domain.AlbumMember
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.services.connector.domain.LibraryItem
import dev.photocleaner.services.connector.domain.LibraryPage
import dev.photocleaner.services.connector.domain.MediaType
import dev.photocleaner.services.connector.domain.PhotosConnector
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.flow

/**
 * A bounded, read-only probe of the live account. It answers the questions the
 * protection inventory depends on, using a few dozen bulk requests and never a
 * per-photo lookup. The report holds counts and data shapes only: no keys,
 * titles, URLs or account details.
 */
class RunProbeUseCase(
    private val connector: PhotosConnector,
    private val pacingMs: Long = DEFAULT_PACING_MS,
    private val clock: () -> Long = System::currentTimeMillis,
) {

    fun execute(): Flow<ProbeProgress> = flow {
        val run = ProbeRun(connector, pacingMs, clock)
        run.execute(this)
    }

    companion object {
        const val DEFAULT_PACING_MS = 250L
        const val MAX_FAVOURITE_PAGES = 5
        const val MAX_ALBUM_PAGES = 100
        const val FAVOURITE_CROSS_CHECKS = 3
        const val MEMBER_CROSS_CHECKS = 2
        const val PREVIEW_SAMPLES = 3
        const val PREVIEW_SIZE_PX = 256
    }
}

private class ProbeRun(
    private val connector: PhotosConnector,
    private val pacingMs: Long,
    private val clock: () -> Long,
) {
    private val startedAt = clock()
    private val checks = mutableListOf<ProbeCheck>()
    private val latenciesMs = mutableListOf<Long>()
    private val failuresByKind = mutableMapOf<String, Int>()
    private val accountFingerprints = mutableSetOf<String>()

    private var firstPage: LibraryPage? = null
    private var favourites: List<LibraryItem> = emptyList()
    private var favouritesComplete = false
    private var myActorId: String? = null
    private var albums: List<Album> = emptyList()

    suspend fun execute(out: FlowCollector<ProbeProgress>) {
        val steps: List<Pair<String, suspend () -> ProbeCheck>> = listOf(
            "Google Photos session" to ::checkSession,
            "Library: first page" to ::checkFirstLibraryPage,
            "Library: pagination" to ::checkPagination,
            "Favourites listing" to ::checkFavouritesListing,
            "Favourites agree with library flags" to ::checkFavouriteAgreement,
            "Album list" to ::checkAlbumList,
            "Album contents link to library photos" to ::checkAlbumContents,
            "Previews" to ::checkPreviews,
        )
        var stop = false
        for ((title, step) in steps) {
            if (stop) {
                checks += ProbeCheck(idOf(title), title, ProbeOutcome.SKIPPED, "Skipped: the session check failed", emptyList())
                continue
            }
            out.emit(ProbeProgress(checks.toList(), title, null))
            val check = try {
                step()
            } catch (e: ConnectorException) {
                ProbeCheck(idOf(title), title, ProbeOutcome.FAIL, "Request failed: ${describe(e)}", emptyList())
            }
            checks += check
            if (check.id == idOf(steps.first().first) && check.outcome == ProbeOutcome.FAIL) stop = true
        }
        checks += requestSummary()
        out.emit(ProbeProgress(checks.toList(), null, ProbeReport(startedAt, clock(), checks.toList())))
    }

    // region checks

    private suspend fun checkSession(): ProbeCheck {
        val session = timed { connector.sessionStatus() }
        accountFingerprints += session.accountFingerprint
        val facts = listOf(ProbeFact("Photos tabs open", session.photosTabCount.toString()))
        return if (session.photosTabCount > 1) {
            check("Google Photos session", ProbeOutcome.WARN, "Signed in; several Photos tabs are open and the most recently used one is queried", facts)
        } else {
            check("Google Photos session", ProbeOutcome.PASS, "Signed in", facts)
        }
    }

    private suspend fun checkFirstLibraryPage(): ProbeCheck {
        val title = "Library: first page"
        val page = timed { connector.libraryPage(pageToken = null, includeShape = true) }.also(::track)
        firstPage = page
        val items = page.items
        val facts = libraryFacts(items) + listOf(
            ProbeFact("Next page token", yesNo(page.nextPageToken != null)),
            ProbeFact("Timestamp cursor", yesNo(page.lastItemTakenAtMs != null)),
        )
        val unknownFavourite = items.count { it.isFavourite == null }
        val unknownType = items.count { it.mediaType == null }
        return when {
            items.isEmpty() -> check(title, ProbeOutcome.FAIL, "The library listing returned no items", facts, page.shapeSample)
            unknownFavourite > 0 || unknownType > 0 ->
                check(title, ProbeOutcome.WARN, "Some items lack a favourite flag or media type; they would be classed as unknown", facts, page.shapeSample)
            else -> check(title, ProbeOutcome.PASS, "Every item carries a favourite flag and a media type", facts, page.shapeSample)
        }
    }

    private suspend fun checkPagination(): ProbeCheck {
        val title = "Library: pagination"
        val first = firstPage ?: return check(title, ProbeOutcome.SKIPPED, "Skipped: the first library page failed", emptyList())
        val token = first.nextPageToken
            ?: return check(title, ProbeOutcome.PASS, "The whole library fits in one page", listOf(ProbeFact("Items", first.items.size.toString())))
        val second = timed { connector.libraryPage(pageToken = token) }.also(::track)
        val firstKeys = first.items.map { it.mediaKey }.toSet()
        val overlap = second.items.count { it.mediaKey in firstKeys }
        val firstOldest = first.items.minOf { it.takenAtMs }
        val secondNewest = second.items.maxOfOrNull { it.takenAtMs }
        val ordered = secondNewest == null || secondNewest <= firstOldest
        val facts = listOf(
            ProbeFact("Second page items", second.items.size.toString()),
            ProbeFact("Items repeated from page 1", overlap.toString()),
            ProbeFact("Page 2 is older than page 1", yesNo(ordered)),
            ProbeFact("Further pages", yesNo(second.nextPageToken != null)),
        )
        return if (overlap == 0 && ordered) {
            check(title, ProbeOutcome.PASS, "Page tokens advance through the library without repeats", facts)
        } else {
            check(title, ProbeOutcome.FAIL, "Pages overlap or go out of order; enumeration could miss or double-count items", facts)
        }
    }

    private suspend fun checkFavouritesListing(): ProbeCheck {
        val title = "Favourites listing"
        val collected = mutableListOf<LibraryItem>()
        var token: String? = null
        var pages = 0
        var shape: String? = null
        do {
            val page = timed { connector.favouritesPage(token, includeShape = pages == 0) }.also(::track)
            if (pages == 0) shape = page.shapeSample
            collected += page.items
            token = page.nextPageToken
            pages++
        } while (token != null && pages < RunProbeUseCase.MAX_FAVOURITE_PAGES)
        favourites = collected
        favouritesComplete = token == null
        myActorId = collected.filter { it.isOwned == true }.mapNotNull { it.uploaderActorId }
            .groupingBy { it }.eachCount().maxByOrNull { it.value }?.key

        val facts = listOf(
            ProbeFact("Pages read", pages.toString()),
            ProbeFact("Listing read to the end", yesNo(favouritesComplete)),
        ) + libraryFacts(collected) + ProbeFact("Own account actor identified", yesNo(myActorId != null))
        val notFlagged = collected.count { it.isFavourite == false }
        val unknown = collected.count { it.isFavourite == null }
        return when {
            collected.isEmpty() -> check(title, ProbeOutcome.WARN, "No favourites found. Mark one photo as a favourite and run the probe again", facts, shape)
            notFlagged > 0 -> check(title, ProbeOutcome.FAIL, "The favourites listing contains items whose flag says they are not favourites", facts, shape)
            unknown > 0 -> check(title, ProbeOutcome.WARN, "Some listed favourites carry no favourite flag", facts, shape)
            !favouritesComplete -> check(title, ProbeOutcome.PASS, "Favourites are listed in bulk and flagged (more pages exist beyond the probe's limit)", facts, shape)
            else -> check(title, ProbeOutcome.PASS, "Favourites are listed in bulk and every one is flagged", facts, shape)
        }
    }

    private suspend fun checkFavouriteAgreement(): ProbeCheck {
        val title = "Favourites agree with library flags"
        if (favourites.isEmpty()) return check(title, ProbeOutcome.SKIPPED, "No favourites to cross-check", emptyList())

        val samples = spread(favourites, RunProbeUseCase.FAVOURITE_CROSS_CHECKS)
        var foundByDedup = 0
        var sameMediaKey = 0
        var flaggedInLibrary = 0
        for (favourite in samples) {
            val page = timed { connector.libraryPage(pageToken = null, takenAtOrBeforeMs = favourite.takenAtMs) }.also(::track)
            val match = page.items.firstOrNull { it.dedupKey == favourite.dedupKey } ?: continue
            foundByDedup++
            if (match.mediaKey == favourite.mediaKey) sameMediaKey++
            if (match.isFavourite == true) flaggedInLibrary++
        }

        val firstItems = firstPage?.items.orEmpty()
        val favouriteDedups = favourites.map { it.dedupKey }.toSet()
        val flaggedOnPage1 = firstItems.filter { it.isFavourite == true }
        val flaggedListed = flaggedOnPage1.count { it.dedupKey in favouriteDedups }
        val unflaggedListed = firstItems.count { it.isFavourite == false && it.dedupKey in favouriteDedups }

        val facts = listOf(
            ProbeFact("Favourites looked up by taken time", samples.size.toString()),
            ProbeFact("Found in library by dedup key", "${foundByDedup}/${samples.size}"),
            ProbeFact("Same media key in both listings", "${sameMediaKey}/${foundByDedup}"),
            ProbeFact("Library flag says favourite", "${flaggedInLibrary}/${foundByDedup}"),
            ProbeFact("Page-1 items flagged favourite", flaggedOnPage1.size.toString()),
            ProbeFact("…of those, in the favourites listing", if (favouritesComplete) flaggedListed.toString() else "listing not read to the end"),
            ProbeFact("Page-1 items not flagged but listed as favourite", unflaggedListed.toString()),
        )
        return when {
            flaggedInLibrary < foundByDedup || unflaggedListed > 0 ->
                check(title, ProbeOutcome.FAIL, "The library flag and the favourites listing disagree", facts)
            favouritesComplete && flaggedListed < flaggedOnPage1.size ->
                check(title, ProbeOutcome.FAIL, "Some library items flagged favourite are missing from the favourites listing", facts)
            foundByDedup < samples.size ->
                check(title, ProbeOutcome.WARN, "Some favourites were not found near their taken time; the time cursor may work differently", facts)
            else -> check(title, ProbeOutcome.PASS, "Both sources agree on every favourite checked", facts)
        }
    }

    private suspend fun checkAlbumList(): ProbeCheck {
        val title = "Album list"
        val collected = mutableListOf<Album>()
        var token: String? = null
        var pages = 0
        var shape: String? = null
        do {
            val page = timed { connector.albumsPage(token, includeShape = pages == 0) }
            accountFingerprints += page.accountFingerprint
            if (pages == 0) shape = page.shapeSample
            collected += page.albums
            token = page.nextPageToken
            pages++
        } while (token != null && pages < RunProbeUseCase.MAX_ALBUM_PAGES)
        albums = collected
        val complete = token == null
        val me = myActorId

        val kinds = collected.groupingBy { it.kindCode?.toString() ?: "none" }.eachCount()
            .entries.sortedBy { it.key }.joinToString(", ") { "code ${it.key}: ${it.value}" }
        val ownerFact = if (me != null) {
            "mine ${collected.count { it.ownerActorId == me }} / others ${collected.count { it.ownerActorId != null && it.ownerActorId != me }} / unknown ${collected.count { it.ownerActorId == null }}"
        } else {
            "${collected.mapNotNull { it.ownerActorId }.distinct().size} distinct owners (own actor not identified)"
        }
        val facts = listOf(
            ProbeFact("Pages read", pages.toString()),
            ProbeFact("Listing read to the end", yesNo(complete)),
            ProbeFact("Albums", collected.size.toString()),
            ProbeFact("Album type codes", kinds.ifEmpty { "none" }),
            ProbeFact("Shared flag: yes / no / unknown", triState(collected.map { it.isShared })),
            ProbeFact("Owner", ownerFact),
            ProbeFact("Albums without an item count", collected.count { it.reportedItemCount == null }.toString()),
            ProbeFact("Total reported album entries", collected.sumOf { it.reportedItemCount ?: 0 }.toString()),
        )
        val othersOwned = me != null && collected.any { it.ownerActorId != null && it.ownerActorId != me }
        return when {
            !complete -> check(title, ProbeOutcome.FAIL, "The album list did not reach its end within ${RunProbeUseCase.MAX_ALBUM_PAGES} pages", facts, shape)
            collected.isEmpty() -> check(title, ProbeOutcome.WARN, "No albums returned", facts, shape)
            !othersOwned -> check(title, ProbeOutcome.WARN, "No albums created by other people were listed. If you joined someone else's shared album, it is missing", facts, shape)
            else -> check(title, ProbeOutcome.PASS, "Own and joined albums are listed", facts, shape)
        }
    }

    private suspend fun checkAlbumContents(): ProbeCheck {
        val title = "Album contents link to library photos"
        val me = myActorId
        val chosen = listOfNotNull(
            albums.firstOrNull { it.isShared != true && (me == null || it.ownerActorId == me) }?.let { "own album" to it },
            albums.firstOrNull { it.isShared == true && (me == null || it.ownerActorId == me) }?.let { "own shared album" to it },
            albums.firstOrNull { me != null && it.ownerActorId != null && it.ownerActorId != me }?.let { "joined album" to it },
        ).distinctBy { it.second.albumKey }
        if (chosen.isEmpty()) return check(title, ProbeOutcome.SKIPPED, "No albums to inspect", emptyList())

        val facts = mutableListOf<ProbeFact>()
        var shape: String? = null
        var checkedMembers = 0
        var linkedByDedup = 0
        var sameMediaKey = 0
        var countMismatch = false
        for ((label, album) in chosen) {
            val page = timed { connector.albumItemsPage(album.albumKey, album.authKey, null, includeShape = shape == null) }
            accountFingerprints += page.accountFingerprint
            if (shape == null) shape = page.shapeSample
            val uploaders = if (me != null) {
                "me ${page.items.count { it.uploaderActorId == me }} / others ${page.items.count { it.uploaderActorId != null && it.uploaderActorId != me }} / unknown ${page.items.count { it.uploaderActorId == null }}"
            } else {
                "${page.items.mapNotNull { it.uploaderActorId }.distinct().size} distinct uploaders"
            }
            if (album.reportedItemCount != null && page.reportedItemCount != null && album.reportedItemCount != page.reportedItemCount) countMismatch = true
            facts += ProbeFact("[$label] entries on first page", page.items.size.toString())
            facts += ProbeFact("[$label] item count: album list / album page", "${album.reportedItemCount ?: "?"} / ${page.reportedItemCount ?: "?"}")
            facts += ProbeFact("[$label] more pages", yesNo(page.nextPageToken != null))
            facts += ProbeFact("[$label] uploaded by", uploaders)

            val mine = page.items.filter { me == null || it.uploaderActorId == me }
            for (member in spread(mine, RunProbeUseCase.MEMBER_CROSS_CHECKS)) {
                checkedMembers++
                val match = findInLibrary(member) ?: continue
                linkedByDedup++
                if (match.mediaKey == member.mediaKey) sameMediaKey++
            }
        }
        facts += ProbeFact("Own album entries looked up in the library", checkedMembers.toString())
        facts += ProbeFact("Found in library by dedup key", "$linkedByDedup/$checkedMembers")
        facts += ProbeFact("Same media key in album and library", "$sameMediaKey/$linkedByDedup")

        return when {
            checkedMembers == 0 -> check(title, ProbeOutcome.WARN, "No album entries uploaded by you to cross-check", facts, shape)
            linkedByDedup < checkedMembers -> check(title, ProbeOutcome.WARN, "Some album entries could not be found in the library by dedup key", facts, shape)
            countMismatch -> check(title, ProbeOutcome.WARN, "Album entries link to the library, but item counts differ between the two listings", facts, shape)
            else -> check(title, ProbeOutcome.PASS, "Album entries link to library photos by dedup key", facts, shape)
        }
    }

    private suspend fun checkPreviews(): ProbeCheck {
        val title = "Previews"
        val first = firstPage ?: return check(title, ProbeOutcome.SKIPPED, "Skipped: the first library page failed", emptyList())
        val candidates = first.items.filter { it.thumbUrl != null }.take(RunProbeUseCase.PREVIEW_SAMPLES)
        if (candidates.isEmpty()) return check(title, ProbeOutcome.FAIL, "No preview URLs in the library listing", emptyList())
        val failures = mutableListOf<String>()
        val sizes = mutableListOf<Int>()
        val types = mutableSetOf<String>()
        val startedAt = clock()
        for (item in candidates + candidates.first()) {
            try {
                val image = timed { connector.preview(checkNotNull(item.thumbUrl), RunProbeUseCase.PREVIEW_SIZE_PX) }
                sizes += image.bytes.size
                types += image.contentType
            } catch (e: ConnectorException) {
                failures += describe(e)
            }
        }
        val elapsedMs = (clock() - startedAt).coerceAtLeast(1)
        val facts = listOf(
            ProbeFact("Previews fetched (including one repeat)", "${sizes.size}/${candidates.size + 1}"),
            ProbeFact("Content types", types.sorted().joinToString().ifEmpty { "none" }),
            ProbeFact("Average size", if (sizes.isEmpty()) "-" else "${sizes.average().toInt() / 1024} KB"),
            ProbeFact("Throughput", "%.1f previews/s".format(sizes.size * 1000.0 / elapsedMs)),
        ) + failures.distinct().map { ProbeFact("Failure", it) }
        return if (failures.isEmpty()) {
            check(title, ProbeOutcome.PASS, "Previews download through the extension", facts)
        } else {
            check(title, ProbeOutcome.FAIL, "Some previews could not be fetched", facts)
        }
    }

    private fun requestSummary(): ProbeCheck {
        val title = "Requests"
        val sorted = latenciesMs.sorted()
        val facts = listOf(
            ProbeFact("Requests sent", (sorted.size + failuresByKind.values.sum()).toString()),
            ProbeFact("Median / max latency", if (sorted.isEmpty()) "-" else "${sorted[sorted.size / 2]} ms / ${sorted.last()} ms"),
            ProbeFact("Failures", failuresByKind.entries.joinToString { "${it.key}: ${it.value}" }.ifEmpty { "none" }),
            ProbeFact("Same account throughout", yesNo(accountFingerprints.size <= 1)),
        )
        return when {
            accountFingerprints.size > 1 -> check(title, ProbeOutcome.FAIL, "Responses came from more than one Google account", facts)
            failuresByKind.containsKey("RateLimited") -> check(title, ProbeOutcome.WARN, "Google rate-limited some requests", facts)
            else -> check(title, ProbeOutcome.PASS, "No rate limiting observed", facts)
        }
    }

    // endregion

    // region helpers

    private suspend fun findInLibrary(member: AlbumMember): LibraryItem? {
        val page = timed { connector.libraryPage(pageToken = null, takenAtOrBeforeMs = member.takenAtMs) }.also(::track)
        return page.items.firstOrNull { it.dedupKey == member.dedupKey }
    }

    private suspend fun <T> timed(block: suspend () -> T): T {
        delay(pacingMs)
        val start = clock()
        try {
            return block().also { latenciesMs += clock() - start }
        } catch (e: ConnectorException) {
            failuresByKind.merge(e.javaClass.simpleName, 1, Int::plus)
            throw e
        }
    }

    private fun track(page: LibraryPage) {
        accountFingerprints += page.accountFingerprint
    }

    private fun check(title: String, outcome: ProbeOutcome, summary: String, facts: List<ProbeFact>, shape: String? = null) =
        ProbeCheck(idOf(title), title, outcome, summary, facts, shape)

    private fun libraryFacts(items: List<LibraryItem>) = listOf(
        ProbeFact("Items", items.size.toString()),
        ProbeFact("Photos / videos / unknown type", "${items.count { it.mediaType == MediaType.PHOTO }} / ${items.count { it.mediaType == MediaType.VIDEO }} / ${items.count { it.mediaType == null }}"),
        ProbeFact("Favourite: yes / no / unknown", triState(items.map { it.isFavourite })),
        ProbeFact("Archived: yes / no / unknown", triState(items.map { it.isArchived })),
        ProbeFact("Owned: yes / no / unknown", triState(items.map { it.isOwned })),
        ProbeFact("Uploader actor present", items.count { it.uploaderActorId != null }.toString()),
        ProbeFact("Preview URL present", items.count { it.thumbUrl != null }.toString()),
    )

    private fun triState(values: List<Boolean?>) =
        "${values.count { it == true }} / ${values.count { it == false }} / ${values.count { it == null }}"

    private fun yesNo(value: Boolean) = if (value) "yes" else "no"

    private fun describe(e: ConnectorException): String = "${e.javaClass.simpleName}: ${e.message}"

    private fun idOf(title: String) = title.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')

    /** Up to [count] elements spread across the list (first, middle, last…). */
    private fun <T> spread(list: List<T>, count: Int): List<T> {
        if (list.size <= count) return list
        return (0 until count).map { list[it * (list.size - 1) / (count - 1).coerceAtLeast(1)] }.distinct()
    }

    // endregion
}
