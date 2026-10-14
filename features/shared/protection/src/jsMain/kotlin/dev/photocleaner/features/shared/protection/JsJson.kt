package dev.photocleaner.features.shared.protection

import dev.photocleaner.repositories.inventory.domain.AlbumRecord
import dev.photocleaner.repositories.inventory.domain.AlbumStatus
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.InventorySnapshot
import dev.photocleaner.repositories.inventory.domain.PhaseCursor
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.ScanPhase
import dev.photocleaner.repositories.inventory.domain.ScanRun
import dev.photocleaner.repositories.inventory.domain.StoredMediaType

/**
 * Strict reading and writing of JSON parsed in JavaScript, for the rules' exports: every field
 * is checked, and a missing required one is an error, not a default.
 */
object JsJson {
    fun field(o: dynamic, name: String): dynamic {
        val value = o[name]
        if (value === undefined) throw IllegalArgumentException("Field '$name' is missing")
        return value
    }

    // `dynamic` values are first held as `Any?`, so the checks below are Kotlin checks, not JavaScript calls.
    private fun value(o: dynamic, name: String): Any? = field(o, name)

    fun string(o: dynamic, name: String): String = value(o, name) as? String ?: throw IllegalArgumentException("'$name' must be a string")
    fun stringOrNull(o: dynamic, name: String): String? {
        val v = value(o, name) ?: return null
        return v as? String ?: throw IllegalArgumentException("'$name' must be a string")
    }
    fun double(o: dynamic, name: String): Double = (value(o, name) as? Number ?: throw IllegalArgumentException("'$name' must be a number")).toDouble()
    fun long(o: dynamic, name: String): Long = (value(o, name) as? Number ?: throw IllegalArgumentException("'$name' must be a number")).toLong()
    fun longOrNull(o: dynamic, name: String): Long? {
        val v = value(o, name) ?: return null
        return (v as? Number ?: throw IllegalArgumentException("'$name' must be a number")).toLong()
    }
    fun int(o: dynamic, name: String): Int = long(o, name).toInt()
    fun intOrNull(o: dynamic, name: String): Int? = longOrNull(o, name)?.toInt()
    fun bool(o: dynamic, name: String): Boolean = value(o, name) as? Boolean ?: throw IllegalArgumentException("'$name' must be true or false")
    fun boolOrNull(o: dynamic, name: String): Boolean? {
        val v = value(o, name) ?: return null
        return v as? Boolean ?: throw IllegalArgumentException("'$name' must be true or false")
    }
    fun array(o: dynamic, name: String): Array<dynamic> = value(o, name) as? Array<dynamic> ?: throw IllegalArgumentException("'$name' must be a list")
    fun list(raw: dynamic, what: String): Array<dynamic> = (raw as Any?) as? Array<dynamic> ?: throw IllegalArgumentException("$what must be a list")
    fun strings(o: dynamic, name: String): Set<String> =
        array(o, name).map { e -> (e as Any?) as? String ?: throw IllegalArgumentException("'$name' must hold strings") }.toSet()

    fun obj(vararg pairs: Pair<String, Any?>): dynamic {
        val o: dynamic = js("({})")
        for ((k, v) in pairs) o[k] = v
        return o
    }

    /** A scan snapshot in the shape of [InventorySnapshot] (see extension/src/app/scan/snapshot.ts). */
    fun inventorySnapshot(raw: dynamic): InventorySnapshot {
        val run = field(raw, "run")
        val membership = field(raw, "albumMembership")
        return InventorySnapshot(
            run = ScanRun(
                id = long(run, "id"),
                accountFingerprint = string(run, "accountFingerprint"),
                startedAtMs = long(run, "startedAtMs"),
                finishedAtMs = longOrNull(run, "finishedAtMs"),
                status = RunStatus.valueOf(string(run, "status")),
                statusReason = stringOrNull(run, "statusReason"),
            ),
            cursors = array(raw, "cursors").map { c ->
                PhaseCursor(
                    phase = ScanPhase.valueOf(string(c, "phase")),
                    scope = string(c, "scope"),
                    nextPageToken = stringOrNull(c, "nextPageToken"),
                    pagesDone = int(c, "pagesDone"),
                    entriesSeen = int(c, "entriesSeen"),
                    duplicateEntries = int(c, "duplicateEntries"),
                    completed = bool(c, "completed"),
                )
            },
            items = array(raw, "items").map { i ->
                InventoryItem(
                    mediaKey = string(i, "mediaKey"),
                    dedupKey = string(i, "dedupKey"),
                    takenAtMs = long(i, "takenAtMs"),
                    mediaType = stringOrNull(i, "mediaType")?.let { StoredMediaType.valueOf(it) },
                    isFavourite = boolOrNull(i, "isFavourite"),
                    isArchived = boolOrNull(i, "isArchived"),
                    isOwned = boolOrNull(i, "isOwned"),
                    width = intOrNull(i, "width"),
                    height = intOrNull(i, "height"),
                    thumbUrl = stringOrNull(i, "thumbUrl"),
                )
            },
            favouriteDedupKeys = strings(raw, "favouriteDedupKeys"),
            archivedDedupKeys = strings(raw, "archivedDedupKeys"),
            albums = array(raw, "albums").map { s ->
                val a = field(s, "album")
                AlbumStatus(
                    album = AlbumRecord(
                        albumKey = string(a, "albumKey"),
                        title = stringOrNull(a, "title"),
                        ownerActorId = stringOrNull(a, "ownerActorId"),
                        isShared = boolOrNull(a, "isShared"),
                        kindCode = intOrNull(a, "kindCode"),
                        reportedItemCount = intOrNull(a, "reportedItemCount"),
                        authKey = stringOrNull(a, "authKey"),
                    ),
                    membersSeen = int(s, "membersSeen"),
                    membersComplete = bool(s, "membersComplete"),
                    failureReason = stringOrNull(s, "failureReason"),
                )
            },
            albumMembership = js("Object").keys(membership).unsafeCast<Array<String>>().associateWith { key ->
                val albums = (membership[key] as Any?) as? Array<*> ?: throw IllegalArgumentException("albumMembership values must be lists")
                albums.map { e -> e as? String ?: throw IllegalArgumentException("albumMembership must hold album keys") }.toSet()
            },
        )
    }
}
