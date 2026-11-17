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

package com.google.a2ui.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * Strongly typed representation of an A2UI v1.0 agent-to-renderer wire message
 * (`specification/v1_0/json/agent_to_renderer.json`).
 */
sealed interface AgentToRendererMessage {
  val version: String

  /** Serializes this message to its canonical A2UI v1.0 wire [JsonObject]. */
  fun toJsonObject(): JsonObject

  companion object {
    private val CREATE_SURFACE_KEYS =
      setOf("surfaceId", "catalogId", "sendDataModel", "components", "dataModel", "metadata")
    private val UPDATE_COMPONENTS_KEYS = setOf("surfaceId", "components")
    private val UPDATE_DATA_MODEL_KEYS = setOf("surfaceId", "path", "value")
    private val DELETE_SURFACE_KEYS = setOf("surfaceId")
    private val CALL_RENDERER_FUNCTION_KEYS = setOf("surfaceId", "functionCallId", "callFunction")
    private val AGENT_FUNCTION_RESPONSE_KEYS = setOf("functionCallId", "value", "error")
    private val FUNCTION_ERROR_KEYS = setOf("code", "message")

    /**
     * Parses a wire [JsonObject] into an [AgentToRendererMessage].
     *
     * When [strict] is `true`, validates exact v1.0 envelope fields and version `"1.0"`. When
     * `false` (used by decompiler input normalization), tolerates omitted optional fields while
     * preserving structure.
     */
    fun fromJsonObject(json: JsonObject, strict: Boolean = true): AgentToRendererMessage {
      val versionPrim = json["version"] as? JsonPrimitive
      val version =
        if (versionPrim != null && versionPrim.isString) {
          versionPrim.content
        } else if (!strict) {
          ProtocolVersion.V1_0.value
        } else {
          throw A2uiValidationError("A2UI message must declare string 'version' == '1.0'.")
        }
      if (strict && version != ProtocolVersion.V1_0.value) {
        throw A2uiValidationError("Expected A2UI protocol version '1.0', got '$version'.")
      }

      val opKeys = json.keys.filter { it != "version" }
      if (strict && opKeys.size != 1) {
        throw A2uiValidationError(
          "A2UI message must contain 'version' and exactly one operation key, got: ${json.keys}."
        )
      }

      return when {
        "createSurface" in json -> parseCreateSurface(json, version, strict)
        "updateComponents" in json -> parseUpdateComponents(json, version, strict)
        "updateDataModel" in json -> parseUpdateDataModel(json, version, strict)
        "deleteSurface" in json -> parseDeleteSurface(json, version, strict)
        "callRendererFunction" in json -> parseCallRendererFunction(json, version, strict)
        "agentFunctionResponse" in json -> parseAgentFunctionResponse(json, version, strict)
        else ->
          throw A2uiValidationError("Unrecognized A2UI message operation in keys: ${json.keys}.")
      }
    }

    private fun parseCreateSurface(
      json: JsonObject,
      version: String,
      strict: Boolean,
    ): CreateSurfaceMessage {
      val body = requireObject(json["createSurface"], "createSurface")
      if (strict) checkAllowedKeys(body, CREATE_SURFACE_KEYS, "createSurface")
      val surfaceId =
        requireString(body["surfaceId"], "createSurface.surfaceId", allowMissing = !strict)
      val catalogId = optionalString(body["catalogId"], "createSurface.catalogId")
      val sendDataModel = optionalBoolean(body["sendDataModel"], "createSurface.sendDataModel")
      val components =
        body["components"]?.let { raw ->
          val arr =
            raw as? JsonArray
              ?: throw A2uiValidationError("'createSurface.components' must be an array.")
          if (strict && arr.isEmpty()) {
            throw A2uiValidationError("'createSurface.components' must be non-empty.")
          }
          arr.map {
            it as? JsonObject
              ?: throw A2uiValidationError(
                "Each entry in 'createSurface.components' must be an object."
              )
          }
        }
      val dataModel =
        body["dataModel"]?.let {
          it as? JsonObject
            ?: throw A2uiValidationError("'createSurface.dataModel' must be an object.")
        }
      val metadata =
        body["metadata"]?.let {
          val metaObj =
            it as? JsonObject
              ?: throw A2uiValidationError("'createSurface.metadata' must be an object.")
          if (strict) checkAllowedKeys(metaObj, setOf("extensions"), "createSurface.metadata")
          metaObj
        }
      return CreateSurfaceMessage(
        surfaceId = surfaceId,
        catalogId = catalogId,
        sendDataModel = sendDataModel,
        components = components,
        dataModel = dataModel,
        metadata = metadata,
        version = version,
      )
    }

    private fun parseUpdateComponents(
      json: JsonObject,
      version: String,
      strict: Boolean,
    ): UpdateComponentsMessage {
      val body = requireObject(json["updateComponents"], "updateComponents")
      if (strict) checkAllowedKeys(body, UPDATE_COMPONENTS_KEYS, "updateComponents")
      val surfaceId =
        requireString(body["surfaceId"], "updateComponents.surfaceId", allowMissing = !strict)
      val arr =
        body["components"] as? JsonArray
          ?: throw A2uiValidationError("'updateComponents.components' must be an array.")
      if (strict && arr.isEmpty()) {
        throw A2uiValidationError("'updateComponents.components' must be non-empty.")
      }
      val components =
        arr.map {
          it as? JsonObject
            ?: throw A2uiValidationError(
              "Each entry in 'updateComponents.components' must be an object."
            )
        }
      return UpdateComponentsMessage(
        surfaceId = surfaceId,
        components = components,
        version = version,
      )
    }

    private fun parseUpdateDataModel(
      json: JsonObject,
      version: String,
      strict: Boolean,
    ): UpdateDataModelMessage {
      val body = requireObject(json["updateDataModel"], "updateDataModel")
      if (strict) checkAllowedKeys(body, UPDATE_DATA_MODEL_KEYS, "updateDataModel")
      val surfaceId =
        requireString(body["surfaceId"], "updateDataModel.surfaceId", allowMissing = !strict)
      val path = optionalString(body["path"], "updateDataModel.path")
      if (strict && "value" !in body) {
        throw A2uiValidationError("'updateDataModel.value' is required in A2UI v1.0.")
      }
      val value = body["value"] ?: JsonNull
      return UpdateDataModelMessage(
        surfaceId = surfaceId,
        path = path,
        value = value,
        version = version,
      )
    }

    private fun parseDeleteSurface(
      json: JsonObject,
      version: String,
      strict: Boolean,
    ): DeleteSurfaceMessage {
      val body = requireObject(json["deleteSurface"], "deleteSurface")
      if (strict) checkAllowedKeys(body, DELETE_SURFACE_KEYS, "deleteSurface")
      val surfaceId =
        requireString(body["surfaceId"], "deleteSurface.surfaceId", allowMissing = !strict)
      return DeleteSurfaceMessage(surfaceId = surfaceId, version = version)
    }

    private fun parseCallRendererFunction(
      json: JsonObject,
      version: String,
      strict: Boolean,
    ): CallRendererFunctionMessage {
      val body = requireObject(json["callRendererFunction"], "callRendererFunction")
      if (strict) checkAllowedKeys(body, CALL_RENDERER_FUNCTION_KEYS, "callRendererFunction")
      val surfaceId = optionalString(body["surfaceId"], "callRendererFunction.surfaceId")
      val functionCallId =
        requireString(
          body["functionCallId"],
          "callRendererFunction.functionCallId",
          allowMissing = !strict,
        )
      if (strict && functionCallId.isEmpty()) {
        throw A2uiValidationError("'callRendererFunction.functionCallId' must be non-empty.")
      }
      val callFunction = requireObject(body["callFunction"], "callRendererFunction.callFunction")
      return CallRendererFunctionMessage(
        functionCallId = functionCallId,
        callFunction = callFunction,
        surfaceId = surfaceId,
        version = version,
      )
    }

    private fun parseAgentFunctionResponse(
      json: JsonObject,
      version: String,
      strict: Boolean,
    ): AgentFunctionResponseMessage {
      val body = requireObject(json["agentFunctionResponse"], "agentFunctionResponse")
      if (strict) checkAllowedKeys(body, AGENT_FUNCTION_RESPONSE_KEYS, "agentFunctionResponse")
      val functionCallId =
        requireString(
          body["functionCallId"],
          "agentFunctionResponse.functionCallId",
          allowMissing = !strict,
        )
      val hasValue = "value" in body
      val hasError = "error" in body
      if (strict && hasValue == hasError) {
        throw A2uiValidationError(
          "'agentFunctionResponse' must specify exactly one of 'value' or 'error'."
        )
      }
      val errorObj =
        body["error"]?.let { errEl ->
          val obj =
            errEl as? JsonObject
              ?: throw A2uiValidationError("'agentFunctionResponse.error' must be an object.")
          if (strict) checkAllowedKeys(obj, FUNCTION_ERROR_KEYS, "agentFunctionResponse.error")
          FunctionResponseError(
            code = requireString(obj["code"], "agentFunctionResponse.error.code"),
            message = requireString(obj["message"], "agentFunctionResponse.error.message"),
          )
        }
      return AgentFunctionResponseMessage(
        functionCallId = functionCallId,
        value = body["value"],
        error = errorObj,
        hasValue = hasValue,
        version = version,
      )
    }

    private fun requireObject(el: JsonElement?, label: String): JsonObject =
      el as? JsonObject ?: throw A2uiValidationError("'$label' must be a JSON object.")

    private fun requireString(
      el: JsonElement?,
      label: String,
      allowMissing: Boolean = false,
    ): String {
      if (el == null && allowMissing) return ""
      val prim = el as? JsonPrimitive
      if (prim == null || !prim.isString) {
        throw A2uiValidationError("'$label' must be a string.")
      }
      return prim.content
    }

    private fun optionalString(el: JsonElement?, label: String): String? {
      if (el == null || el is JsonNull) return null
      val prim = el as? JsonPrimitive
      if (prim == null || !prim.isString) {
        throw A2uiValidationError("'$label' must be a string.")
      }
      return prim.content
    }

    private fun optionalBoolean(el: JsonElement?, label: String): Boolean? {
      if (el == null || el is JsonNull) return null
      val prim = el as? JsonPrimitive
      if (prim == null || prim.isString || prim.booleanOrNull == null) {
        throw A2uiValidationError("'$label' must be a boolean.")
      }
      return prim.booleanOrNull
    }

    private fun checkAllowedKeys(obj: JsonObject, allowed: Set<String>, label: String) {
      val unknown = obj.keys - allowed
      if (unknown.isNotEmpty()) {
        throw A2uiValidationError(
          "Unexpected property(s) ${unknown.sorted()} in '$label'. Allowed: ${allowed.sorted()}."
        )
      }
    }
  }
}

/** `createSurface` wire message in A2UI v1.0. */
data class CreateSurfaceMessage(
  val surfaceId: String,
  val catalogId: String? = null,
  val sendDataModel: Boolean? = null,
  val components: List<JsonObject>? = null,
  val dataModel: JsonObject? = null,
  val metadata: JsonObject? = null,
  override val version: String = ProtocolVersion.V1_0.value,
) : AgentToRendererMessage {
  override fun toJsonObject(): JsonObject =
    JsonObject(
      buildMap {
        put("version", JsonPrimitive(version))
        put(
          "createSurface",
          JsonObject(
            buildMap {
              put("surfaceId", JsonPrimitive(surfaceId))
              if (catalogId != null) put("catalogId", JsonPrimitive(catalogId))
              if (sendDataModel != null) put("sendDataModel", JsonPrimitive(sendDataModel))
              if (components != null) put("components", JsonArray(components))
              if (dataModel != null) put("dataModel", dataModel)
              if (metadata != null) put("metadata", metadata)
            }
          ),
        )
      }
    )
}

/** `updateComponents` wire message in A2UI v1.0. */
data class UpdateComponentsMessage(
  val surfaceId: String,
  val components: List<JsonObject>,
  override val version: String = ProtocolVersion.V1_0.value,
) : AgentToRendererMessage {
  override fun toJsonObject(): JsonObject =
    JsonObject(
      mapOf(
        "version" to JsonPrimitive(version),
        "updateComponents" to
          JsonObject(
            mapOf("surfaceId" to JsonPrimitive(surfaceId), "components" to JsonArray(components))
          ),
      )
    )
}

/** `updateDataModel` wire message in A2UI v1.0. */
data class UpdateDataModelMessage(
  val surfaceId: String,
  val path: String? = null,
  val value: JsonElement = JsonNull,
  override val version: String = ProtocolVersion.V1_0.value,
) : AgentToRendererMessage {
  override fun toJsonObject(): JsonObject =
    JsonObject(
      mapOf(
        "version" to JsonPrimitive(version),
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

/** `deleteSurface` wire message in A2UI v1.0. */
data class DeleteSurfaceMessage(
  val surfaceId: String,
  override val version: String = ProtocolVersion.V1_0.value,
) : AgentToRendererMessage {
  override fun toJsonObject(): JsonObject =
    JsonObject(
      mapOf(
        "version" to JsonPrimitive(version),
        "deleteSurface" to JsonObject(mapOf("surfaceId" to JsonPrimitive(surfaceId))),
      )
    )
}

/** `callRendererFunction` wire message in A2UI v1.0. */
data class CallRendererFunctionMessage(
  val functionCallId: String,
  val callFunction: JsonObject,
  val surfaceId: String? = null,
  override val version: String = ProtocolVersion.V1_0.value,
) : AgentToRendererMessage {
  override fun toJsonObject(): JsonObject =
    JsonObject(
      mapOf(
        "version" to JsonPrimitive(version),
        "callRendererFunction" to
          JsonObject(
            buildMap {
              if (surfaceId != null) put("surfaceId", JsonPrimitive(surfaceId))
              put("functionCallId", JsonPrimitive(functionCallId))
              put("callFunction", callFunction)
            }
          ),
      )
    )
}

/** Structured error object carried by an [AgentFunctionResponseMessage]. */
data class FunctionResponseError(val code: String, val message: String) {
  fun toJsonObject(): JsonObject =
    JsonObject(mapOf("code" to JsonPrimitive(code), "message" to JsonPrimitive(message)))
}

/**
 * `agentFunctionResponse` wire message in A2UI v1.0 (`common_types.json#/$defs/FunctionResponse`).
 */
data class AgentFunctionResponseMessage(
  val functionCallId: String,
  val value: JsonElement? = null,
  val error: FunctionResponseError? = null,
  val hasValue: Boolean = error == null,
  override val version: String = ProtocolVersion.V1_0.value,
) : AgentToRendererMessage {
  override fun toJsonObject(): JsonObject =
    JsonObject(
      mapOf(
        "version" to JsonPrimitive(version),
        "agentFunctionResponse" to
          JsonObject(
            buildMap {
              put("functionCallId", JsonPrimitive(functionCallId))
              if (error != null) {
                put("error", error.toJsonObject())
              } else if (hasValue) {
                put("value", value ?: JsonNull)
              }
            }
          ),
      )
    )
}
