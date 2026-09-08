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

package com.google.a2ui.parser

import com.google.a2ui.exceptions.A2uiParseException
import com.google.a2ui.parser.errors.A2uiCompilationError
import com.google.a2ui.schema.A2uiConstants
import com.google.a2ui.schema.A2uiValidator
import java.util.logging.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

private val logger = Logger.getLogger("com.google.a2ui.parser.Parser")

internal val A2UI_BLOCK_REGEX =
  Regex(
    "<a2ui-json(?:\\s+[^>]*)?>(.*?)</a2ui-json>",
    setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE),
  )

/** Represents a part of the LLM response. */
data class ResponsePart(
  val text: String = "",
  val a2uiRaw: String? = null,
  val a2uiJson: List<JsonElement>? = null,
  val isFinal: Boolean = true,
)

/** Abstract interface defining response unwrapping, compilation, and decompilation. */
interface Parser {
  /** Checks if the content contains blocks belonging to this parser's format. */
  fun hasFormatContent(content: String, complete: Boolean = false): Boolean

  /** Parses full response content into standard JSON payload parts by unwrapping and compiling. */
  fun parseResponse(content: String): List<ResponsePart> {
    val parts = unwrap(content)
    val parsedSoFar = mutableListOf<ResponsePart>()
    val result = mutableListOf<ResponsePart>()
    for (part in parts) {
      if (part.a2uiRaw != null) {
        try {
          val compiled = compile(part.a2uiRaw, isFinal = part.isFinal)
          val updated = part.copy(a2uiJson = compiled)
          result.add(updated)
          parsedSoFar.add(updated)
        } catch (e: Exception) {
          if (e is A2uiCompilationError) {
            e.partialResults = parsedSoFar
            throw e
          }
          throw A2uiCompilationError(
            message = e.message ?: "Compilation failed",
            rawContent = part.a2uiRaw,
            partialResults = parsedSoFar,
            cause = e,
          )
        }
      } else {
        result.add(part)
        parsedSoFar.add(part)
      }
    }
    return result
  }

  /** Tokenizes response content into raw format-content parts. */
  fun unwrap(content: String): List<ResponsePart>

  /** Compiles raw format-content to structured A2UI messages. */
  fun compile(formatContent: String, isFinal: Boolean = true): List<JsonElement>

  /** Decompiles a structured A2UI payload into this format's raw notation. */
  fun decompile(valElement: JsonObject): String

  /** Wraps multiple decompiled blocks with the format's enclosing tags/markers. */
  fun wrapDecompiledBlocks(blocks: List<String>): String = blocks.joinToString("\n")

  /** Whether the parser supports streaming token chunk compilation. */
  val supportsStreaming: Boolean
    get() = false

  /** Processes a streamed token chunk (incremental parsing). */
  fun processChunk(chunk: String): List<ResponsePart> {
    throw UnsupportedOperationException("Streaming is not supported by ${this::class.simpleName}")
  }
}

/** Checks if the given text contains A2UI delimiter tags. */
fun hasA2uiParts(text: String): Boolean {
  val openRegex = Regex("<a2ui-json\\b[^>]*>", RegexOption.IGNORE_CASE)
  val closeRegex = Regex("</a2ui-json\\s*>", RegexOption.IGNORE_CASE)
  return openRegex.containsMatchIn(text) && closeRegex.containsMatchIn(text)
}

/** Parses the response text into a list of ResponsePart objects (legacy helper). */
fun parseResponseToParts(text: String, validator: A2uiValidator? = null): List<ResponsePart> {
  val lexer =
    BlockLexer(openTag = A2uiConstants.A2UI_OPEN_TAG, closeTag = A2uiConstants.A2UI_CLOSE_TAG)
  val parts = lexer.tokenize(text)

  val hasA2ui = parts.any { it.a2uiRaw != null }
  if (!hasA2ui) {
    throw A2uiParseException(
      "A2UI tags '${A2uiConstants.A2UI_OPEN_TAG}' and '${A2uiConstants.A2UI_CLOSE_TAG}' not found in response."
    )
  }

  val responseParts = mutableListOf<ResponsePart>()
  for (part in parts) {
    if (part.a2uiRaw != null) {
      if (part.a2uiRaw.isEmpty()) {
        throw A2uiParseException("A2UI JSON part is empty.")
      }
      val elements = PayloadFixer.parseAndFix(part.a2uiRaw)
      elements.forEach { validator?.validate(it) }
      responseParts.add(part.copy(a2uiJson = elements))
    } else {
      responseParts.add(part)
    }
  }

  return responseParts
}

/** Sanitize LLM output by removing markdown code blocks if present. */
fun sanitizeJsonString(jsonString: String): String {
  var s = jsonString.trim()
  s = s.replace(Regex("^```[a-zA-Z-]*\\s*", RegexOption.IGNORE_CASE), "")
  s = s.replace(Regex("\\s*```[a-zA-Z-]*$", RegexOption.IGNORE_CASE), "")
  return s.trim()
}
