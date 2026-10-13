plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.sqldelight)
}

dependencies {
    api(project(":repositories:analysis:domain"))
    implementation(libs.sqldelight.sqlite.driver)

    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
}

sqldelight {
    databases {
        create("AnalysisDatabase") {
            packageName.set("dev.photocleaner.repositories.analysis.db")
        }
    }
}

tasks.test {
    useJUnitPlatform()
}
