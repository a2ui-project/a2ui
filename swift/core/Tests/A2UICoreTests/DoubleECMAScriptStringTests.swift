// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import A2UICore
import Testing

struct DoubleECMAScriptStringTests {

  /// Each expected string is what `String(value)` prints in Node.js.
  @Test(arguments: [
    (0.00001, "0.00001"),
    (0.000001, "0.000001"),
    (1e-7, "1e-7"),
    (1.5e-7, "1.5e-7"),
    (123.456, "123.456"),
    (0.1 + 0.2, "0.30000000000000004"),
    (1.0, "1"),
    (1e19, "10000000000000000000"),
    (1e20, "100000000000000000000"),
    (1e21, "1e+21"),
    (1.5e21, "1.5e+21"),
    (1.7976931348623157e308, "1.7976931348623157e+308"),
    (5e-324, "5e-324"),
    (9_007_199_254_740_992.0, "9007199254740992"),
    (9_223_372_036_854_775_808.0, "9223372036854776000"),
    (4_611_686_018_427_387_904.0, "4611686018427388000"),
  ])
  func writesPositiveNumbersLikeJavaScript(value: Double, expected: String) {
    #expect(value.ecmaScriptString == expected)
    #expect((-value).ecmaScriptString == "-" + expected)
  }

  @Test func writesZeroWithoutSign() {
    #expect(0.0.ecmaScriptString == "0")
    #expect((-0.0).ecmaScriptString == "0")
  }

  @Test func writesNonFiniteValuesLikeJavaScript() {
    #expect(Double.nan.ecmaScriptString == "NaN")
    #expect(Double.infinity.ecmaScriptString == "Infinity")
    #expect((-Double.infinity).ecmaScriptString == "-Infinity")
  }
}
