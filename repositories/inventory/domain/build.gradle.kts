// Library data types: what a scan records, for the protection rules. Multiplatform: compiled to
// JavaScript for the extension (through features:shared:protection) and tested on the JVM.
plugins {
    alias(libs.plugins.kotlin.multiplatform)
}

kotlin {
    jvm()
    js {
        browser()
    }
}
