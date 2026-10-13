plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.compose.multiplatform)
}

dependencies {
    implementation(project(":core:design"))
    implementation(project(":services:connector:domain"))
    implementation(project(":repositories:inventory:domain"))
    implementation(project(":features:shared:protection"))
    implementation(libs.jetbrains.lifecycle.viewmodel.compose)
    implementation(libs.slf4j.api)

    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(testFixtures(project(":services:connector:domain")))
    testImplementation(project(":repositories:inventory"))
}

tasks.test {
    useJUnitPlatform()
}
