package dev.photocleaner.features.shared.protection

/**
 * The form of Google's dedup key, the ID every copy of a photo shares and the one trash requests
 * name: 27 letters, digits, - and _, rarely followed by ":" and 11 to 16 more. Google also sends
 * other forms (18 characters with others among them, on an item from 2012, seen October 2026). An
 * item with one is read, but never trashed.
 */
internal object DedupKeys {
    private val USUAL = Regex("[A-Za-z0-9_-]{27}(?::[A-Za-z0-9_-]{11,16})?")

    fun isUsual(key: String): Boolean = USUAL.matches(key)
}
