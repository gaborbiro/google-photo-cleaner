// Review decisions and trash jobs: models and the repository contract. Multiplatform: the desktop
// app uses the JVM build, the browser extension the JavaScript one (through features:shared:duplicates).
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
