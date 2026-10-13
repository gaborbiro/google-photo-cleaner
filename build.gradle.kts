plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.compose.multiplatform) apply false
    alias(libs.plugins.sqldelight) apply false
}

// SQLDelight's driver brings in a newer sqlite-jdbc whose native DLL Windows Smart App
// Control blocks here; force the pinned version everywhere (see libs.versions.toml).
val sqliteJdbcVersion = libs.versions.sqlite.jdbc.get()
subprojects {
    configurations.configureEach {
        resolutionStrategy.force("org.xerial:sqlite-jdbc:$sqliteJdbcVersion")
    }
}
