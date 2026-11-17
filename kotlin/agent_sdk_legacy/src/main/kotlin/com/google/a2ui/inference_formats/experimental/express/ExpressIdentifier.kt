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

import com.google.a2ui.inference_formats.experimental.express.generated.ExpressLexer
import org.antlr.v4.runtime.BaseErrorListener
import org.antlr.v4.runtime.CharStreams
import org.antlr.v4.runtime.RecognitionException
import org.antlr.v4.runtime.Recognizer
import org.antlr.v4.runtime.Token

/** Reserved Express literal and discard tokens that cannot be used as bare variable names. */
internal val EXPRESS_KEYWORDS: Set<String> = setOf("true", "false", "null", "_")

/**
 * Returns true if [value] conforms to UAX #31 identifier syntax
 * (`[\p{XID_Start}_][\p{XID_Continue}]*`).
 */
internal fun isValidUax31Identifier(value: String): Boolean {
  if (value.isEmpty()) return false
  if (value in EXPRESS_KEYWORDS) return true
  if (isAsciiIdentifier(value)) return true

  val lexer = ExpressLexer(CharStreams.fromString(value))
  var hadError = false
  lexer.removeErrorListeners()
  lexer.addErrorListener(
    object : BaseErrorListener() {
      override fun syntaxError(
        recognizer: Recognizer<*, *>?,
        offendingSymbol: Any?,
        line: Int,
        charPositionInLine: Int,
        msg: String?,
        e: RecognitionException?,
      ) {
        hadError = true
      }
    }
  )
  val first = lexer.nextToken()
  if (hadError || first.type != ExpressLexer.IDENTIFIER || first.text != value) {
    return false
  }
  val second = lexer.nextToken()
  return !hadError && second.type == Token.EOF
}

/** Returns true if [value] can be written unquoted as an Express identifier or map key. */
internal fun isExpressIdentifier(value: String): Boolean =
  value !in EXPRESS_KEYWORDS && isValidUax31Identifier(value)

private fun isAsciiIdentifier(value: String): Boolean {
  val first = value[0]
  if (!(first in 'a'..'z' || first in 'A'..'Z' || first == '_')) return false
  for (i in 1 until value.length) {
    val ch = value[i]
    if (!(ch in 'a'..'z' || ch in 'A'..'Z' || ch in '0'..'9' || ch == '_')) {
      return false
    }
  }
  return true
}

/**
 * Assigns legal Express variable names to pre-v1.0 component IDs. Valid Express identifiers retain
 * their own ID; others get a sanitized unique identifier so the decompiler can pass `id="..."`.
 */
internal fun assignVariableNames(ids: List<String>): Map<String, String> {
  val taken = mutableSetOf<String>()
  val result = LinkedHashMap<String, String>()

  for (cid in ids) {
    if (isExpressIdentifier(cid)) {
      taken.add(cid)
      result[cid] = cid
    }
  }

  for (cid in ids) {
    if (cid in result) continue
    val chars = StringBuilder()
    for (cp in cid.codePoints().toArray()) {
      val ch = String(Character.toChars(cp))
      if (chars.isEmpty()) {
        chars.append(if (isValidUax31Identifier(ch)) ch else "_")
      } else {
        chars.append(if (isValidUax31Identifier("_$ch")) ch else "_")
      }
    }
    var base = chars.toString().replace(Regex("_+"), "_").trim('_')
    if (base.isEmpty() || !isExpressIdentifier(base)) {
      base = "c_$base".trimEnd('_')
      if (!isExpressIdentifier(base)) base = "c"
    }
    var candidate = base
    var counter = 2
    while (candidate in taken) {
      candidate = "${base}_$counter"
      counter++
    }
    taken.add(candidate)
    result[cid] = candidate
  }

  return result
}
