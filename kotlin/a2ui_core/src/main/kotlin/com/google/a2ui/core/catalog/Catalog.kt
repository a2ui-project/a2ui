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

package com.google.a2ui.core.catalog

import com.google.a2ui.core.common.A2uiMetadata
import com.google.a2ui.core.common.ProtocolVersion
import com.google.a2ui.core.common.ReadonlySignal
import com.google.a2ui.core.common.Uax31Identifier
import com.google.a2ui.core.exceptions.A2uiCatalogError
import com.google.a2ui.core.resolution.DataContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/** Return types defined in `catalog_definition.json#/$defs/FunctionDefinition`. */
enum class FunctionReturnType(val wireValue: String) {
  STRING("string"),
  NUMBER("number"),
  BOOLEAN("boolean"),
  ARRAY("array"),
  OBJECT("object"),
  VALIDATION_RESULT("validationResult"),
  ANY("any"),
  VOID("void");

  companion object {
    fun fromWire(raw: String): FunctionReturnType =
      entries.firstOrNull { it.wireValue == raw }
        ?: throw A2uiCatalogError("Unknown function returnType: '$raw'")
  }
}

/** Caller permission boundaries in `catalog_definition.json#/$defs/FunctionDefinition`. */
enum class AllowedCallers(val wireValue: String) {
  RENDERER_ONLY("rendererOnly"),
  AGENT_ONLY("agentOnly"),
  RENDERER_OR_AGENT("rendererOrAgent");

  val isAgentCallable: Boolean
    get() = this == AGENT_ONLY || this == RENDERER_OR_AGENT

  companion object {
    fun fromWire(raw: String?): AllowedCallers =
      when (raw) {
        null,
        "rendererOnly" -> RENDERER_ONLY
        "agentOnly" -> AGENT_ONLY
        "rendererOrAgent" -> RENDERER_OR_AGENT
        else -> throw A2uiCatalogError("Invalid allowedCallers value: '$raw'")
      }
  }
}

/** Pure schema contract for a component (`a2ui_core.blueprint.md` §3.A). */
interface ComponentApi {
  val name: String
  val schema: JsonObject
  val metadata: A2uiMetadata?
}

data class SchemaComponentApi(
  override val name: String,
  override val schema: JsonObject,
  override val metadata: A2uiMetadata? = null,
) : ComponentApi

/** Pure schema signature for a catalog function (`a2ui_core.blueprint.md` §3.A). */
interface FunctionApi {
  val name: String
  val returnType: FunctionReturnType
  val schema: JsonObject
  val allowedCallers: AllowedCallers
  val requiresUserActivation: Boolean
  val description: String?
}

data class SchemaFunctionApi(
  override val name: String,
  override val returnType: FunctionReturnType,
  override val schema: JsonObject,
  override val allowedCallers: AllowedCallers = AllowedCallers.RENDERER_ONLY,
  override val requiresUserActivation: Boolean = false,
  override val description: String? = null,
) : FunctionApi

/** Result of evaluating a local renderer [FunctionImplementation]. */
sealed interface FunctionExecutionResult {
  data class Immediate(val value: JsonElement) : FunctionExecutionResult

  data class Reactive(val signal: ReadonlySignal<JsonElement>) : FunctionExecutionResult
}

/** Executable renderer-side function (`a2ui_core.blueprint.md` §3.A). */
interface FunctionImplementation : FunctionApi {
  fun execute(args: Map<String, JsonElement>, context: DataContext): FunctionExecutionResult
}

/** Context supplied to an agent-hosted function (`agent_functions.blueprint.md` §1). */
data class AgentFunctionContext(
  val catalogId: String,
  val surfaceId: String,
  val functionCallId: String,
)

fun interface AgentFunctionHandler {
  suspend fun invoke(args: Map<String, JsonElement>, context: AgentFunctionContext): JsonElement
}

/** Agent-hosted function attached to an agent's copy of a catalog via [Catalog.copyWith]. */
class AgentFunction(
  override val name: String,
  override val returnType: FunctionReturnType,
  override val schema: JsonObject,
  val handler: AgentFunctionHandler,
  override val allowedCallers: AllowedCallers = AllowedCallers.RENDERER_ONLY,
  override val requiresUserActivation: Boolean = false,
  override val description: String? = null,
  internal val sourceDeclaration: FunctionApi? = null,
) : FunctionApi {
  init {
    if (allowedCallers == AllowedCallers.AGENT_ONLY) {
      throw A2uiCatalogError("AgentFunction '$name' cannot declare allowedCallers='agentOnly'")
    }
    if (requiresUserActivation && allowedCallers != AllowedCallers.RENDERER_ONLY) {
      throw A2uiCatalogError(
        "AgentFunction '$name' with requiresUserActivation=true must use 'rendererOnly'"
      )
    }
  }

  fun withHandler(newHandler: AgentFunctionHandler): AgentFunction =
    if (sourceDeclaration != null) {
      fromApi(sourceDeclaration, newHandler)
    } else {
      AgentFunction(
        name = name,
        returnType = returnType,
        schema = schema,
        handler = newHandler,
        allowedCallers = allowedCallers,
        requiresUserActivation = requiresUserActivation,
        description = description,
      )
    }

  companion object {
    fun fromApi(declaration: FunctionApi, handler: AgentFunctionHandler): AgentFunction =
      AgentFunction(
        name = declaration.name,
        returnType = declaration.returnType,
        schema = declaration.schema,
        handler = handler,
        allowedCallers = declaration.allowedCallers,
        requiresUserActivation = declaration.requiresUserActivation,
        description = declaration.description,
        sourceDeclaration = declaration,
      )
  }
}

/** Entry selector for [Catalog.derive] (`a2ui_core.blueprint.md` §3.A). */
sealed interface DerivedCatalogEntry<out T> {
  data class Keep(val name: String) : DerivedCatalogEntry<Nothing>

  data class Add<T>(val entry: T) : DerivedCatalogEntry<T>
}

/** Schema-only catalog alias exported across all SDKs (`a2ui_core.blueprint.md` §3.A). */
typealias CatalogApi = Catalog<ComponentApi, FunctionApi>

/**
 * Immutable catalog of component and function definitions (`a2ui_core.blueprint.md` §3.A).
 *
 * Retains the underlying [JsonObject] document representation via [toJson] so JSON-schema-driven
 * inference formats (such as standalone Express) can inspect raw catalog `$defs`, `instructions`,
 * and property declaration order with zero lossy re-serialization.
 */
class Catalog<out TComponent : ComponentApi, out TFunction : FunctionApi>(
  val id: String,
  components: List<TComponent>,
  functions: List<TFunction> = emptyList(),
  val protocolVersion: ProtocolVersion? = null,
  val themeSchema: JsonObject? = null,
  val title: String? = null,
  val description: String? = null,
  val instructions: String? = null,
  private val baseDocument: JsonObject? = null,
) {
  val components: Map<String, TComponent> = components.associateBy { it.name }
  val functions: Map<String, TFunction> = functions.associateBy { it.name }

  val agentFunctions: Map<String, AgentFunction>
    get() = buildMap {
      for ((k, fn) in functions) {
        if (fn is AgentFunction) put(k, fn)
      }
    }

  val rendererFunctions: Map<String, TFunction>
    get() = functions.filterValues { it !is AgentFunction }

  init {
    if (id.isEmpty()) {
      throw A2uiCatalogError("Catalog 'catalogId' must be non-empty")
    }
    if (protocolVersion?.isV1OrLater == true) {
      if ("Surface" in this.components) {
        throw A2uiCatalogError("Component name 'Surface' is reserved in v1.0+")
      }
      for (compName in this.components.keys) {
        if (!Uax31Identifier.isValid(compName)) {
          throw A2uiCatalogError("Invalid UAX #31 component identifier: '$compName'")
        }
      }
      for (fnName in this.functions.keys) {
        if (!Uax31Identifier.isValid(fnName)) {
          throw A2uiCatalogError("Invalid UAX #31 function identifier: '$fnName'")
        }
      }
    } else if (this.functions.values.any { it is AgentFunction }) {
      throw A2uiCatalogError("Agent functions require protocol v1.0 or later")
    }
  }

  /** Returns a schema-only copy with updated components, functions, or [agentFunctions]. */
  fun copyWith(
    components: List<ComponentApi>? = null,
    functions: List<FunctionApi>? = null,
    agentFunctions: List<AgentFunction>? = null,
    instructions: String? = this.instructions,
  ): CatalogApi {
    val nextComponents = components ?: this.components.values.toList()
    val baseFunctions: MutableMap<String, FunctionApi> =
      if (functions != null) {
        functions.associateByTo(linkedMapOf()) { it.name }
      } else {
        linkedMapOf<String, FunctionApi>().apply {
          for ((name, fn) in this@Catalog.functions) {
            if (fn is AgentFunction) {
              fn.sourceDeclaration?.let { put(name, it) }
            } else {
              put(name, fn)
            }
          }
        }
      }
    if (agentFunctions != null) {
      val seen = HashSet<String>()
      for (af in agentFunctions) {
        if (!seen.add(af.name)) {
          throw A2uiCatalogError("Duplicate agent function '${af.name}'")
        }
        val existing = baseFunctions[af.name]
        if (af.sourceDeclaration != null) {
          if (existing !== af.sourceDeclaration) {
            throw A2uiCatalogError(
              "AgentFunction '${af.name}' was not built from this catalog's declaration"
            )
          }
        } else if (existing != null) {
          throw A2uiCatalogError(
            "AgentFunction '${af.name}' collides with declared catalog function"
          )
        }
        baseFunctions[af.name] = af
      }
    }
    return Catalog(
      id = id,
      components = nextComponents,
      functions = baseFunctions.values.toList(),
      protocolVersion = protocolVersion,
      themeSchema = themeSchema,
      title = title,
      description = description,
      instructions = instructions,
      baseDocument = baseDocument,
    )
  }

  /**
   * Derives a new catalog under [catalogId], dropping source `$id`, title, description, and
   * instructions.
   */
  fun derive(
    catalogId: String,
    components: List<DerivedCatalogEntry<@UnsafeVariance TComponent>>? = null,
    functions: List<DerivedCatalogEntry<@UnsafeVariance TFunction>>? = null,
    instructions: String? = null,
  ): Catalog<TComponent, TFunction> {
    val derivedComponents =
      components?.map { entry ->
        when (entry) {
          is DerivedCatalogEntry.Keep ->
            this.components[entry.name]
              ?: throw A2uiCatalogError("Unknown component '${entry.name}' in derive()")
          is DerivedCatalogEntry.Add -> entry.entry
        }
      } ?: this.components.values.toList()

    val derivedFunctions =
      functions?.map { entry ->
        when (entry) {
          is DerivedCatalogEntry.Keep ->
            this.functions[entry.name]
              ?: throw A2uiCatalogError("Unknown function '${entry.name}' in derive()")
          is DerivedCatalogEntry.Add -> entry.entry
        }
      } ?: this.functions.values.toList()

    return Catalog(
      id = catalogId,
      components = derivedComponents,
      functions = derivedFunctions,
      protocolVersion = protocolVersion,
      themeSchema = themeSchema,
      instructions = instructions,
      baseDocument = baseDocument,
    )
  }

  /**
   * Serializes this catalog to its JSON Schema representation (reflecting any pruning/derivation).
   */
  fun toJson(): JsonObject {
    val root = baseDocument?.toMutableMap() ?: linkedMapOf()
    root["catalogId"] = JsonPrimitive(id)
    protocolVersion?.let { root["protocolVersion"] = JsonPrimitive(it.wireTag) }
    if (title != null) root["title"] = JsonPrimitive(title) else root.remove("title")
    if (description != null) {
      root["description"] = JsonPrimitive(description)
    } else {
      root.remove("description")
    }
    if (instructions != null) {
      root["instructions"] = JsonPrimitive(instructions)
    } else {
      root.remove("instructions")
    }
    if (baseDocument?.get("\$id")?.let { (it as? JsonPrimitive)?.content } != id) {
      root.remove("\$id")
    }
    root["components"] = JsonObject(components.mapValues { (_, comp) -> comp.schema })
    if (functions.isNotEmpty() || "functions" in root) {
      root["functions"] = JsonObject(functions.mapValues { (_, fn) -> fn.schema })
    }
    return JsonObject(root)
  }

  companion object {
    /**
     * Parses a JSON catalog document under the fail-closed rules of `a2ui_core.blueprint.md` §3.A.
     */
    fun fromJson(
      document: JsonObject,
      expectedVersion: ProtocolVersion? = null,
      expectedCatalogId: String? = null,
    ): CatalogApi {
      val docCatalogId = (document["catalogId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
      if (docCatalogId != null && expectedCatalogId != null && docCatalogId != expectedCatalogId) {
        throw A2uiCatalogError(
          "Catalog ID mismatch: document declares '$docCatalogId', expected '$expectedCatalogId'"
        )
      }
      val resolvedId =
        docCatalogId
          ?: expectedCatalogId
          ?: throw A2uiCatalogError("Catalog document missing 'catalogId' and none provided")

      val docVersionStr =
        (document["protocolVersion"] as? JsonPrimitive)?.takeIf { it.isString }?.content
      val docVersion = docVersionStr?.let { ProtocolVersion.parse(it) }
      if (docVersion != null && expectedVersion != null && docVersion != expectedVersion) {
        throw A2uiCatalogError(
          "Catalog protocolVersion mismatch: document declares '${docVersion.wireTag}', expected '${expectedVersion.wireTag}'"
        )
      }
      val resolvedVersion =
        docVersion
          ?: expectedVersion
          ?: throw A2uiCatalogError(
            "Catalog '$resolvedId' states no 'protocolVersion' and provider gave none"
          )

      val componentsObj =
        when (val rawComps = document["components"]) {
          null -> JsonObject(emptyMap())
          is JsonObject -> rawComps
          else -> throw A2uiCatalogError("Catalog 'components' must be a JSON object")
        }
      val parsedComponents =
        componentsObj.map { (name, elem) ->
          val schema =
            elem as? JsonObject
              ?: throw A2uiCatalogError("Component '$name' definition must be a JSON object")
          val meta = (schema["metadata"] as? JsonObject)?.let { A2uiMetadata.fromJsonObject(it) }
          SchemaComponentApi(name = name, schema = schema, metadata = meta)
        }

      val parsedFunctions =
        when (val rawFuncs = document["functions"]) {
          null -> emptyList()
          is JsonObject ->
            rawFuncs.map { (name, elem) ->
              val schema =
                elem as? JsonObject
                  ?: throw A2uiCatalogError("Function '$name' definition must be a JSON object")
              val returnTypeStr =
                (schema["returnType"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: "any"
              val callersStr =
                (schema["allowedCallers"] as? JsonPrimitive)?.takeIf { it.isString }?.content
              val requiresActivation =
                (schema["requiresUserActivation"] as? JsonPrimitive)?.booleanOrNull ?: false
              val desc = (schema["description"] as? JsonPrimitive)?.takeIf { it.isString }?.content
              SchemaFunctionApi(
                name = name,
                returnType = FunctionReturnType.fromWire(returnTypeStr),
                schema = schema,
                allowedCallers = AllowedCallers.fromWire(callersStr),
                requiresUserActivation = requiresActivation,
                description = desc,
              )
            }
          else -> throw A2uiCatalogError("Catalog 'functions' must be a JSON object in v1.0")
        }

      return Catalog(
        id = resolvedId,
        components = parsedComponents,
        functions = parsedFunctions,
        protocolVersion = resolvedVersion,
        themeSchema = document["theme"] as? JsonObject,
        title = (document["title"] as? JsonPrimitive)?.takeIf { it.isString }?.content,
        description = (document["description"] as? JsonPrimitive)?.takeIf { it.isString }?.content,
        instructions =
          (document["instructions"] as? JsonPrimitive)?.takeIf { it.isString }?.content,
        baseDocument = document,
      )
    }
  }
}
