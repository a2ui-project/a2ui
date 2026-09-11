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
import Foundation
import Testing

@testable import BasicCatalog

@MainActor
private final class MockFunctionHandler: FunctionHandler {
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    return nil
  }
}

@MainActor
struct FormatCurrencyFunctionTests {

  let function = FormatCurrencyFunction()
  let context = DataContext(
    dataModel: DataModel(), path: "", functionHandler: MockFunctionHandler())

  // Helper to generate expected strings based on current locale
  func expectedFormat(value: Double, currency: String, grouping: Bool = true, decimals: Int? = nil)
    -> String
  {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.currencyCode = currency
    formatter.usesGroupingSeparator = grouping
    if let decimals = decimals {
      formatter.minimumFractionDigits = decimals
      formatter.maximumFractionDigits = decimals
    }
    formatter.locale = Locale.current
    return formatter.string(from: NSNumber(value: value)) ?? ""
  }

  // MARK: - Initialization

  @Test func initializesWithExpectedAPI() {
    #expect(function.api.name == "formatCurrency")
    #expect(function.api.returnType == .string)
  }

  // MARK: - Evaluation

  @Test func formatsCurrencyWithDefaultOptions() throws {
    let expected = expectedFormat(value: 1234.56, currency: "USD")
    let result = try function.evaluate(
      arguments: ["value": .number(1234.56), "currency": .string("USD")], context: context)
    #expect(result == .string(expected))
  }

  @Test func formatsCurrencyWithDifferentCurrencyCode() throws {
    let expected = expectedFormat(value: 1234.56, currency: "EUR")
    let result = try function.evaluate(
      arguments: ["value": .number(1234.56), "currency": .string("EUR")], context: context)
    #expect(result == .string(expected))
  }

  @Test func formatsStringParsedAsNumber() throws {
    let expected = expectedFormat(value: 9876.54, currency: "GBP")
    let result = try function.evaluate(
      arguments: ["value": .string("9876.54"), "currency": .string("GBP")], context: context)
    #expect(result == .string(expected))
  }

  @Test func formatsCurrencyWithoutGrouping() throws {
    let expected = expectedFormat(value: 1234567.89, currency: "JPY", grouping: false)
    let result = try function.evaluate(
      arguments: [
        "value": .number(1234567.89), "currency": .string("JPY"), "grouping": .boolean(false),
      ], context: context)
    #expect(result == .string(expected))
  }

  @Test func formatsCurrencyWithSpecificDecimals() throws {
    let expected = expectedFormat(value: 1234.5, currency: "USD", decimals: 3)
    let result = try function.evaluate(
      arguments: [
        "value": .number(1234.5), "currency": .string("USD"), "decimals": .number(3),
      ], context: context)
    #expect(result == .string(expected))
  }

  @Test func formatsCurrencyWithZeroDecimals() throws {
    let expected = expectedFormat(value: 1234.99, currency: "USD", decimals: 0)
    let result = try function.evaluate(
      arguments: [
        "value": .number(1234.99), "currency": .string("USD"), "decimals": .number(0),
      ], context: context)
    #expect(result == .string(expected))
  }

  @Test func returnsEmptyStringWhenValueIsMissing() throws {
    let result = try function.evaluate(
      arguments: ["currency": .string("USD")], context: context)
    #expect(result == .string(""))
  }

  @Test func returnsEmptyStringWhenCurrencyIsMissing() throws {
    let result = try function.evaluate(
      arguments: ["value": .number(1234.56)], context: context)
    #expect(result == .string(""))
  }

  @Test func returnsEmptyStringWhenValueIsNotANumber() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("not a number"), "currency": .string("USD")], context: context)
    #expect(result == .string(""))
  }
}
