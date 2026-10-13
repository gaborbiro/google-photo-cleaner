package dev.photocleaner.core.storage

import java.nio.file.Files
import java.nio.file.Path

/** Per-user application data, outside any source tree. */
class AppPaths(val root: Path) {

    val pairingTokenFile: Path get() = root.resolve("pairing-token")
    val probeReportsDir: Path get() = root.resolve("probe")
    val logsDir: Path get() = root.resolve("logs")
    val inventoryDatabase: Path get() = root.resolve("inventory.db")
    val analysisDatabase: Path get() = root.resolve("analysis.db")
    val reviewDatabase: Path get() = root.resolve("review.db")
    val nativeLibrariesDir: Path get() = root.resolve("native")
    val windowPlacementFile: Path get() = root.resolve("window.properties")
    val simulatedTrashFile: Path get() = root.resolve("simulated-trash.txt")

    fun ensureCreated(): AppPaths {
        Files.createDirectories(root)
        return this
    }

    companion object {
        fun forCurrentUser(): AppPaths {
            val localAppData = System.getenv("LOCALAPPDATA")
            checkNotNull(localAppData) { "LOCALAPPDATA is not set; Photo Cleaner currently supports Windows only" }
            return AppPaths(Path.of(localAppData, "PhotoCleaner"))
        }
    }
}
