// The protection rules: what makes a photo protected, eligible or unknown. Multiplatform, so the
// desktop app (JVM) and the browser extension (JavaScript) apply exactly the same tested rules.
plugins {
    alias(libs.plugins.kotlin.multiplatform)
}

kotlin {
    jvm()
    js {
        browser()
        // An ES module with TypeScript types, bundled into the extension (see exportToExtension).
        useEsModules()
        binaries.library()
        generateTypeScriptDefinitions()
    }

    sourceSets {
        commonMain.dependencies {
            api(project(":repositories:inventory:domain"))
        }
    }
}

/** Copies the JavaScript build into the extension, which bundles it (extension/generated is git-ignored). */
tasks.register<Copy>("exportToExtension") {
    description = "Builds the protection rules for JavaScript and copies them into extension/generated/protection."
    group = "photo cleaner"
    dependsOn("jsProductionLibraryCompileSync")
    from(layout.buildDirectory.dir("compileSync/js/main/productionLibrary/kotlin"))
    into(rootProject.layout.projectDirectory.dir("extension/generated/protection"))
}
