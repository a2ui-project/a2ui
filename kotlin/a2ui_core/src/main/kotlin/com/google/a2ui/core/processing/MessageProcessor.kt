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

package com.google.a2ui.core.processing

import com.google.a2ui.core.catalog.Catalog
import com.google.a2ui.core.catalog.ComponentApi
import com.google.a2ui.core.catalog.FunctionApi
import com.google.a2ui.core.common.A2uiMetadata
import com.google.a2ui.core.common.ProtocolVersion
import com.google.a2ui.core.common.isCatalogVersionCompatible
import com.google.a2ui.core.common.reactiveBatch
import com.google.a2ui.core.exceptions.A2uiCatalogError
import com.google.a2ui.core.exceptions.A2uiIntegrityError
import com.google.a2ui.core.exceptions.A2uiValidationError
import com.google.a2ui.core.resolution.DataContext
import com.google.a2ui.core.rpc.CallOptions
import com.google.a2ui.core.rpc.OutboundMessageListener
import com.google.a2ui.core.rpc.RpcHandler
import com.google.a2ui.core.schema.A2uiRendererAction
import com.google.a2ui.core.schema.A2uiRendererCapabilities
import com.google.a2ui.core.schema.A2uiRendererDataModel
import com.google.a2ui.core.schema.AgentFunctionResponseMessage
import com.google.a2ui.core.schema.AgentToRendererMessage
import com.google.a2ui.core.schema.AgentToRendererMessagePayload
import com.google.a2ui.core.schema.CallRendererFunctionMessage
import com.google.a2ui.core.schema.CreateSurfaceMessage
import com.google.a2ui.core.schema.DeleteSurfaceMessage
import com.google.a2ui.core.schema.FunctionCall
import com.google.a2ui.core.schema.FunctionError
import com.google.a2ui.core.schema.FunctionResponse
import com.google.a2ui.core.schema.RendererVersionCapabilities
import com.google.a2ui.core.schema.UpdateComponentsMessage
import com.google.a2ui.core.schema.UpdateDataModelMessage
import com.google.a2ui.core.state.ComponentModel
import com.google.a2ui.core.state.DataModel
import com.google.a2ui.core.state.SurfaceGroupModel
import com.google.a2ui.core.state.SurfaceModel
import com.google.a2ui.core.validation.PayloadValidator
import com.google.a2ui.core.validation.ValidationConfig
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Closed 6-member version-neutral operation union (`a2ui_core.blueprint.md` §3.B).
 *
 * Produced exclusively by [VersionAdapter] implementations after wire envelope validation.
 */
sealed interface InternalOperation {
  data class CreateSurface(
    val surfaceId: String,
    val version: ProtocolVersion,
    val catalogId: String? = null,
    val sendDataModel: Boolean = false,
    val components: List<JsonObject>? = null,
    val dataModel: JsonObject? = null,
    val metadata: A2uiMetadata? = null,
    val root: String? = null,
    val theme: JsonObject? = null,
  ) : InternalOperation

  data class UpdateComponents(val surfaceId: String, val components: List<JsonObject>) :
    InternalOperation

  data class UpdateDataModel(
    val surfaceId: String,
    val value: JsonElement,
    val path: String? = null,
  ) : InternalOperation

  data class DeleteSurface(val surfaceId: String) : InternalOperation

  data class CallRendererFunction(
    val functionCallId: String,
    val call: String,
    val version: ProtocolVersion,
    val catalogId: String? = null,
    val args: JsonObject? = null,
    val surfaceId: String? = null,
    val isUserActivated: Boolean = false,
  ) : InternalOperation

  data class AgentFunctionResponse(
    val functionCallId: String,
    val version: ProtocolVersion = ProtocolVersion.V1_0,
    val value: JsonElement? = null,
    val hasValue: Boolean = false,
    val error: FunctionError? = null,
  ) : InternalOperation
}

/** Isolates wire-format version differences (`a2ui_core.blueprint.md` §3.B `VersionAdapter`). */
interface VersionAdapter {
  val version: ProtocolVersion
  val validActions: Set<String>
  val compatibleCatalogVersions: Set<String>

  fun isCatalogCompatible(catalogVersion: String?): Boolean =
    isCatalogVersionCompatible(catalogVersion, version.wireTag)

  fun extractOperations(
    payload: AgentToRendererMessagePayload,
    isUserActivated: Boolean = false,
  ): List<InternalOperation>
}

interface VersionAdapterResolver {
  fun getAdapter(version: ProtocolVersion): VersionAdapter

  fun registerAdapter(adapter: VersionAdapter)

  fun getAllKnownActions(): Set<String>
}

/** Built-in v1.0 wire adapter. */
class V10VersionAdapter : VersionAdapter {
  override val version: ProtocolVersion = ProtocolVersion.V1_0
  override val validActions: Set<String> =
    setOf(
      "createSurface",
      "updateComponents",
      "updateDataModel",
      "deleteSurface",
      "callRendererFunction",
      "agentFunctionResponse",
    )
  override val compatibleCatalogVersions: Set<String> = setOf("1.0", "v1.0", "1.0.0")

  override fun extractOperations(
    payload: AgentToRendererMessagePayload,
    isUserActivated: Boolean,
  ): List<InternalOperation> =
    AgentToRendererMessage.parseAll(payload).map { msg ->
      when (msg) {
        is CreateSurfaceMessage ->
          InternalOperation.CreateSurface(
            surfaceId = msg.surfaceId,
            version = msg.version,
            catalogId = msg.catalogId,
            sendDataModel = msg.sendDataModel,
            components = msg.components,
            dataModel = msg.dataModel,
            metadata = msg.metadata,
          )
        is UpdateComponentsMessage ->
          InternalOperation.UpdateComponents(msg.surfaceId, msg.components)
        is UpdateDataModelMessage ->
          InternalOperation.UpdateDataModel(msg.surfaceId, msg.value, msg.path)
        is DeleteSurfaceMessage -> InternalOperation.DeleteSurface(msg.surfaceId)
        is CallRendererFunctionMessage ->
          InternalOperation.CallRendererFunction(
            functionCallId = msg.functionCallId,
            call = msg.callFunction.call,
            version = msg.version,
            catalogId = msg.callFunction.catalogId,
            args = msg.callFunction.args,
            surfaceId = msg.surfaceId,
            isUserActivated = isUserActivated,
          )
        is AgentFunctionResponseMessage ->
          InternalOperation.AgentFunctionResponse(
            functionCallId = msg.response.functionCallId,
            version = msg.version,
            value = msg.response.value,
            hasValue = msg.response.hasValue,
            error = msg.response.error,
          )
      }
    }
}

class DefaultVersionAdapterFactory : VersionAdapterResolver {
  private val adapters =
    linkedMapOf<ProtocolVersion, VersionAdapter>(ProtocolVersion.V1_0 to V10VersionAdapter())

  override fun getAdapter(version: ProtocolVersion): VersionAdapter =
    adapters[version]
      ?: throw A2uiValidationError("No VersionAdapter registered for ${version.wireTag}")

  override fun registerAdapter(adapter: VersionAdapter) {
    adapters[adapter.version] = adapter
  }

  override fun getAllKnownActions(): Set<String> =
    adapters.values.flatMapTo(linkedSetOf()) { it.validActions }
}

/** Per-call execution context (`a2ui_core.blueprint.md` §3.B, `agent_renderer_app` §1). */
data class ExecutionContext(
  val isUserActivated: Boolean = false,
  val validationConfig: ValidationConfig? = null,
)

data class CapabilitiesOptions(
  val versions: List<ProtocolVersion>,
  val includeInlineCatalogs: Boolean = false,
  val componentEnvelopeRef: String = "common_types.json#/\$defs/ComponentCommon",
)

data class MessageProcessorOptions(
  val version: ProtocolVersion = ProtocolVersion.V1_0,
  val adapterRegistry: VersionAdapterResolver = DefaultVersionAdapterFactory(),
  val validationConfig: ValidationConfig? = null,
  val outboundListener: OutboundMessageListener? = null,
  val defaultTimeout: Duration = 30.seconds,
)

fun interface ActionListener {
  fun onAction(action: A2uiRendererAction)
}

/** Central state controller and multi-catalog validation router (`a2ui_core.blueprint.md` §3.B). */
class MessageProcessor<T : ComponentApi>(
  catalogs: List<Catalog<T, FunctionApi>>,
  private val actionHandler: ActionListener? = null,
  private val options: MessageProcessorOptions = MessageProcessorOptions(),
) {
  val catalogs: List<Catalog<T, FunctionApi>> = catalogs.toList()
  val model: SurfaceGroupModel<T> = SurfaceGroupModel()
  val rpc: RpcHandler =
    RpcHandler(
      catalogs = this.catalogs,
      outboundListener = options.outboundListener,
      defaultTimeout = options.defaultTimeout,
    )

  init {
    if (actionHandler != null) {
      model.onAction.subscribe { actionHandler.onAction(it) }
    }
  }

  fun processMessages(
    messages: AgentToRendererMessagePayload,
    context: ExecutionContext = ExecutionContext(),
  ) {
    val activeValidation = context.validationConfig ?: options.validationConfig
    val adapter = options.adapterRegistry.getAdapter(options.version)
    val ops = adapter.extractOperations(messages, context.isUserActivated)

    for (op in ops) {
      when (op) {
        is InternalOperation.CreateSurface -> applyCreateSurface(op, activeValidation)
        is InternalOperation.UpdateComponents -> applyUpdateComponents(op, activeValidation)
        is InternalOperation.UpdateDataModel -> {
          val surface = requireSurface(op.surfaceId)
          surface.dataModel.set(op.path ?: "/", op.value)
        }
        is InternalOperation.DeleteSurface -> {
          requireSurface(op.surfaceId)
          rpc.cancelSurfaceCalls(op.surfaceId)
          model.deleteSurface(op.surfaceId)
        }
        is InternalOperation.CallRendererFunction -> {
          val dataCtx =
            if (op.surfaceId != null) {
              val s =
                model.getSurface(op.surfaceId)
                  ?: run {
                    options.outboundListener?.onOutboundMessage(
                      com.google.a2ui.core.schema.RendererFunctionResponseMessage(
                        FunctionResponse.failure(
                          op.functionCallId,
                          "INVALID_FUNCTION_CALL",
                          "Unknown surface '${op.surfaceId}'",
                        )
                      )
                    )
                    return@processMessages
                  }
              DataContext(s.dataModel, "/", s)
            } else {
              val headless = SurfaceModel<T>(id = "_headless", protocolVersion = op.version)
              DataContext(DataModel(), "/", headless)
            }
          val reply =
            rpc.handleCallRendererFunction(
              CallRendererFunctionMessage(
                functionCallId = op.functionCallId,
                callFunction =
                  FunctionCall(call = op.call, catalogId = op.catalogId, args = op.args),
                surfaceId = op.surfaceId,
                version = op.version,
              ),
              dataCtx,
              op.isUserActivated,
            )
          options.outboundListener?.onOutboundMessage(reply)
        }
        is InternalOperation.AgentFunctionResponse ->
          rpc.handleAgentFunctionResponse(
            AgentFunctionResponseMessage(
              FunctionResponse(
                functionCallId = op.functionCallId,
                value = op.value,
                hasValue = op.hasValue,
                error = op.error,
              ),
              op.version,
            )
          )
      }
    }
  }

  suspend fun processMessagesAsync(
    messages: AgentToRendererMessagePayload,
    context: ExecutionContext = ExecutionContext(),
  ) {
    processMessages(messages, context)
  }

  suspend fun callAgentFunction(
    surfaceId: String,
    call: FunctionCall,
    callOptions: CallOptions = CallOptions(),
  ): JsonElement? = rpc.callAgentFunction(surfaceId, call, callOptions)

  fun getRendererCapabilities(capOptions: CapabilitiesOptions): A2uiRendererCapabilities {
    if (capOptions.versions.isEmpty()) {
      throw A2uiValidationError("CapabilitiesOptions.versions must contain at least one version")
    }
    val map =
      capOptions.versions.associate { ver ->
        val compatible =
          catalogs.filter { isCatalogVersionCompatible(it.protocolVersion?.wireTag, ver.wireTag) }
        ver.wireTag to
          RendererVersionCapabilities(
            supportedCatalogIds = compatible.map { it.id },
            inlineCatalogs =
              if (capOptions.includeInlineCatalogs) compatible.map { it.toJson() } else null,
          )
      }
    return A2uiRendererCapabilities(map)
  }

  fun getRendererDataModel(version: ProtocolVersion? = null): A2uiRendererDataModel? {
    val active = model.surfaces.values.filter { it.sendDataModel }
    if (active.isEmpty()) return null
    val targetVersion =
      version
        ?: run {
          val distinct = active.map { it.protocolVersion }.distinct()
          if (distinct.size > 1) {
            throw A2uiValidationError(
              "Active surfaces span multiple protocol versions; specify version"
            )
          }
          distinct.single()
        }
    val matching =
      active
        .filter { it.protocolVersion == targetVersion }
        .associate { it.id to it.dataModel.snapshot() }
    return if (matching.isEmpty()) null else A2uiRendererDataModel(targetVersion, matching)
  }

  fun dispose(reason: String = "MessageProcessor disposed") {
    rpc.dispose(reason)
    model.dispose()
  }

  private fun applyCreateSurface(
    op: InternalOperation.CreateSurface,
    validationConfig: ValidationConfig?,
  ) {
    if (model.getSurface(op.surfaceId) != null) {
      throw A2uiIntegrityError("Surface '${op.surfaceId}' already exists")
    }
    val compatible =
      catalogs
        .filter { isCatalogVersionCompatible(it.protocolVersion?.wireTag, op.version.wireTag) }
        .associateBy { it.id }
    val defaultCatalog =
      op.catalogId?.let { id ->
        compatible[id]
          ?: throw A2uiCatalogError("Surface '${op.surfaceId}' requests unsupported catalog '$id'")
      }
    val surface =
      SurfaceModel(
        id = op.surfaceId,
        protocolVersion = op.version,
        defaultCatalog = defaultCatalog,
        availableCatalogs = compatible,
        rootId = op.root ?: "root",
        sendDataModel = op.sendDataModel,
        initialMetadata = op.metadata,
      )
    // Rule (`a2ui_core.blueprint.md` §3.B): apply initial dataModel per top-level key BEFORE
    // components.
    op.dataModel?.forEach { (key, value) -> surface.dataModel.set("/$key", value) }
    if (op.components != null) {
      upsertComponentsIntoSurface(surface, op.components, validationConfig)
    }
    model.addSurface(surface)
  }

  private fun applyUpdateComponents(
    op: InternalOperation.UpdateComponents,
    validationConfig: ValidationConfig?,
  ) {
    val surface = requireSurface(op.surfaceId)
    upsertComponentsIntoSurface(surface, op.components, validationConfig)
  }

  private fun upsertComponentsIntoSurface(
    surface: SurfaceModel<T>,
    rawComponents: List<JsonObject>,
    validationConfig: ValidationConfig?,
  ) {
    val built =
      rawComponents.map { compJson ->
        val id =
          (compJson["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?: throw A2uiValidationError("Component missing string 'id'")
        val typeName =
          (compJson["component"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?: throw A2uiValidationError("Component '$id' missing string 'component'")
        val explicitCat =
          when (val rawCat = compJson["@catalogId"]) {
            null -> null
            is JsonPrimitive ->
              if (rawCat.isString) rawCat.content
              else throw A2uiValidationError("Component '$id' '@catalogId' must be a string")
            else -> throw A2uiValidationError("Component '$id' '@catalogId' must be a string")
          }
        val resolvedCatalog = surface.resolveCatalog(explicitCat, "Component '$id'")
        if (validationConfig != null) {
          PayloadValidator(resolvedCatalog, validationConfig).validateComponent(compJson)
        }
        val metadata =
          (compJson["@metadata"] as? JsonObject)?.let { A2uiMetadata.fromJsonObject(it) }
        val props =
          JsonObject(
            compJson.filterKeys {
              it != "id" && it != "component" && it != "@catalogId" && it != "@metadata"
            }
          )
        ComponentModel(
          id = id,
          type = typeName,
          catalog = resolvedCatalog,
          initialProperties = props,
          initialMetadata = metadata,
        )
      }
    if (validationConfig != null) {
      surface.componentsModel.validateComponentsUpdate(built, surface.rootId, validationConfig)
    }
    for (incoming in built) {
      val existing = surface.componentsModel.get(incoming.id)
      if (existing == null) {
        surface.componentsModel.addComponent(incoming)
      } else if (existing.type != incoming.type || existing.catalog.id != incoming.catalog.id) {
        surface.componentsModel.removeComponent(incoming.id)
        surface.componentsModel.addComponent(incoming)
      } else {
        reactiveBatch {
          existing.properties = incoming.properties
          existing.metadata = incoming.metadata
        }
      }
    }
  }

  private fun requireSurface(surfaceId: String): SurfaceModel<T> =
    model.getSurface(surfaceId) ?: throw A2uiIntegrityError("Surface '$surfaceId' does not exist")
}
