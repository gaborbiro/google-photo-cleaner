package dev.photocleaner.app

import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.WindowPlacement
import androidx.compose.ui.window.WindowPosition
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals

class WindowPlacementStoreTest {

    @Test
    fun `maximising keeps the normal bounds for un-maximising later`() {
        val normal = WindowPlacementSnapshot.Default.updatedWith(WindowPlacement.Floating, WindowPosition(100.dp, 80.dp), DpSize(1200.dp, 800.dp))
        val maximised = normal.updatedWith(WindowPlacement.Maximized, WindowPosition(0.dp, 0.dp), DpSize(2560.dp, 1400.dp))
        assertEquals(WindowPlacementSnapshot(true, 100f, 80f, 1200f, 800f), maximised)
    }

    @Test
    fun `placement survives a save and load`() {
        val store = WindowPlacementStore(Files.createTempDirectory("window").resolve("window.properties"))
        val snapshot = WindowPlacementSnapshot(maximized = true, x = 10f, y = 20f, width = 1000f, height = 700f)
        store.save(snapshot)
        assertEquals(snapshot.copy(x = store.load().x, y = store.load().y), store.load())
        assertEquals(true, store.load().maximized)
        assertEquals(1000f, store.load().width)
    }

    @Test
    fun `the open tab survives a save and load and moving the window`() {
        val store = WindowPlacementStore(Files.createTempDirectory("window").resolve("window.properties"))
        store.save(WindowPlacementSnapshot.Default.copy(tab = "Search"))
        val moved = store.load().updatedWith(WindowPlacementSnapshot.Default.placement, WindowPosition(5.dp, 5.dp), DpSize(900.dp, 700.dp))
        assertEquals("Search", moved.tab)
    }

    @Test
    fun `a missing file gives the default placement`() {
        val store = WindowPlacementStore(Files.createTempDirectory("window").resolve("none.properties"))
        assertEquals(WindowPlacementSnapshot.Default, store.load())
    }
}
