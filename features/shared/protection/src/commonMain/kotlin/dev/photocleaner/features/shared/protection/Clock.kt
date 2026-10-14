package dev.photocleaner.features.shared.protection

/** Milliseconds since the epoch, on whichever platform the rules run. */
internal expect fun currentTimeMs(): Long
