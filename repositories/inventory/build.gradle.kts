plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.sqldelight)
}

dependencies {
    api(project(":repositories:inventory:domain"))
    implementation(libs.sqldelight.sqlite.driver)

    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
}

sqldelight {
    databases {
        create("InventoryDatabase") {
            packageName.set("dev.photocleaner.repositories.inventory.db")
        }
    }
}

tasks.test {
    useJUnitPlatform()
}
