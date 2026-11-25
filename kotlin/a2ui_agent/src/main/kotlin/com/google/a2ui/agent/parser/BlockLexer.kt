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

package com.google.a2ui.agent.parser

/**
 * Sentinel tag tokenizer shared across streaming and one-shot parsers (`a2ui_agent.blueprint.md`
 * §2, §3.C).
 *
 * Holds back trailing characters that could still form a prefix of [openTag] or [closeTag] until
 * the next chunk arrives or [flush] is called at end-of-stream.
 */
class BlockLexer(val openTag: String, val closeTag: String) {
  private val buffer = StringBuilder()

  var isInBlock: Boolean = false
    private set

  fun hasTag(content: String, complete: Boolean = false): Boolean {
    val openIdx = content.indexOf(openTag)
    if (openIdx < 0) return false
    if (!complete) return true
    return content.indexOf(closeTag, startIndex = openIdx + openTag.length) >= 0
  }

  fun unwrapAll(content: String): List<RawResponsePart> {
    val parts = mutableListOf<RawResponsePart>()
    var cursor = 0
    while (cursor < content.length) {
      val openIdx = content.indexOf(openTag, startIndex = cursor)
      if (openIdx < 0) {
        parts.add(RawResponsePart(TextPart(content.substring(cursor)), isFinal = true))
        break
      }
      if (openIdx > cursor) {
        parts.add(RawResponsePart(TextPart(content.substring(cursor, openIdx)), isFinal = true))
      }
      val bodyStart = openIdx + openTag.length
      val closeIdx = content.indexOf(closeTag, startIndex = bodyStart)
      if (closeIdx < 0) {
        parts.add(
          RawResponsePart(RawA2uiPart(content.substring(bodyStart).trim()), isFinal = false)
        )
        break
      }
      parts.add(
        RawResponsePart(RawA2uiPart(content.substring(bodyStart, closeIdx).trim()), isFinal = true)
      )
      cursor = closeIdx + closeTag.length
    }
    return parts
  }

  fun feed(chunk: String): List<RawResponsePart> {
    buffer.append(chunk)
    val emitted = mutableListOf<RawResponsePart>()
    while (buffer.isNotEmpty()) {
      if (!isInBlock) {
        val openIdx = buffer.indexOf(openTag)
        if (openIdx >= 0) {
          if (openIdx > 0) {
            emitted.add(RawResponsePart(TextPart(buffer.substring(0, openIdx)), isFinal = true))
          }
          buffer.delete(0, openIdx + openTag.length)
          isInBlock = true
        } else {
          val holdBack = longestSuffixPrefix(buffer, openTag)
          val safeLen = buffer.length - holdBack
          if (safeLen > 0) {
            emitted.add(RawResponsePart(TextPart(buffer.substring(0, safeLen)), isFinal = true))
            buffer.delete(0, safeLen)
          }
          break
        }
      } else {
        val closeIdx = buffer.indexOf(closeTag)
        if (closeIdx >= 0) {
          val rawBody = buffer.substring(0, closeIdx).trim()
          buffer.delete(0, closeIdx + closeTag.length)
          isInBlock = false
          emitted.add(RawResponsePart(RawA2uiPart(rawBody), isFinal = true))
        } else {
          break
        }
      }
    }
    return emitted
  }

  fun flush(): List<RawResponsePart> {
    if (buffer.isEmpty() && !isInBlock) return emptyList()
    val remaining = buffer.toString()
    buffer.clear()
    val wasInBlock = isInBlock
    isInBlock = false
    return if (wasInBlock) {
      listOf(RawResponsePart(RawA2uiPart(remaining.trim()), isFinal = false))
    } else if (remaining.isNotEmpty()) {
      listOf(RawResponsePart(TextPart(remaining), isFinal = true))
    } else {
      emptyList()
    }
  }

  companion object {
    private fun longestSuffixPrefix(text: CharSequence, tag: String): Int {
      val maxCheck = minOf(text.length, tag.length - 1)
      for (len in maxCheck downTo 1) {
        var match = true
        for (i in 0 until len) {
          if (text[text.length - len + i] != tag[i]) {
            match = false
            break
          }
        }
        if (match) return len
      }
      return 0
    }
  }
}
