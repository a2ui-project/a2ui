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

import com.google.a2ui.agent.RawA2uiPart
import com.google.a2ui.agent.RawResponsePart
import com.google.a2ui.agent.TextPart

/**
 * State-machine scanner extracting `<a2ui>...</a2ui>` Express blocks from one-shot LLM responses,
 * respecting strings, raw strings, line comments, block comments, markdown fences, and missing
 * opening sentinel tag recovery.
 */
internal object ExpressBlockLexer {
  private val OPEN_TAG_RE = Regex("<a2ui(?:\\s[^>]*)?>", RegexOption.IGNORE_CASE)
  private val CLOSE_TAG_RE = Regex("</a2ui\\s*>", RegexOption.IGNORE_CASE)
  private val LEADING_FENCE_RE = Regex("^```[a-zA-Z0-9_-]*\\s*", RegexOption.IGNORE_CASE)
  private val TRAILING_FENCE_RE = Regex("\\s*```[a-zA-Z0-9_-]*$", RegexOption.IGNORE_CASE)
  private val OPEN_FENCE_RE =
    Regex("^[ \\t]*```[a-zA-Z0-9_-]*[ \\t]*\\r?\\n?", RegexOption.MULTILINE)
  private val CLOSING_FENCE_END_RE = Regex("\\r?\\n?[ \\t]*```[ \\t]*\\r?\\n?$")
  private val EXPRESS_PAYLOAD_START_RE =
    Regex(
      """^[ \t]*(?:surface\s*\(|deleteSurface\s*\(|\$[a-zA-Z0-9_/]*\s*=(?!=)|[a-zA-Z_][a-zA-Z0-9_]*\s*=(?!=))""",
      RegexOption.MULTILINE,
    )

  private enum class State {
    IN_A2UI,
    IN_STRING,
    IN_RAW_STRING,
    IN_LINE_COMMENT,
    IN_BLOCK_COMMENT,
  }

  fun tokenize(content: String): List<RawResponsePart> {
    val parts = ArrayList<RawResponsePart>()
    val n = content.length
    var i = 0
    var recoveredUnmatched = false

    while (i < n) {
      val openMatch = OPEN_TAG_RE.find(content, i)
      val searchEnd = openMatch?.range?.first ?: n
      if (!recoveredUnmatched && searchEnd > i) {
        val nextI = tryRecoverUnmatchedClose(parts, content, i, searchEnd)
        if (nextI != null) {
          recoveredUnmatched = true
          i = nextI
          continue
        }
      }
      if (openMatch == null) break
      addText(parts, content.substring(i, openMatch.range.first))
      val openEnd = openMatch.range.last + 1
      val closeSpan = scanBlock(content, openEnd, n)
      if (closeSpan == null) {
        parts.add(
          RawResponsePart(part = RawA2uiPart(cleanRaw(content.substring(openEnd))), isFinal = false)
        )
        return parts
      }
      val (closeStart, closeEnd) = closeSpan
      parts.add(
        RawResponsePart(
          part = RawA2uiPart(cleanRaw(content.substring(openEnd, closeStart))),
          isFinal = true,
        )
      )
      i = closeEnd
    }

    addText(parts, content.substring(i))
    return parts
  }

  private fun cleanMarkdown(rawText: String): String {
    if (rawText.isEmpty()) return ""
    var text = rawText.trim()
    text = LEADING_FENCE_RE.replaceFirst(text, "")
    text = TRAILING_FENCE_RE.replaceFirst(text, "")
    text = text.trim()
    return if (text.trim('`').isEmpty()) "" else text
  }

  private fun cleanRaw(text: String): String = cleanMarkdown(text).trim('`').trim()

  private fun addText(parts: MutableList<RawResponsePart>, text: String) {
    val cleaned = cleanMarkdown(text)
    if (cleaned.isNotEmpty()) {
      parts.add(RawResponsePart(part = TextPart(cleaned), isFinal = true))
    }
  }

  private fun scanBlock(content: String, start: Int, end: Int): Pair<Int, Int>? {
    var i = start
    var state = State.IN_A2UI
    var tripleQuote = false

    while (i < end) {
      when (state) {
        State.IN_A2UI -> {
          val closeMatch = CLOSE_TAG_RE.matchAt(content, i)
          if (closeMatch != null && closeMatch.range.last < end) {
            return i to (closeMatch.range.last + 1)
          }
          val ch = content[i]
          if (
            (ch == 'r' || ch == 'R') &&
              i + 1 < end &&
              content[i + 1] == '"' &&
              (i == start || !(content[i - 1].isLetterOrDigit() || content[i - 1] == '_'))
          ) {
            if (i + 3 < end && content.startsWith("\"\"\"", i + 1)) {
              tripleQuote = true
              i += 4
            } else {
              tripleQuote = false
              i += 2
            }
            state = State.IN_RAW_STRING
            continue
          }
          if (ch == '"') {
            if (i + 2 < end && content.startsWith("\"\"\"", i)) {
              tripleQuote = true
              i += 3
            } else {
              tripleQuote = false
              i += 1
            }
            state = State.IN_STRING
            continue
          }
          if (content.startsWith("/*", i)) {
            i += 2
            state = State.IN_BLOCK_COMMENT
            continue
          }
          if (ch == '#' || content.startsWith("//", i) || content.startsWith("--", i)) {
            i += if (ch == '#') 1 else 2
            state = State.IN_LINE_COMMENT
            continue
          }
          i++
        }
        State.IN_STRING -> {
          if (content[i] == '\\') {
            i += 2
            continue
          }
          if (tripleQuote) {
            if (content.startsWith("\"\"\"", i)) {
              i += 3
              state = State.IN_A2UI
              continue
            }
          } else if (content[i] == '"') {
            i += 1
            state = State.IN_A2UI
            continue
          }
          i++
        }
        State.IN_RAW_STRING -> {
          if (tripleQuote) {
            if (content.startsWith("\"\"\"", i)) {
              i += 3
              state = State.IN_A2UI
              continue
            }
          } else if (content[i] == '"' || content[i] == '\n' || content[i] == '\r') {
            i += 1
            state = State.IN_A2UI
            continue
          }
          i++
        }
        State.IN_LINE_COMMENT -> {
          val closeMatch = CLOSE_TAG_RE.matchAt(content, i)
          if (closeMatch != null && closeMatch.range.last < end) {
            return i to (closeMatch.range.last + 1)
          }
          if (content[i] == '\n' || content[i] == '\r') {
            state = State.IN_A2UI
          }
          i++
        }
        State.IN_BLOCK_COMMENT -> {
          if (content.startsWith("*/", i)) {
            i += 2
            state = State.IN_A2UI
            continue
          }
          i++
        }
      }
    }
    return null
  }

  private fun tryRecoverUnmatchedClose(
    parts: MutableList<RawResponsePart>,
    content: String,
    start: Int,
    searchEnd: Int,
  ): Int? {
    val segment = content.substring(start, searchEnd)
    if (!CLOSE_TAG_RE.containsMatchIn(segment)) return null

    val fences = OPEN_FENCE_RE.findAll(segment).toList()
    var idx = 0
    while (idx < fences.size) {
      val fence = fences[idx]
      val fenceEnd = fence.range.last + 1
      val closeSpan = scanBlock(segment, fenceEnd, segment.length)
      if (closeSpan != null) {
        val (closeStart, closeEnd) = closeSpan
        val body = segment.substring(fenceEnd, closeStart)
        val bodyStripped = CLOSING_FENCE_END_RE.replaceFirst(body, "")
        if (!OPEN_FENCE_RE.containsMatchIn(bodyStripped)) {
          val rawContent = cleanRaw(bodyStripped)
          if (rawContent.isNotEmpty()) {
            addText(parts, segment.substring(0, fence.range.first))
            parts.add(RawResponsePart(part = RawA2uiPart(rawContent), isFinal = true))
            return start + closeEnd
          }
        }
      }
      idx += 2
    }

    var searchFrom = 0
    var pairIdx = 0
    while (pairIdx + 1 < fences.size) {
      val secondFenceEnd = fences[pairIdx + 1].range.last + 1
      if (scanBlock(segment, secondFenceEnd, segment.length) == null) break
      searchFrom = secondFenceEnd
      pairIdx += 2
    }

    val stmtMatch = EXPRESS_PAYLOAD_START_RE.find(segment, searchFrom) ?: return null
    val closeSpan = scanBlock(segment, stmtMatch.range.first, segment.length) ?: return null
    val (closeStart, closeEnd) = closeSpan
    val rawContent = cleanRaw(segment.substring(stmtMatch.range.first, closeStart))
    if (rawContent.isEmpty()) return null
    addText(parts, segment.substring(0, stmtMatch.range.first))
    parts.add(RawResponsePart(part = RawA2uiPart(rawContent), isFinal = true))
    return start + closeEnd
  }
}
