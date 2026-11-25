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

package com.google.a2ui.agent

import com.google.a2ui.agent.parser.Parser
import com.google.a2ui.agent.prompt.PromptGenerator
import com.google.a2ui.core.catalog.CatalogApi
import com.google.a2ui.core.schema.AgentToRendererMessage

/**
 * Factory creating an [InferenceFormat] bound to negotiated catalogs (`a2ui_agent.blueprint.md`
 * §3.E).
 */
fun interface InferenceFormatFactory {
  fun createFormat(
    catalogs: List<CatalogApi>,
    examples: List<List<AgentToRendererMessage>>?,
  ): InferenceFormat

  fun createFormat(catalogs: List<CatalogApi>): InferenceFormat =
    createFormat(catalogs, examples = null)
}

/** Strategy facade pairing a [PromptGenerator] (input) and [Parser] (output) (`blueprint` §3.E). */
interface InferenceFormat {
  val catalogs: List<CatalogApi>
  val promptGenerator: PromptGenerator

  fun createParser(): Parser
}
