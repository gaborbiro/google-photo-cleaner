rootProject.name = "PhotoCleaner"

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        google()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
        google()
    }
}

include(":app")
include(":core:design")
include(":core:storage")
include(":services:connector:domain")
include(":services:connector")
include(":services:inference:domain")
include(":services:inference")
include(":services:trash:domain")
include(":services:trash")
include(":repositories:review:domain")
include(":repositories:review")
include(":repositories:analysis:domain")
include(":repositories:analysis")
include(":repositories:inventory:domain")
include(":repositories:inventory")
include(":features:shared:protection")
include(":features:shared:previews")
include(":features:shared:viewer")
include(":features:shared:embeddings")
include(":features:calibration")
include(":features:duplicates")
include(":features:sweep")
include(":features:scan")
include(":features:sample")
include(":features:connection")
include(":features:probe")
