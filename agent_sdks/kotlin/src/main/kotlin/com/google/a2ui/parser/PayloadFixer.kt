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

import java.util.logging.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** Validates and applies autofixes to raw JSON strings. */
object PayloadFixer {

  private val logger = Logger.getLogger(PayloadFixer::class.java.name)

  /**
   * Parses and applies autofixes to a raw JSON string and returns the parsed payload as a list of
   * components.
   *
   * @param payload The raw JSON string from the LLM.
   * @return A parsed and potentially fixed payload (array of JsonElements).
   */
  fun parseAndFix(payload: String): List<JsonElement> {
    val normalizedPayload = normalizeSmartQuotes(payload)
    return try {
      parse(normalizedPayload)
    } catch (e: Exception) {
      logger.warning("Initial A2UI payload validation failed: ${e.message}")
      parse(removeTrailingCommas(normalizedPayload))
    }
  }

  /**
   * Replaces smart (curly) quotes with standard straight quotes.
   *
   * @param jsonStr The raw JSON string from the LLM.
   * @return A string with curly quotes replaced by straight quotes.
   */
  fun normalizeSmartQuotes(jsonStr: String): String {
    return jsonStr
      .replace('\u201C', '"') // “
      .replace('\u201D', '"') // ”
      .replace('\u2018', '\'') // ‘
      .replace('\u2019', '\'') // ’
  }

  private fun parse(payload: String): List<JsonElement> =
    try {
      when (val element = Json.parseToJsonElement(payload)) {
        is JsonArray -> element.toList()
        is JsonObject -> {
          logger.info("Received a single JSON object, wrapping in a list for validation.")
          listOf(element)
        }
        else ->
          throw IllegalArgumentException(
            "Payload must be a JSON Array or Object, got: ${element::class.simpleName}"
          )
      }
    } catch (e: Exception) {
      logger.severe("Failed to parse JSON: ${e.message}")
      throw IllegalArgumentException("Failed to parse JSON: ${e.message}", e)
    }

  /**
   * Attempts to remove trailing commas from a JSON string.
   *
   * This implementation is quote-aware and will not modify commas inside strings.
   *
   * @param jsonStr The raw JSON string from the LLM.
   * @return A potentially fixed JSON string.
   */
  fun removeTrailingCommas(jsonStr: String): String {
    val result = StringBuilder()
    var inString = false
    var i = 0
    var lastCommaIndex = -1

    while (i < jsonStr.length) {
      val c = jsonStr[i]

      if (c == '"' && (i == 0 || jsonStr[i - 1] != '\\')) {
        inString = !inString
      }

      if (!inString) {
        when {
          c == ',' -> lastCommaIndex = result.length
          (c == ']' || c == '}') && lastCommaIndex != -1 -> {
            val contentBetween = result.substring(lastCommaIndex + 1)
            if (contentBetween.isBlank()) {
              result.deleteCharAt(lastCommaIndex)
            }
            lastCommaIndex = -1
          }
          !c.isWhitespace() -> lastCommaIndex = -1
        }
      }

      result.append(c)
      i++
    }

    val fixedJson = result.toString()
    if (fixedJson != jsonStr) {
      logger.warning("Detected trailing commas in LLM output; applied robust autofix.")
    }
    return fixedJson
  }
}
