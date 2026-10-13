plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.sqldelight)
}

dependencies {
    api(project(":repositories:review:domain"))
    implementation(libs.sqldelight.sqlite.driver)

    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
}

sqldelight {
    databases {
        create("ReviewDatabase") {
            packageName.set("dev.photocleaner.repositories.review.db")
        }
    }
}

tasks.test {
    useJUnitPlatform()
}
