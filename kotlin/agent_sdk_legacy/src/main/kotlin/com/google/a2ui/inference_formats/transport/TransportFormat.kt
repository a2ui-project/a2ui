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

package com.google.a2ui.inference_formats.transport

import com.google.a2ui.InferenceFormat
import com.google.a2ui.parser.Parser
import com.google.a2ui.prompt.PromptGenerator
import com.google.a2ui.schema.A2uiCatalog

/** Standard A2UI JSON transport inference format implementation. */
class TransportFormat(val catalog: A2uiCatalog? = null, val examplesPath: String? = null) :
  InferenceFormat {

  override val promptGenerator: PromptGenerator by lazy {
    TransportPromptGenerator(catalog, examplesPath)
  }

  override val parser: Parser by lazy { TransportParser(catalog?.validator) }
}
