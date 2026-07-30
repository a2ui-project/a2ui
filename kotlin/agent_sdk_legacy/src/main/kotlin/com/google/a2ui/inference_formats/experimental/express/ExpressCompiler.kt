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

package com.google.a2ui.inference_formats.experimental.express

import com.google.a2ui.exceptions.A2uiParseException
import com.google.a2ui.inference_formats.experimental.express.constants.SurfaceOperation
import com.google.a2ui.inference_formats.experimental.express.generated.ExpressLexer
import com.google.a2ui.inference_formats.experimental.express.generated.ExpressParser
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiConstants
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import org.antlr.v4.runtime.CharStreams
import org.antlr.v4.runtime.CommonTokenStream

internal fun setNestedPath(d: MutableMap<String, Any?>, pathStr: String, valItem: Any?) {
  val cleanPath =
    when {
      pathStr.startsWith("$/") -> pathStr.substring(2)
      pathStr.startsWith("$") -> pathStr.substring(1)
      else -> pathStr
    }
  if (cleanPath.isEmpty()) return

  val keys = cleanPath.split("/")
  var current = d
  for (key in keys.dropLast(1)) {
    val existing = current[key]
    if (existing !is MutableMap<*, *>) {
      val newMap = mutableMapOf<String, Any?>()
      current[key] = newMap
      @Suppress("UNCHECKED_CAST")
      current = newMap as MutableMap<String, Any?>
    } else {
      @Suppress("UNCHECKED_CAST")
      current = existing as MutableMap<String, Any?>
    }
  }
  current[keys.last()] = valItem
}

internal fun anyToJsonElement(value: Any?): JsonElement {
  return when (value) {
    null -> JsonNull
    is JsonElement -> value
    is String -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value)
    is Map<*, *> -> {
      val map = mutableMapOf<String, JsonElement>()
      for ((k, v) in value) {
        map[k.toString()] = anyToJsonElement(v)
      }
      JsonObject(map)
    }
    is List<*> -> {
      JsonArray(value.map { anyToJsonElement(it) })
    }
    else -> JsonPrimitive(value.toString())
  }
}

internal fun jsonElementToAny(element: JsonElement): Any? {
  return when (element) {
    is JsonNull -> null
    is JsonPrimitive -> {
      if (element.isString) element.content
      else if (element.booleanOrNull != null) element.booleanOrNull
      else if (element.longOrNull != null) element.longOrNull
      else if (element.doubleOrNull != null) element.doubleOrNull else element.content
    }
    is JsonObject -> element.mapValues { jsonElementToAny(it.value) }
    is JsonArray -> element.map { jsonElementToAny(it) }
  }
}

class CompileContext {
  val extraComponents = mutableListOf<JsonObject>()
  var inlineCounter: Int = 0
  var activeValuePath: Map<String, String>? = null
}

/**
 * Compilation engine for A2UI Express.
 *
 * Compiles A2UI Express plain-text DSL statements into standard A2UI v1.0 JSON messages.
 */
class ExpressCompiler(val catalog: A2uiCatalog, val version: String = "v1.0") {
  val helper = CatalogSchemaHelper(catalog)

  fun compile(
    dslText: String,
    surfaceId: String = "default_surface",
    catalogId: String = "",
    isFinal: Boolean = true,
    version: String? = null,
  ): JsonElement {
    val targetVersion = version ?: this.version
    val ctx = CompileContext()
    val hasSentinels = dslText.contains(A2uiConstants.A2UI_INFERENCE_OPEN_TAG)
    val lines = mutableListOf<String>()
    var insideA2ui = !hasSentinels

    for (line in dslText.lines()) {
      var trimmed = line.trim()
      var activeLine = line
      if (trimmed.contains(A2uiConstants.A2UI_INFERENCE_OPEN_TAG)) {
        insideA2ui = true
        activeLine = activeLine.replace(A2uiConstants.A2UI_INFERENCE_OPEN_TAG, "")
        trimmed = activeLine.trim()
      }
      if (trimmed.contains(A2uiConstants.A2UI_INFERENCE_CLOSE_TAG)) {
        insideA2ui = false
        activeLine = activeLine.split(A2uiConstants.A2UI_INFERENCE_CLOSE_TAG)[0]
        if (activeLine.trim().isNotEmpty()) {
          lines.add(activeLine)
        }
        continue
      }
      if (insideA2ui) {
        lines.add(activeLine)
      }
    }

    val dslBody = lines.joinToString("\n")
    val inputStream = CharStreams.fromString(dslBody)
    val lexer = ExpressLexer(inputStream)
    val errorListener = ExpressErrorListener()
    lexer.removeErrorListeners()
    lexer.addErrorListener(errorListener)

    val tokenStream = CommonTokenStream(lexer)
    val parser = ExpressParser(tokenStream)
    parser.removeErrorListeners()
    parser.addErrorListener(errorListener)

    val statements: List<Any?> =
      try {
        val tree = parser.program()
        if (isFinal && errorListener.errors.isNotEmpty()) {
          val first = errorListener.errors[0]
          throw A2uiParseException(
            "Syntax error at line ${first.line}:${first.charPositionInLine}: ${first.msg}"
          )
        }
        val firstErrLine =
          if (errorListener.errors.isNotEmpty()) errorListener.errors[0].line else null
        val visitor = ExpressAstVisitor(firstErrLine)
        @Suppress("UNCHECKED_CAST")
        visitor.visit(tree) as List<Any?>
      } catch (e: Exception) {
        if (!isFinal) {
          emptyList()
        } else {
          throw A2uiParseException("Failed to parse expression: ${e.message}", e)
        }
      }

    val rawSymbols = mutableMapOf<String, Any?>()
    val dataPathAssignments = mutableMapOf<String, Any?>()
    var targetDeleteSurfaceId: String? = null
    val standaloneFunctionCalls = mutableListOf<Map<String, Any?>>()

    for (stmt in statements) {
      if (stmt !is List<*>) continue
      val stmtType = stmt[0] as? String ?: continue
      if (stmtType == "ASSIGN") {
        val varName = stmt[1] as String
        val parsedVal = stmt[2]
        if (varName.startsWith("$")) {
          dataPathAssignments[varName] = parsedVal
        } else {
          rawSymbols[varName] = parsedVal
        }
      } else if (stmtType == "EXPR") {
        val parsedVal = stmt[1]
        if (parsedVal is Map<*, *>) {
          @Suppress("UNCHECKED_CAST") val mapVal = parsedVal as Map<String, Any?>
          if (mapVal["call"] == "deleteSurface") {
            val args = mapVal["args"] as? List<*>
            if (!args.isNullOrEmpty() && args[0] is String) {
              targetDeleteSurfaceId = args[0] as String
            }
          } else if (mapVal.containsKey("call")) {
            standaloneFunctionCalls.add(mapVal)
          }
        }
      }
    }

    val dataModel = mutableMapOf<String, Any?>()
    for ((pathName, astVal) in dataPathAssignments) {
      val compiledVal = compileValue(astVal, rawSymbols, ctx)
      setNestedPath(dataModel, pathName, jsonElementToAny(compiledVal))
    }

    if (targetDeleteSurfaceId != null) {
      return JsonObject(
        mapOf(
          "version" to JsonPrimitive(targetVersion),
          SurfaceOperation.DELETE to
            JsonObject(mapOf("surfaceId" to JsonPrimitive(targetDeleteSurfaceId))),
        )
      )
    }

    if (standaloneFunctionCalls.isNotEmpty()) {
      if (targetVersion == "v0.9" || targetVersion == "v0.9.1") {
        throw A2uiParseException(
          "Standalone function calls are not supported in A2UI $targetVersion"
        )
      }
      val firstCall = standaloneFunctionCalls[0]
      ctx.inlineCounter++
      val compiledVal = compileValue(firstCall, rawSymbols, ctx, isAction = false)
      val callObj = compiledVal as? JsonObject
      val fnName = callObj?.get("call")?.let { jsonElementToAny(it) }?.toString() ?: ""
      val fnArgs = callObj?.get("args") ?: JsonObject(emptyMap())

      return JsonObject(
        mapOf(
          "version" to JsonPrimitive(targetVersion),
          "functionCallId" to JsonPrimitive("call_${ctx.inlineCounter}"),
          SurfaceOperation.CALL_FUNC to
            JsonObject(mapOf("call" to JsonPrimitive(fnName), "args" to fnArgs)),
        )
      )
    }

    if (!rawSymbols.containsKey("root")) {
      if (dataPathAssignments.isNotEmpty()) {
        return JsonObject(
          mapOf(
            "version" to JsonPrimitive(targetVersion),
            SurfaceOperation.UPDATE_DATA to
              JsonObject(
                mapOf(
                  "surfaceId" to JsonPrimitive(surfaceId),
                  "path" to JsonPrimitive("/"),
                  "value" to anyToJsonElement(dataModel),
                )
              ),
          )
        )
      }
      throw A2uiParseException(
        "A2UI Express source must define a 'root' variable or have data model path assignments."
      )
    }

    val compiledComponents = mutableListOf<JsonObject>()
    for ((varName, ast) in rawSymbols) {
      val compDict = compileAstNode(varName, ast, rawSymbols, ctx)
      if (compDict != null) {
        compiledComponents.add(compDict)
      }
    }
    compiledComponents.addAll(ctx.extraComponents)

    val finalCatalogId = if (catalogId.isNotEmpty()) catalogId else catalog.catalogId

    if (targetVersion == "v0.9" || targetVersion == "v0.9.1") {
      val messages =
        mutableListOf<JsonElement>(
          JsonObject(
            mapOf(
              "version" to JsonPrimitive(targetVersion),
              SurfaceOperation.CREATE to
                JsonObject(
                  mapOf(
                    "surfaceId" to JsonPrimitive(surfaceId),
                    "catalogId" to JsonPrimitive(finalCatalogId),
                  )
                ),
            )
          ),
          JsonObject(
            mapOf(
              "version" to JsonPrimitive(targetVersion),
              "updateComponents" to
                JsonObject(
                  mapOf(
                    "surfaceId" to JsonPrimitive(surfaceId),
                    "components" to JsonArray(compiledComponents),
                  )
                ),
            )
          ),
        )
      if (dataModel.isNotEmpty()) {
        messages.add(
          JsonObject(
            mapOf(
              "version" to JsonPrimitive(targetVersion),
              SurfaceOperation.UPDATE_DATA to
                JsonObject(
                  mapOf(
                    "surfaceId" to JsonPrimitive(surfaceId),
                    "path" to JsonPrimitive("/"),
                    "value" to anyToJsonElement(dataModel),
                  )
                ),
            )
          )
        )
      }
      return JsonArray(messages)
    }

    val createMap =
      mutableMapOf<String, JsonElement>(
        "surfaceId" to JsonPrimitive(surfaceId),
        "catalogId" to JsonPrimitive(finalCatalogId),
        "components" to JsonArray(compiledComponents),
      )
    if (dataModel.isNotEmpty()) {
      createMap["dataModel"] = anyToJsonElement(dataModel)
    }

    return JsonObject(
      mapOf(
        "version" to JsonPrimitive(targetVersion),
        SurfaceOperation.CREATE to JsonObject(createMap),
      )
    )
  }

  private fun compileAstNode(
    varName: String,
    ast: Any?,
    rawSymbols: Map<String, Any?>,
    ctx: CompileContext,
  ): JsonObject? {
    if (ast !is Map<*, *>) return null
    @Suppress("UNCHECKED_CAST") val astMap = ast as Map<String, Any?>
    val compName = astMap["call"] as? String ?: return null
    if (!helper.components.containsKey(compName)) return null

    @Suppress("UNCHECKED_CAST") val positionalArgs = astMap["args"] as? List<Any?> ?: emptyList()
    @Suppress("UNCHECKED_CAST") val kwArgs = astMap["kwargs"] as? Map<String, Any?> ?: emptyMap()

    val properties = helper.getComponentProperties(compName)
    val compMap = mutableMapOf<String, JsonElement>()
    compMap["id"] = JsonPrimitive(varName)
    compMap["component"] = JsonPrimitive(compName)

    var siblingValuePath: Map<String, String>? = null
    val nonCheckProperties = properties.filter { it != "checks" }
    val rawChecks = mutableListOf<Any?>()

    var propIdx = 0
    for (arg in positionalArgs) {
      if (isCheckExpression(arg)) {
        if (arg is List<*>) {
          rawChecks.addAll(arg)
        } else {
          rawChecks.add(arg)
        }
        continue
      }

      if (propIdx < nonCheckProperties.size) {
        val propName = nonCheckProperties[propIdx]
        propIdx++

        if (arg is Map<*, *> && arg["skipped"] == true) {
          continue
        }

        val mappedVal =
          compileValue(
            arg,
            rawSymbols,
            ctx,
            isAction = (propName == "action" || propName == "submitAction"),
          )
        compMap[propName] = mappedVal

        if (propName == "value" && arg is Map<*, *> && arg.containsKey("path")) {
          @Suppress("UNCHECKED_CAST")
          siblingValuePath = arg as Map<String, String>
        }
      }
    }

    // Process named keyword arguments
    for ((kwKey, kwVal) in kwArgs) {
      if (kwKey == "checks" || isCheckExpression(kwVal)) {
        if (kwVal is List<*>) rawChecks.addAll(kwVal) else rawChecks.add(kwVal)
      } else {
        val mappedVal =
          compileValue(
            kwVal,
            rawSymbols,
            ctx,
            isAction = (kwKey == "action" || kwKey == "submitAction"),
          )
        compMap[kwKey] = mappedVal
      }
    }

    ctx.activeValuePath = siblingValuePath

    if (rawChecks.isNotEmpty()) {
      val compiledChecks = mutableListOf<JsonObject>()
      for (rc in rawChecks) {
        if (rc is Map<*, *> && rc.containsKey("check")) {
          val checkName = rc["check"] as String
          @Suppress("UNCHECKED_CAST") val checkArgs = rc["args"] as? List<Any?> ?: emptyList()
          val compiledArgs = mutableMapOf<String, JsonElement>()

          val checkProps = helper.getFunctionProperties(checkName)
          var messageVal = "${checkName.replaceFirstChar { it.uppercase() }} check failed"
          val isValueInjected: Boolean

          if (checkProps.isNotEmpty() && checkProps[0] == "value") {
            val firstArg = checkArgs.firstOrNull()
            if (firstArg is Map<*, *> && firstArg.containsKey("path")) {
              isValueInjected = false
            } else if (siblingValuePath != null) {
              compiledArgs["value"] = anyToJsonElement(siblingValuePath)
              isValueInjected = true
            } else {
              isValueInjected = false
            }
          } else {
            isValueInjected = false
          }

          val startPropIdx = if (isValueInjected) 1 else 0
          for ((cIdx, cArg) in checkArgs.withIndex()) {
            val propTargetIdx = cIdx + startPropIdx
            if (propTargetIdx < checkProps.size) {
              val pName = checkProps[propTargetIdx]
              if (cArg is Map<*, *> && cArg["skipped"] == true) continue
              compiledArgs[pName] = compileValue(cArg, rawSymbols, ctx)
            } else if (cArg is String) {
              messageVal = cArg
            }
          }

          compiledChecks.add(
            JsonObject(
              mapOf(
                "condition" to
                  JsonObject(
                    mapOf("call" to JsonPrimitive(checkName), "args" to JsonObject(compiledArgs))
                  ),
                "message" to JsonPrimitive(messageVal),
              )
            )
          )
        }
      }
      if (compiledChecks.isNotEmpty()) {
        compMap["checks"] = JsonArray(compiledChecks)
      }
    }

    ctx.activeValuePath = null
    return JsonObject(compMap)
  }

  private fun isCheckExpression(valItem: Any?): Boolean {
    if (valItem is Map<*, *> && valItem.containsKey("check")) return true
    if (valItem is List<*> && valItem.isNotEmpty()) {
      return valItem.all { isCheckExpression(it) }
    }
    return false
  }

  private fun compileValue(
    valItem: Any?,
    rawSymbols: Map<String, Any?>,
    ctx: CompileContext,
    isAction: Boolean = false,
  ): JsonElement {
    if (valItem is Map<*, *>) {
      if (valItem.containsKey("path")) {
        return anyToJsonElement(valItem)
      }
      if (valItem.containsKey("variable")) {
        val refName = valItem["variable"] as String
        if (rawSymbols.containsKey(refName)) {
          val symbolVal = rawSymbols[refName]
          if (symbolVal is Map<*, *> && helper.components.containsKey(symbolVal["call"])) {
            return JsonPrimitive(refName)
          }
          return compileValue(symbolVal, rawSymbols, ctx, isAction)
        }
        return JsonPrimitive(refName)
      }
      if (valItem.containsKey("check")) {
        val checkName = valItem["check"] as String
        @Suppress("UNCHECKED_CAST") val checkArgs = valItem["args"] as? List<Any?> ?: emptyList()
        val compiledArgs = mutableMapOf<String, JsonElement>()
        val checkProps = helper.getFunctionProperties(checkName)

        val isValueInjected =
          checkProps.isNotEmpty() &&
            checkProps[0] == "value" &&
            (checkArgs.isEmpty() ||
              checkArgs[0] !is Map<*, *> ||
              !(checkArgs[0] as Map<*, *>).containsKey("path")) &&
            ctx.activeValuePath != null

        if (isValueInjected) {
          compiledArgs["value"] = anyToJsonElement(ctx.activeValuePath)
        }

        val startPropIdx = if (isValueInjected) 1 else 0
        for ((cIdx, cArg) in checkArgs.withIndex()) {
          val propTargetIdx = cIdx + startPropIdx
          if (propTargetIdx < checkProps.size) {
            val pName = checkProps[propTargetIdx]
            if (cArg is Map<*, *> && cArg["skipped"] == true) continue
            compiledArgs[pName] = compileValue(cArg, rawSymbols, ctx, isAction)
          }
        }

        return JsonObject(
          mapOf("call" to JsonPrimitive(checkName), "args" to JsonObject(compiledArgs))
        )
      }
      if (valItem.containsKey("call")) {
        val fnName = valItem["call"] as String
        @Suppress("UNCHECKED_CAST") val fnArgs = valItem["args"] as? List<Any?> ?: emptyList()

        if (helper.components.containsKey(fnName)) {
          ctx.inlineCounter++
          val inlineId = "_inline_${ctx.inlineCounter}"
          val compiledInline = compileAstNode(inlineId, valItem, rawSymbols, ctx)
          if (compiledInline != null) {
            ctx.extraComponents.add(compiledInline)
          }
          return JsonPrimitive(inlineId)
        }

        if (fnName == "_template") {
          if (fnArgs.size < 2) {
            throw A2uiParseException(
              "_template helper requires 2 arguments: path and templateComponent."
            )
          }
          val pathVal = compileValue(fnArgs[0], rawSymbols, ctx, isAction)
          val compIdVal = compileValue(fnArgs[1], rawSymbols, ctx, isAction)

          val pathStr =
            (pathVal as? JsonObject)?.get("path")?.let { jsonElementToAny(it) }?.toString() ?: ""
          val compIdStr = (compIdVal as? JsonPrimitive)?.content ?: compIdVal.toString()

          return JsonObject(
            mapOf("path" to JsonPrimitive(pathStr), "componentId" to JsonPrimitive(compIdStr))
          )
        }

        if (fnName == "Event") {
          val compiledEvtName =
            if (fnArgs.isNotEmpty()) {
              (compileValue(fnArgs[0], rawSymbols, ctx, isAction) as? JsonPrimitive)?.content ?: ""
            } else ""

          val rawContext =
            if (fnArgs.size > 1) {
              jsonElementToAny(compileValue(fnArgs[1], rawSymbols, ctx, isAction))
            } else emptyMap<String, Any?>()

          val compiledContext = mutableMapOf<String, Any?>()
          if (rawContext is Map<*, *>) {
            @Suppress("UNCHECKED_CAST") compiledContext.putAll(rawContext as Map<String, Any?>)
          } else if (rawContext is List<*>) {
            for (item in rawContext) {
              if (item is Map<*, *>) {
                @Suppress("UNCHECKED_CAST") compiledContext.putAll(item as Map<String, Any?>)
              }
            }
          }

          return JsonObject(
            mapOf(
              "event" to
                JsonObject(
                  mapOf(
                    "name" to JsonPrimitive(compiledEvtName),
                    "context" to anyToJsonElement(compiledContext),
                  )
                )
            )
          )
        }

        if (helper.functions.containsKey(fnName)) {
          val fnProps = helper.getFunctionProperties(fnName)
          val compiledArgs = mutableMapOf<String, JsonElement>()

          for ((idx, arg) in fnArgs.withIndex()) {
            if (idx < fnProps.size) {
              if (arg is Map<*, *> && arg["skipped"] == true) continue
              val valElem = compileValue(arg, rawSymbols, ctx, isAction)
              compiledArgs[fnProps[idx]] = valElem
            }
          }

          if (isAction) {
            return JsonObject(
              mapOf(
                "functionCall" to
                  JsonObject(
                    mapOf("call" to JsonPrimitive(fnName), "args" to JsonObject(compiledArgs))
                  )
              )
            )
          }

          return JsonObject(
            mapOf("call" to JsonPrimitive(fnName), "args" to JsonObject(compiledArgs))
          )
        }

        val compiledArgsList = fnArgs.map { compileValue(it, rawSymbols, ctx, isAction) }
        return JsonObject(
          mapOf("call" to JsonPrimitive(fnName), "args" to JsonArray(compiledArgsList))
        )
      }

      val compiledMap = mutableMapOf<String, JsonElement>()
      for ((k, v) in valItem) {
        compiledMap[k.toString()] = compileValue(v, rawSymbols, ctx, isAction)
      }
      return JsonObject(compiledMap)
    }

    if (valItem is List<*>) {
      return JsonArray(valItem.map { compileValue(it, rawSymbols, ctx, isAction) })
    }

    return anyToJsonElement(valItem)
  }
}
