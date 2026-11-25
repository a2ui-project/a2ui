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

import com.google.a2ui.agent.parser.AfterRejectedBlock
import com.google.a2ui.agent.parser.Parser
import com.google.a2ui.agent.parser.RawA2uiPart
import com.google.a2ui.agent.parser.RawResponsePart
import com.google.a2ui.agent.parser.ResponsePart
import com.google.a2ui.agent.parser.ResponseStream
import com.google.a2ui.agent.parser.StreamPart
import com.google.a2ui.agent.parser.TextPart
import com.google.a2ui.agent.utils.RendererState
import com.google.a2ui.core.catalog.CatalogApi
import com.google.a2ui.core.schema.AgentToRendererMessage

/**
 * Concrete [Parser] implementation for A2UI Express v1.0 supporting one-shot `parseResponse`,
 * incremental `openStream`, `compile`, and `decompile`.
 */
class ExpressParser(
  catalogs: List<CatalogApi>,
  val surfaceId: String = "main",
  progressiveKeys: Set<String>? = DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
) : Parser() {
  private val checkedCatalogs: List<CatalogApi> = CatalogSchemaHelper.checkMixedCatalogs(catalogs)
  val progressiveKeys: Set<String> = progressiveKeys?.toSet() ?: DEFAULT_EXPRESS_PROGRESSIVE_KEYS

  override val catalogs: List<CatalogApi>
    get() = checkedCatalogs.toList()

  override val supportsStreaming: Boolean
    get() = true

  override fun hasFormatContent(content: String, complete: Boolean): Boolean =
    unwrap(content).any { part -> part.part is RawA2uiPart && (!complete || part.isFinal) }

  override fun wrap(blocks: List<RawResponsePart>): String =
    blocks.joinToString("\n") { block ->
      when (val inner = block.part) {
        is TextPart -> inner.text
        is RawA2uiPart ->
          "${ExpressDecompiler.A2UI_OPEN_TAG}\n${inner.a2uiRaw}\n${ExpressDecompiler.A2UI_CLOSE_TAG}"
      }
    }

  override fun unwrap(content: String): List<RawResponsePart> = ExpressBlockLexer.tokenize(content)

  override fun compile(formatContent: String, isFinal: Boolean): List<AgentToRendererMessage> =
    ExpressCompiler(checkedCatalogs)
      .compile(dslText = formatContent, surfaceId = surfaceId, isFinal = isFinal)

  override fun decompile(a2uiPayload: List<AgentToRendererMessage>): String =
    ExpressDecompiler(checkedCatalogs).decompile(a2uiPayload)

  fun wrapDecompiledBlocks(blocks: List<String>): String =
    ExpressDecompiler(checkedCatalogs).wrapDecompiledBlocks(blocks)

  override fun openStream(wrapped: Boolean, state: RendererState?): ResponseStream<ResponsePart> =
    ExpressResponseStream(
      parser = this,
      wrapped = wrapped,
      state = state,
      progressiveKeys = progressiveKeys,
      afterRejectedBlock = AfterRejectedBlock.END,
    )

  override fun openStreamContinuing(
    wrapped: Boolean,
    state: RendererState?,
  ): ResponseStream<StreamPart> =
    ExpressResponseStream(
      parser = this,
      wrapped = wrapped,
      state = state,
      progressiveKeys = progressiveKeys,
      afterRejectedBlock = AfterRejectedBlock.CONTINUE,
    )
}
