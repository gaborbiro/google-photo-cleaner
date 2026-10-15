package dev.photocleaner.features.shared.protection.model

/**
 * Which kinds of photo the user wants protected (never trashed). All on unless the user turns one
 * off. Photos of unknown status are always protected: that is not a choice.
 */
data class ProtectionChoices(
    val favourites: Boolean = true,
    val albums: Boolean = true,
    val archived: Boolean = true,
) {
    fun covers(reason: ProtectionReason): Boolean = when (reason) {
        ProtectionReason.FAVOURITE -> favourites
        ProtectionReason.IN_ALBUM -> albums
        ProtectionReason.ARCHIVED -> archived
    }

    companion object {
        val ALL = ProtectionChoices()
    }
}
