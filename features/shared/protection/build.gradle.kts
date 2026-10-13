plugins {
    alias(libs.plugins.kotlin.jvm)
}

dependencies {
    api(project(":repositories:inventory:domain"))

    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(project(":repositories:inventory"))
}

tasks.test {
    useJUnitPlatform()
}
