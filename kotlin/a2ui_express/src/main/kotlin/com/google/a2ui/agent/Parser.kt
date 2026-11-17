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

import com.google.a2ui.core.A2uiError
import com.google.a2ui.core.AgentToRendererMessage
import com.google.a2ui.core.Catalog
import java.util.Collections
import java.util.WeakHashMap

private val partialResultsStore: MutableMap<A2uiError, List<ResponsePart>> =
  Collections.synchronizedMap(WeakHashMap())

/**
 * Validated [ResponsePart]s emitted prior to an [A2uiError] during [Parser.parseResponse] or
 * [ResponseStream] processing.
 */
var A2uiError.partialResults: List<ResponsePart>
  get() = partialResultsStore[this] ?: emptyList()
  internal set(value) {
    partialResultsStore[this] = value.toList()
  }

/** Policy controlling how [ResponseStream] behaves after rejecting an `<a2ui>` block. */
enum class AfterRejectedBlock {
  /** Raise the [A2uiError] immediately and terminate the stream. */
  END,

  /** Emit an [ErrorPart] for the rejected block, skip the remainder of that block, and continue. */
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

/** Generates format-specific LLM system prompt instructions and examples for active [catalogs]. */
abstract class PromptGenerator {
  abstract val catalogs: List<Catalog>

  open fun generateBaseRules(): String = ""

  open fun generateCatalogInstructions(
    includeSchema: Boolean = true,
    catalog: Catalog? = null,
  ): String = ""

  open fun generateExamples(catalog: Catalog? = null, validate: Boolean = false): String = ""

  /**
   * Assembles the complete system prompt snippet across rules, catalog signatures, and examples.
   */
  fun generate(): String {
    val parts = ArrayList<String>()
    val rules = generateBaseRules()
    if (rules.isNotEmpty()) parts.add(rules)
    val instructions = generateCatalogInstructions(includeSchema = true, catalog = null)
    if (instructions.isNotEmpty()) parts.add(instructions)
    val examples = generateExamples(catalog = null, validate = false)
    if (examples.isNotEmpty()) parts.add("### Examples:\n\n$examples")
    return parts.joinToString("\n\n")
  }
}

/** Covariant incremental chunk-by-chunk parser for a single streamed LLM response. */
interface ResponseStream<out P : StreamPart> {
  val state: RendererState
  val isInBlock: Boolean

  /** Feeds the next text [chunk] and returns any newly completed parts. */
  fun feed(chunk: String): List<P>

  /** Closes the stream at end-of-response and flushes any remaining parts. */
  fun close(): List<P>
}

/**
 * Base class for A2UI inference-format payload parsers, combining format-specific `compile` /
 * `decompile` / `unwrap` logic with stateful [RendererState] verification.
 */
abstract class Parser {
  abstract val catalogs: List<Catalog>

  open val supportsStreaming: Boolean
    get() = false

  /** Checks if [content] contains format-specific syntax or blocks. */
  abstract fun hasFormatContent(content: String, complete: Boolean = false): Boolean

  /** Wraps text and raw A2UI blocks into a single LLM-formatted string. */
  abstract fun wrap(blocks: List<RawResponsePart>): String

  /** Splits raw LLM response content into text and raw A2UI blocks. */
  abstract fun unwrap(content: String): List<RawResponsePart>

  /** Compiles a single raw A2UI block into [AgentToRendererMessage] models. */
  abstract fun compile(formatContent: String, isFinal: Boolean = true): List<AgentToRendererMessage>

  /** Converts a sequence of [AgentToRendererMessage] models back into the format's syntax. */
  abstract fun decompile(a2uiPayload: List<AgentToRendererMessage>): String

  /**
   * Parses a complete LLM response into [ResponsePart] objects, applying all messages atomically
   * against [state] (or a fresh [RendererState] when `null`).
   */
  fun parseResponse(
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
              val (messages, blockTouched) = applyBlock(inner.a2uiRaw, rawPart.isFinal, target)
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

  private fun applyBlock(
    formatContent: String,
    isFinal: Boolean,
    state: RendererState,
  ): Pair<List<AgentToRendererMessage>, List<String>> {
    val messages =
      try {
        compile(formatContent, isFinal = isFinal)
      } catch (e: A2uiError) {
        throw e
      } catch (e: Exception) {
        throw A2uiCompilationException(
          message = "Failed to compile A2UI block: ${e.message}",
          rawBlock = formatContent,
          cause = e,
        )
      }
    val touched = state.apply(messages)
    return messages to touched
  }

  /**
   * Opens an incremental [ResponseStream] that raises on the first rejected block, guaranteeing
   * every emitted item is a [ResponsePart] (`TextPart` or `A2uiPart`).
   */
  open fun openStream(
    wrapped: Boolean = true,
    state: RendererState? = null,
  ): ResponseStream<ResponsePart> {
    throw UnsupportedOperationException("Streaming is not supported by ${this::class.simpleName}.")
  }

  /**
   * Opens an incremental [ResponseStream] that emits [ErrorPart]s and continues after a rejected
   * block.
   */
  open fun openStreamContinuing(
    wrapped: Boolean = true,
    state: RendererState? = null,
  ): ResponseStream<StreamPart> =
    openStream(wrapped = wrapped, state = state, afterRejectedBlock = AfterRejectedBlock.CONTINUE)

  /**
   * Opens an incremental [ResponseStream] configured with [afterRejectedBlock] (`END` or
   * `CONTINUE`, where `CONTINUE` may emit [ErrorPart]s alongside [ResponsePart]s).
   */
  open fun openStream(
    wrapped: Boolean = true,
    state: RendererState? = null,
    afterRejectedBlock: AfterRejectedBlock,
  ): ResponseStream<StreamPart> {
    if (afterRejectedBlock == AfterRejectedBlock.END) {
      return openStream(wrapped = wrapped, state = state)
    }
    throw UnsupportedOperationException("Streaming is not supported by ${this::class.simpleName}.")
  }
}
