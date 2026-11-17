/*
 * Copyright 2024 Google LLC
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
import com.google.a2ui.schema.A2uiCatalog
import kotlinx.serialization.json.JsonObject

/**
 * Inference format encapsulating A2UI Express v1.0 and v0.9/v0.9.1 prompt generation, single-shot
 * response parsing, decompilation, and incremental chunk streaming.
 */
class ExpressFormat(
  val catalogs: List<A2uiCatalog>,
  val surfaceId: String = "default_surface",
  version: String? = null,
  exampleTurns: List<List<JsonObject>> = emptyList(),
  allowedMessages: List<String>? = null,
  progressiveKeys: Set<String> = DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
) : InferenceFormat {

  @JvmOverloads
  constructor(
    catalog: A2uiCatalog,
    surfaceId: String = "default_surface",
    version: String? = null,
    allowedMessages: List<String>? = null,
    progressiveKeys: Set<String> = DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
  ) : this(
    catalogs = listOf(catalog),
    surfaceId = surfaceId,
    version = version,
    exampleTurns = emptyList(),
    allowedMessages = allowedMessages,
    progressiveKeys = progressiveKeys,
  )

  init {
    validateExpressCatalogs(catalogs)
  }

  val catalog: A2uiCatalog = catalogs.first()

  val version: String = resolveExpressVersion(catalogs, version)

  override val supportsStreaming: Boolean = true

  override val promptGenerator: ExpressPromptGenerator =
    ExpressPromptGenerator(
      catalogs = catalogs,
      exampleTurns = exampleTurns,
      allowedMessages = allowedMessages,
      version = this.version,
    )

  override val parser: ExpressParser =
    ExpressParser(
      catalogs = catalogs,
      surfaceId = surfaceId,
      version = this.version,
      progressiveKeys = progressiveKeys,
    )
}
