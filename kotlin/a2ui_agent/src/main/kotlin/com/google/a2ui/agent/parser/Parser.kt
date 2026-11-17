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

package com.google.a2ui.agent.parser

import com.google.a2ui.agent.utils.RendererState
import com.google.a2ui.core.catalog.CatalogApi
import com.google.a2ui.core.exceptions.A2uiError
import com.google.a2ui.core.schema.AgentToRendererMessage
import java.util.Collections
import java.util.WeakHashMap

private val partialResultsStore: MutableMap<A2uiError, List<ResponsePart>> =
  Collections.synchronizedMap(WeakHashMap())

/**
 * Validated [ResponsePart]s already applied prior to an [A2uiError] during [Parser.parseResponse]
 * or [ResponseStream] processing (`a2ui_agent.blueprint.md` §3.C).
 */
var A2uiError.partialResults: List<ResponsePart>
  get() = partialResultsStore[this] ?: emptyList()
  set(value) {
    partialResultsStore[this] = value.toList()
  }

/** Policy when [ResponseStream] encounters a rejected block (`a2ui_agent.blueprint.md` §3.C). */
enum class AfterRejectedBlock {
  END,
  CONTINUE;

  companion object {
    fun fromString(raw: String?): AfterRejectedBlock =
      when (raw) {
        null,
        "end" -> END
        "continue" -> CONTINUE
        else ->
          throw IllegalArgumentException(
            "Invalid afterRejectedBlock mode '$raw'. Expected 'end' or 'continue'."
          )
      }
  }
}

/**
 * Incremental chunk-by-chunk response stream (`a2ui_agent.blueprint.md` §3.C `ResponseStream`).
 *
 * Covariant in [P] so `openStream()` returns `ResponseStream<ResponsePart>` (statically free of
 * [ErrorPart]) while `openStreamContinuing()` returns `ResponseStream<StreamPart>`.
 */
interface ResponseStream<out P : StreamPart> {
  val state: RendererState
  val isInBlock: Boolean

  fun feed(chunk: String): List<P>

  fun close(): List<P>
}

/** Base contract for inference format parsers (`a2ui_agent.blueprint.md` §3.C `Parser`). */
abstract class Parser {
  abstract val catalogs: List<CatalogApi>

  open val supportsStreaming: Boolean
    get() = false

  abstract fun hasFormatContent(content: String, complete: Boolean = false): Boolean

  abstract fun wrap(blocks: List<RawResponsePart>): String

  abstract fun unwrap(content: String): List<RawResponsePart>

  abstract fun compile(formatContent: String, isFinal: Boolean = true): List<AgentToRendererMessage>

  abstract fun decompile(a2uiPayload: List<AgentToRendererMessage>): String

  open fun parseResponse(
    content: String,
    wrapped: Boolean = true,
    state: RendererState? = null,
  ): List<ResponsePart> {
    val target = state ?: RendererState(catalogs)
    val responseParts = ArrayList<ResponsePart>()
    val touched = LinkedHashSet<String>()
    val incomplete = HashSet<String>()
    target.transaction {
      try {
        val rawParts =
          if (wrapped) {
            unwrap(content)
          } else {
            listOf(RawResponsePart(part = RawA2uiPart(content), isFinal = true))
          }
        for (rawPart in rawParts) {
          when (val inner = rawPart.part) {
            is TextPart -> responseParts.add(inner)
            is RawA2uiPart -> {
              val messages = compile(inner.a2uiRaw, isFinal = rawPart.isFinal)
              val blockTouched = target.apply(messages, inProgress = !rawPart.isFinal)
              responseParts.add(A2uiPart(messages))
              touched.addAll(blockTouched)
              if (!rawPart.isFinal) {
                incomplete.addAll(blockTouched)
              }
            }
          }
        }
      } catch (e: A2uiError) {
        e.partialResults = responseParts
        throw e
      }
      try {
        val complete = touched.filter { it !in incomplete }
        if (complete.isNotEmpty()) {
          target.checkTopology(complete)
        }
      } catch (e: A2uiError) {
        e.partialResults = responseParts.filterIsInstance<TextPart>()
        throw e
      }
      target.markChecked(incomplete)
    }
    return responseParts
  }

  /**
   * Opens an incremental stream that raises on the first rejected block
   * (`afterRejectedBlock="end"`).
   */
  open fun openStream(
    wrapped: Boolean = true,
    state: RendererState? = null,
  ): ResponseStream<ResponsePart> {
    throw UnsupportedOperationException(
      "Incremental streaming is not supported by ${this::class.simpleName}"
    )
  }

  /** Opens an incremental stream that emits [ErrorPart] and continues past rejected blocks. */
  open fun openStreamContinuing(
    wrapped: Boolean = true,
    state: RendererState? = null,
  ): ResponseStream<StreamPart> {
    throw UnsupportedOperationException(
      "Incremental streaming is not supported by ${this::class.simpleName}"
    )
  }

  /** Dynamic policy overload delegating to [openStream] or [openStreamContinuing]. */
  open fun openStream(
    wrapped: Boolean = true,
    state: RendererState? = null,
    afterRejectedBlock: AfterRejectedBlock,
  ): ResponseStream<StreamPart> =
    when (afterRejectedBlock) {
      AfterRejectedBlock.END -> openStream(wrapped = wrapped, state = state)
      AfterRejectedBlock.CONTINUE -> openStreamContinuing(wrapped = wrapped, state = state)
    }
}
