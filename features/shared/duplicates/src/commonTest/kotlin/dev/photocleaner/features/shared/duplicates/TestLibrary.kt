package dev.photocleaner.features.shared.duplicates

import dev.photocleaner.features.shared.duplicates.model.PhotoAnalysis
import dev.photocleaner.features.shared.protection.InventoryClassifier
import dev.photocleaner.features.shared.protection.model.InventoryClassification
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.InventorySnapshot
import dev.photocleaner.repositories.inventory.domain.PhaseCursor
import dev.photocleaner.repositories.inventory.domain.RunStatus
import dev.photocleaner.repositories.inventory.domain.ScanPhase
import dev.photocleaner.repositories.inventory.domain.ScanRun
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

internal const val NOW = 5_000_000_000L

/** A dedup key of the usual form (27 characters) made from [label], as Google sends them. */
internal fun dedupKey(label: String): String = "d-$label".padEnd(27, 'x').also { require(it.length == 27) { "label too long: $label" } }

/** A synthetic photo: [angleDeg] places its unit vector, so photos 10° apart score cos(10°) ≈ 0.985. */
internal data class Spec(
    val key: String,
    val takenAtMs: Long,
    val angleDeg: Double,
    val favourite: Boolean = false,
    /** Null: the scan didn't get the archived flag, so the photo's status is unknown. */
    val archived: Boolean? = false,
    val sharpness: Double = 100.0,
    val width: Int = 4000,
    val height: Int = 3000,
    val uploadedAtMs: Long = 1_000,
    val mediaType: StoredMediaType = StoredMediaType.PHOTO,
)

internal fun unit(angleDeg: Double): FloatArray = (angleDeg * PI / 180).let { floatArrayOf(cos(it).toFloat(), sin(it).toFloat()) }

/** A library scan that found exactly [specs], classified by the shared protection rules. */
internal fun classification(specs: List<Spec>, complete: Boolean = true, finishedAtMs: Long = NOW): InventoryClassification {
    val snapshot = InventorySnapshot(
        run = ScanRun(1, "account-a", finishedAtMs - 60_000, finishedAtMs, if (complete) RunStatus.COMPLETED else RunStatus.PAUSED, null),
        cursors = listOf(ScanPhase.LIBRARY, ScanPhase.FAVOURITES, ScanPhase.ARCHIVE, ScanPhase.ALBUM_LIST).map {
            PhaseCursor(it, "", null, 1, 0, 0, completed = complete)
        },
        items = specs.map {
            InventoryItem(it.key, dedupKey(it.key), it.takenAtMs, it.mediaType, it.favourite, it.archived, true, it.width, it.height, null)
        },
        favouriteDedupKeys = specs.filter { it.favourite }.map { dedupKey(it.key) }.toSet(),
        archivedDedupKeys = emptySet(),
        albums = emptyList(),
        albumMembership = emptyMap(),
    )
    return InventoryClassifier.classify(snapshot, NOW)
}

internal fun analyses(specs: List<Spec>): Map<String, PhotoAnalysis> = specs.associate {
    it.key to PhotoAnalysis(unit(it.angleDeg), it.sharpness, 0.0, NOW, it.uploadedAtMs, it.width, it.height)
}
