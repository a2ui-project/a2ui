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

import com.google.a2ui.core.AgentToRendererMessage
import com.google.a2ui.core.Catalog

/**
 * Bound A2UI inference format combining a [PromptGenerator] and a [Parser] configured for a set of
 * active [Catalog]s.
 */
interface InferenceFormat {
  val catalogs: List<Catalog>
  val promptGenerator: PromptGenerator
  val parser: Parser
    get() = createParser()

  fun createParser(): Parser
}

/**
 * Factory creating an [InferenceFormat] bound to one or more [Catalog]s, optionally applying
 * [CatalogTransformer]s or custom few-shot [examples].
 */
fun interface InferenceFormatFactory {
  fun createFormat(
    catalogs: List<Catalog>,
    examples: List<List<AgentToRendererMessage>>?,
  ): InferenceFormat

  fun createFormat(catalogs: List<Catalog>): InferenceFormat = createFormat(catalogs, null)

  fun create(
    catalogs: List<Catalog>,
    transformers: List<CatalogTransformer> = emptyList(),
    examples: List<List<AgentToRendererMessage>>? = null,
  ): InferenceFormat {
    val transformed = catalogs.map { cat -> transformers.fold(cat) { acc, t -> t.transform(acc) } }
    return createFormat(transformed, examples)
  }
}
