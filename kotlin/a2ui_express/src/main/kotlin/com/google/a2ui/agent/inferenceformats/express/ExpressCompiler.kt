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

package com.google.a2ui.agent.inferenceformats.express

import com.google.a2ui.core.catalog.CatalogApi
import com.google.a2ui.core.common.A2uiMetadata
import com.google.a2ui.core.common.ProtocolVersion
import com.google.a2ui.core.common.Uax31Identifier
import com.google.a2ui.core.common.jsonValuesEqual
import com.google.a2ui.core.common.jsonValuesStrictEqual
import com.google.a2ui.core.schema.AgentToRendererMessage
import com.google.a2ui.core.schema.CallRendererFunctionMessage
import com.google.a2ui.core.schema.CreateSurfaceMessage
import com.google.a2ui.core.schema.DeleteSurfaceMessage
import com.google.a2ui.core.schema.FunctionCall
import com.google.a2ui.core.schema.UpdateComponentsMessage
import com.google.a2ui.core.schema.UpdateDataModelMessage
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Compilation engine for A2UI Express v1.0.
 *
 * Compiles compact A2UI Express statements into strongly typed [AgentToRendererMessage] instances
 * across single-catalog and multi-catalog configurations.
 */
class ExpressCompiler(catalogs: List<CatalogApi>) {
  private val checkedCatalogs: List<CatalogApi> = CatalogSchemaHelper.checkMixedCatalogs(catalogs)
  internal val helpers: Map<String, CatalogSchemaHelper> =
    CatalogSchemaHelper.buildCatalogHelpers(checkedCatalogs)

  val catalogs: List<CatalogApi>
    get() = checkedCatalogs.toList()

  internal val isMultiCatalog: Boolean
    get() = checkedCatalogs.size > 1

  companion object {
    private const val SURFACE_STATEMENT = "surface"
    private const val DELETE_SURFACE_STATEMENT = "deleteSurface"
    private const val ID_KEY = "id"
    private const val FUNCTION_CALL_ID_KEY = "functionCallId"
    private const val SEND_DATA_MODEL_KEY = "sendDataModel"
    private const val UPDATE_KEY = "update"
    private const val EXTENSIONS_KEY = "extensions"
    private val EVENT_KEYWORDS = listOf("userMessage", "context")
    private val ARRAY_INDEX_RE = Regex("^(?:0|[1-9][0-9]*)$")
    private const val MAX_ARRAY_INDEX = 10_000
  }

  private data class ValueSlot(val schema: JsonObject, val helper: CatalogSchemaHelper)

  internal class PendingVariableError(val variableName: String) : RuntimeException(variableName)

  internal class CompileContext(val allowPending: Boolean = false) {
    val extraComponents = ArrayList<JsonObject>()
    var inlineCounter: Int = 0
    var callCounter: Int = 0
    var activeValuePath: JsonObject? = null
    val resolving = HashSet<String>()
    val referencedVars = LinkedHashSet<String>()
    val usedIds = HashSet<String>()
  }

  internal sealed interface CompileUnit {
    data class SurfaceScope(
      val surfaceId: String,
      val hasSurfaceDirective: Boolean = false,
      val sendDataModel: Boolean? = null,
      val isUpdate: Boolean = false,
      val extensions: ExpressNode? = null,
      val rawSymbols: LinkedHashMap<String, ExpressNode> = LinkedHashMap(),
      val dataPathAssignments: LinkedHashMap<String, ExpressNode> = LinkedHashMap(),
    ) : CompileUnit

    data class DeleteSurface(val surfaceId: String) : CompileUnit

    data class StandaloneCall(val node: ExpressNode.CallNode, val scope: SurfaceScope?) :
      CompileUnit
  }

  /** Compiles an A2UI Express DSL text block into v1.0 [AgentToRendererMessage] models. */
  fun compile(
    dslText: String,
    surfaceId: String = "default_surface",
    isFinal: Boolean = true,
  ): List<AgentToRendererMessage> {
    val ctx = CompileContext(allowPending = false)
    val statements = ExpressGrammarParser.parseStatements(dslText, isFinal = isFinal)
    val units = buildUnits(statements, surfaceId)
    if (units.isEmpty()) {
      throw ExpressUndefinedRootError("root")
    }
    val out = ArrayList<AgentToRendererMessage>()
    for (unit in units) {
      when (unit) {
        is CompileUnit.DeleteSurface -> out.add(DeleteSurfaceMessage(surfaceId = unit.surfaceId))
        is CompileUnit.StandaloneCall -> out.add(compileStandaloneCall(unit, ctx))
        is CompileUnit.SurfaceScope -> out.addAll(compileCreateScope(unit, ctx))
      }
    }
    return out
  }

  internal fun parseRawStatements(
    dslText: String,
    isFinal: Boolean,
    stripSentinels: Boolean,
  ): List<ExpressStatement> =
    ExpressGrammarParser.parseStatements(
      dslText,
      isFinal = isFinal,
      stripSentinels = stripSentinels,
    )

  internal fun buildUnits(
    statements: List<ExpressStatement>,
    defaultSurfaceId: String,
  ): List<CompileUnit> {
    val units = ArrayList<CompileUnit>()
    var currentScope: CompileUnit.SurfaceScope? = null

    for (stmt in statements) {
      when (stmt) {
        is ExpressStatement.Expression -> {
          val call = stmt.value as? ExpressNode.CallNode ?: continue
          when (call.name) {
            SURFACE_STATEMENT -> {
              val opened = openScope(call, defaultSurfaceId)
              currentScope = opened
              units.add(opened)
            }
            DELETE_SURFACE_STATEMENT -> {
              val target =
                stringCallArg(call, 0, "surfaceId", call.name)
                  ?: throw ExpressValidationError(
                    "deleteSurface() requires the id of the surface to delete."
                  )
              units.add(CompileUnit.DeleteSurface(target))
            }
            else -> units.add(CompileUnit.StandaloneCall(call, currentScope))
          }
        }
        is ExpressStatement.Assignment -> {
          if (currentScope == null) {
            currentScope = CompileUnit.SurfaceScope(surfaceId = defaultSurfaceId)
            units.add(currentScope)
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

  private fun openScope(
    node: ExpressNode.CallNode,
    defaultSurfaceId: String,
  ): CompileUnit.SurfaceScope {
    val statement = node.name
    val targetSurf = stringCallArg(node, 0, "surfaceId", statement) ?: defaultSurfaceId
    val explicitCat = stringCallArg(node, 1, "catalogId", statement)
    if (explicitCat != null) {
      checkHeaderCatalog(statement, explicitCat)
    }
    val sendDataModelNode = node.kwargs[SEND_DATA_MODEL_KEY]
    val sendDataModel =
      when (sendDataModelNode) {
        null -> null
        is ExpressNode.BooleanLiteral -> sendDataModelNode.value
        else ->
          throw ExpressValidationError(
            "$SEND_DATA_MODEL_KEY must be true or false, got: $statement($SEND_DATA_MODEL_KEY=${describeExpressValue(sendDataModelNode)})"
          )
      }
    val updateNode = node.kwargs[UPDATE_KEY]
    val isUpdate =
      when (updateNode) {
        null -> false
        is ExpressNode.BooleanLiteral -> updateNode.value
        else ->
          throw ExpressValidationError(
            "$UPDATE_KEY must be true or false, got: $statement($UPDATE_KEY=${describeExpressValue(updateNode)})"
          )
      }
    val extensions =
      if (EXTENSIONS_KEY in node.kwargs) {
        if (isUpdate) {
          throw ExpressValidationError("$statement() with update=true does not accept extensions.")
        }
        node.kwargs[EXTENSIONS_KEY]
      } else {
        null
      }
    return CompileUnit.SurfaceScope(
      surfaceId = targetSurf,
      hasSurfaceDirective = true,
      sendDataModel = sendDataModel,
      isUpdate = isUpdate,
      extensions = extensions,
    )
  }

  private fun checkHeaderCatalog(statement: String, catalogId: String) {
    if (isMultiCatalog) {
      throw ExpressValidationError(
        "$statement() names catalog '$catalogId', but a surface names no catalog when several catalogs are active."
      )
    }
    helperFor(catalogId)
  }

  private fun helperFor(catalogId: String): CatalogSchemaHelper =
    helpers[catalogId]
      ?: throw ExpressValidationError(
        "Unknown catalog '$catalogId'. Available catalogs: ${helpers.keys.toList()}"
      )

  internal fun definesComponent(name: String, catalogIdNode: ExpressNode?): Boolean {
    val catStr = (catalogIdNode as? ExpressNode.StringLiteral)?.value
    if (catStr != null && catStr in helpers) {
      return name in helpers.getValue(catStr).components
    }
    return CatalogSchemaHelper.catalogsDefining(helpers, "component", name).isNotEmpty()
  }

  private fun definesFunction(name: String, catalogIdNode: ExpressNode?): Boolean {
    if (name.startsWith("@")) return true
    if (catalogIdNode != null) {
      val catStr = (catalogIdNode as? ExpressNode.StringLiteral)?.value ?: return false
      val h = helpers[catStr] ?: return false
      return name in h.functions
    }
    return CatalogSchemaHelper.catalogsDefining(helpers, "function", name).isNotEmpty()
  }

  private fun resolve(
    kind: String,
    name: String,
    catalogIdNode: ExpressNode?,
    target: String,
    label: String,
  ): Pair<CatalogSchemaHelper, String?> {
    if (catalogIdNode != null) {
      val catalogId =
        (catalogIdNode as? ExpressNode.StringLiteral)?.value
          ?: throw ExpressValidationError(
            "$target catalogId must be a string, got: ${describeExpressValue(catalogIdNode)}"
          )
      val helper = helperFor(catalogId)
      val defined = if (kind == "component") helper.components else helper.functions
      if (name !in defined) {
        throw ExpressValidationError("Unknown $label '$name' not defined in catalog '$catalogId'.")
      }
      return helper to catalogId
    }

    val matches = CatalogSchemaHelper.catalogsDefining(helpers, kind, name)
    if (matches.size > 1) {
      throw ExpressValidationError(
        "${label.replaceFirstChar { it.uppercase() }} '$name' is defined in several catalogs: $matches. Name the catalog to use with a catalogId argument."
      )
    }
    if (matches.isEmpty()) {
      if (isMultiCatalog) {
        throw ExpressValidationError(
          "Unknown $label '$name' not defined in any catalog: ${helpers.keys.toList()}."
        )
      }
      throw ExpressValidationError(
        "Unknown $label '$name' not defined in catalog '${checkedCatalogs[0].id}'."
      )
    }
    val resolvedId = matches[0]
    return helpers.getValue(resolvedId) to (if (isMultiCatalog) resolvedId else null)
  }

  internal fun componentIdOf(varName: String, ast: ExpressNode): String {
    val call = ast as? ExpressNode.CallNode ?: return varName
    val explicitNode = call.kwargs[ID_KEY] ?: return varName
    val explicitId =
      (explicitNode as? ExpressNode.StringLiteral)?.value?.takeIf { it.isNotEmpty() }
        ?: throw ExpressValidationError(
          "Component id must be a non-empty string, got: ${describeExpressValue(explicitNode)}"
        )
    if (!Uax31Identifier.isValidIdentifier(explicitId)) {
      throw ExpressValidationError("Component id '$explicitId' is not a valid UAX 31 identifier.")
    }
    return explicitId
  }

  internal fun seedScopeComponentIds(scope: CompileUnit.SurfaceScope, ctx: CompileContext) {
    ctx.usedIds.clear()
    for ((varName, ast) in scope.rawSymbols) {
      val call = ast as? ExpressNode.CallNode ?: continue
      if (definesComponent(call.name, call.kwargs["catalogId"])) {
        val compId = componentIdOf(varName, call)
        if (!ctx.usedIds.add(compId)) {
          throw ExpressValidationError("Duplicate component ID '$compId'.")
        }
      }
    }
  }

  private fun compileComponents(
    scope: CompileUnit.SurfaceScope,
    ctx: CompileContext,
  ): List<JsonObject> {
    seedScopeComponentIds(scope, ctx)
    val compiled = ArrayList<JsonObject>()
    for ((varName, ast) in scope.rawSymbols) {
      val compObj = compileAstNode(varName, ast, scope.rawSymbols, ctx)
      if (compObj != null) {
        compiled.add(compObj)
        compiled.addAll(ctx.extraComponents)
        ctx.extraComponents.clear()
      }
    }
    return compiled
  }

  internal fun compileDataValue(
    scope: CompileUnit.SurfaceScope,
    astVal: ExpressNode,
    ctx: CompileContext,
  ): JsonElement = compileValue(astVal, scope.rawSymbols, ctx)

  private fun compileCreateScope(
    scope: CompileUnit.SurfaceScope,
    ctx: CompileContext,
  ): List<AgentToRendererMessage> {
    val compiledComponents = compileComponents(scope, ctx)
    val surfId = scope.surfaceId
    val isCreate =
      !scope.isUpdate && compiledComponents.any { (it["id"] as? JsonPrimitive)?.content == "root" }

    if (!isCreate) {
      if (scope.extensions != null) {
        throw ExpressValidationError(
          "surface() extensions require a surface-creating scope with a root component."
        )
      }
      val dataUpdates = ArrayList<AgentToRendererMessage>()
      for ((pathName, astVal) in scope.dataPathAssignments) {
        val pointer = toJsonPointer(pathName)
        val compiledVal = compileDataValue(scope, astVal, ctx)
        if (pointer == "/" && compiledVal !is JsonObject) {
          throw ExpressValidationError("Cannot assign a non-map value to the root data path '$/'.")
        }
        dataUpdates.add(
          UpdateDataModelMessage(surfaceId = surfId, path = pointer, value = compiledVal)
        )
      }
      if (compiledComponents.isEmpty()) {
        if (dataUpdates.isNotEmpty()) return dataUpdates
        throw ExpressUndefinedRootError("root")
      }
      return buildList {
        add(UpdateComponentsMessage(surfaceId = surfId, components = compiledComponents))
        addAll(dataUpdates)
      }
    }

    val dataModel = LinkedHashMap<String, Any?>()
    for ((pathName, astVal) in scope.dataPathAssignments) {
      val compiledVal = compileDataValue(scope, astVal, ctx)
      setNestedPath(dataModel, pathName, compiledVal)
    }
    return listOf(buildCreateMessage(scope, compiledComponents, toJsonObjectTree(dataModel), ctx))
  }

  internal fun buildCreateMessage(
    scope: CompileUnit.SurfaceScope,
    compiledComponents: List<JsonObject>,
    dataModel: JsonObject,
    ctx: CompileContext,
  ): CreateSurfaceMessage {
    val catId = CatalogSchemaHelper.surfaceCatalogId(checkedCatalogs)
    val metadata =
      scope.extensions?.let { rawExt ->
        val extObj = compileExtensions(rawExt, scope.rawSymbols, "surface()", ctx)
        A2uiMetadata(extObj.toMap())
      }
    return CreateSurfaceMessage(
      surfaceId = scope.surfaceId,
      catalogId = catId,
      sendDataModel = scope.sendDataModel ?: false,
      components = compiledComponents,
      dataModel = if (dataModel.isNotEmpty()) dataModel else null,
      metadata = metadata,
      version = ProtocolVersion.V1_0,
    )
  }

  internal fun compileStandaloneCall(
    unit: CompileUnit.StandaloneCall,
    ctx: CompileContext,
  ): CallRendererFunctionMessage {
    ctx.callCounter++
    var node = unit.node
    var functionCallId = "call_${ctx.callCounter}"
    if (FUNCTION_CALL_ID_KEY in node.kwargs) {
      val explicitNode = node.kwargs[FUNCTION_CALL_ID_KEY]
      val explicitId =
        (explicitNode as? ExpressNode.StringLiteral)?.value?.takeIf { it.isNotEmpty() }
          ?: throw ExpressValidationError(
            "$FUNCTION_CALL_ID_KEY must be a non-empty string, got: ${describeExpressValue(explicitNode)}"
          )
      functionCallId = explicitId
      val filteredKwargs = node.kwargs.filterKeys { it != FUNCTION_CALL_ID_KEY }
      val filteredList = node.kwargList.filter { it.first != FUNCTION_CALL_ID_KEY }
      node = node.copy(kwargs = filteredKwargs, kwargList = filteredList)
    }
    if (node.name.startsWith("@")) {
      throw ExpressValidationError(
        "System function '${node.name}' cannot be called as a standalone statement."
      )
    }
    val rawSyms = unit.scope?.rawSymbols ?: emptyMap()
    val compiledVal = compileValue(node, rawSyms, ctx)
    val callObj =
      compiledVal as? JsonObject
        ?: throw ExpressValidationError(
          "Standalone statement did not compile to a valid function call: $compiledVal"
        )
    val callName =
      (callObj["@call"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?: throw ExpressValidationError(
          "Standalone statement did not compile to a valid function call: $compiledVal"
        )
    val catId =
      ((callObj["catalogId"] as? JsonPrimitive)?.takeIf { it.isString }?.content)
        ?: checkedCatalogs[0].id
    val argsObj = (callObj["args"] as? JsonObject) ?: JsonObject(emptyMap())
    return CallRendererFunctionMessage(
      functionCallId = functionCallId,
      callFunction = FunctionCall(call = callName, catalogId = catId, args = argsObj),
    )
  }

  internal fun compileAstNode(
    varName: String,
    ast: ExpressNode,
    rawSymbols: Map<String, ExpressNode>,
    ctx: CompileContext,
  ): JsonObject? {
    val call = ast as? ExpressNode.CallNode ?: return null
    val compName = call.name
    if (compName.startsWith("@")) {
      systemFunctionHelper(compName, call.kwargs)
      return null
    }

    val compCatNode = call.kwargs["catalogId"]
    if (
      !definesComponent(compName, compCatNode) &&
        ((compName in setOf("Event", "_template") && compCatNode == null) ||
          definesFunction(compName, compCatNode))
    ) {
      return null
    }

    val (compHelper, writeCatId) =
      resolve("component", compName, compCatNode, "Component '$compName'", "component")

    val properties = compHelper.getComponentProperties(compName)
    val compId = componentIdOf(varName, call)
    val consumeCatalogIdAsEnvelope = "catalogId" !in properties || writeCatId != null
    val consumeExtensionsAsEnvelope = EXTENSIONS_KEY !in properties
    val rawExtensions = if (consumeExtensionsAsEnvelope) call.kwargs[EXTENSIONS_KEY] else null

    val compDict = LinkedHashMap<String, JsonElement>()
    compDict["id"] = JsonPrimitive(compId)
    compDict["component"] = JsonPrimitive(compName)
    if (writeCatId != null) {
      compDict["@catalogId"] = JsonPrimitive(writeCatId)
    }
    if (rawExtensions != null) {
      val compiledExt = compileExtensions(rawExtensions, rawSymbols, "Component '$compName'", ctx)
      compDict["@metadata"] = JsonObject(mapOf("extensions" to compiledExt))
    }

    var siblingValuePath: JsonObject? = null
    val customEnvelope = compHelper.getCustomEnvelopeProperties(compName)
    val nonCheckProperties =
      if ("checks" in customEnvelope) properties else properties.filter { it != "checks" }
    val rawChecks = ArrayList<ExpressNode.CheckNode>()

    val propArgPairs = ArrayList<Pair<String, ExpressNode>>()
    val posArgs = ArrayList<ExpressNode>()
    for (arg in call.args) {
      val extractedChecks = extractChecksOrNull(arg)
      if (extractedChecks != null) {
        rawChecks.addAll(extractedChecks)
      } else {
        posArgs.add(arg)
      }
    }

    val remainingKwargs =
      call.kwargList.filter { (k, _) ->
        k != ID_KEY &&
          !(k == "catalogId" && consumeCatalogIdAsEnvelope) &&
          !(k == EXTENSIONS_KEY && consumeExtensionsAsEnvelope)
      }
    val remainingKwargNames = remainingKwargs.mapTo(HashSet()) { it.first }

    val requiredProps = compHelper.getComponentRequired(compName).toSet()
    var propIdx = 0
    for ((argIdx, arg) in posArgs.withIndex()) {
      if (propIdx >= nonCheckProperties.size) {
        throw ExpressValidationError(
          "$compName takes at most ${nonCheckProperties.size} positional arguments (${nonCheckProperties.joinToString()}), but component '$compId' passes ${posArgs.size}."
        )
      }
      if (
        arg is ExpressNode.NumberLiteral &&
          !compHelper.acceptsNumber(
            compHelper.getPropertySchema(compName, nonCheckProperties[propIdx])
          )
      ) {
        var moved = false
        if (argIdx == posArgs.lastIndex) {
          val numericLater =
            (propIdx + 1 until nonCheckProperties.size).filter { laterIdx ->
              nonCheckProperties[laterIdx] !in remainingKwargNames &&
                compHelper.acceptsNumber(
                  compHelper.getPropertySchema(compName, nonCheckProperties[laterIdx])
                )
            }
          if (numericLater.size == 1) {
            val targetIdx = numericLater[0]
            val allSkippedOptionalEnums =
              (propIdx until targetIdx).all { idx ->
                nonCheckProperties[idx] !in requiredProps &&
                  !compHelper.getPropertyEnum(compName, nonCheckProperties[idx]).isNullOrEmpty()
              }
            if (allSkippedOptionalEnums) {
              propIdx = targetIdx
              moved = true
            }
          }
        }
        if (!moved && nonCheckProperties[propIdx] !in requiredProps) {
          throw ExpressValidationError(
            "Positional argument ${argIdx + 1} for component '$compName' is a number, which is not valid for optional property '${nonCheckProperties[propIdx]}'."
          )
        }
      }
      propArgPairs.add(nonCheckProperties[propIdx] to arg)
      propIdx++
    }

    for ((k, v) in remainingKwargs) {
      val extractedChecks = extractChecksOrNull(v)
      if (extractedChecks != null) {
        rawChecks.addAll(extractedChecks)
      } else {
        propArgPairs.add(k to v)
      }
    }

    val seenProperties = HashSet<String>()
    val skippedNullProps = HashSet<String>()
    for ((propName, arg) in propArgPairs) {
      if (propName !in properties) {
        throw ExpressUnknownPropertyError(compName, propName, properties)
      }
      if (!seenProperties.add(propName)) {
        throw ExpressDuplicatePropertyError(compName, propName)
      }
      if (arg is ExpressNode.SkippedNode) {
        skippedNullProps.add(propName)
        continue
      }

      val propSchema = compHelper.getPropertySchema(compName, propName)
      val propType = compHelper.getPropertyType(compName, propName)

      var mappedVal =
        compileValue(
          valNode = arg,
          rawSymbols = rawSymbols,
          ctx = ctx,
          isAction = CatalogSchemaHelper.isActionSlot(propSchema),
          parentId = compId,
          parentProp = propName,
          allowComponentRef = (propType == "Child"),
          allowListComponentRefs = (propType == "ChildList" && arg is ExpressNode.ArrayNode),
          slot = propSchema?.let { ValueSlot(it, compHelper) },
        )

      if (propSchema != null && !CatalogSchemaHelper.schemaAllowsDatabinding(propSchema)) {
        if (hasDatabinding(arg, rawSymbols)) {
          throw ExpressForbiddenDatabindingError(compName, propName)
        }
        if (mappedVal is JsonArray && CatalogSchemaHelper.schemaExpectsOptionObjects(propSchema)) {
          mappedVal =
            JsonArray(
              mappedVal.map { opt ->
                if (opt is JsonPrimitive && opt.isString) {
                  JsonObject(mapOf("label" to opt, "value" to opt))
                } else {
                  opt
                }
              }
            )
        }
      }

      val enumVals = compHelper.getPropertyEnum(compName, propName)
      if (
        enumVals != null &&
          mappedVal !is JsonObject &&
          mappedVal !is JsonArray &&
          mappedVal !is JsonNull
      ) {
        if (enumVals.none { jsonValuesEqual(it, mappedVal) }) {
          throw ExpressValidationError(
            "Value '$mappedVal' is not a valid enum choice for property '$propName' of component '$compName'. Allowed values are: $enumVals"
          )
        }
      }

      if (mappedVal !is JsonNull) {
        compDict[propName] = mappedVal
      } else {
        skippedNullProps.add(propName)
      }

      if (propName == "value" && resolvesToPath(arg, rawSymbols) && mappedVal is JsonObject) {
        siblingValuePath = mappedVal
      }
    }

    if (rawChecks.isNotEmpty() && "checks" !in properties && !compHelper.isCheckable(compName)) {
      throw ExpressValidationError(
        "Component '$compName' does not declare a 'checks' property, so it cannot take checks."
      )
    }

    ctx.activeValuePath = siblingValuePath
    if (rawChecks.isNotEmpty()) {
      val compiledChecks =
        rawChecks.map { rc ->
          val (condition, message) = compileCheck(rc, rawSymbols, ctx)
          JsonObject(mapOf("condition" to condition, "message" to JsonPrimitive(message)))
        }
      if (compiledChecks.isNotEmpty()) {
        compDict["@checks"] = JsonArray(compiledChecks)
      }
    }
    ctx.activeValuePath = null

    for (reqProp in compHelper.getComponentRequired(compName)) {
      if (
        reqProp !in compDict &&
          reqProp !in skippedNullProps &&
          (reqProp !in setOf("checks", "@checks") || reqProp in customEnvelope)
      ) {
        throw ExpressValidationError("Component '$compName' missing required property '$reqProp'.")
      }
    }
    return JsonObject(compDict)
  }

  private fun compileCheck(
    rc: ExpressNode.CheckNode,
    rawSymbols: Map<String, ExpressNode>,
    ctx: CompileContext,
    isAction: Boolean = false,
  ): Pair<JsonObject, String> {
    val checkName = rc.name
    val explicitArgs = ArrayList<ExpressNode>()
    var chkCatNode: ExpressNode? = null

    for (argItem in rc.args) {
      if (argItem is ExpressNode.MapNode && "catalogId" in argItem.entries) {
        val otherKeys = argItem.entries.keys.filter { it != "catalogId" }
        if (otherKeys.isNotEmpty()) {
          throw ExpressValidationError(
            "Unsupported key(s) in check options for '?$checkName': ${otherKeys.joinToString()}. Only 'catalogId' is allowed."
          )
        }
        val catVal = argItem.entries["catalogId"]
        if (catVal is ExpressNode.NullLiteral || catVal == null) {
          throw ExpressValidationError("Check '$checkName' catalogId must be a string, got: null")
        }
        if (chkCatNode != null && chkCatNode != catVal) {
          throw ExpressValidationError(
            "Check '?$checkName' specifies conflicting catalogId values."
          )
        }
        chkCatNode = catVal
        continue
      }
      explicitArgs.add(argItem)
    }

    val (chkHelper, writeCatId) =
      resolve("function", checkName, chkCatNode, "Check '$checkName'", "check function")
    val checkProps = chkHelper.getFunctionProperties(checkName)
    var messageVal = "${checkName.replaceFirstChar { it.uppercase() }} check failed"
    val compiledArgs = LinkedHashMap<String, JsonElement>()

    var isValueInjected = false
    if (checkProps.isNotEmpty() && checkProps[0] == "value") {
      val hasExplicitBinding = explicitArgs.firstOrNull() is ExpressNode.PathNode
      val activePath = ctx.activeValuePath
      if (!hasExplicitBinding && activePath != null) {
        compiledArgs["value"] = activePath
        isValueInjected = true
      }
    }

    val startPropIdx = if (isValueInjected) 1 else 0
    for ((cIdx, cArg) in explicitArgs.withIndex()) {
      val propTargetIdx = cIdx + startPropIdx
      if (propTargetIdx >= checkProps.size) {
        if (cArg is ExpressNode.StringLiteral) {
          messageVal = cArg.value
        }
        continue
      }
      val propName = checkProps[propTargetIdx]
      val propSchema = chkHelper.getFunctionPropertySchema(checkName, propName)
      val propType = (propSchema?.get("type") as? JsonPrimitive)?.takeIf { it.isString }?.content
      if (cArg is ExpressNode.StringLiteral && propType in setOf("integer", "number", "boolean")) {
        messageVal = cArg.value
        break
      }
      if (cArg is ExpressNode.SkippedNode) continue
      val compiled = compileValue(cArg, rawSymbols, ctx, isAction = isAction)
      if (compiled !is JsonNull) {
        compiledArgs[propName] = compiled
      }
    }

    val condition = LinkedHashMap<String, JsonElement>()
    condition["@call"] = JsonPrimitive(checkName)
    if (writeCatId != null) {
      condition["catalogId"] = JsonPrimitive(writeCatId)
    }
    condition["args"] = JsonObject(compiledArgs)
    return JsonObject(condition) to messageVal
  }

  private fun compileEventCall(
    call: ExpressNode.CallNode,
    rawSymbols: Map<String, ExpressNode>,
    ctx: CompileContext,
  ): JsonObject {
    if (call.args.size > 2) {
      throw ExpressValidationError(
        "Event accepts at most 2 positional arguments (name, context), got ${call.args.size}."
      )
    }
    val seenKw = HashSet<String>()
    for ((key, _) in call.kwargList) {
      if (key !in EVENT_KEYWORDS) {
        throw ExpressInvalidParamError("Event", key, EVENT_KEYWORDS)
      }
      if (!seenKw.add(key)) {
        throw ExpressDuplicateParamError("Event", key)
      }
    }
    if (call.args.size == 2 && "context" in call.kwargs) {
      throw ExpressDuplicateParamError("Event", "context")
    }

    val compiledEventName =
      if (call.args.isNotEmpty()) compileValue(call.args[0], rawSymbols, ctx) else JsonPrimitive("")
    val eventDict = LinkedHashMap<String, JsonElement>()
    eventDict["name"] = compiledEventName

    call.kwargs["userMessage"]?.let { rawUserMessage ->
      val userMessage = compileValue(rawUserMessage, rawSymbols, ctx)
      val isString = userMessage is JsonPrimitive && userMessage.isString
      val isBindingOrCall =
        userMessage is JsonObject && ("@path" in userMessage || "@call" in userMessage)
      if (!isString && !isBindingOrCall) {
        throw ExpressValidationError(
          "Event userMessage must be a string, a \$path data binding or a function call, got ${describeExpressValue(rawUserMessage)}."
        )
      }
      eventDict["userMessage"] = userMessage
    }

    val contextNode =
      when {
        call.args.size == 2 -> call.args[1]
        "context" in call.kwargs -> call.kwargs["context"]
        else -> return JsonObject(mapOf("event" to JsonObject(eventDict)))
      }

    val rawContext = compileValue(contextNode!!, rawSymbols, ctx)
    val compiledContext = LinkedHashMap<String, JsonElement>()
    when (rawContext) {
      is JsonObject -> compiledContext.putAll(rawContext)
      is JsonArray -> {
        for (item in rawContext) {
          if (item is JsonObject) compiledContext.putAll(item)
        }
      }
      else -> {}
    }
    eventDict["context"] = JsonObject(compiledContext)
    return JsonObject(mapOf("event" to JsonObject(eventDict)))
  }

  private fun compileValue(
    valNode: ExpressNode,
    rawSymbols: Map<String, ExpressNode>,
    ctx: CompileContext,
    isAction: Boolean = false,
    parentId: String? = null,
    parentProp: String? = null,
    listIndex: Int? = null,
    allowComponentRef: Boolean = false,
    allowListComponentRefs: Boolean = false,
    slot: ValueSlot? = null,
  ): JsonElement =
    when (valNode) {
      is ExpressNode.NullLiteral -> JsonNull
      is ExpressNode.BooleanLiteral -> JsonPrimitive(valNode.value)
      is ExpressNode.StringLiteral -> JsonPrimitive(valNode.value)
      is ExpressNode.NumberLiteral -> valNode.toJsonPrimitive()
      is ExpressNode.PathNode -> JsonObject(mapOf("@path" to JsonPrimitive(valNode.path)))
      is ExpressNode.SkippedNode ->
        throw ExpressValidationError("'_' can only stand in for an argument.")
      is ExpressNode.VariableNode -> {
        val refName = valNode.name
        ctx.referencedVars.add(refName)
        val symbolVal = rawSymbols[refName]
        if (symbolVal == null) {
          if (!allowComponentRef) {
            if (ctx.allowPending) throw PendingVariableError(refName)
            throw ExpressValidationError("Variable '$refName' is not assigned in surface.")
          }
          JsonPrimitive(refName)
        } else if (
          symbolVal is ExpressNode.CallNode &&
            definesComponent(symbolVal.name, symbolVal.kwargs["catalogId"])
        ) {
          JsonPrimitive(componentIdOf(refName, symbolVal))
        } else {
          if (!ctx.resolving.add(refName)) {
            throw ExpressValidationError(
              "Variable '$refName' refers to itself through its own value."
            )
          }
          try {
            compileValue(
              valNode = symbolVal,
              rawSymbols = rawSymbols,
              ctx = ctx,
              isAction = isAction,
              allowComponentRef = allowComponentRef,
              allowListComponentRefs = allowListComponentRefs,
              slot = slot,
            )
          } finally {
            ctx.resolving.remove(refName)
          }
        }
      }
      is ExpressNode.CheckNode -> compileCheck(valNode, rawSymbols, ctx, isAction).first
      is ExpressNode.CallNode ->
        compileCall(valNode, rawSymbols, ctx, isAction, parentId, parentProp, listIndex)
      is ExpressNode.MapNode -> {
        val dictRes = LinkedHashMap<String, JsonElement>(valNode.entries.size)
        for ((k, v) in valNode.entries) {
          val entrySlot = propertySlot(slot, k)
          val entryRefType = entrySlot?.let { CatalogSchemaHelper.schemaRefType(it.schema) }
          val entryIsAction =
            isAction || (entrySlot != null && CatalogSchemaHelper.isActionSlot(entrySlot.schema))
          dictRes[k] =
            compileValue(
              valNode = v,
              rawSymbols = rawSymbols,
              ctx = ctx,
              isAction = entryIsAction,
              allowComponentRef = (entryRefType == "Child"),
              allowListComponentRefs = (entryRefType == "ChildList" && v is ExpressNode.ArrayNode),
              slot = entrySlot,
            )
        }
        JsonObject(dictRes)
      }
      is ExpressNode.ArrayNode -> {
        val itemSlot = itemSlot(slot)
        val itemRefType = itemSlot?.let { CatalogSchemaHelper.schemaRefType(it.schema) }
        val itemIsAction =
          isAction || (itemSlot != null && CatalogSchemaHelper.isActionSlot(itemSlot.schema))
        JsonArray(
          valNode.items.mapIndexed { idx, item ->
            compileValue(
              valNode = item,
              rawSymbols = rawSymbols,
              ctx = ctx,
              isAction = itemIsAction,
              parentId = parentId,
              parentProp = parentProp,
              listIndex = idx,
              allowComponentRef = (allowListComponentRefs || itemRefType == "Child"),
              slot = itemSlot,
            )
          }
        )
      }
    }

  private fun compileCall(
    call: ExpressNode.CallNode,
    rawSymbols: Map<String, ExpressNode>,
    ctx: CompileContext,
    isAction: Boolean,
    parentId: String?,
    parentProp: String?,
    listIndex: Int?,
  ): JsonElement {
    val fnName = call.name
    val fnArgs = call.args

    if (fnName == "_template") {
      if (fnArgs.size < 2) {
        throw ExpressParseError(
          "_template helper requires exactly 2 arguments: path and templateComponent."
        )
      }
      val pathVal = compileValue(fnArgs[0], rawSymbols, ctx, isAction = isAction)
      val templatePath =
        bindingPath(pathVal)
          ?: throw ExpressParseError(
            "The first argument to _template must be a dynamic data binding path (prefixed by \$), got: ${describeExpressValue(fnArgs[0])}"
          )
      val compIdVal =
        compileValue(fnArgs[1], rawSymbols, ctx, isAction = isAction, allowComponentRef = true)
      return JsonObject(mapOf("path" to JsonPrimitive(templatePath), "componentId" to compIdVal))
    }

    if (fnName == "Event") {
      return compileEventCall(call, rawSymbols, ctx)
    }

    if (fnName.startsWith("@")) {
      return compileSystemCall(
        fnName,
        fnArgs,
        call.kwargs,
        call.kwargList,
        rawSymbols,
        ctx,
        isAction,
      )
    }

    val callCatNode = call.kwargs["catalogId"]
    if (definesComponent(fnName, callCatNode)) {
      val inlineId =
        if (parentId != null && parentProp != null) {
          if (listIndex != null) "${parentId}_${parentProp}_${listIndex}"
          else "${parentId}_${parentProp}"
        } else {
          ctx.inlineCounter++
          "_inline_${ctx.inlineCounter}"
        }
      val actualId = componentIdOf(inlineId, call)
      if (!ctx.usedIds.add(actualId)) {
        throw ExpressValidationError("Duplicate component ID '$actualId'.")
      }

      val prevExtras = ArrayList(ctx.extraComponents)
      ctx.extraComponents.clear()
      val compiledInline = compileAstNode(inlineId, call, rawSymbols, ctx)
      val childExtras = ArrayList(ctx.extraComponents)
      ctx.extraComponents.clear()
      ctx.extraComponents.addAll(prevExtras)
      if (compiledInline != null) {
        ctx.extraComponents.add(compiledInline)
        ctx.extraComponents.addAll(childExtras)
        return compiledInline["id"] ?: JsonPrimitive(inlineId)
      }
      return JsonPrimitive(inlineId)
    }

    val (callHelper, writeCatId) =
      resolve("function", fnName, callCatNode, "Call '$fnName'", "function")
    val fnProps = callHelper.getFunctionProperties(fnName)
    val consumeCatId = "catalogId" !in fnProps || writeCatId != null
    val filteredKwargList =
      if (consumeCatId) call.kwargList.filter { it.first != "catalogId" } else call.kwargList
    val compiledArgs =
      compileCallArgs(callHelper, fnName, fnArgs, filteredKwargList, rawSymbols, ctx, isAction)

    val resExpr = LinkedHashMap<String, JsonElement>()
    resExpr["@call"] = JsonPrimitive(fnName)
    if (writeCatId != null) {
      resExpr["catalogId"] = JsonPrimitive(writeCatId)
    }
    resExpr["args"] = compiledArgs

    val callJson = JsonObject(resExpr)
    return if (isAction) JsonObject(mapOf("functionCall" to callJson)) else callJson
  }

  private fun compileSystemCall(
    fnName: String,
    fnArgs: List<ExpressNode>,
    rawKwargs: Map<String, ExpressNode>,
    kwargList: List<Pair<String, ExpressNode>>,
    rawSymbols: Map<String, ExpressNode>,
    ctx: CompileContext,
    isAction: Boolean,
  ): JsonObject {
    val helper = systemFunctionHelper(fnName, rawKwargs)
    val compiledArgs = compileCallArgs(helper, fnName, fnArgs, kwargList, rawSymbols, ctx, isAction)
    val resExpr = LinkedHashMap<String, JsonElement>()
    resExpr["@call"] = JsonPrimitive(fnName)
    if (compiledArgs.isNotEmpty()) {
      resExpr["args"] = compiledArgs
    }
    val callJson = JsonObject(resExpr)
    return if (isAction) JsonObject(mapOf("functionCall" to callJson)) else callJson
  }

  private fun systemFunctionHelper(
    fnName: String,
    rawKwargs: Map<String, ExpressNode>,
  ): CatalogSchemaHelper {
    val helper = helpers.values.first()
    if (fnName !in helper.systemFunctions) {
      throw ExpressValidationError(
        "Unknown system function '$fnName' in A2UI 1.0. System functions: ${helper.systemFunctions.keys.sorted()}."
      )
    }
    if ("catalogId" in rawKwargs) {
      throw ExpressValidationError(
        "System function '$fnName' is defined by the protocol, not a catalog, so it takes no catalogId."
      )
    }
    return helper
  }

  private fun compileCallArgs(
    helper: CatalogSchemaHelper,
    fnName: String,
    fnArgs: List<ExpressNode>,
    kwargList: List<Pair<String, ExpressNode>>,
    rawSymbols: Map<String, ExpressNode>,
    ctx: CompileContext,
    isAction: Boolean,
  ): JsonObject {
    val fnProps = helper.getFunctionProperties(fnName)
    val compiledArgs = LinkedHashMap<String, JsonElement>()
    val seenArgSlots = HashSet<String>()

    for ((idx, arg) in fnArgs.withIndex()) {
      if (idx >= fnProps.size) continue
      val propName = fnProps[idx]
      seenArgSlots.add(propName)
      if (arg is ExpressNode.SkippedNode) continue
      val valItem = compileValue(arg, rawSymbols, ctx, isAction = isAction)
      if (valItem !is JsonNull) {
        compiledArgs[propName] = valItem
      }
    }

    for ((k, v) in kwargList) {
      if (k !in fnProps) {
        throw ExpressInvalidParamError(fnName, k, fnProps)
      }
      if (!seenArgSlots.add(k)) {
        throw ExpressDuplicateParamError(fnName, k)
      }
      if (v is ExpressNode.SkippedNode) continue
      val valItem = compileValue(v, rawSymbols, ctx, isAction = isAction)
      if (valItem !is JsonNull) {
        compiledArgs[k] = valItem
      }
    }
    return JsonObject(compiledArgs)
  }

  private fun compileExtensions(
    rawExt: ExpressNode,
    rawSymbols: Map<String, ExpressNode>,
    target: String,
    ctx: CompileContext,
  ): JsonObject {
    val top = resolveAstVar(rawExt, rawSymbols, ctx, HashSet())
    if (top !is ExpressNode.MapNode) {
      throw ExpressValidationError(
        "$target extensions must be a map, got: ${describeExpressValue(top)}"
      )
    }
    checkExtensionsAst(top, rawSymbols, target, ctx, HashSet())
    val compiled =
      compileValue(rawExt, rawSymbols, ctx) as? JsonObject
        ?: throw ExpressValidationError("$target extensions must be a map.")
    for (key in compiled.keys) {
      if (!Uax31Identifier.isValidIdentifier(key)) {
        throw ExpressValidationError(
          "$target extension key '$key' is not a valid UAX 31 identifier."
        )
      }
    }
    return compiled
  }

  private fun resolveAstVar(
    node: ExpressNode,
    rawSymbols: Map<String, ExpressNode>,
    ctx: CompileContext,
    seen: MutableSet<String>,
  ): ExpressNode {
    var cur = node
    while (cur is ExpressNode.VariableNode) {
      val name = cur.name
      ctx.referencedVars.add(name)
      if (!seen.add(name)) {
        throw ExpressValidationError("Variable '$name' refers to itself.")
      }
      val resolved = rawSymbols[name]
      if (resolved == null) {
        if (ctx.allowPending) throw PendingVariableError(name)
        throw ExpressValidationError("Undefined variable '$name' in 1.0 expression.")
      }
      cur = resolved
    }
    return cur
  }

  private fun checkExtensionsAst(
    node: ExpressNode,
    rawSymbols: Map<String, ExpressNode>,
    target: String,
    ctx: CompileContext,
    seen: Set<String>,
  ) {
    val resolved = resolveAstVar(node, rawSymbols, ctx, seen.toMutableSet())
    when (resolved) {
      is ExpressNode.MapNode -> {
        for (v in resolved.entries.values) {
          checkExtensionsAst(v, rawSymbols, target, ctx, seen)
        }
      }
      is ExpressNode.ArrayNode -> {
        for (item in resolved.items) {
          checkExtensionsAst(item, rawSymbols, target, ctx, seen)
        }
      }
      is ExpressNode.CallNode -> {
        val catId = resolved.kwargs["catalogId"]
        if (definesComponent(resolved.name, catId)) {
          throw ExpressValidationError(
            "$target extensions cannot contain component '${resolved.name}'."
          )
        }
        if (
          resolved.name in
            setOf("Event", "_template", SURFACE_STATEMENT, DELETE_SURFACE_STATEMENT) &&
            catId == null
        ) {
          throw ExpressValidationError("$target extensions cannot contain '${resolved.name}()'.")
        }
        for (arg in resolved.args) {
          checkExtensionsAst(arg, rawSymbols, target, ctx, seen)
        }
        for (kwVal in resolved.kwargs.values) {
          checkExtensionsAst(kwVal, rawSymbols, target, ctx, seen)
        }
      }
      else -> {}
    }
  }

  private fun itemSlot(slot: ValueSlot?): ValueSlot? {
    if (slot == null) return null
    val schema = slot.helper.resolveItemSchema(slot.schema) ?: return null
    return ValueSlot(schema, slot.helper)
  }

  private fun propertySlot(slot: ValueSlot?, name: String): ValueSlot? {
    if (slot == null) return null
    val schema = slot.helper.resolvePropertySchema(slot.schema, name) ?: return null
    return ValueSlot(schema, slot.helper)
  }

  private fun extractChecksOrNull(node: ExpressNode): List<ExpressNode.CheckNode>? =
    when (node) {
      is ExpressNode.CheckNode -> listOf(node)
      is ExpressNode.ArrayNode -> {
        if (node.items.isNotEmpty() && node.items.all { it is ExpressNode.CheckNode }) {
          node.items.map { it as ExpressNode.CheckNode }
        } else {
          null
        }
      }
      else -> null
    }

  private fun resolvesToPath(node: ExpressNode, rawSymbols: Map<String, ExpressNode>): Boolean {
    var cur = node
    val seen = HashSet<String>()
    while (cur is ExpressNode.VariableNode) {
      if (!seen.add(cur.name)) return false
      cur = rawSymbols[cur.name] ?: return false
    }
    return cur is ExpressNode.PathNode
  }

  private fun hasDatabinding(
    node: ExpressNode,
    rawSymbols: Map<String, ExpressNode>,
    seen: Set<String> = emptySet(),
  ): Boolean =
    when (node) {
      is ExpressNode.PathNode -> true
      is ExpressNode.VariableNode -> {
        if (node.name in seen) false
        else {
          val target = rawSymbols[node.name]
          if (target == null) false else hasDatabinding(target, rawSymbols, seen + node.name)
        }
      }
      is ExpressNode.MapNode -> node.entries.values.any { hasDatabinding(it, rawSymbols, seen) }
      is ExpressNode.ArrayNode -> node.items.any { hasDatabinding(it, rawSymbols, seen) }
      else -> false
    }

  private fun bindingPath(el: JsonElement): String? {
    val obj = el as? JsonObject ?: return null
    if ("componentId" in obj) return null
    return (obj["@path"] as? JsonPrimitive)?.takeIf { it.isString }?.content
  }

  private fun stringCallArg(
    node: ExpressNode.CallNode,
    index: Int,
    key: String,
    statement: String,
  ): String? {
    val raw =
      when {
        key in node.kwargs -> node.kwargs[key]
        node.args.size > index -> node.args[index]
        else -> null
      } ?: return null
    return (raw as? ExpressNode.StringLiteral)?.value
      ?: throw ExpressValidationError(
        "$statement() argument '$key' must be a string, got: ${describeExpressValue(raw)}"
      )
  }

  private fun describeExpressValue(node: ExpressNode?): String =
    when (node) {
      null,
      is ExpressNode.NullLiteral -> "null"
      is ExpressNode.CallNode -> "a call to ${node.name}(...)"
      is ExpressNode.CheckNode -> "a check (?${node.name})"
      is ExpressNode.VariableNode -> "the variable ${node.name}"
      is ExpressNode.PathNode -> "the data binding \$${node.path}"
      is ExpressNode.SkippedNode -> "'_'"
      is ExpressNode.MapNode -> "a map literal"
      is ExpressNode.ArrayNode -> "a list"
      is ExpressNode.BooleanLiteral -> "the boolean ${node.value}"
      is ExpressNode.NumberLiteral -> "the number ${node.toJsonPrimitive()}"
      is ExpressNode.StringLiteral -> "the string ${JsonPrimitive(node.value)}"
    }

  internal fun toJsonPointer(pathStr: String): String = "/${stripPathPrefix(pathStr)}"

  private fun stripPathPrefix(pathStr: String): String =
    when {
      pathStr.startsWith("$/") -> pathStr.substring(2)
      pathStr.startsWith("$") -> pathStr.substring(1)
      else -> pathStr
    }

  private fun parseArrayIndex(segment: String, pathStr: String): Int {
    if (!ARRAY_INDEX_RE.matches(segment)) {
      throw ExpressValidationError(
        "Cannot use non-numeric segment '$segment' on an array in path '$pathStr'."
      )
    }
    val idx = segment.toLongOrNull()
    if (idx == null || idx > MAX_ARRAY_INDEX) {
      throw ExpressValidationError(
        "Cannot set path '$pathStr': array index '$segment' exceeds maximum supported index ($MAX_ARRAY_INDEX)."
      )
    }
    return idx.toInt()
  }

  @Suppress("UNCHECKED_CAST")
  internal fun setNestedPath(root: MutableMap<String, Any?>, pathStr: String, value: JsonElement) {
    val cleanPath = stripPathPrefix(pathStr)
    if (cleanPath.isEmpty()) {
      val obj =
        value as? JsonObject
          ?: throw ExpressValidationError(
            "Cannot set root data model '$pathStr' to a non-map value."
          )
      root.clear()
      for ((k, v) in obj) {
        root[k] = jsonToMutableTree(v)
      }
      return
    }
    val keys = cleanPath.split('/')
    var current: Any = root
    for (i in 0 until keys.size - 1) {
      val segment = keys[i]
      val nextSegment = keys[i + 1]
      val isNextIndex = ARRAY_INDEX_RE.matches(nextSegment)
      current =
        when (current) {
          is MutableMap<*, *> -> {
            val map = current as MutableMap<String, Any?>
            val existing = map[segment]
            when (existing) {
              null -> {
                val child: Any =
                  if (isNextIndex) ArrayList<Any?>() else LinkedHashMap<String, Any?>()
                map[segment] = child
                child
              }
              is MutableMap<*, *>,
              is MutableList<*> -> existing
              else ->
                throw ExpressValidationError(
                  "Cannot set path '$pathStr': segment '$segment' is a primitive value."
                )
            }
          }
          is MutableList<*> -> {
            val list = current as MutableList<Any?>
            val idx = parseArrayIndex(segment, pathStr)
            while (list.size <= idx) list.add(null)
            val existing = list[idx]
            when (existing) {
              null -> {
                val child: Any =
                  if (isNextIndex) ArrayList<Any?>() else LinkedHashMap<String, Any?>()
                list[idx] = child
                child
              }
              is MutableMap<*, *>,
              is MutableList<*> -> existing
              else ->
                throw ExpressValidationError(
                  "Cannot set path '$pathStr': segment '$segment' is a primitive value."
                )
            }
          }
          else ->
            throw ExpressValidationError(
              "Cannot set path '$pathStr': segment '$segment' is a primitive value."
            )
        }
    }
    val lastKey = keys.last()
    val treeLeaf = jsonToMutableTree(value)
    when (current) {
      is MutableMap<*, *> -> (current as MutableMap<String, Any?>)[lastKey] = treeLeaf
      is MutableList<*> -> {
        val list = current as MutableList<Any?>
        val idx = parseArrayIndex(lastKey, pathStr)
        while (list.size <= idx) list.add(null)
        list[idx] = treeLeaf
      }
      else ->
        throw ExpressValidationError(
          "Cannot set path '$pathStr': segment '$lastKey' is a primitive value."
        )
    }
  }

  private fun jsonToMutableTree(el: JsonElement): Any? =
    when (el) {
      is JsonNull -> null
      is JsonPrimitive -> el
      is JsonArray -> el.mapTo(ArrayList(el.size)) { jsonToMutableTree(it) }
      is JsonObject -> {
        val m = LinkedHashMap<String, Any?>(el.size)
        for ((k, v) in el) m[k] = jsonToMutableTree(v)
        m
      }
    }

  @Suppress("UNCHECKED_CAST")
  internal fun toJsonObjectTree(map: Map<String, Any?>): JsonObject =
    JsonObject(map.mapValues { (_, v) -> anyToJsonElement(v) })

  @Suppress("UNCHECKED_CAST")
  private fun anyToJsonElement(v: Any?): JsonElement =
    when (v) {
      null -> JsonNull
      is JsonElement -> v
      is Map<*, *> -> toJsonObjectTree(v as Map<String, Any?>)
      is List<*> -> JsonArray(v.map { anyToJsonElement(it) })
      else -> JsonPrimitive(v.toString())
    }
}

/**
 * Tracks incremental statement compilation across chunks of an open `<a2ui>` block during
 * streaming.
 */
internal class ExpressScopeSession(
  private val compiler: ExpressCompiler,
  private val surfaceId: String = "default_surface",
) {
  private data class CachedComponentEntry(
    val ast: ExpressNode,
    val components: List<JsonObject>,
    val deps: Map<String, Pair<ExpressNode?, String?>>,
    val prevInlineCounter: Int,
    val inlineDelta: Int,
    val generatedIds: List<String>,
  )

  private data class CachedDataEntry(
    val ast: ExpressNode,
    val value: JsonElement,
    val deps: Map<String, Pair<ExpressNode?, String?>>,
  )

  private class ScopeStreamState(
    var surfaceId: String = "",
    var surfaceCreated: Boolean = false,
    val emittedComponents: LinkedHashMap<String, JsonObject> = LinkedHashMap(),
    val emittedDataPaths: LinkedHashMap<String, JsonElement> = LinkedHashMap(),
    val varIds: LinkedHashMap<String, String> = LinkedHashMap(),
    val compiledCache: LinkedHashMap<String, CachedComponentEntry> = LinkedHashMap(),
    val dataCache: LinkedHashMap<String, CachedDataEntry> = LinkedHashMap(),
  ) {
    fun clone(): ScopeStreamState =
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
    private val scopeStates: Map<Int, Any>,
    val emittedUnits: Set<Int>,
    val hasEmitted: Boolean,
    val cachedPrefix: String,
    val cachedStatements: List<ExpressStatement>,
    val supersededComponents: List<Pair<String, String>>,
  ) {
    @Suppress("UNCHECKED_CAST")
    internal fun typedStates(): LinkedHashMap<Int, Any> = LinkedHashMap(scopeStates)
  }

  private var scopeStates = LinkedHashMap<Int, ScopeStreamState>()
  private var emittedUnits = HashSet<Int>()
  var hasEmitted: Boolean = false
    private set

  private var cachedPrefix: String = ""
  private var cachedStatements: List<ExpressStatement> = emptyList()
  var supersededComponents: MutableList<Pair<String, String>> = ArrayList()
    private set

  fun snapshot(): SessionSnapshot =
    SessionSnapshot(
      scopeStates = scopeStates.mapValues { (_, st) -> st.clone() },
      emittedUnits = HashSet(emittedUnits),
      hasEmitted = hasEmitted,
      cachedPrefix = cachedPrefix,
      cachedStatements = cachedStatements.toList(),
      supersededComponents = supersededComponents.toList(),
    )

  @Suppress("UNCHECKED_CAST")
  fun restore(snap: SessionSnapshot) {
    scopeStates = LinkedHashMap()
    for ((k, v) in snap.typedStates()) {
      scopeStates[k] = (v as ScopeStreamState).clone()
    }
    emittedUnits = HashSet(snap.emittedUnits)
    hasEmitted = snap.hasEmitted
    cachedPrefix = snap.cachedPrefix
    cachedStatements = snap.cachedStatements.toList()
    supersededComponents = snap.supersededComponents.toMutableList()
  }

  fun compileStep(
    dslText: String,
    isFinal: Boolean,
    existingSurfaces: Iterable<String>,
    cachePrefix: Boolean = true,
  ): List<AgentToRendererMessage> {
    supersededComponents = ArrayList()
    val ctx = ExpressCompiler.CompileContext(allowPending = !isFinal)
    val statements = parseIncrementalStatements(dslText, cachePrefix)
    val units = compiler.buildUnits(statements, surfaceId)
    if (units.isEmpty()) {
      if (isFinal) throw ExpressUndefinedRootError("root")
      return emptyList()
    }

    val activeSurfaces = existingSurfaces.toMutableSet()
    val out = ArrayList<AgentToRendererMessage>()
    for ((idx, unit) in units.withIndex()) {
      out.addAll(compileUnit(idx, unit, ctx, isFinal, activeSurfaces))
    }
    return out
  }

  private fun parseIncrementalStatements(
    dslText: String,
    cachePrefix: Boolean,
  ): List<ExpressStatement> {
    val statements =
      if (
        cachedPrefix.isNotEmpty() &&
          dslText.startsWith(cachedPrefix) &&
          isValidPrefixBoundary(dslText, cachedPrefix.length)
      ) {
        val delta = dslText.substring(cachedPrefix.length)
        if (delta.isBlank()) {
          cachedStatements.toList()
        } else {
          val deltaStmts =
            compiler.parseRawStatements(delta, isFinal = true, stripSentinels = false)
          cachedStatements + deltaStmts
        }
      } else {
        compiler.parseRawStatements(dslText, isFinal = true, stripSentinels = false)
      }
    if (cachePrefix) {
      cachedPrefix = dslText
      cachedStatements = statements.toList()
    }
    return statements
  }

  private fun isValidPrefixBoundary(dslText: String, prefixLen: Int): Boolean {
    if (dslText.length == prefixLen) return true
    if (dslText[prefixLen - 1] == '\n' || dslText[prefixLen - 1] == ';') return true
    return dslText[prefixLen] in charArrayOf(' ', '\t', '\r', '\n', ';')
  }

  private fun compileUnit(
    idx: Int,
    unit: ExpressCompiler.CompileUnit,
    ctx: ExpressCompiler.CompileContext,
    isFinal: Boolean,
    activeSurfaces: MutableSet<String>,
  ): List<AgentToRendererMessage> {
    when (unit) {
      is ExpressCompiler.CompileUnit.DeleteSurface -> {
        activeSurfaces.remove(unit.surfaceId)
        if (!emittedUnits.add(idx)) return emptyList()
        hasEmitted = true
        return listOf(DeleteSurfaceMessage(surfaceId = unit.surfaceId))
      }
      is ExpressCompiler.CompileUnit.StandaloneCall -> {
        if (idx in emittedUnits) return emptyList()
        val msg =
          try {
            compiler.compileStandaloneCall(unit, ctx)
          } catch (_: ExpressCompiler.PendingVariableError) {
            return emptyList()
          }
        emittedUnits.add(idx)
        hasEmitted = true
        return listOf(msg)
      }
      is ExpressCompiler.CompileUnit.SurfaceScope -> {
        val state = scopeStates.getOrPut(idx) { ScopeStreamState(surfaceId = unit.surfaceId) }
        state.surfaceId = unit.surfaceId
        val surfaceExists = unit.surfaceId in activeSurfaces
        val messages = compileScopeDelta(unit, state, ctx, isFinal, surfaceExists)
        if (state.surfaceCreated || surfaceExists) {
          activeSurfaces.add(unit.surfaceId)
        }
        return messages
      }
    }
  }

  private fun compileScopeDelta(
    scope: ExpressCompiler.CompileUnit.SurfaceScope,
    state: ScopeStreamState,
    ctx: ExpressCompiler.CompileContext,
    isFinal: Boolean,
    surfaceExists: Boolean,
  ): List<AgentToRendererMessage> {
    val (compiledComponents, hasPending) = collectReadyComponents(scope, state, ctx)
    val compiledData = collectReadyData(scope, state, ctx)
    val hasRoot = compiledComponents.any { (it["id"] as? JsonPrimitive)?.content == "root" }
    val needsCreate =
      !scope.isUpdate &&
        !state.surfaceCreated &&
        (!surfaceExists || hasRoot || scope.extensions != null)
    return if (needsCreate) {
      compileInitialCreate(scope, state, compiledComponents, compiledData, ctx, isFinal)
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
    scope: ExpressCompiler.CompileUnit.SurfaceScope,
    state: ScopeStreamState,
    compiledComponents: List<JsonObject>,
    compiledData: Map<String, JsonElement>,
    ctx: ExpressCompiler.CompileContext,
    isFinal: Boolean,
  ): List<AgentToRendererMessage> {
    val hasRoot = compiledComponents.any { (it["id"] as? JsonPrimitive)?.content == "root" }
    if (!hasRoot) {
      if (!isFinal) return emptyList()
      if (scope.extensions != null) {
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
      throw ExpressUndefinedRootError("root")
    }

    val dataTree = LinkedHashMap<String, Any?>()
    for ((pathName, value) in compiledData) {
      compiler.setNestedPath(dataTree, pathName, value)
    }
    val createMsg =
      try {
        compiler.buildCreateMessage(
          scope,
          compiledComponents,
          compiler.toJsonObjectTree(dataTree),
          ctx,
        )
      } catch (e: ExpressCompiler.PendingVariableError) {
        if (!isFinal) return emptyList()
        throw ExpressValidationError("Undefined variable '${e.variableName}' in 1.0 expression.")
      }
    for ((pathName, value) in compiledData) {
      state.emittedDataPaths[pathName] = value
    }
    for (comp in compiledComponents) {
      state.emittedComponents[(comp["id"] as JsonPrimitive).content] = comp
    }
    state.surfaceCreated = true
    hasEmitted = true
    return listOf(createMsg)
  }

  private fun compileIncrementalUpdates(
    scope: ExpressCompiler.CompileUnit.SurfaceScope,
    state: ScopeStreamState,
    compiledComponents: List<JsonObject>,
    compiledData: Map<String, JsonElement>,
    isFinal: Boolean,
    hasPending: Boolean,
    surfaceExists: Boolean,
  ): List<AgentToRendererMessage> {
    val deltaComponents =
      compiledComponents.filter { comp ->
        val id = (comp["id"] as JsonPrimitive).content
        !jsonValuesStrictEqual(state.emittedComponents[id], comp)
      }
    for (comp in deltaComponents) {
      state.emittedComponents[(comp["id"] as JsonPrimitive).content] = comp
    }

    val dataUpdates = buildDataUpdates(scope, state, compiledData)
    if (
      isFinal &&
        state.emittedComponents.isEmpty() &&
        state.emittedDataPaths.isEmpty() &&
        !hasPending
    ) {
      throw ExpressUndefinedRootError("root")
    }

    val messages = ArrayList<AgentToRendererMessage>()
    if (deltaComponents.isNotEmpty()) {
      if (!isFinal && !scope.hasSurfaceDirective && !state.surfaceCreated && !surfaceExists) {
        throw ExpressUndefinedRootError("root")
      }
      messages.add(
        UpdateComponentsMessage(surfaceId = scope.surfaceId, components = deltaComponents)
      )
    }
    messages.addAll(dataUpdates)
    if (messages.isNotEmpty()) {
      hasEmitted = true
    }
    return messages
  }

  private fun depSnapshot(
    scope: ExpressCompiler.CompileUnit.SurfaceScope,
    dep: String,
  ): Pair<ExpressNode?, String?> {
    val depAst = scope.rawSymbols[dep]
    if (
      depAst is ExpressNode.CallNode &&
        compiler.definesComponent(depAst.name, depAst.kwargs["catalogId"])
    ) {
      return depAst to compiler.componentIdOf(dep, depAst)
    }
    return depAst to null
  }

  private fun earlierScopeComponent(
    currentState: ScopeStreamState,
    surfaceId: String,
    compId: String,
  ): JsonObject? {
    var found: JsonObject? = null
    for (st in scopeStates.values) {
      if (st === currentState) break
      if (st.surfaceId == surfaceId && compId in st.emittedComponents) {
        found = st.emittedComponents[compId]
      }
    }
    return found
  }

  private fun collectReadyComponents(
    scope: ExpressCompiler.CompileUnit.SurfaceScope,
    state: ScopeStreamState,
    ctx: ExpressCompiler.CompileContext,
  ): Pair<List<JsonObject>, Boolean> {
    compiler.seedScopeComponentIds(scope, ctx)
    val compiled = ArrayList<JsonObject>()
    var hasPending = false
    val superseded = ArrayList<String>()

    for ((varName, ast) in scope.rawSymbols) {
      val cached = state.compiledCache[varName]
      val varComps =
        if (
          cached != null &&
            cached.ast == ast &&
            (cached.inlineDelta == 0 || cached.prevInlineCounter == ctx.inlineCounter) &&
            cached.generatedIds.none { it in ctx.usedIds } &&
            cached.deps.all { (dep, snap) -> depSnapshot(scope, dep) == snap }
        ) {
          ctx.inlineCounter += cached.inlineDelta
          ctx.usedIds.addAll(cached.generatedIds)
          cached.components
        } else {
          val prevInline = ctx.inlineCounter
          val prevUsed = HashSet(ctx.usedIds)
          ctx.referencedVars.clear()
          val compDict =
            try {
              compiler.compileAstNode(varName, ast, scope.rawSymbols, ctx)
            } catch (_: ExpressCompiler.PendingVariableError) {
              ctx.extraComponents.clear()
              ctx.inlineCounter = prevInline
              ctx.usedIds.clear()
              ctx.usedIds.addAll(prevUsed)
              hasPending = true
              continue
            }
          val list = if (compDict != null) listOf(compDict) + ctx.extraComponents else emptyList()
          ctx.extraComponents.clear()
          val deps = ctx.referencedVars.associateWith { depSnapshot(scope, it) }
          val newGenIds = ctx.usedIds.filter { it !in prevUsed }
          state.compiledCache[varName] =
            CachedComponentEntry(
              ast = ast,
              components = list,
              deps = deps,
              prevInlineCounter = prevInline,
              inlineDelta = ctx.inlineCounter - prevInline,
              generatedIds = newGenIds,
            )
          list
        }

      if (varComps.isNotEmpty()) {
        val newId = (varComps[0]["id"] as JsonPrimitive).content
        val oldId = state.varIds[varName]
        state.varIds[varName] = newId
        if (oldId != null && oldId != newId) {
          superseded.add(oldId)
        }
        compiled.addAll(varComps)
      }
    }

    if (superseded.isNotEmpty()) {
      val activeIds = compiled.mapTo(HashSet()) { (it["id"] as JsonPrimitive).content }
      for (oldId in superseded) {
        if (oldId !in activeIds) {
          state.emittedComponents.remove(oldId)
          val earlier = earlierScopeComponent(state, scope.surfaceId, oldId)
          if (earlier != null) {
            compiled.add(earlier)
          } else {
            supersededComponents.add(scope.surfaceId to oldId)
          }
        }
      }
    }
    return compiled to hasPending
  }

  private fun collectReadyData(
    scope: ExpressCompiler.CompileUnit.SurfaceScope,
    state: ScopeStreamState,
    ctx: ExpressCompiler.CompileContext,
  ): Map<String, JsonElement> {
    val compiled = LinkedHashMap<String, JsonElement>()
    for ((pathName, astVal) in scope.dataPathAssignments) {
      val cached = state.dataCache[pathName]
      if (
        cached != null &&
          cached.ast == astVal &&
          cached.deps.all { (dep, snap) -> depSnapshot(scope, dep) == snap }
      ) {
        compiled[pathName] = cached.value
        continue
      }
      ctx.referencedVars.clear()
      val value =
        try {
          compiler.compileDataValue(scope, astVal, ctx)
        } catch (_: ExpressCompiler.PendingVariableError) {
          continue
        }
      val deps = ctx.referencedVars.associateWith { depSnapshot(scope, it) }
      state.dataCache[pathName] = CachedDataEntry(astVal, value, deps)
      compiled[pathName] = value
    }
    return compiled
  }

  private fun buildDataUpdates(
    scope: ExpressCompiler.CompileUnit.SurfaceScope,
    state: ScopeStreamState,
    compiledData: Map<String, JsonElement>,
  ): List<AgentToRendererMessage> {
    val updates = ArrayList<AgentToRendererMessage>()
    for ((pathName, value) in compiledData) {
      if (
        pathName in state.emittedDataPaths &&
          jsonValuesStrictEqual(state.emittedDataPaths[pathName], value)
      ) {
        continue
      }
      val pointer = compiler.toJsonPointer(pathName)
      if (pointer == "/" && value !is JsonObject) {
        throw ExpressValidationError("Cannot assign a non-map value to the root data path '$/'.")
      }
      state.emittedDataPaths[pathName] = value
      updates.add(
        UpdateDataModelMessage(surfaceId = scope.surfaceId, path = pointer, value = value)
      )
    }
    return updates
  }
}
