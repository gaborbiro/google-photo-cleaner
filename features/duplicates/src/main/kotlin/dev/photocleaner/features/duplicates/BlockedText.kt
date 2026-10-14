package dev.photocleaner.features.duplicates

import dev.photocleaner.features.shared.duplicates.model.GroupsBlocked

/** Why no duplicate can be proposed yet, in the desktop app's words (it names its tabs). */
fun GroupsBlocked.text(): String = when (this) {
    GroupsBlocked.NOT_SCANNED -> "The library has not been scanned yet. Start on the Scan library tab."
    GroupsBlocked.SCAN_UNFINISHED -> "The library scan is unfinished, so no photo can be proposed. Finish it on the Scan library tab."
    GroupsBlocked.SCAN_STALE -> "The library scan is more than a day old. Scan again on the Scan library tab (about 2–3 minutes)."
}
