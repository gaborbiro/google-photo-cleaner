plugins {
    alias(libs.plugins.kotlin.jvm)
}

dependencies {
    api(project(":services:connector:domain"))
    api(project(":repositories:inventory:domain"))

    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(testFixtures(project(":services:connector:domain")))
}

tasks.test {
    useJUnitPlatform()
}
