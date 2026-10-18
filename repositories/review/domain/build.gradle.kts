// Review decisions: the models the review queue rules read. Multiplatform: compiled to JavaScript for
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
