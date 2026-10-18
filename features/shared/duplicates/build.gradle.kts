// The duplicate rules: grouping, keeper choice, the review queue and the calibration report.
// Multiplatform: compiled to JavaScript for the extension and tested on the JVM.
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
            api(project(":features:shared:protection"))
            api(project(":repositories:review:domain"))
            api(project(":repositories:analysis:domain"))
        }
        commonTest.dependencies {
            implementation(libs.kotlin.test)
        }
    }
}

tasks.named<Test>("jvmTest") {
    useJUnitPlatform()
}

/**
 * Builds the shared rules for JavaScript and copies them into the extension, which bundles them
 * (extension/generated is git-ignored). One file per Kotlin module: these duplicate rules and the
 * protection rules they build on.
 */
tasks.register<Sync>("exportToExtension") {
    description = "Builds the shared rules for JavaScript and copies them into extension/generated/kotlin."
    group = "photo cleaner"
    dependsOn("jsProductionLibraryCompileSync")
    from(layout.buildDirectory.dir("compileSync/js/main/productionLibrary/kotlin"))
    into(rootProject.layout.projectDirectory.dir("extension/generated/kotlin"))
}
