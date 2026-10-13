package dev.photocleaner.services.trash.domain

data class TrashTarget(val mediaKey: String, val dedupKey: String)

data class TrashOutcome(val dedupKey: String, val succeeded: Boolean, val error: String?)

/**
 * Moves photos to Google Photos' trash and back. Never empties the trash and
 * never deletes permanently. This milestone only ships a simulated implementation.
 */
interface TrashService {
    /** True when nothing really leaves the user's library. */
    val isSimulated: Boolean

    suspend fun moveToTrash(targets: List<TrashTarget>): List<TrashOutcome>

    suspend fun restore(targets: List<TrashTarget>): List<TrashOutcome>

    /** Current trash membership, used to reconcile requests whose outcome is unknown. */
    suspend fun inTrash(dedupKeys: Collection<String>): Map<String, Boolean>
}
