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

/** Tokenizes text streams into text and enclosed block regions. */
class BlockLexer(
  val openTag: String,
  val closeTag: String,
  val stringDelimiters: Set<Char> = setOf('"', '\''),
  val singleLineComments: Set<Char> = setOf('#'),
) {
  fun tokenize(content: String): List<ResponsePart> {
    val parts = mutableListOf<ResponsePart>()
    var cursor = 0

    while (cursor < content.length) {
      val openIndex = content.indexOf(openTag, cursor)
      if (openIndex == -1) {
        val remainingText = content.substring(cursor)
        if (remainingText.isNotEmpty()) {
          parts.add(ResponsePart(text = remainingText))
        }
        break
      }

      val textBefore = content.substring(cursor, openIndex)
      if (textBefore.isNotEmpty()) {
        parts.add(ResponsePart(text = textBefore))
      }

      val blockStart = openIndex + openTag.length
      val closeIndex = content.indexOf(closeTag, blockStart)

      if (closeIndex == -1) {
        // Unclosed block
        val rawContent = content.substring(blockStart)
        parts.add(ResponsePart(text = "", a2uiRaw = rawContent, isFinal = false))
        break
      } else {
        val rawContent = content.substring(blockStart, closeIndex)
        parts.add(ResponsePart(text = "", a2uiRaw = rawContent, isFinal = true))
        cursor = closeIndex + closeTag.length
      }
    }

    return parts
  }
}
