package dev.photocleaner.app

import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.WindowPlacement
import androidx.compose.ui.window.WindowPosition
import java.awt.GraphicsEnvironment
import java.awt.Rectangle
import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.Properties
import org.slf4j.LoggerFactory

/** Where the window was: its normal (non-maximised) bounds, whether it was maximised, and the tab that was open. */
data class WindowPlacementSnapshot(
    val maximized: Boolean,
    val x: Float?,
    val y: Float?,
    val width: Float,
    val height: Float,
    /** Title of the open tab, null before one was ever chosen. */
    val tab: String? = null,
) {
    val placement: WindowPlacement get() = if (maximized) WindowPlacement.Maximized else WindowPlacement.Floating
    val position: WindowPosition get() = if (x != null && y != null) WindowPosition(x.dp, y.dp) else WindowPosition.PlatformDefault
    val size: DpSize get() = DpSize(width.dp, height.dp)

    companion object {
        val Default = WindowPlacementSnapshot(maximized = false, x = null, y = null, width = 1100f, height = 900f)
    }
}

/**
 * Folds the window's live state into what should be remembered: the normal bounds are
 * only updated while the window is not maximised, so un-maximising next time restores them.
 */
fun WindowPlacementSnapshot.updatedWith(placement: WindowPlacement, position: WindowPosition, size: DpSize): WindowPlacementSnapshot {
    val maximized = placement != WindowPlacement.Floating
    return if (!maximized && position is WindowPosition.Absolute) {
        copy(maximized = false, x = position.x.value, y = position.y.value, width = size.width.value, height = size.height.value)
    } else {
        copy(maximized = maximized)
    }
}

/** Remembers the window placement between launches in a small properties file. */
class WindowPlacementStore(private val file: Path) {

    private val log = LoggerFactory.getLogger(WindowPlacementStore::class.java)

    fun load(): WindowPlacementSnapshot {
        if (!Files.exists(file)) return WindowPlacementSnapshot.Default
        val saved = try {
            val props = Properties().apply { Files.newBufferedReader(file).use(::load) }
            WindowPlacementSnapshot(
                maximized = props.getProperty("maximized") == "true",
                x = props.getProperty("x")?.toFloatOrNull(),
                y = props.getProperty("y")?.toFloatOrNull(),
                width = props.getProperty("width")?.toFloatOrNull() ?: WindowPlacementSnapshot.Default.width,
                height = props.getProperty("height")?.toFloatOrNull() ?: WindowPlacementSnapshot.Default.height,
                tab = props.getProperty("tab"),
            )
        } catch (e: IOException) {
            log.warn("Could not read the saved window placement: {}", e.message)
            return WindowPlacementSnapshot.Default
        }
        // A monitor may have been unplugged since: only reuse a position that is still on a screen.
        return if (isOnScreen(saved)) saved else saved.copy(x = null, y = null)
    }

    fun save(snapshot: WindowPlacementSnapshot) {
        val props = Properties().apply {
            setProperty("maximized", snapshot.maximized.toString())
            snapshot.x?.let { setProperty("x", it.toString()) }
            snapshot.y?.let { setProperty("y", it.toString()) }
            setProperty("width", snapshot.width.toString())
            setProperty("height", snapshot.height.toString())
            snapshot.tab?.let { setProperty("tab", it) }
        }
        try {
            Files.createDirectories(file.parent)
            val temp = file.resolveSibling(file.fileName.toString() + ".tmp")
            Files.newBufferedWriter(temp).use { props.store(it, "Photo Cleaner window placement") }
            Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        } catch (e: IOException) {
            log.warn("Could not save the window placement: {}", e.message)
        }
    }

    private fun isOnScreen(snapshot: WindowPlacementSnapshot): Boolean {
        val x = snapshot.x ?: return false
        val y = snapshot.y ?: return false
        // At least the top-left 100×50 of the window (its title bar) must be on some screen.
        val titleBar = Rectangle(x.toInt(), y.toInt(), 100, 50)
        return GraphicsEnvironment.getLocalGraphicsEnvironment().screenDevices.any { it.defaultConfiguration.bounds.intersects(titleBar) }
    }
}
