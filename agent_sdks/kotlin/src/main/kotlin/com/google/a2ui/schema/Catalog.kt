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

@file:JvmName("CatalogApi")

package com.google.a2ui.schema

import java.io.File
import java.net.URI
import java.nio.file.FileSystems
import java.nio.file.Files
import java.nio.file.Paths
import java.util.logging.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

/**
 * Configuration for a catalog of components.
 *
 * A catalog consists of a provider that knows how to load the schema, and optionally a path to
 * examples.
 */
data class CatalogConfig(
  @JvmField val name: String,
  @JvmField val provider: A2uiCatalogProvider,
  @JvmField val examplesPath: String? = null,
  @JvmField val customCuttableKeys: Set<String>? = null,
) {
  companion object {
    /** Create a [CatalogConfig] using a [FileSystemCatalogProvider]. */
    @JvmStatic
    @JvmOverloads
    fun fromPath(
      name: String,
      catalogPath: String,
      examplesPath: String? = null,
      customCuttableKeys: Set<String>? = null,
    ): CatalogConfig {
      val uri =
        try {
          URI(catalogPath)
        } catch (e: Exception) {
          null
        }
      val scheme = uri?.scheme?.lowercase()

      val provider =
        when {
          scheme == null || scheme == "file" -> {
            val path = if (scheme == "file") Paths.get(uri).toString() else catalogPath
            FileSystemCatalogProvider(path)
          }
          scheme == "http" || scheme == "https" ->
            throw NotImplementedError("HTTP support is coming soon.")
          else -> throw IllegalArgumentException("Unsupported catalog URL scheme: $catalogPath")
        }

      return CatalogConfig(name, provider, resolveExamplesPath(examplesPath), customCuttableKeys)
    }
  }
}

internal fun resolveExamplesPath(path: String?): String? {
  if (path != null) {
    val uri =
      try {
        URI(path)
      } catch (e: Exception) {
        null
      }
    val scheme = uri?.scheme?.lowercase()
    if (scheme == null || scheme == "file") {
      return if (scheme == "file") Paths.get(uri).toString() else path
    }
    throw IllegalArgumentException("Unsupported examples URL scheme: $path")
  }
  return null
}

/** Represents a processed component catalog with its schema. */
data class A2uiCatalog(
  @JvmField val version: A2uiVersion,
  @JvmField val name: String,
  @JvmField val serverToClientSchema: JsonObject,
  @JvmField val commonTypesSchema: JsonObject,
  @JvmField val catalogSchema: JsonObject,
  @JvmField val customCuttableKeys: Set<String>? = null,
) {

  companion object {
    private val logger = Logger.getLogger(A2uiCatalog::class.java.name)
  }

  val cuttableKeys: Set<String>
    get() = customCuttableKeys ?: A2uiConstants.DEFAULT_CUTTABLE_KEYS

  val validator: A2uiValidator by lazy { A2uiValidator(this) }

  val catalogId: String
    get() {
      val idElement = catalogSchema[A2uiConstants.CATALOG_ID_KEY]
      require(idElement is JsonPrimitive && idElement.isString) {
        "Catalog '$name' missing catalogId"
      }
      return idElement.content
    }

  /**
   * Returns a new catalog with pruned components and messages.
   *
   * @param allowedComponents List of component names to include.
   * @param allowedMessages List of message names to include in serverToClientSchema.
   * @return A copy of the catalog with pruned components and messages.
   */
  fun withPruning(
    allowedComponents: List<String>? = null,
    allowedMessages: List<String>? = null,
  ): A2uiCatalog {
    var catalog = this
    if (allowedComponents != null) {
      catalog = catalog.withPrunedComponentsInternal(allowedComponents)
    }
    if (allowedMessages != null) {
      catalog = catalog.withPrunedMessages(allowedMessages)
    }
    return catalog.withPrunedCommonTypes()
  }

  private fun withPrunedComponentsInternal(allowedComponents: List<String>): A2uiCatalog {
    if (allowedComponents.isEmpty()) return this

    val schemaCopy = catalogSchema.toMutableMap()

    // Filter components listing
    (schemaCopy[A2uiConstants.CATALOG_COMPONENTS_KEY] as? JsonObject)?.let { components ->
      schemaCopy[A2uiConstants.CATALOG_COMPONENTS_KEY] =
        JsonObject(components.filterKeys { it in allowedComponents })
    }

    // Filter anyComponent oneOf if it exists
    (schemaCopy["\$defs"] as? JsonObject)?.let { defsElement ->
      (defsElement["anyComponent"] as? JsonObject)?.let { anyCompElement ->
        val newAnyComp = pruneAnyComponentOneOf(anyCompElement, allowedComponents)
        val newDefs = defsElement.toMutableMap().apply { put("anyComponent", newAnyComp) }
        schemaCopy["\$defs"] = JsonObject(newDefs)
      }
    }

    return copy(catalogSchema = JsonObject(schemaCopy))
  }

  private fun withPrunedMessages(allowedMessages: List<String>): A2uiCatalog {
    if (allowedMessages.isEmpty()) return this

    val s2cCopy = serverToClientSchema.toMutableMap()

    if (version == A2uiVersion.VERSION_0_8) {
      (s2cCopy["properties"] as? JsonObject)?.let { props ->
        s2cCopy["properties"] =
          pruneDefsByReachability(
            defs = props,
            rootDefNames = allowedMessages,
            internalRefPrefix = "#/properties/",
          )
      }
    } else {
      (s2cCopy["oneOf"] as? JsonArray)?.let { oneOf ->
        val filteredOneOf =
          oneOf.filter { item ->
            val ref = (item as? JsonObject)?.get("\$ref")?.jsonPrimitive?.content
            ref != null && ref.startsWith("#/\$defs/") && ref.split("/").last() in allowedMessages
          }
        s2cCopy["oneOf"] = JsonArray(filteredOneOf)
      }

      (s2cCopy["\$defs"] as? JsonObject)?.let { defs ->
        s2cCopy["\$defs"] =
          pruneDefsByReachability(
            defs = defs,
            rootDefNames = allowedMessages,
            internalRefPrefix = "#/\$defs/",
          )
      }
    }

    return copy(serverToClientSchema = JsonObject(s2cCopy))
  }

  /** Returns a new catalog with unused common types pruned from the schema. */
  private fun withPrunedCommonTypes(): A2uiCatalog {
    val defs = commonTypesSchema["\$defs"] as? JsonObject ?: return this
    if (defs.isEmpty()) return this

    val externalRefs = mutableSetOf<String>()
    collectRefs(catalogSchema, externalRefs)
    collectRefs(serverToClientSchema, externalRefs)

    val prefix = "common_types.json#/\$defs/"
    val rootDefs =
      externalRefs.mapNotNull { if (it.startsWith(prefix)) it.substring(prefix.length) else null }

    val newDefs = pruneDefsByReachability(defs, rootDefs)
    val newCommonTypes =
      JsonObject(commonTypesSchema.toMutableMap().apply { put("\$defs", newDefs) })

    return copy(commonTypesSchema = newCommonTypes)
  }

  private fun collectRefs(rootElement: JsonElement, refs: MutableSet<String>) {
    val stack = ArrayDeque<JsonElement>()
    stack.addLast(rootElement)

    while (stack.isNotEmpty()) {
      when (val element = stack.removeLast()) {
        is JsonObject -> {
          for ((k, v) in element) {
            if (k == "\$ref" && v is JsonPrimitive && v.isString) {
              refs.add(v.content)
            } else {
              stack.addLast(v)
            }
          }
        }
        is JsonArray -> {
          for (item in element) {
            stack.addLast(item)
          }
        }
        else -> {}
      }
    }
  }

  private fun pruneDefsByReachability(
    defs: JsonObject,
    rootDefNames: List<String>,
    internalRefPrefix: String = "#/\$defs/",
  ): JsonObject {
    val visitedDefs = mutableSetOf<String>()
    val queue = ArrayDeque(rootDefNames)

    while (queue.isNotEmpty()) {
      val defName = queue.removeFirst()
      if (defs.containsKey(defName) && visitedDefs.add(defName)) {
        val defElement = defs[defName]!!
        val internalRefs = mutableSetOf<String>()
        collectRefs(defElement, internalRefs)
        for (ref in internalRefs) {
          if (ref.startsWith(internalRefPrefix)) {
            queue.add(ref.substring(internalRefPrefix.length))
          }
        }
      }
    }

    return JsonObject(defs.filterKeys { it in visitedDefs })
  }

  private fun pruneAnyComponentOneOf(
    anyCompElement: JsonObject,
    allowedComponents: List<String>,
  ): JsonObject {
    val oneOfElement = anyCompElement["oneOf"] as? JsonArray ?: return anyCompElement

    val filteredOneOf =
      oneOfElement.filter { item ->
        val ref = (item as? JsonObject)?.get("\$ref")?.jsonPrimitive?.content
        if (ref != null && ref.startsWith("#/${A2uiConstants.CATALOG_COMPONENTS_KEY}/")) {
          val compName = ref.split("/").last()
          compName in allowedComponents
        } else {
          true // Keep external refs or non-matching refs
        }
      }

    return JsonObject(anyCompElement + ("oneOf" to JsonArray(filteredOneOf)))
  }

  /** Renders the catalog and schema as LLM instructions. */
  fun renderAsLlmInstructions(): String = buildString {
    appendLine(A2uiConstants.A2UI_SCHEMA_BLOCK_START)
    appendLine()
    val jsonFmt = Json

    appendLine("### Server To Client Schema:")
    appendLine(jsonFmt.encodeToString(JsonElement.serializer(), serverToClientSchema))

    val defs = commonTypesSchema["\$defs"] as? JsonObject
    if (!defs.isNullOrEmpty()) {
      appendLine("\n### Common Types Schema:")
      appendLine(jsonFmt.encodeToString(JsonElement.serializer(), commonTypesSchema))
    }

    appendLine("\n### Catalog Schema:")
    appendLine(jsonFmt.encodeToString(JsonElement.serializer(), catalogSchema))

    append("\n${A2uiConstants.A2UI_SCHEMA_BLOCK_END}")
  }

  /** Loads and validates examples from a directory or a glob pattern. */
  @JvmOverloads
  fun loadExamples(path: String?, validate: Boolean = false): String {
    if (path.isNullOrEmpty()) return ""

    val isDir = File(path).isDirectory
    val pattern =
      if (isDir) {
        val sep = if (path.endsWith("/") || path.endsWith(File.separator)) "" else "/"
        "$path$sep*.json"
      } else {
        path
      }

    // Extract the base directory to avoid walking the entire filesystem.
    val firstWildcard = pattern.indexOfFirst { it == '*' || it == '?' || it == '[' }
    val baseDirPath =
      if (firstWildcard != -1) {
        val lastSlash = pattern.lastIndexOfAny(charArrayOf('/', '\\'), firstWildcard)
        if (lastSlash != -1) {
          pattern.substring(startIndex = 0, endIndex = lastSlash)
        } else {
          ""
        }
      } else {
        if (isDir) {
          path
        } else {
          val parent = File(path).parent
          parent ?: ""
        }
      }

    val baseDirFile = if (baseDirPath.isEmpty()) File(".") else File(baseDirPath)
    val matchedFiles = mutableListOf<File>()

    if (baseDirFile.exists() && baseDirFile.isDirectory) {
      try {
        val matcher = FileSystems.getDefault().getPathMatcher("glob:$pattern")
        // To support globstar matching where ** matches zero directories, create an alternate
        // matcher.
        val altPattern =
          pattern
            .replace(oldValue = "/**/", newValue = "/")
            .replace(regex = "^\\*\\*/".toRegex(), replacement = "")
        val altMatcher =
          if (altPattern != pattern) {
            FileSystems.getDefault().getPathMatcher("glob:$altPattern")
          } else {
            null
          }

        val startPath =
          if (baseDirPath.isEmpty()) {
            Paths.get("")
          } else {
            Paths.get(baseDirPath)
          }

        Files.walk(startPath).use { stream ->
          stream.forEach { p ->
            if (Files.isRegularFile(p)) {
              if (matcher.matches(p) || altMatcher?.matches(p) == true) {
                matchedFiles.add(p.toFile())
              }
            }
          }
        }
      } catch (e: Exception) {
        logger.warning("Error walking files for pattern $pattern: ${e.message}")
      }
    }

    if (matchedFiles.isEmpty()) {
      if (!isDir && !path.any { it == '*' || it == '?' || it == '[' }) {
        logger.warning("Example path $path is neither a directory nor a valid glob pattern")
      }
      return ""
    }

    // Sort files alphabetically by path to ensure deterministic output order and logical grouping.
    val files = matchedFiles.sortedBy { it.path }

    return files
      .mapNotNull { file ->
        val basename = file.nameWithoutExtension
        val content =
          try {
            file.readText()
          } catch (e: Exception) {
            logger.warning("Failed to read example ${file.path}: ${e.message}")
            return@mapNotNull null
          }

        if (validate) {
          validateExample(file.path, content)
        }
        "---BEGIN $basename---\n$content\n---END $basename---"
      }
      .joinToString(separator = "\n\n")
  }

  private fun validateExample(fullPath: String, content: String) {
    try {
      val jsonElement = Json.parseToJsonElement(content)
      validator.validate(jsonElement)
    } catch (e: Exception) {
      throw IllegalArgumentException("Failed to validate example $fullPath: ${e.message}", e)
    }
  }
}
