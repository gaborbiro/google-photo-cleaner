plugins {
    alias(libs.plugins.kotlin.jvm)
}

dependencies {
    api(project(":services:inference:domain"))
    api(project(":repositories:analysis:domain"))
    api(project(":repositories:inventory:domain"))
    api(project(":features:shared:previews"))
    implementation(libs.slf4j.api)

    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(testFixtures(project(":services:connector:domain")))
    testImplementation(project(":repositories:analysis"))
}

tasks.test {
    useJUnitPlatform()
}
