/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

plugins {
    kotlin("jvm") version "2.1.10"
    application
    id("com.ncorti.ktfmt.gradle") version "0.19.0"
}

ktfmt {
  googleStyle()
}

group = "com.google.a2ui.samples"
version = "0.9.0-SNAPSHOT"

// Configure Java capability
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
    google()
}

dependencies {
    implementation("com.google.a2ui:a2ui-agent")

    // Google ADK
    implementation("com.google.adk:google-adk:0.9.0")

    // Default model integration
    implementation("com.google.genai:google-genai:1.43.0")

    // Ktor Server
    implementation("io.ktor:ktor-server-core:3.0.0")
    implementation("io.ktor:ktor-server-netty:3.0.0")
    implementation("io.ktor:ktor-server-cors:3.0.0")
    implementation("io.ktor:ktor-server-content-negotiation:3.0.0")
    implementation("io.ktor:ktor-serialization-jackson:3.0.0")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")

    // Dotenv
    implementation("io.github.cdimascio:dotenv-java:3.0.0")
}

application {
    mainClass.set("com.google.a2ui.samples.rizzcharts.RizzchartsMainKt")
}
