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

package com.google.a2ui.adk.a2a_extension

import com.google.a2ui.schema.A2uiCatalog
import com.google.adk.agents.ReadonlyContext
import com.google.adk.models.LlmRequest
import com.google.adk.tools.BaseTool
import com.google.adk.tools.BaseToolset
import com.google.adk.tools.ToolContext
import com.google.genai.types.FunctionDeclaration
import com.google.genai.types.Schema
import com.google.genai.types.Type
import io.reactivex.rxjava3.core.Completable
import io.reactivex.rxjava3.core.Flowable
import io.reactivex.rxjava3.core.Single
import java.util.Optional
import java.util.logging.Logger

typealias A2uiEnabledProvider = (ReadonlyContext) -> Boolean

typealias A2uiCatalogProvider = (ReadonlyContext) -> A2uiCatalog

typealias A2uiExamplesProvider = (ReadonlyContext) -> String

/**
 * A toolset that furnishes ADK agents with A2UI (Agent-to-UI) functional tools.
 *
 * This allows an agent to explicitly decide to render UI components based on the configured schemas
 * and current catalog capabilities. Features dynamic enablement, pulling localized components on
 * demand.
 */
class SendA2uiToClientToolset
@JvmOverloads
constructor(
  private val a2uiEnabled: A2uiEnabledProvider,
  private val a2uiCatalog: A2uiCatalogProvider,
  private val a2uiExamples: A2uiExamplesProvider,
) : BaseToolset {

  private val logger = Logger.getLogger(SendA2uiToClientToolset::class.java.name)
  private val uiTools = listOf(SendA2uiJsonToClientTool())

  override fun getTools(readonlyContext: ReadonlyContext): Flowable<BaseTool> =
    if (a2uiEnabled(readonlyContext)) {
      logger.info("A2UI is ENABLED, adding ui tools")
      Flowable.fromIterable(uiTools)
    } else {
      logger.info("A2UI is DISABLED, not adding ui tools")
      Flowable.empty()
    }

  override fun close() {
    // Nothing to close
  }

  fun getPartConverter(ctx: ReadonlyContext): A2uiPartConverter =
    A2uiPartConverter(a2uiCatalog(ctx))

  inner class SendA2uiJsonToClientTool :
    BaseTool(
      TOOL_NAME,
      "Sends A2UI JSON to the client to render rich UI natively. Always prefer this over returning raw JSON.",
    ) {

    override fun declaration(): Optional<FunctionDeclaration> {
      return Optional.of(
        FunctionDeclaration.builder()
          .name(name())
          .description(description())
          .parameters(
            Schema.builder()
              .type(Type(Type.Known.OBJECT))
              .properties(
                mapOf(
                  A2UI_JSON_ARG_NAME to
                    Schema.builder()
                      .type(Type(Type.Known.STRING))
                      .description("The A2UI JSON payload to send to the client.")
                      .build()
                )
              )
              .build()
          )
          .build()
      )
    }

    override fun processLlmRequest(
      llmRequestBuilder: LlmRequest.Builder,
      toolContext: ToolContext,
    ): Completable =
      Completable.fromAction {
          val catalog = a2uiCatalog(toolContext)
          val instruction = catalog.renderAsLlmInstructions()
          val examples = a2uiExamples(toolContext)

          llmRequestBuilder.appendInstructions(listOf(instruction, examples))
          logger.info("Added A2UI schema and examples to system instructions")
        }
        .andThen(super.processLlmRequest(llmRequestBuilder, toolContext))

    override fun runAsync(
      args: Map<String, Any>,
      toolContext: ToolContext,
    ): Single<Map<String, Any>> =
      Single.fromCallable {
        try {
          val a2uiJsonStr =
            args[A2UI_JSON_ARG_NAME] as? String
              ?: throw IllegalArgumentException(
                "Failed to call tool $TOOL_NAME because missing required arg $A2UI_JSON_ARG_NAME"
              )

          val catalog = a2uiCatalog(toolContext)

          val a2uiJsonPayload = kotlinx.serialization.json.Json.parseToJsonElement(a2uiJsonStr)
          catalog.validator.validate(a2uiJsonPayload)

          logger.info("Validated call to tool $TOOL_NAME with $A2UI_JSON_ARG_NAME")

          // Return the validated JSON so the converter can use it.
          mapOf(VALIDATED_A2UI_JSON_KEY to a2uiJsonPayload)
        } catch (e: Exception) {
          val err = "Failed to call A2UI tool $TOOL_NAME: ${e.message}"
          logger.severe(err)
          mapOf(TOOL_ERROR_KEY to err)
        }
      }
  }

  companion object {
    /** Helper to create a toolset with constant values. */
    @JvmStatic
    @JvmOverloads
    fun create(
      enabled: Boolean,
      catalog: A2uiCatalog,
      examples: String = "",
    ): SendA2uiToClientToolset = SendA2uiToClientToolset({ enabled }, { catalog }, { examples })

    const val TOOL_NAME = "send_a2ui_json_to_client"
    const val VALIDATED_A2UI_JSON_KEY = "validated_a2ui_json"
    private const val A2UI_JSON_ARG_NAME = "a2ui_json"
    const val TOOL_ERROR_KEY = "error"
  }
}
