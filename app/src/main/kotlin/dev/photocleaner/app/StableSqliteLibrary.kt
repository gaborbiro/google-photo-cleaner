package dev.photocleaner.app

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import org.slf4j.LoggerFactory

/**
 * sqlite-jdbc normally unpacks its native DLL into %TEMP% under a new random name on
 * every launch. Windows Smart App Control judges each such new file and has blocked it
 * intermittently. Unpacking it once to a fixed, content-named file under the app's data
 * folder and loading it from there gives Windows one stable file to judge.
 */
object StableSqliteLibrary {

    private val log = LoggerFactory.getLogger(StableSqliteLibrary::class.java)
    private const val RESOURCE = "/org/sqlite/native/Windows/x86_64/sqlitejdbc.dll"

    /** Must run before the first database is opened. */
    fun install(directory: Path) {
        val bytes = StableSqliteLibrary::class.java.getResourceAsStream(RESOURCE)?.use { it.readAllBytes() }
        checkNotNull(bytes) { "SQLite native library $RESOURCE not found on the classpath" }
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).take(8).joinToString("") { "%02x".format(it) }
        val name = "sqlitejdbc-$hash.dll"
        val target = directory.resolve(name)
        // Remove copies of other versions (e.g. one Windows refused to load).
        if (Files.isDirectory(directory)) {
            Files.list(directory).use { files ->
                files.filter { it.fileName.toString().startsWith("sqlitejdbc-") && it.fileName.toString() != name }.forEach { old ->
                    try {
                        Files.delete(old)
                    } catch (e: java.io.IOException) {
                        log.warn("Could not remove the old SQLite native library {}: {}", old.fileName, e.message)
                    }
                }
            }
        }
        if (!Files.exists(target) || Files.size(target) != bytes.size.toLong()) {
            Files.createDirectories(directory)
            val temp = Files.createTempFile(directory, "sqlitejdbc", ".part")
            Files.write(temp, bytes)
            Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
            log.info("Installed the SQLite native library as {}", name)
        }
        // Read by org.sqlite.SQLiteJDBCLoader: load this file instead of extracting a temporary copy.
        System.setProperty("org.sqlite.lib.path", directory.toAbsolutePath().toString())
        System.setProperty("org.sqlite.lib.name", name)
    }
}
