package dev.photocleaner.services.trash

import dev.photocleaner.services.trash.domain.TrashOutcome
import dev.photocleaner.services.trash.domain.TrashService
import dev.photocleaner.services.trash.domain.TrashTarget
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import kotlin.random.Random
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Stands in for Google Photos' trash: records which photos *would* be in the trash,
 * in a local file, so queue states, restarts and undo can be exercised end to end.
 * Nothing is sent to Google. [failureRate] injects per-item failures for testing.
 */
class SimulatedTrashService(
    private val stateFile: Path,
    private val latencyMs: Long = 300,
    private val failureRate: Double = 0.0,
    private val random: Random = Random.Default,
) : TrashService {

    private val mutex = Mutex()
    private val trashed: MutableSet<String> = load()

    override val isSimulated: Boolean = true

    override suspend fun moveToTrash(targets: List<TrashTarget>): List<TrashOutcome> = change(targets) { trashed.add(it) }

    override suspend fun restore(targets: List<TrashTarget>): List<TrashOutcome> = change(targets) { trashed.remove(it) }

    override suspend fun inTrash(dedupKeys: Collection<String>): Map<String, Boolean> = mutex.withLock {
        dedupKeys.associateWith { it in trashed }
    }

    private suspend fun change(targets: List<TrashTarget>, apply: (String) -> Unit): List<TrashOutcome> {
        delay(latencyMs)
        return mutex.withLock {
            val outcomes = targets.map { target ->
                if (random.nextDouble() < failureRate) {
                    TrashOutcome(target.dedupKey, succeeded = false, error = "Simulated failure")
                } else {
                    apply(target.dedupKey)
                    TrashOutcome(target.dedupKey, succeeded = true, error = null)
                }
            }
            save()
            outcomes
        }
    }

    private fun load(): MutableSet<String> =
        if (Files.exists(stateFile)) Files.readAllLines(stateFile).filter { it.isNotBlank() }.toMutableSet() else mutableSetOf()

    private suspend fun save() = withContext(Dispatchers.IO) {
        Files.createDirectories(stateFile.parent)
        val temp = stateFile.resolveSibling(stateFile.fileName.toString() + ".tmp")
        Files.write(temp, trashed.sorted())
        Files.move(temp, stateFile, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    }
}
