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

package com.google.a2ui.agent

import com.google.a2ui.agent.catalogtransformers.ComponentPruningTransformer
import com.google.a2ui.agent.parser.A2uiCompilationParseError
import com.google.a2ui.agent.parser.A2uiPart
import com.google.a2ui.agent.parser.AfterRejectedBlock
import com.google.a2ui.agent.parser.BlockLexer
import com.google.a2ui.agent.parser.ErrorPart
import com.google.a2ui.agent.parser.Parser
import com.google.a2ui.agent.parser.RawA2uiPart
import com.google.a2ui.agent.parser.RawResponsePart
import com.google.a2ui.agent.parser.ResponsePart
import com.google.a2ui.agent.parser.ResponseStream
import com.google.a2ui.agent.parser.StreamPart
import com.google.a2ui.agent.parser.TextPart
import com.google.a2ui.agent.parser.partialResults
import com.google.a2ui.agent.processor.A2uiGenerator
import com.google.a2ui.agent.processor.AnswerErrorPart
import com.google.a2ui.agent.processor.AnswerSurfacePart
import com.google.a2ui.agent.processor.AnswerTextPart
import com.google.a2ui.agent.processor.CatalogConfig
import com.google.a2ui.agent.processor.StreamedAnswer
import com.google.a2ui.agent.prompt.PromptGenerator
import com.google.a2ui.agent.rpc.ProcessResult
import com.google.a2ui.agent.rpc.RendererToAgentMessageProcessor
import com.google.a2ui.agent.skill.SkillGenerator
import com.google.a2ui.agent.utils.A2UI_RENDERER_CAPABILITIES_KEY
import com.google.a2ui.agent.utils.RendererState
import com.google.a2ui.agent.utils.readRendererCapabilities
import com.google.a2ui.core.catalog.AgentFunction
import com.google.a2ui.core.catalog.CatalogApi
import com.google.a2ui.core.catalog.FunctionReturnType
import com.google.a2ui.core.exceptions.A2uiError
import com.google.a2ui.core.processing.MessageProcessor
import com.google.a2ui.core.schema.AgentFunctionResponseMessage
import com.google.a2ui.core.schema.AgentToRendererMessage
import com.google.a2ui.core.schema.CallAgentFunctionMessage
import com.google.a2ui.core.schema.CreateSurfaceMessage
import com.google.a2ui.core.schema.FunctionCall
import com.google.a2ui.core.schema.UpdateComponentsMessage
import java.nio.file.Files
import java.nio.file.Path
import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Minimal in-test format double implementing the exact `com.google.a2ui.agent.*` and
 * `com.google.a2ui.core.*` contracts directly (no intermediate `JsonObject` shim).
 *
 * When Option 1 implements these identical FQNs and signatures directly (`InferenceFormat`,
 * `InferenceFormatFactory`, `PromptGenerator`, `Parser`, `ResponseStream<out P>`, `RendererState`,
 * `CatalogApi`, `AgentToRendererMessage`, and `A2uiError`), its `express/` package drops into
 * `a2ui_agent` without rewriting Express internals.
 */
private class ContractDoubleExpressFormat(
  override val catalogs: List<CatalogApi>,
  private val examples: List<List<AgentToRendererMessage>>?,
) : InferenceFormat {
  override val promptGenerator: PromptGenerator =
    object : PromptGenerator() {
      override val catalogs: List<CatalogApi> = this@ContractDoubleExpressFormat.catalogs

      override fun generateBaseRules(): String = "Emit UI blocks inside <a2ui>...</a2ui>."

      override fun generateCatalogInstructions(
        includeSchema: Boolean,
        catalog: CatalogApi?,
      ): String {
        val targets = if (catalog != null) listOf(catalog) else catalogs
        return targets.joinToString("\n") { cat ->
          "Catalog ${cat.id} -> Components: ${cat.components.keys.sorted().joinToString(", ")}"
        }
      }

      override fun generateExamples(catalog: CatalogApi?, validate: Boolean): String =
        examples?.size?.let { "Configured example turns: $it" } ?: ""
    }

  override fun createParser(): Parser = ContractDoubleExpressParser(catalogs)

  companion object : InferenceFormatFactory {
    private val SURFACE_REGEX =
      Regex(
        """surface\("([^"]+)"\)\s+\$/(\w+)\s*=\s*"([^"]+)"\s+root\s*=\s*Text\(\$/\2\)""",
        RegexOption.DOT_MATCHES_ALL,
      )

    override fun createFormat(
      catalogs: List<CatalogApi>,
      examples: List<List<AgentToRendererMessage>>?,
    ): InferenceFormat = ContractDoubleExpressFormat(catalogs, examples)
  }

  private class ContractDoubleExpressParser(override val catalogs: List<CatalogApi>) : Parser() {
    override val supportsStreaming: Boolean = true

    override fun hasFormatContent(content: String, complete: Boolean): Boolean =
      BlockLexer("<a2ui>", "</a2ui>").hasTag(content, complete)

    override fun wrap(blocks: List<RawResponsePart>): String =
      blocks.joinToString("") { raw ->
        when (val inner = raw.part) {
          is TextPart -> inner.text
          is RawA2uiPart -> "<a2ui>${inner.a2uiRaw}</a2ui>"
        }
      }

    override fun unwrap(content: String): List<RawResponsePart> =
      BlockLexer("<a2ui>", "</a2ui>").unwrapAll(content)

    override fun compile(formatContent: String, isFinal: Boolean): List<AgentToRendererMessage> {
      val match =
        SURFACE_REGEX.matchEntire(formatContent.trim())
          ?: throw A2uiCompilationParseError(
            message = "Syntax error in Express block",
            rawBlock = formatContent,
          )
      val (surfaceId, key, literalValue) = match.destructured
      val defaultCatId = catalogs.first().id
      return listOf(
        CreateSurfaceMessage(
          surfaceId = surfaceId,
          catalogId = defaultCatId,
          dataModel = JsonObject(mapOf(key to JsonPrimitive(literalValue))),
          components =
            listOf(
              JsonObject(
                mapOf(
                  "id" to JsonPrimitive("root"),
                  "component" to JsonPrimitive("Text"),
                  "text" to JsonObject(mapOf("path" to JsonPrimitive("/$key"))),
                )
              )
            ),
        )
      )
    }

    override fun decompile(a2uiPayload: List<AgentToRendererMessage>): String =
      a2uiPayload.joinToString("\n") { it.toJsonObject().toString() }

    override fun openStream(wrapped: Boolean, state: RendererState?): ResponseStream<ResponsePart> {
      val target = state ?: RendererState(catalogs)
      val inner = createStreamImpl(wrapped, target, AfterRejectedBlock.END)
      return object : ResponseStream<ResponsePart> {
        override val state: RendererState = target
        override val isInBlock: Boolean
          get() = inner.isInBlock

        override fun feed(chunk: String): List<ResponsePart> =
          inner.feed(chunk).map { it as ResponsePart }

        override fun close(): List<ResponsePart> = inner.close().map { it as ResponsePart }
      }
    }

    override fun openStreamContinuing(
      wrapped: Boolean,
      state: RendererState?,
    ): ResponseStream<StreamPart> =
      createStreamImpl(wrapped, state ?: RendererState(catalogs), AfterRejectedBlock.CONTINUE)

    private fun createStreamImpl(
      wrapped: Boolean,
      target: RendererState,
      policy: AfterRejectedBlock,
    ): ResponseStream<StreamPart> {
      val lexer = BlockLexer("<a2ui>", "</a2ui>")
      return object : ResponseStream<StreamPart> {
        override val state: RendererState = target
        override val isInBlock: Boolean
          get() = if (wrapped) lexer.isInBlock else true

        override fun feed(chunk: String): List<StreamPart> = processRaw(lexer.feed(chunk))

        override fun close(): List<StreamPart> = processRaw(lexer.flush())

        private fun processRaw(rawParts: List<RawResponsePart>): List<StreamPart> {
          val out = mutableListOf<StreamPart>()
          for (raw in rawParts) {
            when (val inner = raw.part) {
              is TextPart -> out.add(inner)
              is RawA2uiPart -> {
                if (!raw.isFinal) {
                  val err =
                    A2uiCompilationParseError("Unclosed <a2ui> block", rawBlock = inner.a2uiRaw)
                  if (policy == AfterRejectedBlock.CONTINUE) {
                    out.add(ErrorPart(err))
                  } else {
                    err.partialResults = out.filterIsInstance<ResponsePart>()
                    throw err
                  }
                } else {
                  try {
                    val compiled =
                      target.transaction {
                        val msgs = compile(inner.a2uiRaw, isFinal = true)
                        val touched = target.apply(msgs, inProgress = false)
                        target.checkTopology(touched)
                        msgs
                      }
                    out.add(A2uiPart(compiled))
                  } catch (e: A2uiError) {
                    if (policy == AfterRejectedBlock.CONTINUE) {
                      out.add(ErrorPart(e))
                    } else {
                      e.partialResults = out.filterIsInstance<ResponsePart>()
                      throw e
                    }
                  }
                }
              }
            }
          }
          return out
        }
      }
    }
  }
}

class ExpressContractSeamTest {

  private fun findBasicCatalogPath(): String {
    var cursor: Path? = Path.of("").toAbsolutePath()
    while (cursor != null) {
      val candidate = cursor.resolve("catalogs/basic/v1/catalog.json")
      if (Files.isRegularFile(candidate)) return candidate.toString()
      cursor = cursor.parent
    }
    error("Could not find catalogs/basic/v1/catalog.json")
  }

  @Test
  fun negotiatesPrunesStreamsAndRecoversViaDirectAgentContracts() {
    val catalogPath = findBasicCatalogPath()
    val config =
      CatalogConfig.fromPath(
        catalogPath = catalogPath,
        transformers = listOf(ComponentPruningTransformer(listOf("Text", "Column", "Button"))),
      )

    val generator =
      A2uiGenerator(catalogs = listOf(config), inferenceFormatFactory = ContractDoubleExpressFormat)

    val basicId = config.catalog.id
    val capabilities =
      assertNotNull(
        readRendererCapabilities(
          mapOf(
            A2UI_RENDERER_CAPABILITIES_KEY to
              JsonObject(
                mapOf(
                  "1.0" to
                    JsonObject(
                      mapOf("supportedCatalogIds" to JsonArray(listOf(JsonPrimitive(basicId))))
                    )
                )
              )
          )
        )
      )
    val requestProcessor = generator.createProcessor(capabilities)

    // 1. Pruned catalog propagates through PromptGenerator and SkillGenerator
    val snippet = requestProcessor.promptSnippet
    assertTrue("Components: Button, Column, Text" in snippet)
    assertTrue("AudioPlayer" !in snippet)
    assertEquals(snippet, SkillGenerator(requestProcessor.format).generateSkill().content)

    // 2. Default openStream() is statically typed as ResponseStream<ResponsePart> (no ErrorPart)
    val failFastStream: ResponseStream<ResponsePart> = requestProcessor.openStream()
    val okParts =
      failFastStream.feed(
        """Hi <a2ui>surface("card_1") $/title = "Ready" root = Text($/title)</a2ui>"""
      ) + failFastStream.close()
    assertEquals(2, okParts.size)
    assertEquals("Hi ", (okParts[0] as TextPart).text)
    assertEquals(1, (okParts[1] as A2uiPart).a2ui.size)

    // 3. Dynamic enum overload and StreamedAnswer continue past a rejected block onto live Core
    val liveRenderer = MessageProcessor(requestProcessor.activeCatalogs)
    val answer = StreamedAnswer(requestProcessor, renderer = liveRenderer)
    answer.feed("Intro ")
    answer.feed("""<a2ui>surface("s1") $/title = "Streamed!" root = Text($/title)</a2ui>""")
    answer.feed(" middle ")
    answer.feed("<a2ui>BROKEN SYNTAX</a2ui>")
    answer.feed(" outro")
    answer.close()

    assertEquals(5, answer.parts.size)
    assertEquals("Intro ", (answer.parts[0] as AnswerTextPart).text)
    val surfacePart = answer.parts[1] as AnswerSurfacePart
    assertEquals("s1", surfacePart.surface.id)
    assertEquals(JsonPrimitive("Streamed!"), surfacePart.surface.dataModel.get("/title"))
    assertEquals(" middle ", (answer.parts[2] as AnswerTextPart).text)
    assertEquals(ErrorPart::class, (answer.parts[3] as AnswerErrorPart).errorPart::class)
    assertEquals(" outro", (answer.parts[4] as AnswerTextPart).text)
  }

  @Test
  fun dropsProvisionalComponentCleanlyViaRendererStateInterface() {
    val catalog = CatalogConfig.fromPath(findBasicCatalogPath()).catalog
    val state: RendererState = RendererState(listOf(catalog))
    state.transaction {
      state.apply(
        listOf(
          CreateSurfaceMessage(surfaceId = "prov", catalogId = catalog.id),
          UpdateComponentsMessage(
            surfaceId = "prov",
            components =
              listOf(
                JsonObject(
                  mapOf(
                    "id" to JsonPrimitive("text_1"),
                    "component" to JsonPrimitive("Text"),
                    "text" to JsonPrimitive("Provisional"),
                  )
                )
              ),
          ),
        ),
        inProgress = true,
      )
      state.dropProvisionalComponent("prov", "text_1")
      state.apply(
        listOf(
          UpdateComponentsMessage(
            surfaceId = "prov",
            components =
              listOf(
                JsonObject(
                  mapOf(
                    "id" to JsonPrimitive("root"),
                    "component" to JsonPrimitive("Text"),
                    "text" to JsonPrimitive("Final"),
                  )
                )
              ),
          )
        ),
        inProgress = true,
      )
      state.checkTopology(listOf("prov"))
    }
    assertEquals(setOf("root"), state.surfaceComponents("prov")?.keys)
  }

  @Test
  fun executesAgentHostedFunctionThroughRendererToAgentMessageProcessor() {
    val baseCatalog = CatalogConfig.fromPath(findBasicCatalogPath()).catalog
    val withAgentFn =
      baseCatalog.copyWith(
        agentFunctions =
          listOf(
            AgentFunction(
              name = "lookupOrder",
              returnType = FunctionReturnType.OBJECT,
              schema = JsonObject(mapOf("type" to JsonPrimitive("object"))),
              handler = { args, ctx ->
                JsonObject(
                  mapOf(
                    "orderId" to (args["id"] ?: JsonPrimitive("none")),
                    "surface" to JsonPrimitive(ctx.surfaceId),
                  )
                )
              },
            )
          )
      )

    val rpcProcessor = RendererToAgentMessageProcessor(listOf(withAgentFn))
    var settled: ProcessResult? = null
    val block: suspend () -> Unit = {
      settled =
        rpcProcessor.processMessage(
          CallAgentFunctionMessage(
            surfaceId = "checkout",
            functionCallId = "call_42",
            callFunction =
              FunctionCall(
                call = "lookupOrder",
                catalogId = withAgentFn.id,
                args = JsonObject(mapOf("id" to JsonPrimitive("ORD-9"))),
              ),
          )
        )
    }
    block.startCoroutine(
      object : Continuation<Unit> {
        override val context = EmptyCoroutineContext

        override fun resumeWith(result: Result<Unit>) {
          result.getOrThrow()
        }
      }
    )

    val outcome = assertNotNull(settled)
    assertTrue(outcome.handled)
    val reply = outcome.replies.single() as AgentFunctionResponseMessage
    assertEquals("call_42", reply.response.functionCallId)
    assertEquals(
      JsonObject(
        mapOf("orderId" to JsonPrimitive("ORD-9"), "surface" to JsonPrimitive("checkout"))
      ),
      reply.response.value,
    )
  }
}
