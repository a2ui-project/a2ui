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

import com.google.a2ui.exceptions.A2uiCatalogException
import com.google.a2ui.inference_formats.experimental.express.constants.SurfaceOperation
import com.google.a2ui.schema.A2uiCatalog
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Raised internally during streaming when an expression references an unassigned value variable.
 */
internal class PendingVariableException(val varName: String) : RuntimeException(varName)

internal data class InlineContext(
  val parentId: String,
  val property: String,
  val index: Int? = null,
)

private data class ValueSlot(val schema: JsonObject?, val helper: CatalogSchemaHelper)

internal class CompileContext(
  val keys: ReservedWireKeys,
  val version: String,
  val allowPending: Boolean = false,
) {
  var extraComponents = mutableListOf<JsonObject>()
  var generatedIds = LinkedHashSet<String>()
  var inlineCounter = 0
  var callCounter = 0
  var activeBoundPaths: Map<String, JsonObject> = emptyMap()
  val resolving = LinkedHashSet<String>()
  val referencedVars = LinkedHashSet<String>()
}

internal class SurfaceScope(
  val surfaceId: String,
  val sendDataModel: Boolean? = null,
  val update: Boolean = false,
  val hasSurfaceDirective: Boolean = false,
  val rawExtensions: ExpressNode? = null,
) {
  val rawSymbols = LinkedHashMap<String, ExpressNode>()
  val dataPathAssignments = LinkedHashMap<String, ExpressNode>()
}

internal sealed interface CompilationUnit {
  data class Scope(val scope: SurfaceScope) : CompilationUnit

  data class Delete(val surfaceId: String) : CompilationUnit

  data class StandaloneCall(val stmt: ExpressNode.Call, val scope: SurfaceScope?) : CompilationUnit
}

/**
 * Incremental compilation session across streamed chunks of a single `<a2ui>` block.
 *
 * Emits `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`, and
 * `callRendererFunction` deltas as statements complete, holding back new surfaces until `root`
 * arrives and deferring expressions referencing not-yet-assigned value variables.
 */
class ExpressScopeSession(
  val compiler: ExpressCompiler,
  val surfaceId: String = "default_surface",
  version: String? = null,
) {
  val version: String =
    if (version != null) resolveExpressVersion(compiler.catalogs, version) else compiler.version
  var hasEmitted: Boolean = false
    private set

  var supersededComponents: MutableList<Pair<String, String>> = mutableListOf()
    private set

  internal data class CachedCompEntry(
    val ast: ExpressNode,
    val comps: List<JsonObject>,
    val deps: Map<String, Pair<ExpressNode?, String?>>,
    val startInline: Int,
    val inlineDelta: Int,
    val generatedIds: List<String>,
  )

  internal data class CachedDataEntry(
    val ast: ExpressNode,
    val value: JsonElement,
    val deps: Map<String, Pair<ExpressNode?, String?>>,
  )

  internal class ScopeStreamState(
    var surfaceId: String,
    var surfaceCreated: Boolean = false,
    val emittedComponents: LinkedHashMap<String, String> = LinkedHashMap(),
    val emittedDataPaths: LinkedHashMap<String, String> = LinkedHashMap(),
    val varIds: LinkedHashMap<String, String> = LinkedHashMap(),
    val compiledCache: LinkedHashMap<String, CachedCompEntry> = LinkedHashMap(),
    val dataCache: LinkedHashMap<String, CachedDataEntry> = LinkedHashMap(),
  ) {
    fun deepCopy(): ScopeStreamState =
      ScopeStreamState(
        surfaceId = surfaceId,
        surfaceCreated = surfaceCreated,
        emittedComponents = LinkedHashMap(emittedComponents),
        emittedDataPaths = LinkedHashMap(emittedDataPaths),
        varIds = LinkedHashMap(varIds),
        compiledCache = LinkedHashMap(compiledCache),
        dataCache = LinkedHashMap(dataCache),
      )
  }

  internal data class SessionSnapshot(
    val hasEmitted: Boolean,
    val superseded: List<Pair<String, String>>,
    val scopeStates: LinkedHashMap<Int, ScopeStreamState>,
    val emittedUnits: LinkedHashSet<Int>,
    val cachedPrefix: String,
    val cachedStatements: List<ExpressStmt>,
  )

  private var scopeStates = LinkedHashMap<Int, ScopeStreamState>()
  private var emittedUnits = LinkedHashSet<Int>()
  private var cachedPrefix = ""
  private var cachedStatements: List<ExpressStmt> = emptyList()

  internal fun snapshot(): SessionSnapshot {
    val copiedStates = LinkedHashMap<Int, ScopeStreamState>()
    for ((k, v) in scopeStates) copiedStates[k] = v.deepCopy()
    return SessionSnapshot(
      hasEmitted = hasEmitted,
      superseded = supersededComponents.toList(),
      scopeStates = copiedStates,
      emittedUnits = LinkedHashSet(emittedUnits),
      cachedPrefix = cachedPrefix,
      cachedStatements = cachedStatements.toList(),
    )
  }

  internal fun restore(saved: SessionSnapshot) {
    hasEmitted = saved.hasEmitted
    supersededComponents = saved.superseded.toMutableList()
    scopeStates = saved.scopeStates
    emittedUnits = saved.emittedUnits
    cachedPrefix = saved.cachedPrefix
    cachedStatements = saved.cachedStatements
  }

  fun compileStep(
    dslText: String,
    isFinal: Boolean,
    existingSurfaces: Set<String>,
    cachePrefix: Boolean = true,
  ): List<JsonObject> {
    supersededComponents = mutableListOf()
    val isV1 = isExpressV1OrLater(version)
    if (compiler.catalogs.size > 1 && !isV1) {
      throw A2uiCatalogException("Several catalogs need A2UI v1.0 or later, but got '$version'.")
    }
    val keys = compiler.defaultReservedKeys(isV1)
    val ctx = CompileContext(keys, version, allowPending = !isFinal)
    val statements = parseIncrementalStatements(dslText, isFinal, cachePrefix)
    val units = compiler.buildUnits(statements, surfaceId, isV1)
    if (units.isEmpty()) {
      if (isFinal) {
        throw ExpressValidationError("Surface is missing required 'root' component.")
      }
      return emptyList()
    }

    val activeSurfaces = LinkedHashSet(existingSurfaces)
    val out = mutableListOf<JsonObject>()
    for ((idx, unit) in units.withIndex()) {
      out.addAll(compileUnit(idx, unit, ctx, isV1, isFinal, activeSurfaces))
    }
    return out
  }

  private fun parseIncrementalStatements(
    dslText: String,
    isFinal: Boolean,
    cachePrefix: Boolean,
  ): List<ExpressStmt> {
    if (
      cachedPrefix.isNotEmpty() &&
        dslText.startsWith(cachedPrefix) &&
        isValidPrefixBoundary(dslText, cachedPrefix.length)
    ) {
      val tail = dslText.substring(cachedPrefix.length)
      val tailStmts =
        if (tail.isNotBlank())
          compiler.parseStatements(tail, isFinal = true, stripSentinels = false)
        else emptyList()
      val merged = cachedStatements + tailStmts
      if (cachePrefix) {
        cachedPrefix = dslText
        cachedStatements = merged
      }
      return merged
    }
    val stmts =
      compiler.parseStatements(
        dslText,
        isFinal = isFinal || dslText.isNotBlank(),
        stripSentinels = false,
      )
    if (cachePrefix) {
      cachedPrefix = dslText
      cachedStatements = stmts
    }
    return stmts
  }

  private fun compileUnit(
    idx: Int,
    unit: CompilationUnit,
    ctx: CompileContext,
    isV1: Boolean,
    isFinal: Boolean,
    activeSurfaces: MutableSet<String>,
  ): List<JsonObject> {
    when (unit) {
      is CompilationUnit.Delete -> {
        activeSurfaces.remove(unit.surfaceId)
        if (!emittedUnits.add(idx)) return emptyList()
        hasEmitted = true
        return listOf(
          JsonObject(
            mapOf(
              "version" to JsonPrimitive(version),
              SurfaceOperation.DELETE to
                JsonObject(mapOf("surfaceId" to JsonPrimitive(unit.surfaceId))),
            )
          )
        )
      }
      is CompilationUnit.StandaloneCall -> {
        if (emittedUnits.contains(idx)) return emptyList()
        return try {
          val msg = compiler.compileStandaloneCall(unit.stmt, unit.scope, ctx, version, isV1)
          emittedUnits.add(idx)
          hasEmitted = true
          listOf(msg)
        } catch (_: PendingVariableException) {
          emptyList()
        }
      }
      is CompilationUnit.Scope -> {
        val state = scopeStates.getOrPut(idx) { ScopeStreamState(surfaceId = unit.scope.surfaceId) }
        state.surfaceId = unit.scope.surfaceId
        val surfaceExists = unit.scope.surfaceId in activeSurfaces
        val msgs = compileScopeDelta(unit.scope, state, ctx, isV1, isFinal, surfaceExists)
        if (surfaceExists || state.surfaceCreated) {
          activeSurfaces.add(unit.scope.surfaceId)
        }
        return msgs
      }
    }
  }

  private fun compileScopeDelta(
    scope: SurfaceScope,
    state: ScopeStreamState,
    ctx: CompileContext,
    isV1: Boolean,
    isFinal: Boolean,
    surfaceExists: Boolean,
  ): List<JsonObject> {
    val compIds = compiler.collectComponentIds(scope, isV1)
    val (compiledComponents, hasPending) = collectReadyComponents(scope, state, compIds, ctx, isV1)
    val compiledData = collectReadyData(scope, state, compIds, ctx, isV1)
    val hasRoot = compiledComponents.any { it["id"] == JsonPrimitive("root") }
    val needsCreate =
      !scope.update &&
        !state.surfaceCreated &&
        (!surfaceExists || hasRoot || scope.rawExtensions != null)
    return if (needsCreate) {
      compileInitialCreate(
        scope,
        state,
        compiledComponents,
        compiledData,
        isFinal,
        compIds,
        ctx,
        isV1,
      )
    } else {
      compileIncrementalUpdates(
        scope,
        state,
        compiledComponents,
        compiledData,
        isFinal,
        hasPending,
        surfaceExists,
      )
    }
  }

  private fun compileInitialCreate(
    scope: SurfaceScope,
    state: ScopeStreamState,
    compiledComponents: List<JsonObject>,
    compiledData: Map<String, JsonElement>,
    isFinal: Boolean,
    compIds: Map<String, String>,
    ctx: CompileContext,
    isV1: Boolean,
  ): List<JsonObject> {
    val hasRoot = compiledComponents.any { it["id"] == JsonPrimitive("root") }
    if (!hasRoot) {
      if (!isFinal) return emptyList()
      if (scope.rawExtensions != null) {
        throw ExpressValidationError(
          "surface() extensions require a surface-creating scope with a root component."
        )
      }
      if (compiledComponents.isNotEmpty() || compiledData.isNotEmpty()) {
        return compileIncrementalUpdates(
          scope,
          state,
          compiledComponents,
          compiledData,
          isFinal = true,
          hasPending = false,
          surfaceExists = false,
        )
      }
      throw ExpressValidationError(
        "Surface '${scope.surfaceId}' is missing required 'root' component."
      )
    }

    val metadata =
      try {
        compiler.compileSurfaceMetadata(scope, compIds, ctx, isV1)
      } catch (e: PendingVariableException) {
        if (!isFinal) return emptyList()
        throw ExpressValidationError("Undefined variable '${e.varName}'.")
      }

    val dataTree = LinkedHashMap<String, Any?>()
    for ((pathName, valEl) in compiledData) {
      setNestedPath(dataTree, pathName, valEl)
      state.emittedDataPaths[pathName] = valEl.toString()
    }
    val dataModelObj = nestedTreeToJsonObject(dataTree)
    for (comp in compiledComponents) {
      val id = (comp["id"] as JsonPrimitive).content
      state.emittedComponents[id] = comp.toString()
    }
    state.surfaceCreated = true
    hasEmitted = true
    return compiler.buildCreateMessages(scope, compiledComponents, dataModelObj, version, metadata)
  }

  private fun compileIncrementalUpdates(
    scope: SurfaceScope,
    state: ScopeStreamState,
    compiledComponents: List<JsonObject>,
    compiledData: Map<String, JsonElement>,
    isFinal: Boolean,
    hasPending: Boolean,
    surfaceExists: Boolean,
  ): List<JsonObject> {
    val deltaComponents =
      compiledComponents.filter { comp ->
        val id = (comp["id"] as JsonPrimitive).content
        state.emittedComponents[id] != comp.toString()
      }
    for (comp in deltaComponents) {
      val id = (comp["id"] as JsonPrimitive).content
      state.emittedComponents[id] = comp.toString()
    }
    val dataUpdates = buildDataUpdates(scope, state, compiledData)
    if (
      isFinal &&
        state.emittedComponents.isEmpty() &&
        state.emittedDataPaths.isEmpty() &&
        !hasPending
    ) {
      throw ExpressValidationError(
        "Surface '${scope.surfaceId}' is missing required 'root' component."
      )
    }

    val messages = mutableListOf<JsonObject>()
    if (deltaComponents.isNotEmpty()) {
      if (!isFinal && !scope.hasSurfaceDirective && !state.surfaceCreated && !surfaceExists) {
        throw ExpressValidationError(
          "Surface '${scope.surfaceId}' is missing required 'root' component."
        )
      }
      messages.add(
        JsonObject(
          mapOf(
            "version" to JsonPrimitive(version),
            SurfaceOperation.UPDATE_COMPONENTS to
              JsonObject(
                mapOf(
                  "surfaceId" to JsonPrimitive(scope.surfaceId),
                  "components" to JsonArray(deltaComponents),
                )
              ),
          )
        )
      )
    }
    messages.addAll(dataUpdates)
    if (messages.isNotEmpty()) {
      hasEmitted = true
    }
    return messages
  }

  private fun earlierScopeComponent(
    currentState: ScopeStreamState,
    targetSurfaceId: String,
    compId: String,
  ): JsonObject? {
    var foundJson: String? = null
    for (st in scopeStates.values) {
      if (st === currentState) break
      if (st.surfaceId == targetSurfaceId && st.emittedComponents.containsKey(compId)) {
        foundJson = st.emittedComponents[compId]
      }
    }
    return foundJson?.let { kotlinx.serialization.json.Json.parseToJsonElement(it) as JsonObject }
  }

  private fun collectReadyComponents(
    scope: SurfaceScope,
    state: ScopeStreamState,
    compIds: Map<String, String>,
    ctx: CompileContext,
    isV1: Boolean,
  ): Pair<List<JsonObject>, Boolean> {
    ctx.generatedIds.clear()
    val topLevelIds = compIds.values.toSet()
    val compiled = mutableListOf<JsonObject>()
    val extras = mutableListOf<JsonObject>()
    val superseded = mutableListOf<String>()
    var hasPending = false

    for ((varName, ast) in scope.rawSymbols) {
      val cached = state.compiledCache[varName]
      if (cached != null && cached.ast === ast) {
        val depsUnchanged =
          cached.deps.all { (dep, pair) ->
            scope.rawSymbols[dep] === pair.first && compIds[dep] == pair.second
          }
        val idsFree =
          cached.generatedIds.all { gid ->
            gid !in ctx.generatedIds && gid !in topLevelIds && !scope.rawSymbols.containsKey(gid)
          }
        if (
          depsUnchanged &&
            (cached.inlineDelta == 0 || cached.startInline == ctx.inlineCounter) &&
            idsFree
        ) {
          ctx.inlineCounter += cached.inlineDelta
          ctx.generatedIds.addAll(cached.generatedIds)
          if (cached.comps.isNotEmpty()) {
            val compDict = cached.comps.first()
            val compId = (compDict["id"] as JsonPrimitive).content
            val prevId = state.varIds[varName]
            if (prevId != null && prevId != compId) {
              superseded.add(prevId)
            }
            state.varIds[varName] = compId
            compiled.add(compDict)
            extras.addAll(cached.comps.drop(1))
          }
          continue
        }
      }

      val prevInlineCounter = ctx.inlineCounter
      val prevGeneratedIds = LinkedHashSet(ctx.generatedIds)
      ctx.referencedVars.clear()
      try {
        val compDict =
          compiler.compileAstNodeForSession(varName, ast, scope.rawSymbols, compIds, ctx, isV1)
        val deps = LinkedHashMap<String, Pair<ExpressNode?, String?>>()
        for (dep in ctx.referencedVars) {
          deps[dep] = scope.rawSymbols[dep] to compIds[dep]
        }
        val newGeneratedIds = ctx.generatedIds.filter { it !in prevGeneratedIds }
        val inlineDelta = ctx.inlineCounter - prevInlineCounter
        if (compDict != null) {
          val compId = (compDict["id"] as JsonPrimitive).content
          val prevId = state.varIds[varName]
          if (prevId != null && prevId != compId) {
            superseded.add(prevId)
          }
          state.varIds[varName] = compId
          val nodeExtras = ctx.extraComponents.toList()
          ctx.extraComponents.clear()
          state.compiledCache[varName] =
            CachedCompEntry(
              ast = ast,
              comps = listOf(compDict) + nodeExtras,
              deps = deps,
              startInline = prevInlineCounter,
              inlineDelta = inlineDelta,
              generatedIds = newGeneratedIds,
            )
          compiled.add(compDict)
          extras.addAll(nodeExtras)
        } else {
          state.compiledCache[varName] =
            CachedCompEntry(
              ast = ast,
              comps = emptyList(),
              deps = deps,
              startInline = prevInlineCounter,
              inlineDelta = inlineDelta,
              generatedIds = newGeneratedIds,
            )
        }
      } catch (_: PendingVariableException) {
        ctx.extraComponents.clear()
        ctx.inlineCounter = prevInlineCounter
        ctx.generatedIds = prevGeneratedIds
        hasPending = true
      }
    }

    compiled.addAll(extras)
    if (superseded.isNotEmpty()) {
      val activeIds = compiled.map { (it["id"] as JsonPrimitive).content }.toSet()
      for (oldId in superseded) {
        if (oldId !in activeIds) {
          state.emittedComponents.remove(oldId)
          val earlierComp = earlierScopeComponent(state, scope.surfaceId, oldId)
          if (earlierComp != null) {
            compiled.add(earlierComp)
          } else {
            supersededComponents.add(scope.surfaceId to oldId)
          }
        }
      }
    }
    return compiled to hasPending
  }

  private fun collectReadyData(
    scope: SurfaceScope,
    state: ScopeStreamState,
    compIds: Map<String, String>,
    ctx: CompileContext,
    isV1: Boolean,
  ): Map<String, JsonElement> {
    val compiled = LinkedHashMap<String, JsonElement>()
    for ((pathName, astVal) in scope.dataPathAssignments) {
      val cached = state.dataCache[pathName]
      if (cached != null && cached.ast === astVal) {
        val depsUnchanged =
          cached.deps.all { (dep, pair) ->
            scope.rawSymbols[dep] === pair.first && compIds[dep] == pair.second
          }
        if (depsUnchanged) {
          compiled[pathName] = cached.value
          continue
        }
      }
      ctx.referencedVars.clear()
      try {
        val valEl = compiler.compileDataValue(scope, astVal, compIds, ctx, isV1)
        val deps = LinkedHashMap<String, Pair<ExpressNode?, String?>>()
        for (dep in ctx.referencedVars) {
          deps[dep] = scope.rawSymbols[dep] to compIds[dep]
        }
        state.dataCache[pathName] = CachedDataEntry(astVal, valEl, deps)
        compiled[pathName] = valEl
      } catch (_: PendingVariableException) {
        continue
      }
    }
    return compiled
  }

  private fun buildDataUpdates(
    scope: SurfaceScope,
    state: ScopeStreamState,
    compiledData: Map<String, JsonElement>,
  ): List<JsonObject> {
    val updates = mutableListOf<JsonObject>()
    for ((pathName, valEl) in compiledData) {
      val serialized = valEl.toString()
      if (state.emittedDataPaths[pathName] == serialized) continue
      val pointer = toJsonPointer(pathName)
      if (pointer == "/" && valEl !is JsonObject) {
        throw ExpressValidationError("Cannot assign a non-map value to the root data path '$/'.")
      }
      state.emittedDataPaths[pathName] = serialized
      updates.add(
        JsonObject(
          mapOf(
            "version" to JsonPrimitive(version),
            SurfaceOperation.UPDATE_DATA to
              JsonObject(
                mapOf(
                  "surfaceId" to JsonPrimitive(scope.surfaceId),
                  "path" to JsonPrimitive(pointer),
                  "value" to valEl,
                )
              ),
          )
        )
      )
    }
    return updates
  }
}

/**
 * Compilation pipeline for A2UI Express (v1.0 and v0.9/v0.9.1).
 *
 * Resolves positional and keyword arguments against active catalog schemas, hoists inline child
 * components with deterministic `<parent>_<property>` IDs, evaluates `?check` rules, supports
 * multi-catalog disambiguation, and emits validated A2UI wire messages.
 */
class ExpressCompiler(val catalogs: List<A2uiCatalog>, version: String? = null) {
  @JvmOverloads
  constructor(catalog: A2uiCatalog, version: String? = null) : this(listOf(catalog), version)

  val version: String = resolveExpressVersion(catalogs, version)
  val helpers: Map<String, CatalogSchemaHelper>
  internal val validators: Map<String, CatalogJsonSchemaValidator> by lazy {
    val isV1 = isExpressV1OrLater(this.version)
    val map = LinkedHashMap<String, CatalogJsonSchemaValidator>()
    for (cat in catalogs) {
      map[cat.catalogId] = CatalogJsonSchemaValidator.build(cat, isV1)
    }
    map
  }
  private val systemFunctionHelpers = HashMap<String, CatalogSchemaHelper>()

  init {
    val map = LinkedHashMap<String, CatalogSchemaHelper>()
    for (cat in catalogs) {
      map[cat.catalogId] = CatalogSchemaHelper(cat, this.version)
    }
    helpers = map
  }

  /**
   * Compiles [dslText] into a single [JsonObject] (if 1 message) or [JsonArray] (if multiple
   * messages), preserving legacy Kotlin caller compatibility.
   */
  @JvmOverloads
  fun compile(
    dslText: String,
    surfaceId: String = "default_surface",
    isFinal: Boolean = true,
    version: String? = null,
  ): JsonElement {
    val messages = compileMessages(dslText, surfaceId, isFinal, version)
    return if (messages.size == 1) messages.first() else JsonArray(messages)
  }

  /**
   * Compiles [dslText] into a list of A2UI wire message [JsonObject]s without post-state checks.
   */
  @JvmOverloads
  fun compileMessages(
    dslText: String,
    surfaceId: String = "default_surface",
    isFinal: Boolean = true,
    version: String? = null,
  ): List<JsonObject> {
    val targetVersion =
      if (version != null) resolveExpressVersion(catalogs, version) else this.version
    val isV1 = isExpressV1OrLater(targetVersion)
    if (catalogs.size > 1 && !isV1) {
      throw A2uiCatalogException(
        "Several catalogs need A2UI v1.0 or later, where components and function calls carry their own catalogId, but got '$targetVersion'."
      )
    }

    val ctx = CompileContext(defaultReservedKeys(isV1), targetVersion, allowPending = false)
    val statements = parseStatements(dslText, isFinal = isFinal, stripSentinels = true)
    val units = buildUnits(statements, surfaceId, isV1)
    if (units.isEmpty()) {
      throw ExpressParseError("Empty Express block: expected at least one statement.")
    }

    val result = mutableListOf<JsonObject>()
    for (unit in units) {
      when (unit) {
        is CompilationUnit.Delete ->
          result.add(
            JsonObject(
              mapOf(
                "version" to JsonPrimitive(targetVersion),
                SurfaceOperation.DELETE to
                  JsonObject(mapOf("surfaceId" to JsonPrimitive(unit.surfaceId))),
              )
            )
          )
        is CompilationUnit.StandaloneCall ->
          result.add(compileStandaloneCall(unit.stmt, unit.scope, ctx, targetVersion, isV1))
        is CompilationUnit.Scope ->
          result.addAll(compileScope(unit.scope, ctx, targetVersion, isV1))
      }
    }
    return result
  }

  /**
   * Compiles [dslText] and validates the resulting message batch against active catalog schemas,
   * component topology, and function call rules.
   */
  @JvmOverloads
  fun compileChecked(
    dslText: String,
    surfaceId: String = "default_surface",
    version: String? = null,
  ): List<JsonObject> {
    val messages =
      compileMessages(dslText, surfaceId = surfaceId, isFinal = true, version = version)
    if (version == null) {
      ExpressRendererState.validatePayload(catalogs, messages, helpers, validators)
    } else {
      ExpressRendererState.validatePayload(catalogs, messages)
    }
    return messages
  }

  internal fun defaultReservedKeys(isV1: Boolean): ReservedWireKeys =
    if (isV1) {
      ReservedWireKeys("@path", "@call", setOf("path", "event", "functionCall"))
    } else {
      ReservedWireKeys("path", "call", setOf("path", "event", "functionCall"))
    }

  internal fun parseStatements(
    dslText: String,
    isFinal: Boolean,
    stripSentinels: Boolean = true,
  ): List<ExpressStmt> {
    val body = if (stripSentinels) stripSentinelTags(dslText) else dslText
    val parsed =
      try {
        parseExpressSource(body)
      } catch (e: ExpressCompilerError) {
        if (!isFinal) return emptyList()
        throw e
      }
    if (parsed.errors.isNotEmpty()) {
      if (!isFinal) return emptyList()
      val err = parsed.errors.first()
      throw ExpressParseError(
        message = "Syntax error at line ${err.line}:${err.column}: ${err.message}",
        line = err.line,
        column = err.column,
      )
    }
    return parsed.statements
  }

  internal fun buildUnits(
    statements: List<ExpressStmt>,
    defaultSurfaceId: String,
    isV1: Boolean,
  ): List<CompilationUnit> {
    val units = mutableListOf<CompilationUnit>()
    var currentScope: SurfaceScope? = null

    for (stmt in statements) {
      when (stmt) {
        is ExpressStmt.Expr -> {
          val call =
            stmt.value as? ExpressNode.Call
              ?: throw ExpressParseError(
                "Standalone expression must be a function call, surface(...), or deleteSurface(...).",
                line = stmt.line,
                column = stmt.column,
              )
          when (call.name) {
            SurfaceOperation.SURFACE -> {
              val nextScope = parseSurfaceCall(call, isV1)
              units.add(CompilationUnit.Scope(nextScope))
              currentScope = nextScope
            }
            SurfaceOperation.DELETE -> {
              units.add(CompilationUnit.Delete(parseDeleteSurfaceId(call)))
            }
            else -> {
              units.add(CompilationUnit.StandaloneCall(call, currentScope))
            }
          }
        }
        is ExpressStmt.Assign -> {
          if (currentScope == null) {
            currentScope = SurfaceScope(surfaceId = defaultSurfaceId)
            units.add(CompilationUnit.Scope(currentScope))
          }
          if (stmt.target.startsWith("$")) {
            currentScope.dataPathAssignments.remove(stmt.target)
            currentScope.dataPathAssignments[stmt.target] = stmt.value
          } else {
            currentScope.rawSymbols[stmt.target] = stmt.value
          }
        }
      }
    }
    return units
  }

  private fun parseSurfaceCall(call: ExpressNode.Call, isV1: Boolean): SurfaceScope {
    val args = call.args
    val kwargs = call.kwargs
    if (args.isEmpty()) {
      throw ExpressValidationError(
        "surface() requires at least 1 argument: surface(\"surface_id\").",
        line = call.line,
        column = call.column,
      )
    }
    if (args.size > 2) {
      throw ExpressValidationError(
        "surface() takes at most 2 positional arguments: surface(id) or surface(id, catalogId).",
        line = call.line,
        column = call.column,
      )
    }
    val sid =
      (args[0] as? ExpressNode.Str)?.value
        ?: throw ExpressValidationError(
          "The first argument to surface() must be a string literal.",
          line = call.line,
          column = call.column,
        )

    var explicitCatalogId = ""
    if (args.size == 2) {
      if (kwargs.containsKey("catalogId")) {
        throw ExpressValidationError(
          "Duplicate catalogId in surface(): specified both positionally and as a keyword argument.",
          line = call.line,
          column = call.column,
        )
      }
      explicitCatalogId =
        (args[1] as? ExpressNode.Str)?.value
          ?: throw ExpressValidationError(
            "The second argument to surface() must be a catalog ID string.",
            line = call.line,
            column = call.column,
          )
    }

    var sendDataModel: Boolean? = null
    var update = false
    var rawExtensions: ExpressNode? = null

    for ((k, v) in kwargs) {
      when (k) {
        "catalogId" -> {
          explicitCatalogId =
            (v as? ExpressNode.Str)?.value
              ?: throw ExpressValidationError(
                "The catalogId argument to surface() must be a string.",
                line = call.line,
                column = call.column,
              )
        }
        "sendDataModel" -> {
          sendDataModel =
            (v as? ExpressNode.Bool)?.value
              ?: throw ExpressValidationError(
                "The sendDataModel argument to surface() must be a boolean.",
                line = call.line,
                column = call.column,
              )
        }
        "update" -> {
          update =
            (v as? ExpressNode.Bool)?.value
              ?: throw ExpressValidationError(
                "The update argument to surface() must be a boolean.",
                line = call.line,
                column = call.column,
              )
        }
        "extensions" -> {
          if (!isV1) {
            throw ExpressValidationError(
              "extensions on surface() is only supported in A2UI v1.0 or later.",
              line = call.line,
              column = call.column,
            )
          }
          rawExtensions = v
        }
        else ->
          throw ExpressValidationError(
            "Unknown keyword argument '$k' in surface().",
            line = call.line,
            column = call.column,
          )
      }
    }

    if (update && rawExtensions != null) {
      throw ExpressValidationError(
        "surface() with update=true does not accept extensions.",
        line = call.line,
        column = call.column,
      )
    }

    if (explicitCatalogId.isNotEmpty()) {
      if (catalogs.size > 1) {
        throw ExpressValidationError(
          "surface() names catalog '$explicitCatalogId', but a surface names no catalog when several catalogs are active.",
          line = call.line,
          column = call.column,
        )
      }
      if (explicitCatalogId != catalogs.first().catalogId) {
        throw ExpressValidationError(
          "Surface '$sid' names unknown catalog '$explicitCatalogId'.",
          line = call.line,
          column = call.column,
        )
      }
    }

    return SurfaceScope(
      surfaceId = sid,
      sendDataModel = sendDataModel,
      update = update,
      hasSurfaceDirective = true,
      rawExtensions = rawExtensions,
    )
  }

  private fun parseDeleteSurfaceId(call: ExpressNode.Call): String {
    if (call.args.isNotEmpty() && call.args[0] is ExpressNode.Str) {
      return (call.args[0] as ExpressNode.Str).value
    }
    val kw = call.kwargs["surfaceId"]
    if (kw is ExpressNode.Str) {
      return kw.value
    }
    throw ExpressValidationError(
      "deleteSurface() requires the id of the surface to delete.",
      line = call.line,
      column = call.column,
    )
  }

  internal fun compileStandaloneCall(
    stmt: ExpressNode.Call,
    scope: SurfaceScope?,
    ctx: CompileContext,
    targetVersion: String,
    isV1: Boolean,
  ): JsonObject {
    if (!isV1) {
      throw ExpressValidationError(
        "Standalone function calls are not supported before A2UI v1.0.",
        line = stmt.line,
        column = stmt.column,
      )
    }
    ctx.callCounter += 1
    val rawSyms = scope?.rawSymbols ?: emptyMap()
    val (compiledCall, explicitCallId) =
      compileFunctionCall(
        call = stmt,
        rawSymbols = rawSyms,
        compIds = emptyMap(),
        ctx = ctx,
        isV1 = isV1,
        isAction = false,
        allowCallId = true,
      )
    val callMap = LinkedHashMap<String, JsonElement>()
    val cid = (compiledCall["catalogId"] as? JsonPrimitive)?.content ?: catalogs.first().catalogId
    callMap["catalogId"] = JsonPrimitive(cid)
    for ((k, v) in compiledCall) {
      if (k != "catalogId") callMap[k] = v
    }
    return JsonObject(
      mapOf(
        "version" to JsonPrimitive(targetVersion),
        "callRendererFunction" to
          JsonObject(
            mapOf(
              "functionCallId" to JsonPrimitive(explicitCallId ?: "call_${ctx.callCounter}"),
              "callFunction" to JsonObject(callMap),
            )
          ),
      )
    )
  }

  internal fun collectComponentIds(scope: SurfaceScope, isV1: Boolean): Map<String, String> {
    val compIds = LinkedHashMap<String, String>()
    val seenIds = HashSet<String>()
    for ((varName, ast) in scope.rawSymbols) {
      val call = ast as? ExpressNode.Call ?: continue
      val explicitIdNode = call.kwargs["id"]
      var explicitId: String? = null
      if (explicitIdNode != null) {
        val idStr = (explicitIdNode as? ExpressNode.Str)?.value
        if (idStr.isNullOrEmpty()) {
          throw ExpressValidationError(
            "id on component '${call.name}' must be a non-empty string.",
            line = call.line,
            column = call.column,
          )
        }
        if (isV1 && !isValidUax31Identifier(idStr)) {
          throw ExpressValidationError(
            "Component id '$idStr' on '${call.name}' is not a valid UAX #31 identifier.",
            line = call.line,
            column = call.column,
          )
        }
        explicitId = idStr
      }
      if (definesComponent(call.name, call.kwargs["catalogId"])) {
        val resolvedId = explicitId ?: varName
        if (!seenIds.add(resolvedId)) {
          throw ExpressIdCollisionError(
            "Duplicate component ID '$resolvedId'.",
            line = call.line,
            column = call.column,
          )
        }
        compIds[varName] = resolvedId
      }
    }
    return compIds
  }

  private fun compileScope(
    scope: SurfaceScope,
    ctx: CompileContext,
    targetVersion: String,
    isV1: Boolean,
  ): List<JsonObject> {
    ctx.generatedIds.clear()
    val compIds = collectComponentIds(scope, isV1)
    val compiledComponents = mutableListOf<JsonObject>()
    for ((varName, ast) in scope.rawSymbols) {
      compileAstNode(varName, ast, scope.rawSymbols, compIds, ctx, isV1)?.let {
        compiledComponents.add(it)
      }
    }
    compiledComponents.addAll(ctx.extraComponents)
    ctx.extraComponents.clear()

    val hasRoot = compiledComponents.any { it["id"] == JsonPrimitive("root") }
    if (scope.update || !hasRoot) {
      if (scope.rawExtensions != null) {
        throw ExpressValidationError(
          "surface() extensions require a surface-creating scope with a root component."
        )
      }
      return compileUpdateScope(scope, compiledComponents, compIds, ctx, targetVersion, isV1)
    }

    val dataTree = LinkedHashMap<String, Any?>()
    for ((pathName, astVal) in scope.dataPathAssignments) {
      val compiledVal = compileValue(astVal, scope.rawSymbols, compIds, ctx, isV1, isAction = false)
      setNestedPath(dataTree, pathName, compiledVal)
    }
    val dataModelObj = nestedTreeToJsonObject(dataTree)
    val metadata = compileSurfaceMetadata(scope, compIds, ctx, isV1)
    return buildCreateMessages(scope, compiledComponents, dataModelObj, targetVersion, metadata)
  }

  private fun compileUpdateScope(
    scope: SurfaceScope,
    compiledComponents: List<JsonObject>,
    compIds: Map<String, String>,
    ctx: CompileContext,
    targetVersion: String,
    isV1: Boolean,
  ): List<JsonObject> {
    val dataUpdates = mutableListOf<JsonObject>()
    for ((pathName, astVal) in scope.dataPathAssignments) {
      val pointer = toJsonPointer(pathName)
      val compiledVal = compileValue(astVal, scope.rawSymbols, compIds, ctx, isV1, isAction = false)
      if (pointer == "/" && compiledVal !is JsonObject) {
        throw ExpressValidationError("Cannot assign a non-map value to the root data path '$/'.")
      }
      dataUpdates.add(
        JsonObject(
          mapOf(
            "version" to JsonPrimitive(targetVersion),
            SurfaceOperation.UPDATE_DATA to
              JsonObject(
                mapOf(
                  "surfaceId" to JsonPrimitive(scope.surfaceId),
                  "path" to JsonPrimitive(pointer),
                  "value" to compiledVal,
                )
              ),
          )
        )
      )
    }
    if (compiledComponents.isEmpty()) {
      if (dataUpdates.isNotEmpty()) return dataUpdates
      throw ExpressValidationError(
        "Surface '${scope.surfaceId}' is missing required 'root' component."
      )
    }
    val result = mutableListOf<JsonObject>()
    result.add(
      JsonObject(
        mapOf(
          "version" to JsonPrimitive(targetVersion),
          SurfaceOperation.UPDATE_COMPONENTS to
            JsonObject(
              mapOf(
                "surfaceId" to JsonPrimitive(scope.surfaceId),
                "components" to JsonArray(compiledComponents),
              )
            ),
        )
      )
    )
    result.addAll(dataUpdates)
    return result
  }

  internal fun buildCreateMessages(
    scope: SurfaceScope,
    compiledComponents: List<JsonObject>,
    dataModel: JsonObject,
    targetVersion: String,
    metadata: JsonObject?,
  ): List<JsonObject> {
    val isV1 = isExpressV1OrLater(targetVersion)
    val createMap = LinkedHashMap<String, JsonElement>()
    createMap["surfaceId"] = JsonPrimitive(scope.surfaceId)
    if (catalogs.size == 1) {
      createMap["catalogId"] = JsonPrimitive(catalogs.first().catalogId)
    }
    scope.sendDataModel?.let { createMap["sendDataModel"] = JsonPrimitive(it) }

    if (isV1) {
      createMap["components"] = JsonArray(compiledComponents)
      if (dataModel.isNotEmpty()) {
        createMap["dataModel"] = dataModel
      }
      if (metadata != null) {
        createMap["metadata"] = metadata
      }
      return listOf(
        JsonObject(
          mapOf(
            "version" to JsonPrimitive(targetVersion),
            SurfaceOperation.CREATE to JsonObject(createMap),
          )
        )
      )
    }

    val messages = mutableListOf<JsonObject>()
    messages.add(
      JsonObject(
        mapOf(
          "version" to JsonPrimitive(targetVersion),
          SurfaceOperation.CREATE to JsonObject(createMap),
        )
      )
    )
    messages.add(
      JsonObject(
        mapOf(
          "version" to JsonPrimitive(targetVersion),
          SurfaceOperation.UPDATE_COMPONENTS to
            JsonObject(
              mapOf(
                "surfaceId" to JsonPrimitive(scope.surfaceId),
                "components" to JsonArray(compiledComponents),
              )
            ),
        )
      )
    )
    if (dataModel.isNotEmpty()) {
      messages.add(
        JsonObject(
          mapOf(
            "version" to JsonPrimitive(targetVersion),
            SurfaceOperation.UPDATE_DATA to
              JsonObject(
                mapOf(
                  "surfaceId" to JsonPrimitive(scope.surfaceId),
                  "path" to JsonPrimitive("/"),
                  "value" to dataModel,
                )
              ),
          )
        )
      )
    }
    return messages
  }

  internal fun compileSurfaceMetadata(
    scope: SurfaceScope,
    compIds: Map<String, String>,
    ctx: CompileContext,
    isV1: Boolean,
  ): JsonObject? {
    val rawExt = scope.rawExtensions ?: return null
    val extObj =
      compileExtensionsMap(
        rawExt,
        scope.rawSymbols,
        compIds,
        ctx,
        isV1,
        "surface '${scope.surfaceId}'",
      )
    return JsonObject(mapOf("extensions" to extObj))
  }

  internal fun compileAstNodeForSession(
    varName: String,
    ast: ExpressNode,
    rawSymbols: Map<String, ExpressNode>,
    compIds: Map<String, String>,
    ctx: CompileContext,
    isV1: Boolean,
  ): JsonObject? = compileAstNode(varName, ast, rawSymbols, compIds, ctx, isV1)

  internal fun compileDataValue(
    scope: SurfaceScope,
    astVal: ExpressNode,
    compIds: Map<String, String>,
    ctx: CompileContext,
    isV1: Boolean,
  ): JsonElement = compileValue(astVal, scope.rawSymbols, compIds, ctx, isV1, isAction = false)

  private fun compileAstNode(
    varName: String,
    ast: ExpressNode,
    rawSymbols: Map<String, ExpressNode>,
    compIds: Map<String, String>,
    ctx: CompileContext,
    isV1: Boolean,
  ): JsonObject? {
    val call = ast as? ExpressNode.Call ?: return null
    if (call.name.startsWith("@")) {
      systemFunctionHelper(call.name, call.kwargs, ctx.version, call.line, call.column)
      return null
    }

    val compName = call.name
    val rawKwargs = LinkedHashMap(call.kwargs)
    val explicitCatalogId = rawKwargs.remove("catalogId")
    val explicitIdNode = rawKwargs.remove("id")

    var explicitId: String? = null
    if (explicitIdNode != null) {
      val idStr = (explicitIdNode as? ExpressNode.Str)?.value
      if (idStr.isNullOrEmpty()) {
        throw ExpressValidationError(
          "id on component '$compName' must be a non-empty string.",
          line = call.line,
          column = call.column,
        )
      }
      if (isV1 && !isValidUax31Identifier(idStr)) {
        throw ExpressValidationError(
          "Component id '$idStr' on '$compName' is not a valid UAX #31 identifier.",
          line = call.line,
          column = call.column,
        )
      }
      explicitId = idStr
    }

    if (
      !definesComponent(compName, explicitCatalogId) &&
        ((explicitCatalogId == null &&
          compName in
            setOf("Event", "_template", SurfaceOperation.SURFACE, SurfaceOperation.DELETE)) ||
          definesFunction(compName, explicitCatalogId))
    ) {
      return null
    }

    val (compHelper, resolvedCatalogId) =
      resolveSymbol("component", compName, explicitCatalogId, isV1, call.line, call.column)
    val meta = compHelper.components[compName]!!
    val compId = explicitId ?: compIds[varName] ?: varName

    val properties = meta.properties
    val rawExtensions = if ("extensions" !in properties) rawKwargs.remove("extensions") else null

    val compMap = LinkedHashMap<String, JsonElement>()
    compMap["id"] = JsonPrimitive(compId)
    compMap["component"] = JsonPrimitive(compName)
    if (resolvedCatalogId != null) {
      compMap[envelopeKey("catalogId", isV1)] = JsonPrimitive(resolvedCatalogId)
    }
    if (rawExtensions != null) {
      if (!isV1) {
        throw ExpressValidationError(
          "extensions on component '$compName' is only supported in A2UI v1.0 or later.",
          line = call.line,
          column = call.column,
        )
      }
      val compiledExt =
        compileExtensionsMap(rawExtensions, rawSymbols, compIds, ctx, isV1, "component '$compName'")
      compMap[envelopeKey("metadata", isV1)] = JsonObject(mapOf("extensions" to compiledExt))
    }

    val checkPropName = if (meta.hasChecks) "checks" else null
    val nonCheckProperties =
      if (checkPropName != null && checkPropName !in meta.customEnvelopeProperties) {
        properties.filter { it != checkPropName }
      } else {
        properties
      }

    val rawChecks = mutableListOf<ExpressNode.Check>()
    val posArgs = mutableListOf<ExpressNode>()
    for (arg in call.args) {
      val extractedChecks = extractCheckNodes(arg)
      if (extractedChecks != null) {
        rawChecks.addAll(extractedChecks)
      } else {
        posArgs.add(arg)
      }
    }

    val propArgPairs = mutableListOf<Pair<String, ExpressNode>>()
    var propIdx = 0
    for ((argIdx, arg) in posArgs.withIndex()) {
      if (propIdx >= nonCheckProperties.lengthOrSize()) {
        throw ExpressValidationError(
          "$compName takes at most ${nonCheckProperties.size} positional arguments (${nonCheckProperties.joinToString(", ")}), but component '$compId' passes ${posArgs.size}.",
          line = call.line,
          column = call.column,
        )
      }
      val curProp = nonCheckProperties[propIdx]
      if (arg is ExpressNode.Num && !compHelper.acceptsNumber(meta.propertySchemas[curProp])) {
        var moved = false
        if (argIdx == posArgs.lastIndex) {
          val numericLater = mutableListOf<Int>()
          for (laterIdx in (propIdx + 1) until nonCheckProperties.size) {
            val laterProp = nonCheckProperties[laterIdx]
            if (
              !rawKwargs.containsKey(laterProp) &&
                compHelper.acceptsNumber(meta.propertySchemas[laterProp])
            ) {
              numericLater.add(laterIdx)
            }
          }
          if (numericLater.size == 1) {
            val targetIdx = numericLater.first()
            val allOptionalEnums =
              (propIdx until targetIdx).all { idx ->
                val skipped = nonCheckProperties[idx]
                skipped !in meta.required &&
                  !compHelper.extractEnumValues(meta.propertySchemas[skipped]).isNullOrEmpty()
              }
            if (allOptionalEnums) {
              propIdx = targetIdx
              moved = true
            }
          }
        }
        if (!moved && curProp !in meta.required) {
          throw ExpressValidationError(
            "Positional argument ${argIdx + 1} for component '$compName' is a number, which is not valid for optional property '$curProp'.",
            line = call.line,
            column = call.column,
          )
        }
      }
      propArgPairs.add(nonCheckProperties[propIdx] to arg)
      propIdx++
    }

    for ((k, v) in rawKwargs) {
      val extractedChecks = extractCheckNodes(v)
      if (extractedChecks != null) {
        rawChecks.addAll(extractedChecks)
      } else {
        propArgPairs.add(k to v)
      }
    }

    val seenProps = HashSet<String>()
    val boundPaths = LinkedHashMap<String, JsonObject>()

    for ((propName, arg) in propArgPairs) {
      if (propName !in properties) {
        throw ExpressUnknownPropertyError(
          "Unknown property '$propName' on component '$compName'. Allowed properties: ${properties.joinToString(", ")}",
          line = call.line,
          column = call.column,
        )
      }
      if (!seenProps.add(propName)) {
        throw ExpressValidationError(
          "Duplicate property '$propName' in call to component '$compName'.",
          line = call.line,
          column = call.column,
        )
      }
      if (arg is ExpressNode.Skipped) {
        continue
      }

      val propSchema = meta.propertySchemas[propName]
      val isChild = propName in meta.childProperties || compHelper.isComponentIdSchema(propSchema)
      val isChildList =
        propName in meta.childListProperties || compHelper.isChildListSchema(propSchema)
      val isAction = compHelper.isActionSlot(propSchema)

      var mappedVal =
        compileValue(
          value = arg,
          rawSymbols = rawSymbols,
          compIds = compIds,
          ctx = ctx,
          isV1 = isV1,
          isAction = isAction,
          inlineCtx = InlineContext(parentId = compId, property = propName),
          allowComponentRef = isChild,
          allowListComponentRefs = isChildList && arg is ExpressNode.Arr,
          slot = ValueSlot(propSchema, compHelper),
        )

      if (propSchema != null && !compHelper.admitsPath(propSchema)) {
        checkDataBindings(compName, propName, arg, propSchema, compHelper, rawSymbols)
        if (mappedVal is JsonArray && compHelper.expectsOptionObjects(propSchema)) {
          mappedVal =
            JsonArray(
              mappedVal.map { item ->
                if (item is JsonPrimitive && item.isString) {
                  JsonObject(mapOf("label" to item, "value" to item))
                } else {
                  item
                }
              }
            )
        }
      }

      val enumVals = compHelper.extractEnumValues(propSchema)
      if (enumVals != null && mappedVal is JsonPrimitive && mappedVal.isString) {
        if (mappedVal.content !in enumVals) {
          val allowed = enumVals.joinToString(", ") { "'$it'" }
          throw ExpressValidationError(
            "Value '${mappedVal.content}' is not a valid enum choice for property '$propName' of component '$compName'. Allowed values are: [$allowed]",
            line = call.line,
            column = call.column,
          )
        }
      }

      if (isChild && arg is ExpressNode.Str) {
        throw ExpressValidationError(
          "Property '$propName' on component '$compName' expects a child component or variable reference, not a string literal.",
          line = call.line,
          column = call.column,
        )
      }
      if (isChildList && arg is ExpressNode.Arr && arg.items.any { it is ExpressNode.Str }) {
        throw ExpressValidationError(
          "Property '$propName' on component '$compName' expects child components or variable references, not string literals.",
          line = call.line,
          column = call.column,
        )
      }

      if (mappedVal !is JsonNull) {
        compMap[propName] = mappedVal
      }
      if (resolvesToPath(arg, rawSymbols) && mappedVal is JsonObject) {
        boundPaths[propName] = mappedVal
      }
    }

    for (reqProp in meta.required) {
      if (
        reqProp == "id" ||
          reqProp == "component" ||
          (reqProp == "checks" && "checks" !in meta.customEnvelopeProperties) ||
          reqProp == "@checks"
      ) {
        continue
      }
      if (reqProp !in seenProps) {
        throw ExpressValidationError(
          "Component '$compName' is missing required property '$reqProp'.",
          line = call.line,
          column = call.column,
        )
      }
    }

    ctx.activeBoundPaths = boundPaths
    if (rawChecks.isNotEmpty()) {
      if (!meta.hasChecks) {
        throw ExpressCheckError(
          "Component '$compName' does not accept checks.",
          line = rawChecks.first().line,
          column = rawChecks.first().column,
        )
      }
      val compiledChecks =
        rawChecks.map { rc ->
          compileCheckCall(rc, rawSymbols, compIds, ctx, isV1, isAction = false)
        }
      val wireCheckKey =
        if ("checks" in meta.customEnvelopeProperties) "checks" else envelopeKey("checks", isV1)
      compMap[wireCheckKey] = JsonArray(compiledChecks)
    }
    ctx.activeBoundPaths = emptyMap()

    return JsonObject(compMap)
  }

  private fun compileCheckCall(
    rc: ExpressNode.Check,
    rawSymbols: Map<String, ExpressNode>,
    compIds: Map<String, String>,
    ctx: CompileContext,
    isV1: Boolean,
    isAction: Boolean,
  ): JsonObject {
    val checkName = rc.name
    if (rc.kwargs.isNotEmpty()) {
      throw ExpressCheckError(
        "Check '?$checkName' does not accept keyword arguments directly; pass options as {catalogId: \"...\"}.",
        line = rc.line,
        column = rc.column,
      )
    }
    val remainingArgs = mutableListOf<ExpressNode>()
    var checkCatalogId: ExpressNode? = null

    for (arg in rc.args) {
      if (arg is ExpressNode.MapLit && arg.entries.containsKey("catalogId")) {
        val otherKeys = arg.entries.keys.filter { it != "catalogId" }
        if (otherKeys.isNotEmpty()) {
          throw ExpressCheckError(
            "Unsupported key(s) in check options for '?$checkName': ${otherKeys.joinToString(", ")}. Only 'catalogId' is allowed.",
            line = rc.line,
            column = rc.column,
          )
        }
        val catVal = arg.entries["catalogId"]!!
        if (checkCatalogId != null && checkCatalogId != catVal) {
          throw ExpressCheckError(
            "Check '?$checkName' specifies conflicting catalogId values.",
            line = rc.line,
            column = rc.column,
          )
        }
        checkCatalogId = catVal
        continue
      }
      remainingArgs.add(arg)
    }

    val (checkHelper, _) =
      resolveSymbol("function", checkName, checkCatalogId, isV1, rc.line, rc.column)
    val fnMeta = checkHelper.functions[checkName]!!
    val checkParams = fnMeta.parameters
    var messageVal = "${checkName.replaceFirstChar { it.uppercaseChar() }} check failed"

    val callArgs = mutableListOf<ExpressNode>()
    var isValueInjected = false
    if (checkParams.isNotEmpty()) {
      val firstParam = checkParams.first()
      val firstIsPath = remainingArgs.firstOrNull() is ExpressNode.Path
      if (!firstIsPath) {
        val bound = ctx.activeBoundPaths[firstParam]
        if (bound != null) {
          val rawPath = (bound[ctx.keys.path] as? JsonPrimitive)?.content ?: ""
          callArgs.add(ExpressNode.Path(rawPath))
          isValueInjected = true
        }
      }
    }

    val startParamIdx = if (isValueInjected) 1 else 0
    for ((cIdx, cArg) in remainingArgs.withIndex()) {
      val paramTargetIdx = cIdx + startParamIdx
      if (paramTargetIdx < checkParams.size) {
        val paramName = checkParams[paramTargetIdx]
        val paramSchema = fnMeta.propertySchemas[paramName]
        val isMessage =
          cArg is ExpressNode.Str && paramSchema != null && !checkHelper.acceptsString(paramSchema)
        if (isMessage) {
          messageVal = (cArg as ExpressNode.Str).value
          break
        }
        callArgs.add(cArg)
      } else if (cArg is ExpressNode.Str) {
        messageVal = cArg.value
      } else {
        throw ExpressCheckError(
          "Too many arguments passed to check '?$checkName'.",
          line = rc.line,
          column = rc.column,
        )
      }
    }

    val innerKwargs = LinkedHashMap<String, ExpressNode>()
    if (checkCatalogId != null) {
      innerKwargs["catalogId"] = checkCatalogId
    }
    val condCall =
      ExpressNode.Call(
        name = checkName,
        args = callArgs,
        kwargs = innerKwargs,
        line = rc.line,
        column = rc.column,
      )
    val (conditionObj, _) =
      compileFunctionCall(condCall, rawSymbols, compIds, ctx, isV1, isAction, allowCallId = false)
    return JsonObject(mapOf("condition" to conditionObj, "message" to JsonPrimitive(messageVal)))
  }

  private fun compileFunctionCall(
    call: ExpressNode.Call,
    rawSymbols: Map<String, ExpressNode>,
    compIds: Map<String, String>,
    ctx: CompileContext,
    isV1: Boolean,
    isAction: Boolean,
    allowCallId: Boolean,
  ): Pair<JsonObject, String?> {
    val fnName = call.name
    val fnKwargs = LinkedHashMap(call.kwargs)

    if (fnName.startsWith("@")) {
      if (allowCallId) {
        throw ExpressValidationError(
          "System function '$fnName' cannot be called as a standalone statement.",
          line = call.line,
          column = call.column,
        )
      }
      val helper = systemFunctionHelper(fnName, fnKwargs, ctx.version, call.line, call.column)
      val sysMeta = helper.systemFunctions[fnName]!!
      val compiledArgs =
        compileCallArgs(
          sysMeta,
          fnName,
          call.args,
          fnKwargs,
          rawSymbols,
          compIds,
          ctx,
          isV1,
          isAction,
          call.line,
          call.column,
        )
      val map = LinkedHashMap<String, JsonElement>()
      map[ctx.keys.call] = JsonPrimitive(fnName)
      if (compiledArgs.isNotEmpty()) {
        map["args"] = compiledArgs
      }
      return JsonObject(map) to null
    }

    val explicitCatalogId = fnKwargs.remove("catalogId")
    var explicitCallId: String? = null
    if (allowCallId && fnKwargs.containsKey("functionCallId")) {
      val rawId = fnKwargs.remove("functionCallId")
      val idStr = (rawId as? ExpressNode.Str)?.value
      if (idStr.isNullOrEmpty()) {
        throw ExpressValidationError(
          "functionCallId on function '$fnName' must be a non-empty string.",
          line = call.line,
          column = call.column,
        )
      }
      explicitCallId = idStr
    }

    val (fnHelper, resolvedCatalogId) =
      resolveSymbol("function", fnName, explicitCatalogId, isV1, call.line, call.column)
    val fnMeta = fnHelper.functions[fnName]!!
    val compiledArgs =
      compileCallArgs(
        fnMeta,
        fnName,
        call.args,
        fnKwargs,
        rawSymbols,
        compIds,
        ctx,
        isV1,
        isAction,
        call.line,
        call.column,
      )

    val res = LinkedHashMap<String, JsonElement>()
    res[fnHelper.reservedKeys.call] = JsonPrimitive(fnName)
    if (resolvedCatalogId != null) {
      res["catalogId"] = JsonPrimitive(resolvedCatalogId)
    }
    res["args"] = compiledArgs
    return JsonObject(res) to explicitCallId
  }

  private fun compileCallArgs(
    fnMeta: FunctionMetadata,
    fnName: String,
    fnArgs: List<ExpressNode>,
    fnKwargs: Map<String, ExpressNode>,
    rawSymbols: Map<String, ExpressNode>,
    compIds: Map<String, String>,
    ctx: CompileContext,
    isV1: Boolean,
    isAction: Boolean,
    line: Int,
    col: Int,
  ): JsonObject {
    val fnParams = fnMeta.parameters
    if (fnArgs.size > fnParams.size) {
      throw ExpressValidationError(
        "Function '$fnName' accepts at most ${fnParams.size} positional arguments, got ${fnArgs.size}.",
        line = line,
        column = col,
      )
    }
    val compiledArgs = LinkedHashMap<String, JsonElement>()
    for ((idx, arg) in fnArgs.withIndex()) {
      if (arg is ExpressNode.Skipped) continue
      val valEl = compileValue(arg, rawSymbols, compIds, ctx, isV1, isAction)
      if (valEl !is JsonNull) {
        compiledArgs[fnParams[idx]] = valEl
      }
    }
    for ((k, v) in fnKwargs) {
      if (k !in fnParams) {
        throw ExpressValidationError(
          "Unknown parameter '$k' in call to function '$fnName'.",
          line = line,
          column = col,
        )
      }
      if (compiledArgs.containsKey(k)) {
        throw ExpressValidationError(
          "Duplicate argument for parameter '$k' in call to function '$fnName'.",
          line = line,
          column = col,
        )
      }
      if (v is ExpressNode.Skipped) continue
      val valEl = compileValue(v, rawSymbols, compIds, ctx, isV1, isAction)
      if (valEl !is JsonNull) {
        compiledArgs[k] = valEl
      }
    }
    return JsonObject(compiledArgs)
  }

  private fun compileEventCall(
    call: ExpressNode.Call,
    rawSymbols: Map<String, ExpressNode>,
    compIds: Map<String, String>,
    ctx: CompileContext,
    isV1: Boolean,
  ): JsonObject {
    if (call.args.size > 2) {
      throw ExpressValidationError(
        "Event accepts at most 2 positional arguments (name, context), got ${call.args.size}.",
        line = call.line,
        column = call.column,
      )
    }
    for (key in call.kwargs.keys) {
      if (key != "userMessage" && key != "context") {
        throw ExpressValidationError(
          "Unknown keyword argument '$key' in Event(...). Allowed: userMessage, context.",
          line = call.line,
          column = call.column,
        )
      }
    }
    if (call.args.size == 2 && call.kwargs.containsKey("context")) {
      throw ExpressValidationError(
        "Duplicate 'context' argument in Event(...).",
        line = call.line,
        column = call.column,
      )
    }
    val compiledName =
      if (call.args.isNotEmpty()) {
        compileValue(call.args[0], rawSymbols, compIds, ctx, isV1, isAction = false)
      } else {
        JsonPrimitive("")
      }
    val eventMap = LinkedHashMap<String, JsonElement>()
    eventMap["name"] = compiledName

    val userMessageNode = call.kwargs["userMessage"]
    if (userMessageNode != null) {
      if (!isV1) {
        throw ExpressValidationError(
          "Event userMessage requires protocol v1.0 or later.",
          line = call.line,
          column = call.column,
        )
      }
      val compiledMsg =
        compileValue(userMessageNode, rawSymbols, compIds, ctx, isV1, isAction = false)
      val isStr = compiledMsg is JsonPrimitive && compiledMsg.isString
      val isBindingOrCall =
        compiledMsg is JsonObject &&
          (compiledMsg.containsKey(ctx.keys.path) || compiledMsg.containsKey(ctx.keys.call))
      if (!isStr && !isBindingOrCall) {
        throw ExpressValidationError(
          "Event userMessage must be a string, a \$path data binding or a function call.",
          line = call.line,
          column = call.column,
        )
      }
      eventMap["userMessage"] = compiledMsg
    }

    val contextNode = if (call.args.size == 2) call.args[1] else call.kwargs["context"]
    if (contextNode != null) {
      val rawCtx = compileValue(contextNode, rawSymbols, compIds, ctx, isV1, isAction = false)
      val ctxMap = LinkedHashMap<String, JsonElement>()
      when (rawCtx) {
        is JsonObject -> ctxMap.putAll(rawCtx)
        is JsonArray -> rawCtx.forEach { if (it is JsonObject) ctxMap.putAll(it) }
        else ->
          throw ExpressValidationError(
            "Event context must be a map literal or list of maps.",
            line = call.line,
            column = call.column,
          )
      }
      eventMap["context"] = JsonObject(ctxMap)
    }
    return JsonObject(mapOf("event" to JsonObject(eventMap)))
  }

  private fun compileValue(
    value: ExpressNode,
    rawSymbols: Map<String, ExpressNode>,
    compIds: Map<String, String>,
    ctx: CompileContext,
    isV1: Boolean,
    isAction: Boolean,
    inlineCtx: InlineContext? = null,
    allowComponentRef: Boolean = false,
    allowListComponentRefs: Boolean = false,
    slot: ValueSlot? = null,
  ): JsonElement {
    when (value) {
      is ExpressNode.Str -> return JsonPrimitive(value.value)
      is ExpressNode.Num ->
        return if (value.longValue != null) {
          JsonPrimitive(value.longValue)
        } else {
          JsonPrimitive(value.doubleValue)
        }
      is ExpressNode.Bool -> return JsonPrimitive(value.value)
      is ExpressNode.Null -> return JsonNull
      is ExpressNode.Path -> return JsonObject(mapOf(ctx.keys.path to JsonPrimitive(value.path)))
      is ExpressNode.Skipped ->
        throw ExpressValidationError("'_' can only stand in for a skipped call argument.")
      is ExpressNode.Check -> {
        val checkObj = compileCheckCall(value, rawSymbols, compIds, ctx, isV1, isAction)
        return checkObj["condition"]!!
      }
      is ExpressNode.Arr -> {
        val itemSchema = slot?.schema?.let { slot.helper.resolveItemSchema(it) }
        val itemSlot = if (itemSchema != null) ValueSlot(itemSchema, slot.helper) else null
        val itemIsAction = isAction || (itemSlot?.helper?.isActionSlot(itemSlot.schema) == true)
        val itemIsChild = itemSlot?.helper?.isComponentIdSchema(itemSlot.schema) == true
        val itemIsChildList = itemSlot?.helper?.isChildListSchema(itemSlot.schema) == true
        return JsonArray(
          value.items.mapIndexed { idx, item ->
            compileValue(
              value = item,
              rawSymbols = rawSymbols,
              compIds = compIds,
              ctx = ctx,
              isV1 = isV1,
              isAction = itemIsAction,
              inlineCtx = inlineCtx?.copy(index = idx),
              allowComponentRef = allowListComponentRefs || itemIsChild,
              allowListComponentRefs = itemIsChildList && item is ExpressNode.Arr,
              slot = itemSlot,
            )
          }
        )
      }
      is ExpressNode.MapLit -> {
        val out = LinkedHashMap<String, JsonElement>(value.entries.size)
        for ((k, v) in value.entries) {
          val propSchema = slot?.schema?.let { slot.helper.resolvePropertySchema(it, k) }
          val entrySlot = if (propSchema != null) ValueSlot(propSchema, slot.helper) else null
          val entryIsAction =
            isAction || (entrySlot?.helper?.isActionSlot(entrySlot.schema) == true)
          val entryIsChild = entrySlot?.helper?.isComponentIdSchema(entrySlot.schema) == true
          val entryIsChildList = entrySlot?.helper?.isChildListSchema(entrySlot.schema) == true
          out[k] =
            compileValue(
              value = v,
              rawSymbols = rawSymbols,
              compIds = compIds,
              ctx = ctx,
              isV1 = isV1,
              isAction = entryIsAction,
              inlineCtx = null,
              allowComponentRef = entryIsChild,
              allowListComponentRefs = entryIsChildList && v is ExpressNode.Arr,
              slot = entrySlot,
            )
        }
        return JsonObject(out)
      }
      is ExpressNode.VarRef -> {
        val refName = value.name
        ctx.referencedVars.add(refName)
        compIds[refName]?.let {
          return JsonPrimitive(it)
        }
        val targetAst = rawSymbols[refName]
        if (targetAst != null) {
          if (!ctx.resolving.add(refName)) {
            throw ExpressCycleError(
              "Variable '$refName' refers to itself through its own value.",
              line = value.line,
              column = value.column,
            )
          }
          try {
            return compileValue(
              value = targetAst,
              rawSymbols = rawSymbols,
              compIds = compIds,
              ctx = ctx,
              isV1 = isV1,
              isAction = isAction,
              inlineCtx = null,
              allowComponentRef = allowComponentRef,
              allowListComponentRefs = allowListComponentRefs,
              slot = slot,
            )
          } finally {
            ctx.resolving.remove(refName)
          }
        }
        if (!allowComponentRef) {
          if (ctx.allowPending) {
            throw PendingVariableException(refName)
          }
          throw ExpressValidationError(
            "Variable '$refName' is not assigned in surface.",
            line = value.line,
            column = value.column,
          )
        }
        return JsonPrimitive(refName)
      }
      is ExpressNode.Call -> {
        if (value.name == "_template") {
          return compileTemplateHelper(value, rawSymbols, compIds, ctx, isV1, isAction)
        }
        if (value.name == "Event") {
          return compileEventCall(value, rawSymbols, compIds, ctx, isV1)
        }
        if (definesComponent(value.name, value.kwargs["catalogId"])) {
          return JsonPrimitive(
            compileInlineComponent(value, rawSymbols, compIds, ctx, isV1, inlineCtx)
          )
        }
        val (compiledFn, _) =
          compileFunctionCall(
            call = value,
            rawSymbols = rawSymbols,
            compIds = compIds,
            ctx = ctx,
            isV1 = isV1,
            isAction = false,
            allowCallId = false,
          )
        return if (isAction) {
          JsonObject(mapOf("functionCall" to compiledFn))
        } else {
          compiledFn
        }
      }
    }
  }

  private fun compileTemplateHelper(
    call: ExpressNode.Call,
    rawSymbols: Map<String, ExpressNode>,
    compIds: Map<String, String>,
    ctx: CompileContext,
    isV1: Boolean,
    isAction: Boolean,
  ): JsonObject {
    if (call.args.size != 2 || call.kwargs.isNotEmpty()) {
      throw ExpressParseError(
        "_template helper requires exactly 2 positional arguments: path and templateComponent.",
        line = call.line,
        column = call.column,
      )
    }
    val pathVal = compileValue(call.args[0], rawSymbols, compIds, ctx, isV1, isAction)
    val pathStr =
      (pathVal as? JsonObject)?.get(ctx.keys.path)?.let {
        (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content
      }
        ?: throw ExpressParseError(
          "The first argument to _template must be a dynamic data binding path (prefixed by $).",
          line = call.line,
          column = call.column,
        )
    val compIdVal =
      compileValue(
        value = call.args[1],
        rawSymbols = rawSymbols,
        compIds = compIds,
        ctx = ctx,
        isV1 = isV1,
        isAction = isAction,
        inlineCtx = null,
        allowComponentRef = true,
        allowListComponentRefs = false,
      )
    val compIdStr =
      (compIdVal as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?: throw ExpressValidationError(
          "The second argument to _template must resolve to a component ID.",
          line = call.line,
          column = call.column,
        )
    return JsonObject(
      mapOf("path" to JsonPrimitive(pathStr), "componentId" to JsonPrimitive(compIdStr))
    )
  }

  private fun compileInlineComponent(
    call: ExpressNode.Call,
    rawSymbols: Map<String, ExpressNode>,
    compIds: Map<String, String>,
    ctx: CompileContext,
    isV1: Boolean,
    inlineCtx: InlineContext?,
  ): String {
    ctx.inlineCounter += 1
    val inlineId =
      if (inlineCtx != null) {
        if (inlineCtx.index != null) {
          "${inlineCtx.parentId}_${inlineCtx.property}_${inlineCtx.index}"
        } else {
          "${inlineCtx.parentId}_${inlineCtx.property}"
        }
      } else {
        "_inline_${ctx.inlineCounter}"
      }
    val explicitId = (call.kwargs["id"] as? ExpressNode.Str)?.value?.takeIf { it.isNotEmpty() }
    val actualId = explicitId ?: inlineId
    if (
      rawSymbols.containsKey(actualId) ||
        compIds.containsValue(actualId) ||
        actualId in ctx.generatedIds
    ) {
      throw ExpressIdCollisionError(
        "Inline component ID '$actualId' collides with another component or variable.",
        line = call.line,
        column = call.column,
      )
    }
    ctx.generatedIds.add(actualId)
    val extraStart = ctx.extraComponents.size
    val compiledInline = compileAstNode(inlineId, call, rawSymbols, compIds, ctx, isV1)
    if (compiledInline != null) {
      ctx.extraComponents.add(extraStart, compiledInline)
      return (compiledInline["id"] as JsonPrimitive).content
    }
    return inlineId
  }

  private fun compileExtensionsMap(
    rawExt: ExpressNode,
    rawSymbols: Map<String, ExpressNode>,
    compIds: Map<String, String>,
    ctx: CompileContext,
    isV1: Boolean,
    subject: String,
  ): JsonObject {
    val top = resolveAstVar(rawExt, rawSymbols, ctx, HashSet())
    if (top !is ExpressNode.MapLit) {
      throw ExpressValidationError("extensions on $subject must be a map.")
    }
    checkExtensionsAst(top, rawSymbols, ctx, subject, HashSet())
    val compiled = compileValue(rawExt, rawSymbols, compIds, ctx, isV1, isAction = false)
    val obj =
      compiled as? JsonObject
        ?: throw ExpressValidationError("extensions on $subject must be a map.")
    for (extKey in obj.keys) {
      if (!isValidUax31Identifier(extKey)) {
        throw ExpressValidationError(
          "Extension key '$extKey' on $subject is not a valid UAX #31 identifier."
        )
      }
    }
    return obj
  }

  private fun resolveAstVar(
    node: ExpressNode,
    rawSymbols: Map<String, ExpressNode>,
    ctx: CompileContext,
    seen: MutableSet<String>,
  ): ExpressNode {
    var cur = node
    while (cur is ExpressNode.VarRef) {
      val refName = cur.name
      ctx.referencedVars.add(refName)
      if (!seen.add(refName)) {
        throw ExpressCycleError(
          "Variable '$refName' refers to itself through its own value.",
          line = cur.line,
          column = cur.column,
        )
      }
      val target = rawSymbols[refName]
      if (target == null) {
        if (ctx.allowPending) throw PendingVariableException(refName)
        throw ExpressValidationError(
          "Undefined variable '$refName'.",
          line = cur.line,
          column = cur.column,
        )
      }
      cur = target
    }
    return cur
  }

  private fun checkExtensionsAst(
    node: ExpressNode,
    rawSymbols: Map<String, ExpressNode>,
    ctx: CompileContext,
    subject: String,
    seen: Set<String>,
  ) {
    val resolved = resolveAstVar(node, rawSymbols, ctx, HashSet(seen))
    when (resolved) {
      is ExpressNode.MapLit ->
        resolved.entries.values.forEach { checkExtensionsAst(it, rawSymbols, ctx, subject, seen) }
      is ExpressNode.Arr ->
        resolved.items.forEach { checkExtensionsAst(it, rawSymbols, ctx, subject, seen) }
      is ExpressNode.Call -> {
        val catId = resolved.kwargs["catalogId"]
        if (definesComponent(resolved.name, catId)) {
          throw ExpressValidationError(
            "extensions on $subject cannot contain component '${resolved.name}'.",
            line = resolved.line,
            column = resolved.column,
          )
        }
        if (
          catId == null &&
            resolved.name in
              setOf("Event", "_template", SurfaceOperation.SURFACE, SurfaceOperation.DELETE)
        ) {
          throw ExpressValidationError(
            "extensions on $subject cannot contain '${resolved.name}()'.",
            line = resolved.line,
            column = resolved.column,
          )
        }
        resolved.args.forEach { checkExtensionsAst(it, rawSymbols, ctx, subject, seen) }
        resolved.kwargs.values.forEach { checkExtensionsAst(it, rawSymbols, ctx, subject, seen) }
      }
      else -> {}
    }
  }

  private fun checkDataBindings(
    compName: String,
    topPropName: String,
    node: ExpressNode,
    schema: JsonObject?,
    helper: CatalogSchemaHelper,
    rawSymbols: Map<String, ExpressNode>,
  ) {
    fun walk(v: ExpressNode, s: JsonObject?, seen: Set<String>) {
      when (v) {
        is ExpressNode.Path -> {
          if (s != null && !helper.admitsPath(s)) {
            throw ExpressDataBindingError(
              "Property '$topPropName' on component '$compName' does not admit dynamic data bindings."
            )
          }
        }
        is ExpressNode.VarRef -> {
          if (v.name !in seen) {
            rawSymbols[v.name]?.let { walk(it, s, seen + v.name) }
          }
        }
        is ExpressNode.Arr -> {
          val itemSchema = s?.let { helper.resolveItemSchema(it) }
          v.items.forEach { walk(it, itemSchema, seen) }
        }
        is ExpressNode.MapLit -> {
          for ((k, subVal) in v.entries) {
            val propSchema = s?.let { helper.resolvePropertySchema(it, k) }
            walk(subVal, propSchema, seen)
          }
        }
        else -> {}
      }
    }
    walk(node, schema, emptySet())
  }

  private fun systemFunctionHelper(
    fnName: String,
    fnKwargs: Map<String, ExpressNode>,
    targetVersion: String,
    line: Int,
    col: Int,
  ): CatalogSchemaHelper {
    val helper =
      if (targetVersion == this.version) {
        helpers.values.first()
      } else {
        systemFunctionHelpers.getOrPut(targetVersion) {
          CatalogSchemaHelper(catalogs.first(), targetVersion)
        }
      }
    if (!helper.systemFunctions.containsKey(fnName)) {
      val known = helper.systemFunctions.keys.sorted()
      val knownStr = if (known.isEmpty()) "none" else known.joinToString(", ")
      throw ExpressValidationError(
        "Unknown system function '$fnName' in A2UI $targetVersion. System functions: $knownStr.",
        line = line,
        column = col,
      )
    }
    if (fnKwargs.containsKey("catalogId")) {
      throw ExpressValidationError(
        "System function '$fnName' is defined by the protocol, not a catalog, so it takes no catalogId.",
        line = line,
        column = col,
      )
    }
    return helper
  }

  private fun definesComponent(name: String, explicitCatalogId: ExpressNode?): Boolean {
    if (explicitCatalogId != null) {
      if (explicitCatalogId !is ExpressNode.Str) return false
      return helpers[explicitCatalogId.value]?.components?.containsKey(name) == true
    }
    return helpers.values.any { it.components.containsKey(name) }
  }

  private fun definesFunction(name: String, explicitCatalogId: ExpressNode?): Boolean {
    if (explicitCatalogId != null) {
      if (explicitCatalogId !is ExpressNode.Str) return false
      return helpers[explicitCatalogId.value]?.functions?.containsKey(name) == true
    }
    return helpers.values.any { it.functions.containsKey(name) }
  }

  private fun resolveSymbol(
    kind: String,
    name: String,
    explicitCatalogId: ExpressNode?,
    isV1: Boolean,
    line: Int,
    col: Int,
  ): Pair<CatalogSchemaHelper, String?> {
    val label = if (kind == "component") "Component" else "Function"
    if (explicitCatalogId != null) {
      if (!isV1) {
        throw ExpressValidationError(
          "$label '$name' specifies catalogId, which is only supported in A2UI v1.0 or later.",
          line = line,
          column = col,
        )
      }
      val cid =
        (explicitCatalogId as? ExpressNode.Str)?.value?.takeIf { it.isNotEmpty() }
          ?: throw ExpressValidationError(
            "catalogId on $kind '$name' must be a non-empty string.",
            line = line,
            column = col,
          )
      val helper =
        helpers[cid]
          ?: throw ExpressValidationError(
            "$label '$name' names unknown catalog '$cid'. Active catalogs: ${helpers.keys.joinToString(", ")}.",
            line = line,
            column = col,
          )
      val exists =
        if (kind == "component") helper.components.containsKey(name)
        else helper.functions.containsKey(name)
      if (!exists) {
        throw ExpressUnknownTypeError(
          "Catalog '$cid' does not define $kind '$name'.",
          line = line,
          column = col,
        )
      }
      val wireCatId = if (catalogs.size > 1) cid else null
      return helper to wireCatId
    }

    val matchingIds =
      helpers.entries
        .filter { (_, h) ->
          if (kind == "component") h.components.containsKey(name) else h.functions.containsKey(name)
        }
        .map { it.key }
    if (matchingIds.size > 1) {
      val quoted = matchingIds.joinToString(", ") { "'$it'" }
      throw ExpressValidationError(
        "$label '$name' is defined in several catalogs: $quoted. Name the catalog to use with a catalogId argument.",
        line = line,
        column = col,
      )
    }
    if (matchingIds.isEmpty()) {
      throw ExpressUnknownTypeError("Unknown $kind '$name'.", line = line, column = col)
    }
    val cid = matchingIds.first()
    return helpers[cid]!! to (if (catalogs.size > 1) cid else null)
  }

  companion object {
    private fun List<*>.lengthOrSize(): Int = size
  }
}

private fun envelopeKey(base: String, isV1: Boolean): String = if (isV1) "@$base" else base

private fun extractCheckNodes(node: ExpressNode): List<ExpressNode.Check>? {
  if (node is ExpressNode.Check) return listOf(node)
  if (
    node is ExpressNode.Arr && node.items.isNotEmpty() && node.items.all { it is ExpressNode.Check }
  ) {
    return node.items.map { it as ExpressNode.Check }
  }
  return null
}

private fun resolvesToPath(node: ExpressNode, rawSymbols: Map<String, ExpressNode>): Boolean {
  val seen = HashSet<String>()
  var cur = node
  while (cur is ExpressNode.VarRef) {
    if (!seen.add(cur.name)) return false
    cur = rawSymbols[cur.name] ?: return false
  }
  return cur is ExpressNode.Path
}

private val ARRAY_INDEX_REGEX = Regex("^(?:0|[1-9][0-9]*)$")
private const val MAX_ARRAY_INDEX = 10000

private fun stripPathPrefix(pathStr: String): String =
  when {
    pathStr.startsWith("$/") -> pathStr.substring(2)
    pathStr.startsWith("$") -> pathStr.substring(1)
    else -> pathStr
  }

internal fun toJsonPointer(pathStr: String): String = "/" + stripPathPrefix(pathStr)

internal fun setNestedPath(root: MutableMap<String, Any?>, pathStr: String, valEl: JsonElement) {
  val clean = stripPathPrefix(pathStr)
  if (clean.isEmpty()) {
    val obj =
      valEl as? JsonObject
        ?: throw ExpressValidationError("Cannot set root data model '$pathStr' to a non-map value.")
    root.clear()
    for ((k, v) in obj) {
      root[k] = jsonElementToMutableTree(v)
    }
    return
  }

  val keys = clean.split("/")
  var current: Any = root
  for (i in 0 until keys.lastIndex) {
    current = stepPathContainer(current, keys[i], keys[i + 1], pathStr)
  }
  val lastKey = keys.last()
  val mutableVal = jsonElementToMutableTree(valEl)
  if (current is MutableMap<*, *>) {
    @Suppress("UNCHECKED_CAST")
    (current as MutableMap<String, Any?>)[lastKey] = mutableVal
  } else if (current is MutableList<*>) {
    @Suppress("UNCHECKED_CAST") val list = current as MutableList<Any?>
    val idx = parseArrayIndex(lastKey, pathStr)
    while (list.size <= idx) list.add(JsonNull)
    list[idx] = mutableVal
  }
}

private fun stepPathContainer(
  current: Any,
  segment: String,
  nextSegment: String,
  pathStr: String,
): Any {
  val isNextIndex = ARRAY_INDEX_REGEX.matches(nextSegment)
  if (current is MutableMap<*, *>) {
    @Suppress("UNCHECKED_CAST") val map = current as MutableMap<String, Any?>
    val existing = map[segment]
    if (existing == null || existing === JsonNull) {
      val created: Any = if (isNextIndex) ArrayList<Any?>() else LinkedHashMap<String, Any?>()
      map[segment] = created
      return created
    }
    if (existing is MutableMap<*, *> || existing is MutableList<*>) {
      return existing
    }
    throw ExpressValidationError(
      "Cannot set path '$pathStr': segment '$segment' is a primitive value."
    )
  }
  if (current is MutableList<*>) {
    @Suppress("UNCHECKED_CAST") val list = current as MutableList<Any?>
    val idx = parseArrayIndex(segment, pathStr)
    while (list.size <= idx) list.add(JsonNull)
    val existing = list[idx]
    if (existing == null || existing === JsonNull) {
      val created: Any = if (isNextIndex) ArrayList<Any?>() else LinkedHashMap<String, Any?>()
      list[idx] = created
      return created
    }
    if (existing is MutableMap<*, *> || existing is MutableList<*>) {
      return existing
    }
    throw ExpressValidationError(
      "Cannot set path '$pathStr': segment '$segment' is a primitive value."
    )
  }
  throw ExpressValidationError(
    "Cannot set path '$pathStr': segment '$segment' is a primitive value."
  )
}

private fun parseArrayIndex(segment: String, pathStr: String): Int {
  if (!ARRAY_INDEX_REGEX.matches(segment)) {
    throw ExpressValidationError(
      "Cannot use non-numeric segment '$segment' on an array in path '$pathStr'."
    )
  }
  val idx =
    segment.toIntOrNull()
      ?: throw ExpressValidationError("Invalid array index '$segment' in path '$pathStr'.")
  if (idx > MAX_ARRAY_INDEX) {
    throw ExpressValidationError(
      "Cannot set path '$pathStr': array index '$segment' exceeds maximum supported index ($MAX_ARRAY_INDEX)."
    )
  }
  return idx
}

private fun jsonElementToMutableTree(el: JsonElement): Any =
  when (el) {
    is JsonObject -> {
      val m = LinkedHashMap<String, Any?>(el.size)
      for ((k, v) in el) m[k] = jsonElementToMutableTree(v)
      m
    }
    is JsonArray -> {
      val l = ArrayList<Any?>(el.size)
      for (v in el) l.add(jsonElementToMutableTree(v))
      l
    }
    else -> el
  }

private fun nestedTreeToJsonObject(map: Map<String, Any?>): JsonObject {
  val out = LinkedHashMap<String, JsonElement>(map.size)
  for ((k, v) in map) out[k] = nestedNodeToJsonElement(v)
  return JsonObject(out)
}

private fun nestedNodeToJsonElement(node: Any?): JsonElement =
  when (node) {
    null -> JsonNull
    is JsonElement -> node
    is Map<*, *> -> {
      val out = LinkedHashMap<String, JsonElement>(node.size)
      for ((k, v) in node) out[k as String] = nestedNodeToJsonElement(v)
      JsonObject(out)
    }
    is List<*> -> JsonArray(node.map { nestedNodeToJsonElement(it) })
    else -> JsonPrimitive(node.toString())
  }

private val OPEN_SENTINEL_REGEX = Regex("""<a2ui(?:\s[^>]*)?>""", RegexOption.IGNORE_CASE)
private val CLOSE_SENTINEL_REGEX = Regex("""</a2ui\s*>""", RegexOption.IGNORE_CASE)

private fun matchSentinelAt(dslText: String, pos: Int): Pair<Boolean, Int>? {
  if (pos >= dslText.length || dslText[pos] != '<') return null
  OPEN_SENTINEL_REGEX.matchAt(dslText, pos)?.let {
    return true to (it.range.last + 1)
  }
  CLOSE_SENTINEL_REGEX.matchAt(dslText, pos)?.let {
    return false to (it.range.last + 1)
  }
  return null
}

private fun advanceStringInSentinelScan(dslText: String, pos: Int): Int? {
  val n = dslText.length
  var isRaw = false
  var qPos = pos
  if (
    (dslText[pos] == 'r' || dslText[pos] == 'R') &&
      pos + 1 < n &&
      dslText[pos + 1] == '"' &&
      (pos == 0 || !(dslText[pos - 1].isLetterOrDigit() || dslText[pos - 1] == '_'))
  ) {
    isRaw = true
    qPos = pos + 1
  } else if (dslText[pos] != '"') {
    return null
  }
  val triple = dslText.startsWith("\"\"\"", qPos)
  var i = qPos + (if (triple) 3 else 1)
  while (i < n) {
    if (!isRaw && dslText[i] == '\\') {
      i += 2
      continue
    }
    if (triple && dslText.startsWith("\"\"\"", i)) {
      return i + 3
    }
    if (!triple && dslText[i] == '"') {
      return i + 1
    }
    i++
  }
  return n
}

private fun advanceCommentInSentinelScan(dslText: String, pos: Int): Int? {
  val n = dslText.length
  if (dslText.startsWith("//", pos) || dslText[pos] == '#' || dslText.startsWith("--", pos)) {
    val nl = dslText.indexOf('\n', pos)
    val end = if (nl < 0) n else nl
    var j = pos + (if (dslText[pos] == '#') 1 else 2)
    while (j < end) {
      val m = matchSentinelAt(dslText, j)
      if (m != null && !m.first) return j
      j++
    }
    return end
  }
  if (dslText.startsWith("/*", pos)) {
    val end = dslText.indexOf("*/", pos + 2)
    return if (end < 0) n else end + 2
  }
  return null
}

/** Strips `<a2ui>` / `</a2ui>` sentinel tags outside strings and block comments. */
internal fun stripSentinelTags(dslText: String): String {
  val n = dslText.length
  var hasOpenSentinel = false
  var scanPos = 0
  while (scanPos < n) {
    advanceStringInSentinelScan(dslText, scanPos)?.let {
      scanPos = it
      return@let
    }
      ?: run {
        advanceCommentInSentinelScan(dslText, scanPos)?.let { scanPos = it }
          ?: run {
            val m = matchSentinelAt(dslText, scanPos)
            if (m != null && m.first) {
              hasOpenSentinel = true
              scanPos = n
            } else {
              scanPos++
            }
          }
      }
  }

  val out = StringBuilder()
  var insideA2ui = !hasOpenSentinel
  var i = 0
  var segStart = if (insideA2ui) 0 else -1
  while (i < n) {
    val strEnd = advanceStringInSentinelScan(dslText, i)
    if (strEnd != null) {
      i = strEnd
      continue
    }
    val cmtEnd = advanceCommentInSentinelScan(dslText, i)
    if (cmtEnd != null) {
      i = cmtEnd
      continue
    }
    val m = matchSentinelAt(dslText, i)
    if (m != null) {
      if (insideA2ui && segStart >= 0) {
        out.append(dslText, segStart, i)
      }
      insideA2ui = m.first
      segStart = if (m.first) m.second else -1
      i = m.second
      continue
    }
    i++
  }
  if (insideA2ui && segStart in 0 until n) {
    out.append(dslText, segStart, n)
  }
  return out.toString()
}

private val CONTINUATION_OPERATORS =
  setOf('+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '.', ',', ':')

private fun isValidPrefixBoundary(dslText: String, prefixLen: Int): Boolean {
  if (prefixLen <= 0 || prefixLen >= dslText.length) return true
  val rest = dslText.substring(prefixLen).trimStart()
  if (rest.isEmpty()) return true
  if (rest.startsWith("//") || rest.startsWith("/*") || rest.startsWith("--")) return true
  return rest[0] !in CONTINUATION_OPERATORS
}
