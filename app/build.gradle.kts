import java.io.RandomAccessFile
import org.jetbrains.compose.desktop.application.dsl.TargetFormat

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.compose.multiplatform)
}

dependencies {
    implementation(project(":core:design"))
    implementation(project(":core:storage"))
    implementation(project(":services:connector"))
    implementation(project(":repositories:inventory"))
    implementation(project(":features:shared:protection"))
    implementation(project(":features:shared:duplicates"))
    implementation(project(":features:scan"))
    implementation(project(":features:sample"))
    implementation(project(":features:calibration"))
    implementation(project(":features:duplicates"))
    implementation(project(":features:sweep"))
    implementation(project(":features:shared:previews"))
    implementation(project(":features:shared:embeddings"))
    implementation(project(":repositories:analysis"))
    implementation(project(":services:inference"))
    implementation(project(":services:trash"))
    implementation(project(":repositories:review"))
    implementation(libs.slf4j.api)
    implementation(project(":features:connection"))
    implementation(project(":features:probe"))
    implementation(compose.desktop.currentOs)
    implementation(libs.kotlinx.coroutines.swing)
    implementation(libs.jetbrains.lifecycle.viewmodel.compose)
    runtimeOnly(libs.logback.classic)

    testImplementation(libs.kotlin.test)
}

tasks.test {
    useJUnitPlatform()
}

tasks.register<JavaExec>("printInventoryReport") {
    description = "Prints the latest inventory report (counts only) using the app's classification rules."
    group = "photo cleaner"
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("dev.photocleaner.app.ReportCliKt")
}

tasks.register<JavaExec>("printCalibrationReport") {
    description = "Prints calibration score distributions and threshold tables (scores and counts only)."
    group = "photo cleaner"
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("dev.photocleaner.app.ReportCliKt")
    args("calibration")
}

tasks.register<JavaExec>("printGroupsReport") {
    description = "Prints duplicate group statistics (counts only)."
    group = "photo cleaner"
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("dev.photocleaner.app.ReportCliKt")
    args("groups")
}

val workerDirArg = "-Dphotocleaner.workerDir=${rootDir.resolve("worker").absolutePath}"

/*
 * Runs the app from its own copy of the built jars, one folder per launch, so rebuilding
 * the project never swaps classes under a running app (which crashed it). Folders of
 * earlier launches are removed unless that launch is still running (it holds app.lock).
 */
tasks.register<JavaExec>("launch") {
    description = "Starts Photo Cleaner from a private copy of the build, safe against rebuilds while it runs."
    group = "photo cleaner"
    dependsOn(tasks.jar)
    val runtime = configurations.runtimeClasspath
    val appJar = tasks.jar.flatMap { it.archiveFile }
    val stagingRoot = layout.buildDirectory.dir("staged-runs")
    mainClass.set("dev.photocleaner.app.MainKt")
    jvmArgs(workerDirArg)
    doFirst {
        val root = stagingRoot.get().asFile
        root.listFiles()?.filter { it.isDirectory }?.forEach { old ->
            val lock = File(old, "app.lock")
            val free = !lock.exists() || RandomAccessFile(lock, "rw").use { raf -> raf.channel.tryLock()?.also { it.release() } != null }
            if (free) old.deleteRecursively()
        }
        val dir = File(root, System.currentTimeMillis().toString()).apply { mkdirs() }
        // Several modules produce a jar called domain.jar, so copies are numbered.
        val copies = (listOf(appJar.get().asFile) + runtime.get().files).mapIndexed { index, file ->
            file.copyTo(File(dir, "%03d-%s".format(index, file.name)))
        }
        classpath = files(copies)
        jvmArgs("-Dphotocleaner.stageDir=${dir.absolutePath}")
    }
}

compose.desktop {
    application {
        mainClass = "dev.photocleaner.app.MainKt"
        jvmArgs += workerDirArg
        nativeDistributions {
            targetFormats(TargetFormat.Msi)
            packageName = "PhotoCleaner"
            packageVersion = "0.1.0"
        }
    }
}
