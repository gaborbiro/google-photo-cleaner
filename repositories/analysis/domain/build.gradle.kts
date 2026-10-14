// Embeddings, photo facts and calibration labels: models and the repository contracts.
// Multiplatform: the desktop app uses the JVM build, the browser extension the JavaScript one
// (through features:shared:duplicates).
plugins {
    alias(libs.plugins.kotlin.multiplatform)
}

kotlin {
    jvm()
    js {
        browser()
    }

    sourceSets {
        commonMain.dependencies {
            api(libs.kotlinx.coroutines.core)
        }
    }
}
