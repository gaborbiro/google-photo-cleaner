// Library data types and the repository contract. Multiplatform: the desktop app uses the JVM
// build, the browser extension the JavaScript one (through features:shared:protection).
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
