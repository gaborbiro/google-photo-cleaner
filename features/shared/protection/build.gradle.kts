// The protection rules: what makes a photo protected, eligible or unknown. Multiplatform: compiled
// to JavaScript for the extension and tested on the JVM.
plugins {
    alias(libs.plugins.kotlin.multiplatform)
}

kotlin {
    jvm()
    js {
        browser()
        // Exported to the extension by features:shared:duplicates, the one entry point.
    }

    sourceSets {
        commonMain.dependencies {
            api(project(":repositories:inventory:domain"))
        }
    }
}
