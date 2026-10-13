plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.compose.multiplatform)
}

dependencies {
    api(project(":features:shared:previews"))
    implementation(project(":core:design"))
    implementation(libs.slf4j.api)
}
