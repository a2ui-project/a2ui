/*
 * Copyright 2024 Google LLC
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

import com.google.a2ui.parser.Parser
import com.google.a2ui.parser.ResponsePart
import com.google.a2ui.parser.errors.A2uiCompilationError
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiConstants
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Parser implementation for A2UI Express DSL responses (`<a2ui>...</a2ui>`).
 *
 * Implements both the legacy [Parser] interface ([ResponsePart]) and the v1.0 multi-catalog and
 * streaming methods ([unwrapParts], [wrapParts], [parseResponseParts], [openStream],
 * [compileMessages], [decompileMessages]).
 */
class ExpressParser(
  val catalogs: List<A2uiCatalog>,
  val surfaceId: String = "default_surface",
  version: String? = null,
  val progressiveKeys: Set<String> = DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
) : Parser {

  @JvmOverloads
  constructor(
    catalog: A2uiCatalog,
    surfaceId: String = "default_surface",
    version: String? = null,
    progressiveKeys: Set<String> = DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
  ) : this(listOf(catalog), surfaceId, version, progressiveKeys)

  init {
    validateExpressCatalogs(catalogs)
  }

  val catalog: A2uiCatalog = catalogs.first()

  override val supportsStreaming: Boolean = true

  val version: String = resolveExpressVersion(catalogs, version)
  private val lexer = ExpressBlockLexer()
  private val compiler = ExpressCompiler(catalogs, this.version)
  private val decompiler = ExpressDecompiler(catalogs, this.version)

  /**
   * Tracks partial results when a non-compilation [com.google.a2ui.exceptions.A2uiException] is
   * thrown.
   */
  var lastFailurePartialParts: List<ExpressStreamPart> = emptyList()
    private set

  override fun hasFormatContent(content: String, complete: Boolean): Boolean {
    val parts = lexer.tokenize(content)
    return parts.any { it is ExpressStreamPart.RawA2ui && (!complete || it.isFinal) }
  }

  /**
   * Unwraps [content] into separate [ExpressStreamPart.Text] and [ExpressStreamPart.RawA2ui] parts.
   */
  fun unwrapParts(content: String): List<ExpressStreamPart> = lexer.tokenize(content)

  /** Wraps [parts] back into an `<a2ui>...</a2ui>` formatted response string. */
  fun wrapParts(parts: List<ExpressStreamPart>): String {
    if (parts.isEmpty()) return ""
    val sb = StringBuilder()
    for (part in parts) {
      when (part) {
        is ExpressStreamPart.Text -> sb.append(part.text).append('\n')
        is ExpressStreamPart.RawA2ui -> {
          sb
            .append(A2uiConstants.A2UI_INFERENCE_OPEN_TAG)
            .append('\n')
            .append(part.a2uiRaw)
            .append('\n')
            .append(A2uiConstants.A2UI_INFERENCE_CLOSE_TAG)
            .append('\n')
        }
        else -> {}
      }
    }
    return sb.toString().trimEnd()
  }

  /** Compiles a single Express block into validated A2UI wire messages. */
  @JvmOverloads
  fun compileMessages(formatContent: String, isFinal: Boolean = true): List<JsonObject> {
    val messages = compiler.compileMessages(formatContent, surfaceId = surfaceId, isFinal = isFinal)
    if (isFinal) {
      ExpressRendererState.validatePayload(
        catalogs,
        messages,
        compiler.helpers,
        compiler.validators,
      )
    }
    return messages
  }

  /** Decompiles a list of A2UI wire messages back into Express DSL notation. */
  fun decompileMessages(messages: List<JsonObject>): String = decompiler.decompile(messages)

  /**
   * Parses a complete model response into separate [ExpressStreamPart.Text] and
   * [ExpressStreamPart.A2ui] parts, validating surface state atomically across all blocks.
   */
  @JvmOverloads
  fun parseResponseParts(
    content: String,
    wrapped: Boolean = true,
    state: ExpressRendererState? = null,
  ): List<ExpressStreamPart> {
    val targetState = state ?: ExpressRendererState(catalogs)
    val parts = mutableListOf<ExpressStreamPart>()
    return targetState.transaction {
      val touched = LinkedHashSet<String>()
      val incomplete = LinkedHashSet<String>()
      try {
        val rawParts =
          if (wrapped) {
            unwrapParts(content)
          } else {
            listOf(ExpressStreamPart.RawA2ui(a2uiRaw = content, isFinal = true))
          }
        for (raw in rawParts) {
          when (raw) {
            is ExpressStreamPart.Text -> parts.add(raw)
            is ExpressStreamPart.RawA2ui -> {
              val messages =
                compiler.compileMessages(raw.a2uiRaw, surfaceId = surfaceId, isFinal = raw.isFinal)
              for (sid in targetState.apply(messages)) {
                touched.add(sid)
                if (!raw.isFinal) incomplete.add(sid)
              }
              parts.add(ExpressStreamPart.A2ui(messages))
            }
            else -> {}
          }
        }
      } catch (t: Throwable) {
        throw attachPartials(t, parts)
      }

      try {
        val completeIds = touched.filter { it !in incomplete }
        if (completeIds.isNotEmpty()) {
          targetState.checkTopology(completeIds)
        }
      } catch (t: Throwable) {
        throw attachPartials(t, parts.filterIsInstance<ExpressStreamPart.Text>())
      }

      targetState.markChecked(incomplete)
      parts
    }
  }

  /** Opens an incremental [ExpressResponseStream] over incoming chunks. */
  @JvmOverloads
  fun openStream(
    wrapped: Boolean = true,
    state: ExpressRendererState? = null,
    afterRejectedBlock: String = "end",
    progressiveKeys: Set<String> = this.progressiveKeys,
  ): ExpressResponseStream =
    ExpressResponseStream(
      catalogs = catalogs,
      surfaceId = surfaceId,
      version = version,
      wrapped = wrapped,
      state = state,
      afterRejectedBlock = afterRejectedBlock,
      progressiveKeys = progressiveKeys,
    )

  override fun unwrap(content: String): List<ResponsePart> = mergeLegacyParts(unwrapParts(content))

  override fun compile(formatContent: String, isFinal: Boolean): List<JsonElement> =
    compileMessages(formatContent, isFinal = isFinal)

  override fun decompile(valElement: JsonObject): String = decompiler.decompile(valElement)

  fun decompile(a2uiJson: JsonElement): String {
    if (a2uiJson is JsonObject) {
      return decompiler.decompile(a2uiJson)
    }
    if (a2uiJson is kotlinx.serialization.json.JsonArray) {
      return decompiler.decompile(a2uiJson.mapNotNull { it as? JsonObject })
    }
    throw A2uiCompilationError("ExpressParser.decompile requires a JsonObject or JsonArray.")
  }

  fun wrap(blocks: List<ResponsePart>): String {
    val streamParts = mutableListOf<ExpressStreamPart>()
    for (b in blocks) {
      if (b.text.isNotEmpty()) streamParts.add(ExpressStreamPart.Text(b.text))
      if (!b.a2uiRaw.isNullOrEmpty()) streamParts.add(ExpressStreamPart.RawA2ui(b.a2uiRaw))
    }
    return wrapParts(streamParts)
  }

  override fun parseResponse(content: String): List<ResponsePart> {
    val rawParts = unwrapParts(content)
    val parsedParts = parseResponseParts(content, wrapped = true)
    // Preserve legacy ResponsePart pairing (text + a2uiRaw + a2uiJson on same ResponsePart when a
    // text run immediately precedes an <a2ui> block) so pre-existing legacy callers stay unbroken!
    val result = mutableListOf<ResponsePart>()
    var pendingText = ""
    var rawIdx = 0
    val rawA2uiBlocks = rawParts.filterIsInstance<ExpressStreamPart.RawA2ui>()
    for (p in parsedParts) {
      when (p) {
        is ExpressStreamPart.Text -> {
          if (pendingText.isNotEmpty()) {
            result.add(ResponsePart(text = pendingText))
          }
          pendingText = p.text
        }
        is ExpressStreamPart.A2ui -> {
          val rawDsl = rawA2uiBlocks.getOrNull(rawIdx)?.a2uiRaw
          rawIdx++
          result.add(ResponsePart(text = pendingText, a2uiRaw = rawDsl, a2uiJson = p.a2ui))
          pendingText = ""
        }
        else -> {}
      }
    }
    if (pendingText.isNotEmpty()) {
      result.add(ResponsePart(text = pendingText))
    }
    return result
  }

  private fun mergeLegacyParts(parts: List<ExpressStreamPart>): List<ResponsePart> {
    val result = mutableListOf<ResponsePart>()
    var pendingText = ""
    for (p in parts) {
      when (p) {
        is ExpressStreamPart.Text -> {
          if (pendingText.isNotEmpty()) result.add(ResponsePart(text = pendingText))
          pendingText = p.text
        }
        is ExpressStreamPart.RawA2ui -> {
          result.add(ResponsePart(text = pendingText, a2uiRaw = p.a2uiRaw))
          pendingText = ""
        }
        else -> {}
      }
    }
    if (pendingText.isNotEmpty()) result.add(ResponsePart(text = pendingText))
    return result
  }

  private fun attachPartials(t: Throwable, partial: List<ExpressStreamPart>): Throwable {
    lastFailurePartialParts = partial
    if (t is A2uiCompilationError) {
      t.partialResults = toLegacyResponseParts(partial)
    }
    return t
  }
}
