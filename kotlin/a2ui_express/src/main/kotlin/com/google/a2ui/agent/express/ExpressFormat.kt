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

package com.google.a2ui.agent.express

import com.google.a2ui.agent.InferenceFormat
import com.google.a2ui.agent.InferenceFormatFactory
import com.google.a2ui.agent.PromptGenerator
import com.google.a2ui.core.AgentToRendererMessage
import com.google.a2ui.core.Catalog

/**
 * Bound A2UI Express v1.0 [InferenceFormat] combining an Express [PromptGenerator] and
 * [ExpressParser].
 */
class ExpressFormat(
  catalogs: List<Catalog>,
  examples: List<List<AgentToRendererMessage>>? = null,
  allowedMessages: List<String>? = null,
  private val surfaceId: String = "main",
  private val progressiveKeys: Set<String>? = DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
) : InferenceFormat {
  private val checkedCatalogs: List<Catalog> = CatalogSchemaHelper.checkMixedCatalogs(catalogs)

  override val catalogs: List<Catalog>
    get() = checkedCatalogs.toList()

  override val promptGenerator: PromptGenerator =
    ExpressPromptGenerator(
      catalogs = checkedCatalogs,
      examples = examples,
      allowedMessages = allowedMessages,
    )

  override val parser: ExpressParser
    get() = createParser()

  override fun createParser(): ExpressParser =
    ExpressParser(
      catalogs = checkedCatalogs,
      surfaceId = surfaceId,
      progressiveKeys = progressiveKeys,
    )
}

/** [InferenceFormatFactory] producing [ExpressFormat] instances. */
class ExpressFormatFactory(
  private val allowedMessages: List<String>? = null,
  private val surfaceId: String = "main",
  private val progressiveKeys: Set<String>? = DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
) : InferenceFormatFactory {
  override fun createFormat(
    catalogs: List<Catalog>,
    examples: List<List<AgentToRendererMessage>>?,
  ): InferenceFormat =
    ExpressFormat(
      catalogs = catalogs,
      examples = examples,
      allowedMessages = allowedMessages,
      surfaceId = surfaceId,
      progressiveKeys = progressiveKeys,
    )
}
