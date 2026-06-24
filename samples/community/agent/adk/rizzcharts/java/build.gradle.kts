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
    application
    id("java")
    id("com.diffplug.spotless") version "6.25.0"
}

spotless {
    java {
        googleJavaFormat()
    }
}

group = "com.google.a2ui.samples"
version = "1.0-SNAPSHOT"

repositories {
    mavenCentral()
}

dependencies {
    // A2UI SDK (via includeBuild)
    implementation("com.google.a2ui:a2ui-agent:0.1.0")

    // Google GenAI Java SDK
    implementation("com.google.genai:google-genai:1.43.0")

    // Google ADK Java SDK
    implementation("com.google.adk:google-adk:0.9.0") {
        exclude(group = "org.slf4j", module = "slf4j-simple")
    }

    // Google A2A Java SDK
    implementation("io.github.a2asdk:a2a-java-sdk-client:1.0.0.Alpha3")

    // Spring Boot
    implementation("org.springframework.boot:spring-boot-starter-web:3.2.4")

    // Dotenv
    implementation("io.github.cdimascio:dotenv-java:3.0.0")
}

application {
    mainClass.set("com.google.a2ui.samples.rizzcharts.RizzchartsMain")
}

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

