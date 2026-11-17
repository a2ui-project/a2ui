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
  kotlin("jvm") version "2.1.10" apply false
  kotlin("plugin.serialization") version "2.1.10" apply false
  id("com.ncorti.ktfmt.gradle") version "0.19.0"
}

ktfmt { googleStyle() }

subprojects {
  apply(plugin = "org.jetbrains.kotlin.jvm")
  apply(plugin = "org.jetbrains.kotlin.plugin.serialization")
  apply(plugin = "java-library")
  apply(plugin = "com.ncorti.ktfmt.gradle")

  group = "com.google.a2ui"
  version = "0.1.0-SNAPSHOT"

  repositories { mavenCentral() }

  ktfmt { googleStyle() }

  tasks.withType<KotlinCompile>().configureEach {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_21) }
  }

  tasks.withType<JavaCompile>().configureEach { options.release.set(21) }

  tasks.withType<Test>().configureEach { useJUnitPlatform() }
}
