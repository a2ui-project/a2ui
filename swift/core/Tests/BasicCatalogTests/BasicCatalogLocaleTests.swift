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
import BasicCatalog
import Foundation
import OrderedJSON
import Testing

@MainActor
private final class MockFunctionHandler: FunctionHandler {
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    return nil
  }
}

@MainActor
struct BasicCatalogLocaleTests {

  let context = DataContext(
    dataModel: DataModel(), path: "", functionHandler: MockFunctionHandler())
  let german = Locale(identifier: "de_DE")

  private func evaluate(
    _ name: String, in catalog: AnyCatalog, arguments: [String: JSONValue]
  ) throws -> JSONValue {
    let function = try #require(catalog.functions[name])
    return try function.evaluate(arguments: arguments, context: context)
  }

  private func currencyString(_ value: Double, currency: String, locale: Locale) -> String {
    let formatter = NumberFormatter()
    formatter.locale = locale
    formatter.numberStyle = .currency
    formatter.currencyCode = currency
    return formatter.string(from: NSNumber(value: value)) ?? ""
  }

  // MARK: - Default locale

  @Test func defaultLocaleIsEnglishUS() {
    #expect(BasicFunctions.defaultLocale.identifier == "en_US")
  }

  // The expectations are literal en-US strings, so these fail on a device whose locale formats
  // numbers differently if the functions fall back to `Locale.current`.
  @Test func formatNumberDefaultsToEnglishUSWhateverTheDeviceLocale() throws {
    let result = try FormatNumberFunction().evaluate(
      arguments: ["value": .number(1234.567), "decimals": .number(2)], context: context)
    #expect(result == .string("1,234.57"))
  }

  @Test func formatCurrencyDefaultsToEnglishUSWhateverTheDeviceLocale() throws {
    let result = try FormatCurrencyFunction().evaluate(
      arguments: ["value": .number(99.99), "currency": .string("USD")], context: context)
    #expect(result == .string("$99.99"))
  }

  @Test func pluralizeDefaultsToEnglishRules() throws {
    // Polish puts 3 in `few`; English puts it in `other`.
    let result = try PluralizeFunction().evaluate(
      arguments: ["value": .number(3), "few": .string("few"), "other": .string("other")],
      context: context)
    #expect(result == .string("other"))
  }

  @Test(arguments: A2UIProtocolVersion.allCases)
  func sharedCatalogsFormatInEnglishUS(version: A2UIProtocolVersion) throws {
    let result = try evaluate(
      "formatNumber", in: BasicCatalog.makeCatalog(version: version),
      arguments: ["value": .number(1234.5), "decimals": .number(2)])
    #expect(result == .string("1,234.50"))
  }

  // MARK: - Explicit locale

  @Test func formatNumberUsesTheGivenLocale() throws {
    let result = try FormatNumberFunction(locale: german).evaluate(
      arguments: ["value": .number(1234.567), "decimals": .number(2)], context: context)
    #expect(result == .string("1.234,57"))
  }

  @Test func formatCurrencyUsesTheGivenLocale() throws {
    let result = try FormatCurrencyFunction(locale: german).evaluate(
      arguments: ["value": .number(1234.5), "currency": .string("EUR")], context: context)
    #expect(result == .string(currencyString(1234.5, currency: "EUR", locale: german)))
    #expect(
      result != .string(currencyString(1234.5, currency: "EUR", locale: .init(identifier: "en_US")))
    )
  }

  @Test(arguments: A2UIProtocolVersion.allCases)
  func makeCatalogWithLocaleFormatsInThatLocale(version: A2UIProtocolVersion) throws {
    let catalog = BasicCatalog.makeCatalog(version: version, locale: german)
    #expect(catalog.id == BasicCatalog.catalogURI(version: version))
    let defaultCatalog = BasicCatalog.makeCatalog(version: version)
    #expect(catalog.protocolVersion == defaultCatalog.protocolVersion)
    #expect(catalog.components.count == defaultCatalog.components.count)
    #expect(catalog.functions.count == defaultCatalog.functions.count)

    let number = try evaluate(
      "formatNumber", in: catalog, arguments: ["value": .number(1234.5), "decimals": .number(2)])
    #expect(number == .string("1.234,50"))

    let currency = try evaluate(
      "formatCurrency", in: catalog,
      arguments: ["value": .number(99.99), "currency": .string("USD")])
    #expect(currency == .string(currencyString(99.99, currency: "USD", locale: german)))

    let polish = BasicCatalog.makeCatalog(version: version, locale: Locale(identifier: "pl"))
    let plural = try evaluate(
      "pluralize", in: polish,
      arguments: ["value": .number(3), "few": .string("few"), "other": .string("other")])
    #expect(plural == .string("few"))
  }
}
