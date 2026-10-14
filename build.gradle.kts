plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.compose.multiplatform) apply false
    alias(libs.plugins.sqldelight) apply false
}

// Kotlin/JS (the protection rules compiled for the browser extension) uses the Node.js and npm
// installed on this computer instead of downloading its own, which would also add download
// repositories that settings.gradle.kts forbids.
allprojects {
    plugins.withType<org.jetbrains.kotlin.gradle.targets.js.nodejs.NodeJsRootPlugin> {
        extensions.getByType<org.jetbrains.kotlin.gradle.targets.js.nodejs.NodeJsEnvSpec>().download.set(false)
    }
    plugins.withType<org.jetbrains.kotlin.gradle.targets.js.nodejs.NodeJsPlugin> {
        extensions.getByType<org.jetbrains.kotlin.gradle.targets.js.nodejs.NodeJsEnvSpec>().download.set(false)
    }
}

// SQLDelight's driver brings in a newer sqlite-jdbc whose native DLL Windows Smart App
// Control blocks here; force the pinned version everywhere (see libs.versions.toml).
val sqliteJdbcVersion = libs.versions.sqlite.jdbc.get()
subprojects {
    configurations.configureEach {
        resolutionStrategy.force("org.xerial:sqlite-jdbc:$sqliteJdbcVersion")
    }
}
