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

package com.google.a2ui.schema

/** Central repository for A2UI protocol constants, aligned with the Python SDK. */
object A2uiConstants {
  const val A2UI_ASSET_PACKAGE = "com.google.a2ui.assets"
  const val SERVER_TO_CLIENT_SCHEMA_KEY = "server_to_client"
  const val COMMON_TYPES_SCHEMA_KEY = "common_types"
  const val CATALOG_SCHEMA_KEY = "catalog"
  const val CATALOG_COMPONENTS_KEY = "components"
  const val CATALOG_ID_KEY = "catalogId"
  const val CATALOG_STYLES_KEY = "styles"

  @JvmField
  val DEFAULT_CUTTABLE_KEYS =
    setOf("literalString", "valueString", "label", "hint", "caption", "altText", "text")

  // Protocol constants
  const val SUPPORTED_CATALOG_IDS_KEY = "supportedCatalogIds"
  const val INLINE_CATALOGS_KEY = "inlineCatalogs"
  const val ACCEPTS_INLINE_CATALOGS_KEY = "acceptsInlineCatalogs"

  const val A2UI_CLIENT_CAPABILITIES_KEY = "a2uiClientCapabilities"

  const val BASE_SCHEMA_URL = "https://a2ui.org/"
  const val INLINE_CATALOG_NAME = "inline"

  const val VERSION_0_8 = "0.8"
  const val VERSION_0_9 = "0.9"
  const val VERSION_0_9_1 = "0.9.1"

  const val A2UI_OPEN_TAG = "<a2ui-json>"
  const val A2UI_CLOSE_TAG = "</a2ui-json>"

  const val A2UI_SCHEMA_BLOCK_START = "---BEGIN A2UI JSON SCHEMA---"
  const val A2UI_SCHEMA_BLOCK_END = "---END A2UI JSON SCHEMA---"

  const val DEFAULT_WORKFLOW_RULES =
    """
    The generated response MUST follow these rules:
    1.  The response can contain one or more A2UI JSON blocks.
    2.  Each A2UI JSON block MUST be wrapped in $A2UI_OPEN_TAG and $A2UI_CLOSE_TAG tags.
    3.  Between or around these blocks, you can provide conversational text.
    4.  The JSON part MUST be a single, raw JSON object (usually a list of A2UI messages) and MUST validate against the provided A2UI JSON SCHEMA.
    """
}
