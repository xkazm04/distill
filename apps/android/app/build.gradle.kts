plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// google-services.json is git-ignored (the owner adds it after creating the Firebase project). Without it the app
// still builds and shows "Firebase is not configured".
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "dev.distill.envelope"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.distill.envelope"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    // The JVM unit tests read the engine's exported contract (schemas/*.json and the golden prompts), so they rerun
    // whenever the engine changes it.
    val engine = rootProject.file("../../packages/engine")
    testOptions {
        unitTests.all {
            it.systemProperty("distill.engine", engine.absolutePath)
            it.inputs.dir(engine.resolve("schemas")).withPropertyName("engineSchemas")
            it.inputs.file(engine.resolve("test/fixtures/prompts.golden.json")).withPropertyName("enginePrompts")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        optIn.add("com.google.firebase.ai.type.PublicPreviewAPI")
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.02.01")
    implementation(composeBom)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.core:core-ktx:1.17.0")

    // Firebase AI Logic hybrid inference. firebase-ai-ondevice is NOT in the BoM: pinned explicitly (latest on
    // Google Maven, 2026-11-17). The BoM pins firebase-ai 18.2.0.
    implementation(platform("com.google.firebase:firebase-bom:35.2.0"))
    implementation("com.google.firebase:firebase-ai")
    implementation("com.google.firebase:firebase-ai-ondevice:16.0.0-beta08")
    implementation("com.google.firebase:firebase-appcheck-playintegrity")
    debugImplementation("com.google.firebase:firebase-appcheck-debug")
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-firestore")
    implementation("com.google.firebase:firebase-config")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")

    // On-device OCR, bundled Latin model (no download).
    implementation("com.google.mlkit:text-recognition:16.0.1")

    // JVM unit tests: the real org.json (android.jar only has stubs) and kotlin-reflect for the schema drift check.
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.jetbrains.kotlin:kotlin-reflect:2.3.21")
}
