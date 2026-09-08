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

private enum class LexerState {
  NORMAL,
  IN_A2UI,
  IN_STRING,
  IN_COMMENT,
}

/** Tokenizes text streams into text and enclosed block regions. */
class BlockLexer(
  val openTag: String,
  val closeTag: String,
  val stringDelimiters: Set<Char> = setOf('"', '\''),
  val singleLineComments: Set<Char> = setOf('#'),
) {
  private val openTagPattern: Regex
  private val closeTagPattern: Regex

  init {
    val openName = openTag.trim().trimStart('<').trimEnd('>')
    val closeName = closeTag.trim().trimStart('<', '/').trimEnd('>')
    openTagPattern = Regex("<${Regex.escape(openName)}\\b[^>]*>", RegexOption.IGNORE_CASE)
    closeTagPattern = Regex("</${Regex.escape(closeName)}\\s*>", RegexOption.IGNORE_CASE)
  }

  fun tokenize(content: String): List<ResponsePart> {
    val parts = mutableListOf<ResponsePart>()
    val n = content.length
    var i = 0

    var state = LexerState.NORMAL
    val currentText = StringBuilder()
    val currentRaw = StringBuilder()

    var stringDelim = ""
    var tripleQuote = false

    while (i < n) {
      if (state == LexerState.NORMAL) {
        val match = openTagPattern.find(content, i)?.let { if (it.range.first == i) it else null }
        if (match != null) {
          i = match.range.last + 1
          state = LexerState.IN_A2UI
          currentRaw.clear()
          continue
        } else {
          currentText.append(content[i])
          i++
          continue
        }
      }

      if (state == LexerState.IN_A2UI) {
        val match = closeTagPattern.find(content, i)?.let { if (it.range.first == i) it else null }
        if (match != null) {
          val rawContent = sanitizeJsonString(currentRaw.toString())
          val textPart = currentText.toString().trim()
          parts.add(ResponsePart(text = textPart, a2uiRaw = rawContent, isFinal = true))
          currentText.clear()
          currentRaw.clear()
          state = LexerState.NORMAL
          i = match.range.last + 1
          continue
        }

        val ch = content[i]
        if (ch in stringDelimiters) {
          if (i + 2 < n && content[i + 1] == ch && content[i + 2] == ch) {
            stringDelim = "$ch$ch$ch"
            tripleQuote = true
            currentRaw.append(stringDelim)
            i += 3
          } else {
            stringDelim = "$ch"
            tripleQuote = false
            currentRaw.append(ch)
            i += 1
          }
          state = LexerState.IN_STRING
          continue
        }

        var commentStart = false
        for (cm in singleLineComments) {
          if (content[i] == cm) {
            currentRaw.append(cm)
            i += 1
            state = LexerState.IN_COMMENT
            commentStart = true
            break
          }
        }
        if (commentStart) continue

        currentRaw.append(ch)
        i++
        continue
      }

      if (state == LexerState.IN_STRING) {
        if (content[i] == '\\') {
          if (i + 1 < n) {
            currentRaw.append(content.substring(i, i + 2))
            i += 2
          } else {
            currentRaw.append(content[i])
            i += 1
          }
          continue
        }

        if (tripleQuote) {
          if (content.startsWith(stringDelim, i)) {
            currentRaw.append(stringDelim)
            i += 3
            state = LexerState.IN_A2UI
            continue
          }
        } else {
          if (content[i] == stringDelim[0]) {
            currentRaw.append(stringDelim)
            i += 1
            state = LexerState.IN_A2UI
            continue
          }
        }

        currentRaw.append(content[i])
        i++
        continue
      }

      if (state == LexerState.IN_COMMENT) {
        val ch = content[i]
        currentRaw.append(ch)
        i++
        if (ch == '\n' || ch == '\r') {
          state = LexerState.IN_A2UI
        }
        continue
      }
    }

    if (state in setOf(LexerState.IN_A2UI, LexerState.IN_STRING, LexerState.IN_COMMENT)) {
      val rawContent = sanitizeJsonString(currentRaw.toString())
      val textPart = currentText.toString().trim()
      parts.add(ResponsePart(text = textPart, a2uiRaw = rawContent, isFinal = false))
    } else {
      val trailing = currentText.toString().trim()
      if (trailing.isNotEmpty()) {
        parts.add(ResponsePart(text = trailing, a2uiRaw = null))
      }
    }

    return parts
  }
}
