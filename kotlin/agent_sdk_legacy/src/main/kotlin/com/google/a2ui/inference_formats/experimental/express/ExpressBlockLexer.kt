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

package com.google.a2ui.inference_formats.experimental.express

/** Raw or compiled part emitted by [ExpressParser] or [ExpressResponseStream]. */
sealed interface ExpressStreamPart {
  data class Text(val text: String) : ExpressStreamPart

  data class RawA2ui(val a2uiRaw: String, val isFinal: Boolean = true) : ExpressStreamPart

  data class A2ui(val a2ui: List<kotlinx.serialization.json.JsonObject>) : ExpressStreamPart

  data class Error(val error: Throwable) : ExpressStreamPart
}

/**
 * String- and comment-aware `<a2ui>` / `</a2ui>` block lexer for Express responses.
 *
 * Honors `Express.g4` lexical rules:
 * - Only `"` (and `"""`, `r"`, `r"""`) open string literals; apostrophes in prose/comments do not.
 * - Single-line comments (`#`, `//`, `--`) end at newline, while `</a2ui>` on a comment line still
 *   closes the block.
 * - Block comments (`/` + `* ... *` + `/`) mask quotes and `</a2ui>` until closed.
 * - Strips markdown code fences and inline-code edge backticks.
 * - Recovers at most one block with an omitted opening `<a2ui>` tag when anchored by a code fence
 *   or Express statement start before `</a2ui>`.
 */
internal class ExpressBlockLexer {
  private enum class State {
    IN_A2UI,
    IN_STRING,
    IN_RAW_STRING,
    IN_COMMENT,
    IN_BLOCK_COMMENT,
  }

  fun tokenize(content: String): List<ExpressStreamPart> {
    if (content.isEmpty()) return emptyList()
    val parts = mutableListOf<ExpressStreamPart>()
    val n = content.length
    var i = 0
    var recoveredUnmatched = false

    while (i < n) {
      val openMatch = OPEN_TAG_REGEX.find(content, i)
      val openStart = openMatch?.range?.first
      val searchEnd = openStart ?: n

      if (!recoveredUnmatched && searchEnd > i) {
        val nextI = tryRecoverUnmatchedClose(parts, content, i, searchEnd)
        if (nextI != null) {
          recoveredUnmatched = true
          i = nextI
          continue
        }
      }

      if (openStart == null) {
        break
      }

      addText(parts, content.substring(i, openStart))
      val openEnd = openMatch.range.last + 1
      val closeSpan = scanBlock(content, openEnd, n)
      if (closeSpan == null) {
        parts.add(
          ExpressStreamPart.RawA2ui(a2uiRaw = cleanRaw(content.substring(openEnd)), isFinal = false)
        )
        return parts
      }

      val (closeStart, closeEnd) = closeSpan
      parts.add(
        ExpressStreamPart.RawA2ui(
          a2uiRaw = cleanRaw(content.substring(openEnd, closeStart)),
          isFinal = true,
        )
      )
      i = closeEnd
    }

    addText(parts, content.substring(i))
    return parts
  }

  private fun scanBlock(content: String, start: Int, end: Int): Pair<Int, Int>? {
    var i = start
    var state = State.IN_A2UI
    var tripleQuote = false

    while (i < end) {
      when (state) {
        State.IN_A2UI -> {
          val closeMatch = CLOSE_TAG_REGEX.matchAt(content, i)
          if (closeMatch != null && closeMatch.range.last + 1 <= end) {
            return i to (closeMatch.range.last + 1)
          }

          if (
            (content[i] == 'r' || content[i] == 'R') &&
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

          if (content[i] == '"') {
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

          if (i + 1 < end && content.startsWith("/*", i)) {
            i += 2
            state = State.IN_BLOCK_COMMENT
            continue
          }

          if (
            content[i] == '#' ||
              (i + 1 < end && content.startsWith("//", i)) ||
              (i + 1 < end && content.startsWith("--", i))
          ) {
            i += if (content[i] == '#') 1 else 2
            state = State.IN_COMMENT
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
            i++
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
          } else if (content[i] == '"') {
            i++
            state = State.IN_A2UI
            continue
          }
          i++
        }

        State.IN_COMMENT -> {
          val closeMatch = CLOSE_TAG_REGEX.matchAt(content, i)
          if (closeMatch != null && closeMatch.range.last + 1 <= end) {
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
    parts: MutableList<ExpressStreamPart>,
    content: String,
    start: Int,
    searchEnd: Int,
  ): Int? {
    val segment = content.substring(start, searchEnd)
    if (!CLOSE_TAG_REGEX.containsMatchIn(segment)) return null

    val fences = OPEN_FENCE_LINE_REGEX.findAll(segment).toList()
    var idx = 0
    while (idx < fences.size) {
      val fence = fences[idx]
      val fenceStart = fence.range.first
      val fenceEnd = fence.range.last + 1
      val closeSpan = scanBlock(segment, fenceEnd, segment.length)
      if (closeSpan != null) {
        val (closeStart, closeEnd) = closeSpan
        val body = segment.substring(fenceEnd, closeStart)
        val bodyStripped = body.replace(CLOSING_FENCE_END_REGEX, "")
        if (!OPEN_FENCE_LINE_REGEX.containsMatchIn(bodyStripped)) {
          val rawContent = cleanRaw(bodyStripped)
          if (rawContent.isNotEmpty()) {
            addText(parts, segment.substring(0, fenceStart))
            parts.add(ExpressStreamPart.RawA2ui(a2uiRaw = rawContent, isFinal = true))
            // Consume a trailing closing fence right after </a2ui> if present (`</a2ui>\n``` `)
            var nextPos = start + closeEnd
            val afterMatch = TRAILING_FENCE_AFTER_CLOSE_REGEX.matchAt(content, nextPos)
            if (afterMatch != null) {
              nextPos = afterMatch.range.last + 1
            }
            return nextPos
          }
        }
      }
      idx += 2
    }

    var searchFrom = 0
    var pairIdx = 0
    while (pairIdx + 1 < fences.size) {
      val closeFence = fences[pairIdx + 1]
      val closeFenceEnd = closeFence.range.last + 1
      if (scanBlock(segment, closeFenceEnd, segment.length) == null) break
      searchFrom = closeFenceEnd
      pairIdx += 2
    }

    val subSegment = segment.substring(searchFrom)
    val stmtMatch = EXPRESS_PAYLOAD_START_REGEX.find(subSegment) ?: return null
    val stmtStart = searchFrom + stmtMatch.range.first
    val closeSpan = scanBlock(segment, stmtStart, segment.length) ?: return null
    val (closeStart, closeEnd) = closeSpan
    val rawContent = cleanRaw(segment.substring(stmtStart, closeStart))
    if (rawContent.isEmpty()) return null

    addText(parts, segment.substring(0, stmtStart))
    parts.add(ExpressStreamPart.RawA2ui(a2uiRaw = rawContent, isFinal = true))
    return start + closeEnd
  }

  private fun addText(parts: MutableList<ExpressStreamPart>, text: String) {
    val cleaned = cleanMarkdown(text)
    if (cleaned.isNotEmpty()) {
      parts.add(ExpressStreamPart.Text(cleaned))
    }
  }

  private fun cleanMarkdown(text: String): String {
    if (text.isEmpty()) return ""
    var cleaned = text.trim()
    cleaned = cleaned.replace(LEADING_FENCE_REGEX, "")
    cleaned = cleaned.replace(TRAILING_FENCE_REGEX, "")
    cleaned = cleaned.trim()
    return if (BACKTICKS_ONLY_REGEX.matches(cleaned)) "" else cleaned
  }

  private fun cleanRaw(text: String): String = cleanMarkdown(text).trim('`').trim()

  companion object {
    private val OPEN_TAG_REGEX = Regex("""<a2ui(?:\s[^>]*)?>""", RegexOption.IGNORE_CASE)
    private val CLOSE_TAG_REGEX = Regex("""</a2ui\s*>""", RegexOption.IGNORE_CASE)
    private val LEADING_FENCE_REGEX = Regex("""^```[a-zA-Z0-9_-]*\s*""", RegexOption.IGNORE_CASE)
    private val TRAILING_FENCE_REGEX = Regex("""\s*```[a-zA-Z0-9_-]*$""", RegexOption.IGNORE_CASE)
    private val OPEN_FENCE_LINE_REGEX =
      Regex("""^[ \t]*```[a-zA-Z0-9_-]*[ \t]*\r?\n?""", RegexOption.MULTILINE)
    private val CLOSING_FENCE_END_REGEX = Regex("""\r?\n?[ \t]*```[ \t]*\r?\n?$""")
    private val TRAILING_FENCE_AFTER_CLOSE_REGEX =
      Regex("""[ \t]*\r?\n?[ \t]*```[ \t]*(?:\r?\n|$)""")
    private val BACKTICKS_ONLY_REGEX = Regex("""^`*$""")
    private val EXPRESS_PAYLOAD_START_REGEX =
      Regex(
        """^[ \t]*(?:surface\s*\(|deleteSurface\s*\(|\$[a-zA-Z0-9_/]*\s*=(?!=)|[\p{L}_][\p{L}\p{N}_]*\s*=(?!=))""",
        RegexOption.MULTILINE,
      )
  }
}
