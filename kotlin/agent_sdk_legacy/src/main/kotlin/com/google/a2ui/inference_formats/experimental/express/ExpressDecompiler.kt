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

import com.google.a2ui.inference_formats.experimental.express.constants.SurfaceOperation
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiConstants
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

private val IDENTIFIER_REGEX = Regex("^[a-zA-Z_][a-zA-Z0-9_]*$")

internal fun flattenDataModel(dataMap: JsonObject): List<Pair<String, JsonElement>> {
  val results = mutableListOf<Pair<String, JsonElement>>()

  fun recurse(current: JsonElement, path: String) {
    if (current is JsonObject && current.isNotEmpty()) {
      for ((k, v) in current) {
        recurse(v, "$path/$k")
      }
    } else {
      results.add(Pair(path, current))
    }
  }

  recurse(dataMap, "")
  return results
}

internal fun decompileString(valStr: String): String {
  val hasNewline = "\n" in valStr || "\r" in valStr
  val hasTab = "\t" in valStr
  val hasQuote = '"' in valStr
  val hasBackslash = "\\" in valStr

  if ((hasQuote || hasNewline) && !valStr.endsWith('"')) {
    if ("\"\"\"" !in valStr) {
      if (hasBackslash && !hasTab) {
        return "r\"\"\"$valStr\"\"\""
      }
      val escaped = valStr.replace("\\", "\\\\").replace("\t", "\\t")
      return "\"\"\"$escaped\"\"\""
    }
  }

  if (hasBackslash && !hasNewline && !hasTab && !hasQuote) {
    return "r\"$valStr\""
  }

  val escaped =
    valStr
      .replace("\\", "\\\\")
      .replace("\"", "\\\"")
      .replace("\n", "\\n")
      .replace("\r", "\\r")
      .replace("\t", "\\t")
  return "\"$escaped\""
}

/**
 * Decompilation engine for A2UI Express.
 *
 * Reconstructs standard A2UI v1.0 JSON envelopes back into plain-text Express DSL code.
 */
class ExpressDecompiler(val catalog: A2uiCatalog) {
  val helper = CatalogSchemaHelper(catalog)

  fun wrapDecompiledBlocks(blocks: List<String>): String {
    val fullDsl = blocks.joinToString("\n")
    return "${A2uiConstants.A2UI_INFERENCE_OPEN_TAG}\n$fullDsl\n${A2uiConstants.A2UI_INFERENCE_CLOSE_TAG}"
  }

  fun decompile(envelopeJson: JsonObject): String {
    if (envelopeJson.containsKey(SurfaceOperation.DELETE)) {
      val surfOp = envelopeJson[SurfaceOperation.DELETE] as? JsonObject
      val surfaceId = (surfOp?.get("surfaceId") as? JsonPrimitive)?.content ?: ""
      return "deleteSurface(\"$surfaceId\")"
    }

    if (envelopeJson.containsKey(SurfaceOperation.UPDATE_DATA)) {
      val valOp = envelopeJson[SurfaceOperation.UPDATE_DATA] as? JsonObject
      val dataVal = valOp?.get("value") as? JsonObject ?: JsonObject(emptyMap())
      val dslLines = mutableListOf<String>()
      if (dataVal.isNotEmpty()) {
        for ((path, valElement) in flattenDataModel(dataVal).sortedBy { it.first }) {
          val valStr = decompileValue(valElement, emptySet())
          dslLines.add("$$path = $valStr")
        }
      }
      return dslLines.joinToString("\n")
    }

    if (envelopeJson.containsKey(SurfaceOperation.CALL_FUNC)) {
      val funcOp = envelopeJson[SurfaceOperation.CALL_FUNC] as? JsonObject
      val fnName = (funcOp?.get("call") as? JsonPrimitive)?.content ?: ""
      val fnArgs = funcOp?.get("args")
      val argsList = mutableListOf<String>()

      if (helper.functions.containsKey(fnName)) {
        val fnProps = helper.getFunctionProperties(fnName)
        if (fnArgs is JsonObject) {
          for (propName in fnProps) {
            if (fnArgs.containsKey(propName)) {
              argsList.add(decompileValue(fnArgs[propName]!!, emptySet()))
            } else {
              argsList.add("_")
            }
          }
        } else if (fnArgs is JsonArray) {
          for ((idx, propName) in fnProps.withIndex()) {
            if (idx < fnArgs.size) {
              argsList.add(decompileValue(fnArgs[idx], emptySet()))
            } else {
              argsList.add("_")
            }
          }
        }
      } else {
        if (fnArgs is JsonObject) {
          for (v in fnArgs.values) {
            argsList.add(decompileValue(v, emptySet()))
          }
        } else if (fnArgs is JsonArray) {
          for (v in fnArgs) {
            argsList.add(decompileValue(v, emptySet()))
          }
        }
      }

      while (argsList.isNotEmpty() && argsList.last() == "_") {
        argsList.removeAt(argsList.size - 1)
      }
      return "$fnName(${argsList.joinToString(", ")})"
    }

    val createSurface =
      envelopeJson[SurfaceOperation.CREATE] as? JsonObject ?: JsonObject(emptyMap())
    val components = (createSurface["components"] as? JsonArray) ?: JsonArray(emptyList())
    val dataModel = createSurface["dataModel"] as? JsonObject ?: JsonObject(emptyMap())

    val dslLines = mutableListOf<String>()
    val compIds =
      components.mapNotNull { ((it as? JsonObject)?.get("id") as? JsonPrimitive)?.content }.toSet()

    if (dataModel.isNotEmpty()) {
      for ((path, valElement) in flattenDataModel(dataModel).sortedBy { it.first }) {
        val valStr = decompileValue(valElement, compIds)
        dslLines.add("$$path = $valStr")
      }
    }

    for (compElem in components) {
      val c = compElem as? JsonObject ?: continue
      val compId = (c["id"] as? JsonPrimitive)?.content ?: continue
      val compName = (c["component"] as? JsonPrimitive)?.content ?: continue
      if (!helper.components.containsKey(compName)) continue

      val properties = helper.getComponentProperties(compName)
      val argsReprs = mutableListOf<String>()

      for (propName in properties) {
        if (propName == "checks") {
          val checksVal = (c["checks"] as? JsonArray) ?: JsonArray(emptyList())
          if (checksVal.isEmpty()) {
            argsReprs.add("_")
            continue
          }

          val compiledChecksList = mutableListOf<String>()
          for (rcElem in checksVal) {
            val rc = rcElem as? JsonObject ?: continue
            val condition = rc["condition"] as? JsonObject ?: JsonObject(emptyMap())
            val message = (rc["message"] as? JsonPrimitive)?.content ?: ""

            val checkName = (condition["call"] as? JsonPrimitive)?.content ?: ""
            val checkArgs = condition["args"] as? JsonObject ?: JsonObject(emptyMap())
            val checkProps = helper.getFunctionProperties(checkName)
            val explicitArgsReprs = mutableListOf<String>()

            val startIdx = if (checkProps.isNotEmpty() && checkProps[0] == "value") 1 else 0
            for (idx in startIdx until checkProps.size) {
              val p = checkProps[idx]
              if (checkArgs.containsKey(p)) {
                explicitArgsReprs.add(decompileValue(checkArgs[p]!!, compIds))
              }
            }

            if (
              checkName.isNotEmpty() &&
                message.isNotEmpty() &&
                message != "${checkName.replaceFirstChar { it.uppercase() }} check failed"
            ) {
              explicitArgsReprs.add(decompileString(message))
            }

            if (explicitArgsReprs.isNotEmpty()) {
              compiledChecksList.add("?$checkName(${explicitArgsReprs.joinToString(", ")})")
            } else {
              compiledChecksList.add("?$checkName")
            }
          }

          if (compiledChecksList.size == 1) {
            argsReprs.add(compiledChecksList[0])
          } else {
            argsReprs.add("[${compiledChecksList.joinToString(", ")}]")
          }
          continue
        }

        if (c.containsKey(propName)) {
          val valElement = c[propName]!!
          argsReprs.add(decompileValue(valElement, compIds))
        } else {
          val idx = properties.indexOf(propName)
          var hasSubsequentVal = false
          for (p in properties.drop(idx + 1)) {
            if (p != "checks" && c.containsKey(p)) {
              hasSubsequentVal = true
              break
            }
          }
          if (hasSubsequentVal) {
            argsReprs.add("_")
          }
        }
      }

      while (argsReprs.isNotEmpty() && argsReprs.last() == "_") {
        argsReprs.removeAt(argsReprs.size - 1)
      }

      dslLines.add("$compId = $compName(${argsReprs.joinToString(", ")})")
    }

    return dslLines.joinToString("\n")
  }

  private fun decompileValue(valElement: JsonElement, compIds: Set<String>): String {
    when (valElement) {
      is JsonObject -> {
        if (valElement.containsKey("path")) {
          if (valElement.containsKey("componentId")) {
            val pathRepr =
              decompileValue(JsonObject(mapOf("path" to valElement["path"]!!)), compIds)
            val compIdRepr = (valElement["componentId"] as? JsonPrimitive)?.content ?: ""
            return "_template($pathRepr, $compIdRepr)"
          }
          val pathStr = (valElement["path"] as? JsonPrimitive)?.content ?: ""
          return if (pathStr.startsWith("/")) "$/$pathStr" else "$$pathStr"
        }

        if (valElement.containsKey("event")) {
          val evt = valElement["event"] as? JsonObject ?: JsonObject(emptyMap())
          val name = (evt["name"] as? JsonPrimitive)?.content ?: ""
          val ctx = evt["context"] as? JsonObject ?: JsonObject(emptyMap())
          val ctxReprs = mutableListOf<String>()
          for ((k, v) in ctx) {
            ctxReprs.add("$k: ${decompileValue(v, compIds)}")
          }
          return if (ctxReprs.isNotEmpty()) {
            "Event(\"$name\", {${ctxReprs.joinToString(", ")}})"
          } else {
            "Event(\"$name\")"
          }
        }

        if (valElement.containsKey("functionCall")) {
          val fn = valElement["functionCall"] as? JsonObject ?: JsonObject(emptyMap())
          val name = (fn["call"] as? JsonPrimitive)?.content ?: ""
          val args = fn["args"] as? JsonObject ?: JsonObject(emptyMap())
          val fnProps = helper.getFunctionProperties(name)
          val argsReprs = mutableListOf<String>()

          for (p in fnProps) {
            if (args.containsKey(p)) {
              argsReprs.add(decompileValue(args[p]!!, compIds))
            } else {
              argsReprs.add("_")
            }
          }
          while (argsReprs.isNotEmpty() && argsReprs.last() == "_") {
            argsReprs.removeAt(argsReprs.size - 1)
          }
          return "$name(${argsReprs.joinToString(", ")})"
        }

        if (valElement.containsKey("call")) {
          val name = (valElement["call"] as? JsonPrimitive)?.content ?: ""
          val args = valElement["args"]
          val argsReprs = mutableListOf<String>()

          if (helper.functions.containsKey(name)) {
            val fnProps = helper.getFunctionProperties(name)
            for (p in fnProps) {
              if (args is JsonObject && args.containsKey(p)) {
                argsReprs.add(decompileValue(args[p]!!, compIds))
              } else {
                argsReprs.add("_")
              }
            }
          } else {
            if (args is JsonArray) {
              for (v in args) {
                argsReprs.add(decompileValue(v, compIds))
              }
            } else if (args is JsonObject) {
              for (v in args.values) {
                argsReprs.add(decompileValue(v, compIds))
              }
            }
          }

          while (argsReprs.isNotEmpty() && argsReprs.last() == "_") {
            argsReprs.removeAt(argsReprs.size - 1)
          }
          return "$name(${argsReprs.joinToString(", ")})"
        }

        val itemsReprs = mutableListOf<String>()
        for ((k, v) in valElement) {
          val isIdentifier =
            k.isNotEmpty() &&
              (k[0].isLetter() || k[0] == '_') &&
              k.all { it.isLetterOrDigit() || it == '_' }
          val kRepr = if (isIdentifier) k else decompileString(k)
          itemsReprs.add("$kRepr: ${decompileValue(v, compIds)}")
        }
        return "{${itemsReprs.joinToString(", ")}}"
      }

      is JsonArray -> {
        val listReprs = valElement.map { decompileValue(it, compIds) }
        return "[${listReprs.joinToString(", ")}]"
      }

      is JsonPrimitive -> {
        if (valElement.isString) {
          val strVal = valElement.content
          if (strVal in compIds) return strVal
          return decompileString(strVal)
        }
        if (valElement.booleanOrNull != null) {
          return if (valElement.booleanOrNull == true) "true" else "false"
        }
        return valElement.content
      }

      is JsonNull -> return "null"
    }
  }
}
