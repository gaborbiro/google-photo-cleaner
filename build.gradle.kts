plugins {
    alias(libs.plugins.kotlin.multiplatform) apply false
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
