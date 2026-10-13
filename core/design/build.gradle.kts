plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.compose.multiplatform)
}

dependencies {
    api(libs.compose.runtime)
    api(libs.compose.foundation)
    api(libs.compose.material3)

    testImplementation(libs.kotlin.test)
}

tasks.test {
    useJUnitPlatform()
}
