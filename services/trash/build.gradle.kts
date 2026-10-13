plugins {
    alias(libs.plugins.kotlin.jvm)
}

dependencies {
    api(project(":services:trash:domain"))

    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
}

tasks.test {
    useJUnitPlatform()
}
