package dev.photocleaner.app

import java.io.RandomAccessFile
import java.nio.channels.FileLock
import java.nio.file.Path
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.slf4j.LoggerFactory

/**
 * Unexpected errors: always written to the app log and shown in the window,
 * instead of closing the app.
 */
object AppErrors {
    private val log = LoggerFactory.getLogger(AppErrors::class.java)
    private val mutableMessage = MutableStateFlow<String?>(null)

    /** The latest unexpected error for the user, or null. */
    val message: StateFlow<String?> = mutableMessage.asStateFlow()

    fun report(where: String, error: Throwable) {
        log.error("Unexpected error in {}", where, error)
        mutableMessage.value = "Something went wrong (${error.javaClass.simpleName}: ${error.message ?: "no details"}). " +
            "The app keeps running; details are in the log."
    }

    fun dismiss() {
        mutableMessage.value = null
    }

    /** Errors on any thread end up in the log and the window. */
    fun installThreadHandler() {
        Thread.setDefaultUncaughtExceptionHandler { thread, error -> report("thread ${thread.name}", error) }
    }
}

/**
 * Marks the staged copy this process runs from as in use, so the next launch does
 * not delete it. Held until the process exits.
 */
object StagedRunLock {
    @Suppress("unused") // kept referenced so the lock is not released early
    private var lock: FileLock? = null

    fun holdIfStaged() {
        val dir = System.getProperty("photocleaner.stageDir") ?: return
        val file = RandomAccessFile(Path.of(dir, "app.lock").toFile(), "rw")
        lock = file.channel.tryLock()
    }
}
