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

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class Uax31IdentifierTest {

  @Test
  fun uax31UnicodeEdgeCasesMatchSpec() {
    // Valid XID_Start edge cases (Other_ID_Start)
    assertTrue(Uax31Identifier.isValid("\u2118")) // SCRIPT CAPITAL P
    assertTrue(Uax31Identifier.isValid("\u212E")) // ESTIMATED SYMBOL
    assertTrue(Uax31Identifier.isValid("größe"))
    assertTrue(Uax31Identifier.isValid("名前"))

    // Rejected non-XID_Start (Vertical Tilde U+2E2F)
    assertFalse(Uax31Identifier.isValid("\u2E2F"))
    assertFalse(Uax31Identifier.isValid("a\u2E2F"))

    // Valid XID_Continue edge cases (Other_ID_Continue)
    assertTrue(Uax31Identifier.isValid("a\u00B7")) // MIDDLE DOT
    assertTrue(Uax31Identifier.isValid("a\u200C")) // ZWNJ
    assertTrue(Uax31Identifier.isValid("a\u200D")) // ZWJ

    // NFKC-unstable Arabic presentation forms rejected by XID_Continue
    for (cp in 0xFC5E..0xFC63) {
      assertFalse(
        Uax31Identifier.isXidContinue(cp),
        "Expected U+${cp.toString(16)} not XID_Continue",
      )
    }
    assertFalse(Uax31Identifier.isXidContinue(0xFDFA))
    assertFalse(Uax31Identifier.isXidContinue(0xFDFB))
    for (cp in 0xFE70..0xFE7E step 2) {
      assertFalse(
        Uax31Identifier.isXidContinue(cp),
        "Expected U+${cp.toString(16)} not XID_Continue",
      )
    }
  }
}
