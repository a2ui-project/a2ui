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

package com.google.a2ui.inference_formats.transport

import com.google.a2ui.parser.BlockLexer
import com.google.a2ui.parser.Parser
import com.google.a2ui.parser.PayloadFixer
import com.google.a2ui.parser.ResponsePart
import com.google.a2ui.parser.hasA2uiParts
import com.google.a2ui.parser.sanitizeJsonString
import com.google.a2ui.schema.A2uiConstants
import com.google.a2ui.schema.A2uiValidator
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** Standard A2UI JSON transport parser. */
class TransportParser(private val validator: A2uiValidator? = null) : Parser {

  override fun hasFormatContent(content: String, complete: Boolean): Boolean {
    if (complete) {
      return hasA2uiParts(content)
    }
    return content.contains(A2uiConstants.A2UI_OPEN_TAG.dropLast(1))
  }

  override fun unwrap(content: String): List<ResponsePart> {
    val lexer =
      BlockLexer(openTag = A2uiConstants.A2UI_OPEN_TAG, closeTag = A2uiConstants.A2UI_CLOSE_TAG)
    return lexer.tokenize(content)
  }

  override fun compile(formatContent: String, isFinal: Boolean): List<JsonElement> {
    val cleaned = sanitizeJsonString(formatContent)
    if (cleaned.isEmpty()) return emptyList()
    val elements = PayloadFixer.parseAndFix(cleaned)
    if (validator != null) {
      elements.forEach { validator.validate(it) }
    }
    return elements
  }

  override fun decompile(valElement: JsonObject): String {
    return Json.encodeToString(JsonObject.serializer(), valElement)
  }

  override fun wrapDecompiledBlocks(blocks: List<String>): String {
    return "${A2uiConstants.A2UI_OPEN_TAG}\n${blocks.joinToString("\n")}\n${A2uiConstants.A2UI_CLOSE_TAG}"
  }
}
