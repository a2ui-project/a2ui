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

package com.google.a2ui.inference_formats.experimental.express

import com.google.a2ui.InferenceFormat
import com.google.a2ui.parser.Parser
import com.google.a2ui.prompt.PromptGenerator
import com.google.a2ui.schema.A2uiCatalog

/**
 * Concrete strategy for Express DSL representation.
 *
 * @param catalog The component catalog containing valid elements.
 * @param surfaceId The surface identifier for layout targeting.
 * @param examplesPath Optional path to markdown files containing examples.
 */
class ExpressFormat(
  val catalog: A2uiCatalog? = null,
  val surfaceId: String = "main",
  val examplesPath: String? = null,
  val version: String = "v1.0",
) : InferenceFormat {

  fun ensureCatalog(): A2uiCatalog {
    return catalog
      ?: throw IllegalArgumentException(
        "Catalog is required for parsing and decompiling in express format."
      )
  }

  override val promptGenerator: PromptGenerator by lazy {
    ensureCatalog()
    ExpressPromptGenerator(this)
  }

  override val parser: Parser by lazy {
    val cat = ensureCatalog()
    ExpressParser(cat, surfaceId, version = version)
  }
}
