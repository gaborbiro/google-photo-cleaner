package dev.photocleaner.features.shared.protection

import kotlin.js.Date

internal actual fun currentTimeMs(): Long = Date.now().toLong()
