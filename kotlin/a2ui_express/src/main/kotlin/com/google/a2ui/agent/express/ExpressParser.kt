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

package com.google.a2ui.agent.express

import com.google.a2ui.agent.AfterRejectedBlock
import com.google.a2ui.agent.Parser
import com.google.a2ui.agent.RawA2uiPart
import com.google.a2ui.agent.RawResponsePart
import com.google.a2ui.agent.RendererState
import com.google.a2ui.agent.ResponsePart
import com.google.a2ui.agent.ResponseStream
import com.google.a2ui.agent.StreamPart
import com.google.a2ui.agent.TextPart
import com.google.a2ui.core.AgentToRendererMessage
import com.google.a2ui.core.Catalog

/**
 * Concrete [Parser] implementation for A2UI Express v1.0 supporting one-shot `parseResponse`,
 * incremental `openStream`, `compile`, and `decompile`.
 */
class ExpressParser(
  catalogs: List<Catalog>,
  val surfaceId: String = "main",
  progressiveKeys: Set<String>? = DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
) : Parser() {
  private val checkedCatalogs: List<Catalog> = CatalogSchemaHelper.checkMixedCatalogs(catalogs)
  val progressiveKeys: Set<String> = progressiveKeys?.toSet() ?: DEFAULT_EXPRESS_PROGRESSIVE_KEYS

  override val catalogs: List<Catalog>
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

  override fun openStream(
    wrapped: Boolean,
    state: RendererState?,
    afterRejectedBlock: AfterRejectedBlock,
  ): ResponseStream<StreamPart> =
    ExpressResponseStream(
      parser = this,
      wrapped = wrapped,
      state = state,
      progressiveKeys = progressiveKeys,
      afterRejectedBlock = afterRejectedBlock,
    )
}
