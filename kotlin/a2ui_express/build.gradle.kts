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

import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
  kotlin("jvm") version "2.1.10"
  id("java-library")
  id("com.ncorti.ktfmt.gradle") version "0.19.0"
}

ktfmt { googleStyle() }

version = "0.1.0"

group = "com.google.a2ui"

repositories { mavenCentral() }

dependencies {
  api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

  testImplementation(kotlin("test"))
  testImplementation("com.fasterxml.jackson.dataformat:jackson-dataformat-yaml:2.17.2")
}

tasks.test {
  useJUnitPlatform()
  val manifestDir = providers.environmentVariable("A2UI_CONFORMANCE_MANIFEST_DIR")
  if (manifestDir.isPresent) {
    environment("A2UI_CONFORMANCE_MANIFEST_DIR", manifestDir.get())
    outputs.upToDateWhen { false }
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

val copySpecs by
  tasks.registering(Copy::class) {
    val repoRoot = findRepoRoot()
    from(File(repoRoot, "specification/v1_0/json/common_types.json")) {
      into("com/google/a2ui/assets/1.0")
    }
    from(File(repoRoot, "catalogs/basic/v1/catalog.json")) {
      into("com/google/a2ui/assets/1.0/catalogs/basic")
    }
    into(layout.buildDirectory.dir("generated/resources/specs"))
  }

sourceSets { main { resources { srcDir(copySpecs) } } }

tasks.withType<KotlinCompile>().configureEach {
  compilerOptions { jvmTarget.set(JvmTarget.JVM_21) }
}

tasks.withType<JavaCompile>().configureEach { options.release.set(21) }
