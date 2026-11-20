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

package com.google.a2ui.core.schema

import com.google.a2ui.core.common.A2uiMetadata
import com.google.a2ui.core.common.ProtocolVersion
import com.google.a2ui.core.exceptions.A2uiValidationError
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/** Common types defined in `specification/v1_0/json/common_types.json`. */
data class FunctionCall(
  val call: String,
  val catalogId: String? = null,
  val args: JsonObject? = null,
) {
  fun toJsonObject(): JsonObject =
    JsonObject(
      buildMap {
        put("@call", JsonPrimitive(call))
        if (catalogId != null) put("catalogId", JsonPrimitive(catalogId))
        if (args != null) put("args", args)
      }
    )

  companion object {
    fun fromJsonObject(json: JsonObject): FunctionCall {
      val unknown = json.keys - setOf("@call", "catalogId", "args")
      if (unknown.isNotEmpty()) {
        throw A2uiValidationError("FunctionCall has unexpected field(s): $unknown")
      }
      val call =
        (json["@call"] as? JsonPrimitive)?.takeIf { it.isString }?.content
          ?: throw A2uiValidationError("FunctionCall requires string '@call'")
      val catalogId =
        when (val rawCat = json["catalogId"]) {
          null -> null
          is JsonPrimitive ->
            if (rawCat.isString) rawCat.content
            else throw A2uiValidationError("FunctionCall 'catalogId' must be a string")
          else -> throw A2uiValidationError("FunctionCall 'catalogId' must be a string")
        }
      val args =
        when (val rawArgs = json["args"]) {
          null -> null
          is JsonObject -> rawArgs
          else -> throw A2uiValidationError("FunctionCall 'args' must be a JSON object")
        }
      return FunctionCall(call = call, catalogId = catalogId, args = args)
    }
  }
}

data class FunctionError(val code: String, val message: String)

/**
 * Matches `common_types.json#/$defs/FunctionResponse`.
 *
 * Distinguishes an explicit `value = JsonNull` from an unset `value` (`hasValue`) so `null` return
 * values survive wire serialization (`agent_functions.blueprint.md` §6).
 */
data class FunctionResponse(
  val functionCallId: String,
  val value: JsonElement? = null,
  val hasValue: Boolean = false,
  val error: FunctionError? = null,
) {
  init {
    if (hasValue == (error != null)) {
      throw A2uiValidationError(
        "FunctionResponse '$functionCallId' must specify exactly one of 'value' or 'error'"
      )
    }
  }

  fun toJsonObject(): JsonObject =
    JsonObject(
      buildMap {
        put("functionCallId", JsonPrimitive(functionCallId))
        if (hasValue) {
          put("value", value ?: JsonNull)
        }
        if (error != null) {
          put(
            "error",
            JsonObject(
              mapOf("code" to JsonPrimitive(error.code), "message" to JsonPrimitive(error.message))
            ),
          )
        }
      }
    )

  companion object {
    fun success(functionCallId: String, value: JsonElement): FunctionResponse =
      FunctionResponse(functionCallId = functionCallId, value = value, hasValue = true)

    fun failure(functionCallId: String, code: String, message: String): FunctionResponse =
      FunctionResponse(
        functionCallId = functionCallId,
        hasValue = false,
        error = FunctionError(code = code, message = message),
      )

    fun fromJsonObject(json: JsonObject): FunctionResponse {
      val unknown = json.keys - setOf("functionCallId", "value", "error")
      if (unknown.isNotEmpty()) {
        throw A2uiValidationError("FunctionResponse has unexpected field(s): $unknown")
      }
      val id =
        (json["functionCallId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
          ?: throw A2uiValidationError("FunctionResponse requires string 'functionCallId'")
      val containsVal = "value" in json
      val errObj =
        when (val rawErr = json["error"]) {
          null -> null
          is JsonObject -> rawErr
          else -> throw A2uiValidationError("FunctionResponse 'error' must be a JSON object")
        }
      val error =
        errObj?.let {
          val errUnknown = it.keys - setOf("code", "message")
          if (errUnknown.isNotEmpty()) {
            throw A2uiValidationError("FunctionResponse.error has unexpected field(s): $errUnknown")
          }
          val code =
            (it["code"] as? JsonPrimitive)?.takeIf { p -> p.isString }?.content
              ?: throw A2uiValidationError("FunctionResponse.error requires string 'code'")
          val msg =
            (it["message"] as? JsonPrimitive)?.takeIf { p -> p.isString }?.content
              ?: throw A2uiValidationError("FunctionResponse.error requires string 'message'")
          FunctionError(code, msg)
        }
      return FunctionResponse(
        functionCallId = id,
        value = json["value"],
        hasValue = containsVal,
        error = error,
      )
    }
  }
}

/** Strongly-typed inbound envelopes (`specification/v1_0/json/agent_to_renderer.json`). */
sealed interface AgentToRendererMessage {
  val version: ProtocolVersion

  fun toJsonObject(): JsonObject

  companion object {
    private val V1_ACTION_KEYS =
      setOf(
        "createSurface",
        "updateComponents",
        "updateDataModel",
        "deleteSurface",
        "callRendererFunction",
        "agentFunctionResponse",
      )
    private val CREATE_SURFACE_KEYS =
      setOf("surfaceId", "catalogId", "sendDataModel", "components", "dataModel", "metadata")
    private val UPDATE_COMPONENTS_KEYS = setOf("surfaceId", "components")
    private val UPDATE_DATA_MODEL_KEYS = setOf("surfaceId", "path", "value")
    private val DELETE_SURFACE_KEYS = setOf("surfaceId")
    private val CALL_RENDERER_FUNCTION_KEYS = setOf("surfaceId", "functionCallId", "callFunction")

    /**
     * Parses and validates a single v1.0 envelope without requiring a catalog (`blueprint` §3.C).
     */
    fun fromJsonObject(json: JsonObject): AgentToRendererMessage {
      val rawVersion =
        (json["version"] as? JsonPrimitive)?.takeIf { it.isString }?.content
          ?: throw A2uiValidationError("Missing required string 'version' on message envelope")
      if (rawVersion != ProtocolVersion.V1_0.wireTag) {
        throw A2uiValidationError("Expected envelope version '1.0', got '$rawVersion'")
      }
      val actionKeys = json.keys.filter { it != "version" }
      if (actionKeys.size != 1 || actionKeys.single() !in V1_ACTION_KEYS) {
        throw A2uiValidationError(
          "Envelope must contain 'version' and exactly one v1.0 action key; got keys=${json.keys}"
        )
      }
      return when (val key = actionKeys.single()) {
        "createSurface" -> {
          val body = expectObject(json[key], "createSurface")
          checkAllowedKeys(body, CREATE_SURFACE_KEYS, "createSurface")
          val surfaceId = expectString(body, "surfaceId")
          val catalogId = optionalString(body, "catalogId")
          val sendDataModel =
            body["sendDataModel"]?.let {
              (it as? JsonPrimitive)?.booleanOrNull
                ?: throw A2uiValidationError("'sendDataModel' must be a boolean")
            } ?: false
          val components =
            body["components"]?.let { raw ->
              val arr =
                raw as? JsonArray
                  ?: throw A2uiValidationError("'createSurface.components' must be an array")
              if (arr.isEmpty()) {
                throw A2uiValidationError("'createSurface.components' must be non-empty")
              }
              arr.map { elem -> expectObject(elem, "component") }
            }
          val dataModel = body["dataModel"]?.let { expectObject(it, "createSurface.dataModel") }
          val metadata =
            body["metadata"]?.let { A2uiMetadata.fromJsonObject(expectObject(it, "metadata")) }
          CreateSurfaceMessage(
            surfaceId = surfaceId,
            catalogId = catalogId,
            sendDataModel = sendDataModel,
            components = components,
            dataModel = dataModel,
            metadata = metadata,
          )
        }
        "updateComponents" -> {
          val body = expectObject(json[key], "updateComponents")
          checkAllowedKeys(body, UPDATE_COMPONENTS_KEYS, "updateComponents")
          val surfaceId = expectString(body, "surfaceId")
          val arr =
            body["components"] as? JsonArray
              ?: throw A2uiValidationError("'updateComponents.components' must be an array")
          if (arr.isEmpty()) {
            throw A2uiValidationError("'updateComponents.components' must be non-empty")
          }
          UpdateComponentsMessage(
            surfaceId = surfaceId,
            components = arr.map { expectObject(it, "component") },
          )
        }
        "updateDataModel" -> {
          val body = expectObject(json[key], "updateDataModel")
          checkAllowedKeys(body, UPDATE_DATA_MODEL_KEYS, "updateDataModel")
          val surfaceId = expectString(body, "surfaceId")
          if ("value" !in body) {
            throw A2uiValidationError("'updateDataModel' requires 'value'")
          }
          UpdateDataModelMessage(
            surfaceId = surfaceId,
            value = body.getValue("value"),
            path = optionalString(body, "path"),
          )
        }
        "deleteSurface" -> {
          val body = expectObject(json[key], "deleteSurface")
          checkAllowedKeys(body, DELETE_SURFACE_KEYS, "deleteSurface")
          DeleteSurfaceMessage(surfaceId = expectString(body, "surfaceId"))
        }
        "callRendererFunction" -> {
          val body = expectObject(json[key], "callRendererFunction")
          checkAllowedKeys(body, CALL_RENDERER_FUNCTION_KEYS, "callRendererFunction")
          val fnCall =
            FunctionCall.fromJsonObject(expectObject(body["callFunction"], "callFunction"))
          if (fnCall.catalogId.isNullOrEmpty()) {
            throw A2uiValidationError("'callRendererFunction.callFunction.catalogId' is required")
          }
          val functionCallId = expectString(body, "functionCallId")
          if (functionCallId.isEmpty()) {
            throw A2uiValidationError("'callRendererFunction.functionCallId' must be non-empty")
          }
          CallRendererFunctionMessage(
            functionCallId = functionCallId,
            callFunction = fnCall,
            surfaceId = optionalString(body, "surfaceId"),
          )
        }
        "agentFunctionResponse" ->
          AgentFunctionResponseMessage(
            response = FunctionResponse.fromJsonObject(expectObject(json[key], key))
          )
        else -> throw A2uiValidationError("Unsupported action key: '$key'")
      }
    }

    private fun expectObject(elem: JsonElement?, name: String): JsonObject =
      elem as? JsonObject ?: throw A2uiValidationError("Expected '$name' to be a JSON object")

    private fun expectString(obj: JsonObject, key: String): String =
      (obj[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?: throw A2uiValidationError("Expected required string '$key'")

    private fun optionalString(obj: JsonObject, key: String): String? =
      when (val elem = obj[key]) {
        null,
        is JsonNull -> null
        is JsonPrimitive ->
          if (elem.isString) elem.content
          else throw A2uiValidationError("Expected '$key' to be a string")
        else -> throw A2uiValidationError("Expected '$key' to be a string")
      }

    private fun checkAllowedKeys(obj: JsonObject, allowed: Set<String>, label: String) {
      val unknown = obj.keys - allowed
      if (unknown.isNotEmpty()) {
        throw A2uiValidationError("Unexpected property(s) ${unknown.sorted()} in '$label'")
      }
    }
  }
}

data class CreateSurfaceMessage(
  val surfaceId: String,
  val catalogId: String? = null,
  val sendDataModel: Boolean = false,
  val components: List<JsonObject>? = null,
  val dataModel: JsonObject? = null,
  val metadata: A2uiMetadata? = null,
  override val version: ProtocolVersion = ProtocolVersion.V1_0,
) : AgentToRendererMessage {
  override fun toJsonObject(): JsonObject =
    JsonObject(
      mapOf(
        "version" to JsonPrimitive(version.wireTag),
        "createSurface" to
          JsonObject(
            buildMap {
              put("surfaceId", JsonPrimitive(surfaceId))
              if (catalogId != null) put("catalogId", JsonPrimitive(catalogId))
              if (sendDataModel) put("sendDataModel", JsonPrimitive(true))
              if (components != null) put("components", JsonArray(components))
              if (dataModel != null) put("dataModel", dataModel)
              if (metadata != null) put("metadata", metadata.toJsonObject())
            }
          ),
      )
    )
}

data class UpdateComponentsMessage(
  val surfaceId: String,
  val components: List<JsonObject>,
  override val version: ProtocolVersion = ProtocolVersion.V1_0,
) : AgentToRendererMessage {
  override fun toJsonObject(): JsonObject =
    JsonObject(
      mapOf(
        "version" to JsonPrimitive(version.wireTag),
        "updateComponents" to
          JsonObject(
            mapOf("surfaceId" to JsonPrimitive(surfaceId), "components" to JsonArray(components))
          ),
      )
    )
}

data class UpdateDataModelMessage(
  val surfaceId: String,
  val value: JsonElement,
  val path: String? = null,
  override val version: ProtocolVersion = ProtocolVersion.V1_0,
) : AgentToRendererMessage {
  override fun toJsonObject(): JsonObject =
    JsonObject(
      mapOf(
        "version" to JsonPrimitive(version.wireTag),
        "updateDataModel" to
          JsonObject(
            buildMap {
              put("surfaceId", JsonPrimitive(surfaceId))
              if (path != null) put("path", JsonPrimitive(path))
              put("value", value)
            }
          ),
      )
    )
}

data class DeleteSurfaceMessage(
  val surfaceId: String,
  override val version: ProtocolVersion = ProtocolVersion.V1_0,
) : AgentToRendererMessage {
  override fun toJsonObject(): JsonObject =
    JsonObject(
      mapOf(
        "version" to JsonPrimitive(version.wireTag),
        "deleteSurface" to JsonObject(mapOf("surfaceId" to JsonPrimitive(surfaceId))),
      )
    )
}

data class CallRendererFunctionMessage(
  val functionCallId: String,
  val callFunction: FunctionCall,
  val surfaceId: String? = null,
  override val version: ProtocolVersion = ProtocolVersion.V1_0,
) : AgentToRendererMessage {
  override fun toJsonObject(): JsonObject =
    JsonObject(
      mapOf(
        "version" to JsonPrimitive(version.wireTag),
        "callRendererFunction" to
          JsonObject(
            buildMap {
              if (surfaceId != null) put("surfaceId", JsonPrimitive(surfaceId))
              put("functionCallId", JsonPrimitive(functionCallId))
              put("callFunction", callFunction.toJsonObject())
            }
          ),
      )
    )
}

data class AgentFunctionResponseMessage(
  val response: FunctionResponse,
  override val version: ProtocolVersion = ProtocolVersion.V1_0,
) : AgentToRendererMessage {
  override fun toJsonObject(): JsonObject =
    JsonObject(
      mapOf(
        "version" to JsonPrimitive(version.wireTag),
        "agentFunctionResponse" to response.toJsonObject(),
      )
    )
}
