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
    "${A2uiConstants.A2UI_OPEN_TAG}(.*?)${A2uiConstants.A2UI_CLOSE_TAG}",
    RegexOption.DOT_MATCHES_ALL,
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
fun hasA2uiParts(text: String): Boolean =
  text.contains(A2uiConstants.A2UI_OPEN_TAG) && text.contains(A2uiConstants.A2UI_CLOSE_TAG)

/** Parses the response text into a list of ResponsePart objects (legacy helper). */
fun parseResponseToParts(text: String, validator: A2uiValidator? = null): List<ResponsePart> {
  val matches = A2UI_BLOCK_REGEX.findAll(text).toList()

  if (matches.isEmpty()) {
    throw A2uiParseException(
      "A2UI tags '${A2uiConstants.A2UI_OPEN_TAG}' and '${A2uiConstants.A2UI_CLOSE_TAG}' not found in response."
    )
  }

  val responseParts = mutableListOf<ResponsePart>()
  var lastEnd = 0

  for (match in matches) {
    val start = match.range.first
    val end = match.range.last + 1
    val textPart = text.substring(lastEnd, start).trim()

    val jsonString = match.groupValues[1]
    val jsonStringCleaned = sanitizeJsonString(jsonString)

    if (jsonStringCleaned.isEmpty()) {
      throw A2uiParseException("A2UI JSON part is empty.")
    }

    val elements = PayloadFixer.parseAndFix(jsonStringCleaned)
    elements.forEach { validator?.validate(it) }

    responseParts.add(ResponsePart(text = textPart, a2uiRaw = jsonString, a2uiJson = elements))
    lastEnd = end
  }

  val trailingText = text.substring(lastEnd).trim()
  if (trailingText.isNotEmpty()) {
    responseParts.add(ResponsePart(text = trailingText, a2uiRaw = null, a2uiJson = null))
  }

  return responseParts
}

/** Sanitize LLM output by removing markdown code blocks if present. */
fun sanitizeJsonString(jsonString: String): String =
  jsonString.trim().removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
