// Browser AI test, step 1: exports the labelled calibration photos for the browser test page.
// Spike only; the desktop app does not depend on it.
plugins {
    alias(libs.plugins.kotlin.jvm)
}

dependencies {
    implementation(project(":app"))
    implementation(project(":core:storage"))
    implementation(project(":services:connector"))
    implementation(project(":services:connector:domain"))
    implementation(project(":repositories:analysis"))
    implementation(project(":repositories:analysis:domain"))
    implementation(project(":repositories:inventory"))
    implementation(project(":repositories:inventory:domain"))
    implementation(project(":repositories:review"))
    implementation(project(":repositories:review:domain"))
    implementation(project(":features:shared:protection"))
    implementation(project(":features:shared:duplicates"))
    implementation(project(":features:shared:previews"))
    implementation(project(":features:shared:embeddings"))
    implementation(project(":features:calibration"))
    implementation(project(":features:duplicates"))
    implementation(libs.kotlinx.coroutines.core)
    runtimeOnly(libs.logback.classic)
}

tasks.register<JavaExec>("exportCalibrationPhotos") {
    description = "Saves the labelled calibration photos, labels and desktop vectors for the browser AI test."
    group = "photo cleaner spikes"
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("dev.photocleaner.spikes.browserai.ExportCalibrationPhotosKt")
    args(layout.projectDirectory.dir("../data").asFile.absolutePath)
}

tasks.register<JavaExec>("exportSearchPhotos") {
    description = "Saves the photos of approved Search sweeps plus random others, with desktop vectors, for the search test."
    group = "photo cleaner spikes"
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("dev.photocleaner.spikes.browserai.search.ExportSearchPhotosKt")
    args(layout.projectDirectory.dir("../data").asFile.absolutePath)
}
