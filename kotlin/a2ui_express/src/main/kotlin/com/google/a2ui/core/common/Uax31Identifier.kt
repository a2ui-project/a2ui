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

package com.google.a2ui.core.common

import java.text.Normalizer

/**
 * Pure-JVM Unicode Standard Annex #31 (`XID_Start` / `XID_Continue`) identifier checker.
 *
 * OpenJDK's `java.util.regex.Pattern` does not support `\p{XID_Start}` or `\p{XID_Continue}`. This
 * utility implements exact UAX #31 identifier classification (`[_\p{XID_Start}]\p{XID_Continue}*`)
 * using Unicode general categories, `Other_ID_Start` / `Other_ID_Continue` code points, and NFKC
 * normalization closure.
 */
object Uax31Identifier {
  private val OTHER_ID_START = intArrayOf(0x1885, 0x1886, 0x2118, 0x212E, 0x309B, 0x309C)
  private val OTHER_ID_CONTINUE =
    intArrayOf(
      0x00B7,
      0x0387,
      0x1369,
      0x136A,
      0x136B,
      0x136C,
      0x136D,
      0x136E,
      0x136F,
      0x1370,
      0x1371,
      0x19DA,
      0x200C,
      0x200D,
      0x30FB,
      0xFF65,
    )

  /** Alias matching the Track 3A core contract (`Uax31Identifier.isValid`). */
  fun isValid(value: String): Boolean = isValidIdentifier(value)

  /** Returns `true` if [value] matches `^[\p{XID_Start}_][\p{XID_Continue}]*$`. */
  fun isValidIdentifier(value: String): Boolean {
    if (value.isEmpty()) return false
    val firstCp = value.codePointAt(0)
    if (firstCp != '_'.code && !isXidStart(firstCp)) return false
    var offset = Character.charCount(firstCp)
    while (offset < value.length) {
      val cp = value.codePointAt(offset)
      if (!isXidContinue(cp)) return false
      offset += Character.charCount(cp)
    }
    return true
  }

  /** Returns `true` if Unicode code point [cp] has the `XID_Start` property. */
  fun isXidStart(cp: Int): Boolean {
    if (cp < 0x80) {
      return (cp in 'A'.code..'Z'.code) || (cp in 'a'.code..'z'.code)
    }
    if (!isIdStartBase(cp)) return false
    val s = String(Character.toChars(cp))
    val nfkc = Normalizer.normalize(s, Normalizer.Form.NFKC)
    if (nfkc == s) return true
    if (nfkc.isEmpty()) return false
    val first = nfkc.codePointAt(0)
    if (!isIdStartBase(first)) return false
    var i = Character.charCount(first)
    while (i < nfkc.length) {
      val next = nfkc.codePointAt(i)
      if (!isIdContinueBase(next)) return false
      i += Character.charCount(next)
    }
    return true
  }

  /** Returns `true` if Unicode code point [cp] has the `XID_Continue` property. */
  fun isXidContinue(cp: Int): Boolean {
    if (cp < 0x80) {
      return (cp in 'A'.code..'Z'.code) ||
        (cp in 'a'.code..'z'.code) ||
        (cp in '0'.code..'9'.code) ||
        cp == '_'.code
    }
    if (!isIdContinueBase(cp)) return false
    val s = String(Character.toChars(cp))
    val nfkc = Normalizer.normalize(s, Normalizer.Form.NFKC)
    if (nfkc == s) return true
    if (nfkc.isEmpty()) return false
    var i = 0
    while (i < nfkc.length) {
      val next = nfkc.codePointAt(i)
      if (!isIdContinueBase(next)) return false
      i += Character.charCount(next)
    }
    return true
  }

  private fun isIdStartBase(cp: Int): Boolean {
    if (cp == 0x2E2F) return false
    return when (Character.getType(cp).toByte()) {
      Character.UPPERCASE_LETTER,
      Character.LOWERCASE_LETTER,
      Character.TITLECASE_LETTER,
      Character.MODIFIER_LETTER,
      Character.OTHER_LETTER,
      Character.LETTER_NUMBER -> true
      else -> OTHER_ID_START.binarySearch(cp) >= 0
    }
  }

  private fun isIdContinueBase(cp: Int): Boolean {
    if (isIdStartBase(cp)) return true
    if (cp in 0xFE70..0xFEFF) return false
    return when (Character.getType(cp).toByte()) {
      Character.NON_SPACING_MARK,
      Character.COMBINING_SPACING_MARK,
      Character.DECIMAL_DIGIT_NUMBER,
      Character.CONNECTOR_PUNCTUATION -> true
      else -> OTHER_ID_CONTINUE.binarySearch(cp) >= 0
    }
  }
}
