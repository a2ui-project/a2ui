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

import com.google.a2ui.InferenceStrategy
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Represents the supported A2UI specification versions. */
enum class A2uiVersion(
  val value: String,
  val serverToClientSchemaPath: String,
  val commonTypesSchemaPath: String? = null,
) {
  VERSION_0_8(A2uiConstants.VERSION_0_8, "server_to_client.json"),
  VERSION_0_9(A2uiConstants.VERSION_0_9, "server_to_client.json", "common_types.json"),
  VERSION_0_9_1(A2uiConstants.VERSION_0_9_1, "server_to_client.json", "common_types.json"),
}

/**
 * Integrates A2UI capabilities by processing and aggregating [CatalogConfig] schemas to establish
 * the grammatical constraints for Agent UI payload generation.
 *
 * This implementation of [InferenceStrategy] synthesizes the resulting system prompt instructions,
 * which contain the precise JSON grammar for the LLM based on the active schemas and requested
 * components negotiated between the agent and client.
 *
 * @param version Framework version (e.g., "0.8" or "0.9"). Delineates internal topology handling
 *   and resolution strategies.
 * @param catalogs List of user-configured catalogs offering UI components to this agent.
 * @param acceptsInlineCatalogs Whether this agent permits the client UI to dictate dynamic schema
 *   payloads rather than relying solely on bundled configurations.
 * @param schemaModifiers An optional chain of transformations to perform on all resolved schema
 *   endpoints.
 */
class A2uiSchemaManager
@JvmOverloads
constructor(
  private val version: A2uiVersion,
  catalogs: List<CatalogConfig> = emptyList(),
  @JvmField val acceptsInlineCatalogs: Boolean = false,
  private val schemaModifiers: List<(JsonObject) -> JsonObject> = emptyList(),
) : InferenceStrategy {

  private val serverToClientSchema: JsonObject
  private val commonTypesSchema: JsonObject
  private val supportedCatalogs = mutableListOf<A2uiCatalog>()
  private val catalogExamplePaths = mutableMapOf<String, String?>()

  /**
   * Identifies the catalogs technically supported by this running agent application. Can be
   * utilized to negotiate payload rendering with downstream clients.
   */
  val supportedCatalogIds: List<String>
    get() = supportedCatalogs.map { it.catalogId }

  init {
    serverToClientSchema =
      applyModifiers(
        SchemaResourceLoader.loadFromBundledResource(
          version.value,
          version.serverToClientSchemaPath,
        ) ?: JsonObject(emptyMap())
      )

    commonTypesSchema =
      version.commonTypesSchemaPath?.let {
        applyModifiers(
          SchemaResourceLoader.loadFromBundledResource(version.value, it) ?: JsonObject(emptyMap())
        )
      } ?: JsonObject(emptyMap())

    for (config in catalogs) {
      val catalogSchema = applyModifiers(config.provider.load())
      val catalog =
        A2uiCatalog(
          version = version,
          name = config.name,
          catalogSchema = catalogSchema,
          serverToClientSchema = serverToClientSchema,
          commonTypesSchema = commonTypesSchema,
        )
      supportedCatalogs.add(catalog)
      catalogExamplePaths[catalog.catalogId] = config.examplesPath
    }
  }

  private fun applyModifiers(schema: JsonObject): JsonObject =
    schemaModifiers.fold(schema) { current, modifier -> modifier(current) }

  private fun selectCatalog(clientUiCapabilities: JsonObject?): A2uiCatalog {
    check(supportedCatalogs.isNotEmpty()) { "No supported catalogs found." }

    if (clientUiCapabilities == null) return supportedCatalogs.first()

    val inlineCatalogs =
      (clientUiCapabilities[A2uiConstants.INLINE_CATALOGS_KEY] as? JsonArray)?.mapNotNull {
        it as? JsonObject
      } ?: emptyList()

    val clientSupportedCatalogIds =
      (clientUiCapabilities[A2uiConstants.SUPPORTED_CATALOG_IDS_KEY] as? JsonArray)?.mapNotNull {
        it.jsonPrimitive.content
      } ?: emptyList()

    if (!acceptsInlineCatalogs && inlineCatalogs.isNotEmpty()) {
      throw IllegalArgumentException(
        "Inline catalog '${A2uiConstants.INLINE_CATALOGS_KEY}' is provided in client UI capabilities. However, the agent does not accept inline catalogs."
      )
    }

    if (inlineCatalogs.isNotEmpty()) {
      // Determine the base catalog: use supportedCatalogIds if provided,
      // otherwise fall back to the agent's default catalog.
      var baseCatalog = supportedCatalogs.first()
      if (clientSupportedCatalogIds.isNotEmpty()) {
        val agentSupportedCatalogs = supportedCatalogs.associateBy { it.catalogId }
        for (cscid in clientSupportedCatalogIds) {
          agentSupportedCatalogs[cscid]?.let { baseCatalog = it }
          if (baseCatalog != supportedCatalogs.first()) break
        }
      }

      val mergedSchemaMap = baseCatalog.catalogSchema.toMutableMap()
      val mergedComponents =
        mergedSchemaMap[A2uiConstants.CATALOG_COMPONENTS_KEY]?.jsonObject?.toMutableMap()
          ?: mutableMapOf()

      for (inlineCatalogSchema in inlineCatalogs) {
        val modifiedInline = applyModifiers(inlineCatalogSchema)
        val inlineComponents =
          modifiedInline[A2uiConstants.CATALOG_COMPONENTS_KEY]?.jsonObject ?: JsonObject(emptyMap())
        mergedComponents.putAll(inlineComponents)
      }

      mergedSchemaMap[A2uiConstants.CATALOG_COMPONENTS_KEY] = JsonObject(mergedComponents)
      val mergedSchema = JsonObject(mergedSchemaMap)

      return A2uiCatalog(
        version = version,
        name = A2uiConstants.INLINE_CATALOG_NAME,
        catalogSchema = mergedSchema,
        serverToClientSchema = serverToClientSchema,
        commonTypesSchema = commonTypesSchema,
      )
    }

    if (clientSupportedCatalogIds.isEmpty()) return supportedCatalogs.first()

    val agentSupportedCatalogs = supportedCatalogs.associateBy { it.catalogId }
    for (cscid in clientSupportedCatalogIds) {
      agentSupportedCatalogs[cscid]?.let {
        return it
      }
    }

    throw IllegalArgumentException(
      "No client-supported catalog found on the agent side. Agent-supported catalogs are: ${supportedCatalogs.map { it.catalogId }}"
    )
  }

  /**
   * Resolves the desired catalog based on the client capabilities, returning it with pruned unused
   * components and messages.
   */
  @JvmOverloads
  fun getSelectedCatalog(
    clientUiCapabilities: JsonObject? = null,
    allowedComponents: List<String> = emptyList(),
    allowedMessages: List<String> = emptyList(),
  ): A2uiCatalog =
    selectCatalog(clientUiCapabilities).withPruning(allowedComponents, allowedMessages)

  /** Renders LLM examples for a given catalog, loaded from its configured examples path. */
  @JvmOverloads
  fun loadExamples(catalog: A2uiCatalog, validate: Boolean = false): String =
    catalogExamplePaths[catalog.catalogId]?.let { path -> catalog.loadExamples(path, validate) }
      ?: ""

  /** Creates a fully formatted system prompt describing the schema to the LLM model. */
  override fun generateSystemPrompt(
    roleDescription: String,
    workflowDescription: String,
    uiDescription: String,
    clientUiCapabilities: JsonObject?,
    allowedComponents: List<String>,
    allowedMessages: List<String>,
    includeSchema: Boolean,
    includeExamples: Boolean,
    validateExamples: Boolean,
  ): String {
    val parts = mutableListOf(roleDescription)

    val workflow =
      if (workflowDescription.isEmpty()) A2uiConstants.DEFAULT_WORKFLOW_RULES
      else "${A2uiConstants.DEFAULT_WORKFLOW_RULES}\n$workflowDescription"
    parts.add("## Workflow Description:\n$workflow")

    if (uiDescription.isNotEmpty()) {
      parts.add("## UI Description:\n$uiDescription")
    }

    val selectedCatalog =
      getSelectedCatalog(clientUiCapabilities, allowedComponents, allowedMessages)

    if (includeSchema) {
      parts.add(selectedCatalog.renderAsLlmInstructions())
    }

    if (includeExamples) {
      val examplesStr = loadExamples(selectedCatalog, validateExamples)
      if (examplesStr.isNotEmpty()) {
        parts.add("### Examples:\n$examplesStr")
      }
    }

    return parts.joinToString("\n\n")
  }
}
