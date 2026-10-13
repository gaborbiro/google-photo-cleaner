plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.compose.multiplatform)
}

dependencies {
    implementation(project(":core:design"))
    implementation(project(":services:connector:domain"))
    implementation(project(":features:shared:protection"))
    implementation(project(":features:shared:previews"))
    implementation(project(":features:shared:viewer"))
    implementation(project(":features:shared:embeddings"))
    implementation(project(":repositories:review:domain"))
    implementation(project(":services:trash:domain"))
    implementation(libs.jetbrains.lifecycle.viewmodel.compose)
    implementation(libs.slf4j.api)

    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(testFixtures(project(":services:connector:domain")))
    testImplementation(project(":repositories:analysis"))
    testImplementation(project(":repositories:inventory"))
    testImplementation(project(":repositories:review"))
    testImplementation(project(":services:trash"))
}

tasks.test {
    useJUnitPlatform()
}
