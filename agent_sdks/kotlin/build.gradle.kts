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
  kotlin("plugin.serialization") version "2.1.10"
  id("java-library")
  id("com.ncorti.ktfmt.gradle") version "0.19.0"
  id("org.jetbrains.kotlinx.kover") version "0.9.1"
}

ktfmt {
  googleStyle()
}

version = "0.1.0"
group = "com.google.a2ui"

// Using system default Java compiler

repositories {
  mavenCentral()
}

dependencies {
  api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
  implementation("com.networknt:json-schema-validator:2.0.1")
  implementation("com.fasterxml.jackson.core:jackson-databind:2.17.2")

  // Core Dependencies
  api("com.google.adk:google-adk:1.5.0")
  api("com.google.adk:google-adk-a2a:1.5.0")
  api("io.github.a2asdk:a2a-java-sdk-client:1.0.0.Alpha3")
  api("com.google.genai:google-genai:1.43.0")

  testImplementation(kotlin("test"))
  testImplementation("io.mockk:mockk:1.13.11")
  testImplementation("com.fasterxml.jackson.dataformat:jackson-dataformat-yaml:2.17.2")
}

tasks.test {
  useJUnitPlatform()
}

val copySpecs by tasks.registering(Copy::class) {
  val repoRoot = findRepoRoot()

  from(File(repoRoot, "specification/v0_8/json/server_to_client.json")) {
    into("com/google/a2ui/assets/0.8")
  }
  from(File(repoRoot, "specification/v0_8/json/standard_catalog_definition.json")) {
    into("com/google/a2ui/assets/0.8")
  }

  from(File(repoRoot, "specification/v0_9/json/server_to_client.json")) {
    into("com/google/a2ui/assets/0.9")
  }
  from(File(repoRoot, "specification/v0_9/json/common_types.json")) {
    into("com/google/a2ui/assets/0.9")
  }
  from(File(repoRoot, "specification/v0_9/catalogs/basic/catalog.json")) {
    into("com/google/a2ui/assets/0.9/catalogs/basic")
  }

  into(layout.buildDirectory.dir("generated/resources/specs"))
}

sourceSets {
  main {
    resources {
      srcDir(copySpecs)
    }
  }
}

fun findRepoRoot(): File {
  var currentDir: File? = project.projectDir
  while (currentDir != null) {
    if (File(currentDir, "specification").isDirectory) {
      return currentDir
    }
    currentDir = currentDir.parentFile
  }
  throw GradleException("Could not find repository root containing specification directory.")
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
  compilerOptions {
    jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
  }
}

tasks.withType<JavaCompile>().configureEach {
  options.release.set(21)
}

