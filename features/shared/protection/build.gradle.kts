// The protection rules: what makes a photo protected, eligible or unknown. Multiplatform, so the
// desktop app (JVM) and the browser extension (JavaScript) apply exactly the same tested rules.
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
