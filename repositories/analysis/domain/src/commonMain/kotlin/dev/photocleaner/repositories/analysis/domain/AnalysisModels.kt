package dev.photocleaner.repositories.analysis.domain

enum class PairLabel {
    /** The same photo: identical, re-saved, resized or lightly edited. */
    SAME,

    /** The same moment (burst, retake); only one is worth keeping. */
    NEAR_DUPLICATE,

    /** Different photos; keep both. */
    DIFFERENT,
}
