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

extension Double {
  /// This number written the way JavaScript's `String(number)` writes it (ECMAScript
  /// `Number::toString`), so string coercion matches the web and Dart renderers.
  ///
  /// The digits are the shortest ones that round-trip, as in `description`. A magnitude in
  /// `1e-7 ..< 1e21` is written without an exponent (`0.00001`, `100000000000000000000`), and
  /// anything else with one (`1e-7`, `1.5e+21`). Integral values have no `.0`, `-0` is `0`, and
  /// NaN and the infinities are `NaN`, `Infinity` and `-Infinity`.
  package var ecmaScriptString: String {
    if isNaN { return "NaN" }
    if isInfinite { return self < 0 ? "-Infinity" : "Infinity" }
    if self == 0 { return "0" }
    guard let (digits, pointPosition) = Self.shortestDigits(of: magnitude) else {
      return description
    }
    let sign = self < 0 ? "-" : ""
    return sign + Self.ecmaScriptLayout(digits: digits, pointPosition: pointPosition)
  }

  /// Splits the `description` of a positive finite number into its significant digits, without
  /// leading or trailing zeros, and the position of the decimal point relative to the first
  /// digit: the number equals `0.<digits> × 10^pointPosition`.
  private static func shortestDigits(of value: Double) -> (digits: [Character], pointPosition: Int)?
  {
    let parts = value.description.split(separator: "e", omittingEmptySubsequences: false)
    guard parts.count <= 2 else { return nil }
    var exponent = 0
    if parts.count == 2 {
      guard let parsed = Int(parts[1]) else { return nil }
      exponent = parsed
    }
    let mantissa = parts[0].split(separator: ".", omittingEmptySubsequences: false)
    guard mantissa.count <= 2 else { return nil }
    let integerDigits = Array(mantissa[0])
    let fractionDigits = mantissa.count == 2 ? Array(mantissa[1]) : []
    var digits = integerDigits + fractionDigits
    guard digits.allSatisfy({ ("0"..."9").contains($0) }) else { return nil }

    var pointPosition = integerDigits.count + exponent
    let leadingZeros = digits.prefix { $0 == "0" }.count
    digits.removeFirst(leadingZeros)
    pointPosition -= leadingZeros
    while digits.last == "0" { digits.removeLast() }
    guard !digits.isEmpty else { return nil }
    return (digits, pointPosition)
  }

  /// Lays out significant digits by the rules of ECMAScript `Number::toString` (steps 6 to 10).
  private static func ecmaScriptLayout(digits: [Character], pointPosition n: Int) -> String {
    let k = digits.count
    if k <= n && n <= 21 {
      return String(digits) + String(repeating: "0", count: n - k)
    }
    if 0 < n && n <= 21 {
      return String(digits[..<n]) + "." + String(digits[n...])
    }
    if -6 < n && n <= 0 {
      return "0." + String(repeating: "0", count: -n) + String(digits)
    }
    let exponent = n - 1
    let exponentText = (exponent < 0 ? "-" : "+") + String(exponent.magnitude)
    let mantissa = k == 1 ? String(digits) : "\(digits[0])." + String(digits[1...])
    return mantissa + "e" + exponentText
  }
}
