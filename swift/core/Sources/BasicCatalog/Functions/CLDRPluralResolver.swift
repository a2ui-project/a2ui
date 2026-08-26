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

import Foundation

/// Resolves cardinal plural categories using the Unicode CLDR rules.
///
/// The implementation is a dependency-free port of the CLDR 48 cardinal rules. Numeric operands
/// mirror ICU's `PluralRules::select(double)` / `FixedDecimal(double)` behavior.
///
/// Source data: `unicode-org/cldr` release 48, `common/supplemental/plurals.xml`.
public final class CLDRPluralResolver: PluralResolver, Sendable {
  private let ruleSet: RuleSet

  /// Creates a resolver for a Foundation locale.
  public init(locale: Locale = .current) {
    self.ruleSet = Self.ruleSet(for: locale.identifier)
  }

  /// Creates a resolver for a BCP-47 or POSIX locale identifier.
  public init(localeIdentifier: String) {
    self.ruleSet = Self.ruleSet(for: localeIdentifier)
  }

  public func pluralCategory(for value: Double) -> PluralCategory {
    guard value.isFinite else { return .other }
    let operands = Operands(abs(value))
    return ruleSet.category(for: operands)
  }
}

extension CLDRPluralResolver {
  private struct Operands {
    let number: Double
    let integer: Int64
    let visibleFractionDigitCount: Int
    let fractionDigits: Int
    let fractionDigitsWithoutTrailingZeros: Int

    init(_ value: Double) {
      self.number = value

      let int64UpperBound = Double(Int64.max)
      if value > int64UpperBound {
        self.integer = 0
        self.visibleFractionDigitCount = 0
        self.fractionDigits = 0
        self.fractionDigitsWithoutTrailingZeros = 0
        return
      }

      // Converting Double(Int64.max) reproduces the boundary behavior of the Clang conversion used
      // by ICU's FixedDecimal on supported Apple platforms. Double(Int64.max) is exactly 2^63.
      if value == int64UpperBound {
        self.integer = .min
      } else {
        self.integer = Int64(value)
      }

      let visibleDigits = Self.visibleFractionDigitCount(of: value)
      self.visibleFractionDigitCount = visibleDigits
      let fractionDigits = Self.fractionDigits(of: value, visibleDigitCount: visibleDigits)
      self.fractionDigits = fractionDigits
      self.fractionDigitsWithoutTrailingZeros = Self.removingTrailingZeros(from: fractionDigits)
    }

    var isInteger: Bool { number == number.rounded(.down) }

    func integerIs(_ values: Int...) -> Bool {
      values.contains { Int64($0) == integer }
    }

    func integerIs(in range: ClosedRange<Int>) -> Bool {
      integer >= Int64(range.lowerBound) && integer <= Int64(range.upperBound)
    }

    func integerModulo(_ divisor: Int) -> Int {
      Int(integer % Int64(divisor))
    }

    func numberIs(_ values: Int...) -> Bool {
      isInteger && values.contains { Double($0) == number }
    }

    func numberIs(in range: ClosedRange<Int>) -> Bool {
      isInteger && number >= Double(range.lowerBound) && number <= Double(range.upperBound)
    }

    func numberModulo(_ divisor: Int, is values: Int...) -> Bool {
      isInteger && values.contains(numberModulo(divisor))
    }

    func numberModulo(_ divisor: Int, isIn range: ClosedRange<Int>) -> Bool {
      isInteger && range.contains(numberModulo(divisor))
    }

    func numberModulo(_ divisor: Int) -> Int {
      Int(number.truncatingRemainder(dividingBy: Double(divisor)))
    }

    private static func visibleFractionDigitCount(of value: Double) -> Int {
      let powersOfTen = [1.0, 10.0, 100.0, 1_000.0]
      for (digitCount, power) in powersOfTen.enumerated()
      where value * power == (value * power).rounded(.down) {
        return digitCount
      }

      // ICU's FixedDecimal slow path uses snprintf("%1.15e") and trims trailing zeroes from the
      // 15-digit mantissa before accounting for the scientific exponent.
      let scientific = String(format: "%1.15e", value)
      guard let exponentIndex = scientific.firstIndex(where: { $0 == "e" || $0 == "E" }) else {
        return 0
      }
      let mantissa = scientific[..<exponentIndex]
      let exponentStart = scientific.index(after: exponentIndex)
      guard let exponent = Int(scientific[exponentStart...]) else { return 0 }
      let mantissaFraction = mantissa.split(separator: ".", maxSplits: 1).last ?? ""
      let significantFractionCount =
        mantissaFraction.drop(while: { $0 == "0" }).isEmpty
        ? 0
        : mantissaFraction.lastIndex(where: { $0 != "0" }).map {
          mantissaFraction.distance(from: mantissaFraction.startIndex, to: $0) + 1
        } ?? 0
      return significantFractionCount - exponent
    }

    private static func fractionDigits(of value: Double, visibleDigitCount: Int) -> Int {
      guard visibleDigitCount != 0, value != value.rounded(.down) else { return 0 }
      let fraction = value - value.rounded(.down)
      let scaled: Double
      switch visibleDigitCount {
      case 1:
        scaled = fraction * 10.0 + 0.5
      case 2:
        scaled = fraction * 100.0 + 0.5
      case 3:
        scaled = fraction * 1_000.0 + 0.5
      default:
        scaled = fraction * pow(10.0, Double(visibleDigitCount)) + 0.5
      }
      guard scaled < Double(Int64.max) else { return Int(Int64.max) }
      return Int(scaled.rounded(.down))
    }

    private static func removingTrailingZeros(from value: Int) -> Int {
      guard value != 0 else { return 0 }
      var result = value
      while result % 10 == 0 {
        result /= 10
      }
      return result
    }
  }

  private enum RuleSet: Sendable {
    case arabic
    case belarusian
    case breton
    case colognian
    case cornish
    case czech
    case danish
    case filipino
    case french
    case hebrew
    case icelandic
    case irish
    case italian
    case langi
    case latvian
    case lithuanian
    case macedonian
    case maltese
    case manx
    case oneTwo
    case oneWhenI0Or1
    case oneWhenI0OrN1
    case oneWhenI1V0
    case oneWhenN0Through1
    case oneWhenN1
    case otherOnly
    case polish
    case portuguese
    case romanian
    case russian
    case samogitian
    case scottishGaelic
    case serboCroatian
    case shilha
    case sinhala
    case slovenian
    case sorbian
    case spanish
    case tachelhitTamazight
    case welsh

    func category(for operands: Operands) -> PluralCategory {
      switch self {
      case .arabic:
        return Self.arabicCategory(operands)
      case .belarusian:
        return Self.belarusianCategory(operands)
      case .breton:
        return Self.bretonCategory(operands)
      case .colognian:
        return Self.colognianCategory(operands)
      case .cornish:
        return Self.cornishCategory(operands)
      case .czech:
        return Self.czechCategory(operands)
      case .danish:
        return Self.danishCategory(operands)
      case .filipino:
        return Self.filipinoCategory(operands)
      case .french:
        return Self.frenchCategory(operands)
      case .hebrew:
        return Self.hebrewCategory(operands)
      case .icelandic:
        return Self.icelandicCategory(operands)
      case .irish:
        return Self.irishCategory(operands)
      case .italian:
        return Self.italianCategory(operands)
      case .langi:
        return Self.langiCategory(operands)
      case .latvian:
        return Self.latvianCategory(operands)
      case .lithuanian:
        return Self.lithuanianCategory(operands)
      case .macedonian:
        return Self.macedonianCategory(operands)
      case .maltese:
        return Self.malteseCategory(operands)
      case .manx:
        return Self.manxCategory(operands)
      case .oneTwo:
        return Self.oneTwoCategory(operands)
      case .oneWhenI0Or1:
        return operands.integerIs(0, 1) ? .one : .other
      case .oneWhenI0OrN1:
        return operands.integerIs(0) || operands.numberIs(1) ? .one : .other
      case .oneWhenI1V0:
        return operands.integerIs(1) && operands.visibleFractionDigitCount == 0 ? .one : .other
      case .oneWhenN0Through1:
        return operands.numberIs(in: 0...1) ? .one : .other
      case .oneWhenN1:
        return operands.numberIs(1) ? .one : .other
      case .otherOnly:
        return .other
      case .polish:
        return Self.polishCategory(operands)
      case .portuguese:
        return Self.portugueseCategory(operands)
      case .romanian:
        return Self.romanianCategory(operands)
      case .russian:
        return Self.russianCategory(operands)
      case .samogitian:
        return Self.samogitianCategory(operands)
      case .scottishGaelic:
        return Self.scottishGaelicCategory(operands)
      case .serboCroatian:
        return Self.serboCroatianCategory(operands)
      case .shilha:
        return Self.shilhaCategory(operands)
      case .sinhala:
        return Self.sinhalaCategory(operands)
      case .slovenian:
        return Self.slovenianCategory(operands)
      case .sorbian:
        return Self.sorbianCategory(operands)
      case .spanish:
        return Self.spanishCategory(operands)
      case .tachelhitTamazight:
        return operands.numberIs(in: 0...1) || operands.numberIs(in: 11...99) ? .one : .other
      case .welsh:
        return Self.welshCategory(operands)
      }
    }

    private static func arabicCategory(_ operands: Operands) -> PluralCategory {
      if operands.numberIs(0) { return .zero }
      if operands.numberIs(1) { return .one }
      if operands.numberIs(2) { return .two }
      if operands.numberModulo(100, isIn: 3...10) { return .few }
      if operands.numberModulo(100, isIn: 11...99) { return .many }
      return .other
    }

    private static func belarusianCategory(_ operands: Operands) -> PluralCategory {
      guard operands.isInteger else { return .other }
      if operands.numberModulo(10) == 1 && operands.numberModulo(100) != 11 {
        return .one
      }
      if (2...4).contains(operands.numberModulo(10))
        && !(12...14).contains(operands.numberModulo(100))
      {
        return .few
      }
      return .many
    }

    private static func bretonCategory(_ operands: Operands) -> PluralCategory {
      guard operands.isInteger else { return .other }
      let modulo10 = operands.numberModulo(10)
      let modulo100 = operands.numberModulo(100)
      if modulo10 == 1 && ![11, 71, 91].contains(modulo100) { return .one }
      if modulo10 == 2 && ![12, 72, 92].contains(modulo100) { return .two }
      if [3, 4, 9].contains(modulo10)
        && !(10...19).contains(modulo100)
        && !(70...79).contains(modulo100)
        && !(90...99).contains(modulo100)
      {
        return .few
      }
      if !operands.numberIs(0) && operands.numberModulo(1_000_000) == 0 {
        return .many
      }
      return .other
    }

    private static func colognianCategory(_ operands: Operands) -> PluralCategory {
      if operands.numberIs(0) { return .zero }
      if operands.numberIs(1) { return .one }
      return .other
    }

    private static func cornishCategory(_ operands: Operands) -> PluralCategory {
      guard operands.isInteger else { return .other }
      if operands.numberIs(0) { return .zero }
      if operands.numberIs(1) { return .one }

      let modulo100 = operands.numberModulo(100)
      let moduloOneThousand = operands.numberModulo(1_000)
      let moduloOneHundredThousand = operands.numberModulo(100_000)
      let moduloOneMillion = operands.numberModulo(1_000_000)
      if [2, 22, 42, 62, 82].contains(modulo100)
        || (moduloOneThousand == 0
          && ((1_000...20_000).contains(moduloOneHundredThousand)
            || [40_000, 60_000, 80_000].contains(moduloOneHundredThousand)))
        || (!operands.numberIs(0) && moduloOneMillion == 100_000)
      {
        return .two
      }
      if [3, 23, 43, 63, 83].contains(modulo100) { return .few }
      if !operands.numberIs(1) && [1, 21, 41, 61, 81].contains(modulo100) {
        return .many
      }
      return .other
    }

    private static func czechCategory(_ operands: Operands) -> PluralCategory {
      if operands.visibleFractionDigitCount != 0 { return .many }
      if operands.integerIs(1) { return .one }
      if operands.integerIs(in: 2...4) { return .few }
      return .other
    }

    private static func danishCategory(_ operands: Operands) -> PluralCategory {
      if operands.numberIs(1)
        || (operands.fractionDigits != 0 && operands.integerIs(0, 1))
      {
        return .one
      }
      return .other
    }

    private static func filipinoCategory(_ operands: Operands) -> PluralCategory {
      let excludedDigits = [4, 6, 9]
      if operands.visibleFractionDigitCount == 0 {
        return operands.integerIs(1, 2, 3)
          || !excludedDigits.contains(operands.integerModulo(10)) ? .one : .other
      }
      return excludedDigits.contains(operands.fractionDigits % 10) ? .other : .one
    }

    private static func frenchCategory(_ operands: Operands) -> PluralCategory {
      if operands.integerIs(0, 1) { return .one }
      if operands.visibleFractionDigitCount == 0
        && !operands.integerIs(0)
        && operands.integerModulo(1_000_000) == 0
      {
        return .many
      }
      return .other
    }

    private static func hebrewCategory(_ operands: Operands) -> PluralCategory {
      if (operands.integerIs(1) && operands.visibleFractionDigitCount == 0)
        || (operands.integerIs(0) && operands.visibleFractionDigitCount != 0)
      {
        return .one
      }
      if operands.integerIs(2) && operands.visibleFractionDigitCount == 0 { return .two }
      return .other
    }

    private static func icelandicCategory(_ operands: Operands) -> PluralCategory {
      let fractionDigits = operands.fractionDigitsWithoutTrailingZeros
      if (fractionDigits == 0
        && operands.integerModulo(10) == 1
        && operands.integerModulo(100) != 11)
        || (fractionDigits != 0
          && fractionDigits % 10 == 1
          && fractionDigits % 100 != 11)
      {
        return .one
      }
      return .other
    }

    private static func irishCategory(_ operands: Operands) -> PluralCategory {
      if operands.numberIs(1) { return .one }
      if operands.numberIs(2) { return .two }
      if operands.numberIs(in: 3...6) { return .few }
      if operands.numberIs(in: 7...10) { return .many }
      return .other
    }

    private static func italianCategory(_ operands: Operands) -> PluralCategory {
      if operands.integerIs(1) && operands.visibleFractionDigitCount == 0 { return .one }
      if operands.visibleFractionDigitCount == 0
        && !operands.integerIs(0)
        && operands.integerModulo(1_000_000) == 0
      {
        return .many
      }
      return .other
    }

    private static func langiCategory(_ operands: Operands) -> PluralCategory {
      if operands.numberIs(0) { return .zero }
      if operands.integerIs(0, 1) { return .one }
      return .other
    }

    private static func latvianCategory(_ operands: Operands) -> PluralCategory {
      if operands.numberModulo(10, is: 0)
        || operands.numberModulo(100, isIn: 11...19)
        || (operands.visibleFractionDigitCount == 2
          && (11...19).contains(operands.fractionDigits % 100))
      {
        return .zero
      }
      if (operands.numberModulo(10, is: 1) && !operands.numberModulo(100, is: 11))
        || (operands.visibleFractionDigitCount == 2
          && operands.fractionDigits % 10 == 1
          && operands.fractionDigits % 100 != 11)
        || (operands.visibleFractionDigitCount != 2 && operands.fractionDigits % 10 == 1)
      {
        return .one
      }
      return .other
    }

    private static func lithuanianCategory(_ operands: Operands) -> PluralCategory {
      if operands.numberModulo(10, is: 1)
        && !operands.numberModulo(100, isIn: 11...19)
      {
        return .one
      }
      if operands.numberModulo(10, isIn: 2...9)
        && !operands.numberModulo(100, isIn: 11...19)
      {
        return .few
      }
      if operands.fractionDigits != 0 { return .many }
      return .other
    }

    private static func macedonianCategory(_ operands: Operands) -> PluralCategory {
      if (operands.visibleFractionDigitCount == 0
        && operands.integerModulo(10) == 1
        && operands.integerModulo(100) != 11)
        || (operands.fractionDigits % 10 == 1 && operands.fractionDigits % 100 != 11)
      {
        return .one
      }
      return .other
    }

    private static func malteseCategory(_ operands: Operands) -> PluralCategory {
      if operands.numberIs(1) { return .one }
      if operands.numberIs(2) { return .two }
      if operands.numberIs(0) || operands.numberModulo(100, isIn: 3...10) { return .few }
      if operands.numberModulo(100, isIn: 11...19) { return .many }
      return .other
    }

    private static func manxCategory(_ operands: Operands) -> PluralCategory {
      if operands.visibleFractionDigitCount != 0 { return .many }
      if operands.integerModulo(10) == 1 { return .one }
      if operands.integerModulo(10) == 2 { return .two }
      if [0, 20, 40, 60, 80].contains(operands.integerModulo(100)) { return .few }
      return .other
    }

    private static func oneTwoCategory(_ operands: Operands) -> PluralCategory {
      if operands.numberIs(1) { return .one }
      if operands.numberIs(2) { return .two }
      return .other
    }

    private static func polishCategory(_ operands: Operands) -> PluralCategory {
      guard operands.visibleFractionDigitCount == 0 else { return .other }
      if operands.integerIs(1) { return .one }
      if (2...4).contains(operands.integerModulo(10))
        && !(12...14).contains(operands.integerModulo(100))
      {
        return .few
      }
      return .many
    }

    private static func portugueseCategory(_ operands: Operands) -> PluralCategory {
      if operands.integerIs(in: 0...1) { return .one }
      if operands.visibleFractionDigitCount == 0
        && !operands.integerIs(0)
        && operands.integerModulo(1_000_000) == 0
      {
        return .many
      }
      return .other
    }

    private static func romanianCategory(_ operands: Operands) -> PluralCategory {
      if operands.integerIs(1) && operands.visibleFractionDigitCount == 0 { return .one }
      if operands.visibleFractionDigitCount != 0
        || operands.numberIs(0)
        || (!operands.numberIs(1) && operands.numberModulo(100, isIn: 1...19))
      {
        return .few
      }
      return .other
    }

    private static func russianCategory(_ operands: Operands) -> PluralCategory {
      guard operands.visibleFractionDigitCount == 0 else { return .other }
      if operands.integerModulo(10) == 1 && operands.integerModulo(100) != 11 {
        return .one
      }
      if (2...4).contains(operands.integerModulo(10))
        && !(12...14).contains(operands.integerModulo(100))
      {
        return .few
      }
      return .many
    }

    private static func samogitianCategory(_ operands: Operands) -> PluralCategory {
      if operands.fractionDigits != 0 { return .many }
      if operands.numberModulo(10, is: 1) && !operands.numberModulo(100, is: 11) {
        return .one
      }
      if operands.numberIs(2) { return .two }
      if !operands.numberIs(2)
        && operands.numberModulo(10, isIn: 2...9)
        && !operands.numberModulo(100, isIn: 11...19)
      {
        return .few
      }
      return .other
    }

    private static func serboCroatianCategory(_ operands: Operands) -> PluralCategory {
      if (operands.visibleFractionDigitCount == 0
        && operands.integerModulo(10) == 1
        && operands.integerModulo(100) != 11)
        || (operands.visibleFractionDigitCount != 0
          && operands.fractionDigits % 10 == 1
          && operands.fractionDigits % 100 != 11)
      {
        return .one
      }
      if (operands.visibleFractionDigitCount == 0
        && (2...4).contains(operands.integerModulo(10))
        && !(12...14).contains(operands.integerModulo(100)))
        || (operands.visibleFractionDigitCount != 0
          && (2...4).contains(operands.fractionDigits % 10)
          && !(12...14).contains(operands.fractionDigits % 100))
      {
        return .few
      }
      return .other
    }

    private static func scottishGaelicCategory(_ operands: Operands) -> PluralCategory {
      if operands.numberIs(1, 11) { return .one }
      if operands.numberIs(2, 12) { return .two }
      if operands.numberIs(in: 3...10) || operands.numberIs(in: 13...19) { return .few }
      return .other
    }

    private static func shilhaCategory(_ operands: Operands) -> PluralCategory {
      if operands.integerIs(0) || operands.numberIs(1) { return .one }
      if operands.numberIs(in: 2...10) { return .few }
      return .other
    }

    private static func sinhalaCategory(_ operands: Operands) -> PluralCategory {
      return operands.numberIs(0, 1)
        || (operands.integerIs(0) && operands.fractionDigits == 1) ? .one : .other
    }

    private static func slovenianCategory(_ operands: Operands) -> PluralCategory {
      if operands.visibleFractionDigitCount != 0 { return .few }
      switch operands.integerModulo(100) {
      case 1: return .one
      case 2: return .two
      case 3, 4: return .few
      default: return .other
      }
    }

    private static func sorbianCategory(_ operands: Operands) -> PluralCategory {
      let fractionModulo100 = operands.fractionDigits % 100
      if (operands.visibleFractionDigitCount == 0 && operands.integerModulo(100) == 1)
        || fractionModulo100 == 1
      {
        return .one
      }
      if (operands.visibleFractionDigitCount == 0 && operands.integerModulo(100) == 2)
        || fractionModulo100 == 2
      {
        return .two
      }
      if (operands.visibleFractionDigitCount == 0
        && (3...4).contains(operands.integerModulo(100)))
        || (3...4).contains(fractionModulo100)
      {
        return .few
      }
      return .other
    }

    private static func spanishCategory(_ operands: Operands) -> PluralCategory {
      if operands.numberIs(1) { return .one }
      if operands.visibleFractionDigitCount == 0
        && !operands.integerIs(0)
        && operands.integerModulo(1_000_000) == 0
      {
        return .many
      }
      return .other
    }

    private static func welshCategory(_ operands: Operands) -> PluralCategory {
      if operands.numberIs(0) { return .zero }
      if operands.numberIs(1) { return .one }
      if operands.numberIs(2) { return .two }
      if operands.numberIs(3) { return .few }
      if operands.numberIs(6) { return .many }
      return .other
    }
  }

  private static func ruleSet(for identifier: String) -> RuleSet {
    let locale = languageAndRegion(identifier)
    switch locale.language {
    // These identifiers fall back to root in the pinned swift-foundation-icu data bundle.
    case "cv", "ie", "kok", "sgs":
      return .otherOnly
    case "am", "as", "bn", "doi", "fa", "gu", "hi", "kn", "pcm", "zu":
      return .oneWhenI0OrN1
    case "ff", "hy", "kab":
      return .oneWhenI0Or1
    case "ast", "de", "en", "et", "fi", "fy", "gl", "ia", "io", "ji", "lij",
      "nl", "sc", "sv", "sw", "ur", "yi":
      return .oneWhenI1V0
    case "si":
      return .sinhala
    case "ak", "bho", "csw", "guw", "ln", "mg", "nso", "pa", "ti", "wa":
      return .oneWhenN0Through1
    case "tzm":
      return .tachelhitTamazight
    case "af", "an", "asa", "az", "bal", "bem", "bez", "bg", "brx", "ce", "cgg", "chr",
      "ckb", "dv", "ee", "el", "eo", "eu", "fo", "fur", "gsw", "ha", "haw", "hu",
      "jgo", "jmc", "ka", "kaj", "kcg", "kk", "kkj", "kl", "ks", "ksb", "ku", "ky",
      "lb", "lg", "mas", "mgo", "ml", "mn", "mr", "nah", "nb", "nd", "ne", "nn",
      "nnh", "no", "nr", "ny", "nyn", "om", "or", "os", "pap", "ps", "rm", "rof",
      "rwk", "saq", "sd", "sdh", "seh", "sn", "so", "sq", "ss", "ssy", "st", "syr",
      "ta", "te", "teo", "tig", "tk", "tn", "tr", "ts", "ug", "uz", "ve", "vo",
      "vun", "wae", "xh", "xog":
      return .oneWhenN1
    case "da":
      return .danish
    case "is":
      return .icelandic
    case "mk":
      return .macedonian
    case "ceb", "fil", "tl":
      return .filipino
    case "lv", "prg":
      return .latvian
    case "lag":
      return .langi
    case "blo", "ksh":
      return .colognian
    case "he", "iw":
      return .hebrew
    case "iu", "naq", "sat", "se", "sma", "smi", "smj", "smn", "sms":
      return .oneTwo
    case "shi":
      return .shilha
    case "mo", "ro":
      return .romanian
    case "bs", "hr", "sh", "sr":
      return .serboCroatian
    case "fr":
      return .french
    case "pt":
      return locale.region == "PT" ? .italian : .portuguese
    case "ca", "it", "lld", "scn", "vec":
      return .italian
    case "es":
      return .spanish
    case "gd":
      return .scottishGaelic
    case "sl":
      return .slovenian
    case "dsb", "hsb":
      return .sorbian
    case "cs", "sk":
      return .czech
    case "pl":
      return .polish
    case "be":
      return .belarusian
    case "lt":
      return .lithuanian
    case "ru", "uk":
      return .russian
    case "br":
      return .breton
    case "mt":
      return .maltese
    case "ga":
      return .irish
    case "gv":
      return .manx
    case "kw":
      return .cornish
    case "ar", "ars":
      return .arabic
    case "cy":
      return .welsh
    default:
      return .otherOnly
    }
  }

  private static func languageAndRegion(
    _ identifier: String
  ) -> (language: String, region: String?) {
    let withoutKeyword = identifier.split(separator: "@", maxSplits: 1).first ?? ""
    let subtags = withoutKeyword.split { $0 == "-" || $0 == "_" }
    guard let language = subtags.first else { return ("", nil) }

    for subtag in subtags.dropFirst() {
      if subtag.count == 1 && subtag.allSatisfy({ $0.isLetter || $0.isNumber }) {
        break
      }
      if subtag.count == 2 && subtag.allSatisfy(\.isLetter) {
        return (language.lowercased(), subtag.uppercased())
      }
      if subtag.count == 3 && subtag.allSatisfy(\.isNumber) {
        return (language.lowercased(), String(subtag))
      }
    }
    return (language.lowercased(), nil)
  }
}
