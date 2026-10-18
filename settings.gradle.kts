rootProject.name = "PhotoCleaner"

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}

// The shared rules, compiled to JavaScript for the extension (and tested on the JVM).
include(":repositories:review:domain")
include(":repositories:analysis:domain")
include(":repositories:inventory:domain")
include(":features:shared:protection")
include(":features:shared:duplicates")
