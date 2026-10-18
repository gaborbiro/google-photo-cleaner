// Calibration labels: the model the calibration report reads. Multiplatform: compiled to JavaScript for
// the extension (through features:shared:duplicates) and tested on the JVM.
plugins {
    alias(libs.plugins.kotlin.multiplatform)
}

kotlin {
    jvm()
    js {
        browser()
    }
}
