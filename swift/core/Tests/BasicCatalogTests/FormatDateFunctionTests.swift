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
struct FormatDateFunctionTests {

  let function = FormatDateFunction()
  let context = DataContext(
    dataModel: DataModel(), path: "", functionHandler: MockFunctionHandler())

  // Helper to generate expected strings based on current locale
  func expectedFormat(date: Date, format: String) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = format
    formatter.locale = Locale.current
    return formatter.string(from: date)
  }

  // MARK: - Initialization

  @Test func initializesWithExpectedAPI() {
    #expect(function.api.name == "formatDate")
    #expect(function.api.returnType == .string)
  }

  // MARK: - Evaluation

  @Test func formatsISO8601String() throws {
    let isoString = "2026-01-16T14:30:00Z"
    let date = try #require(ISO8601DateFormatter().date(from: isoString))
    let format = "MMM dd, yyyy"
    let expected = expectedFormat(date: date, format: format)

    let result = try function.evaluate(
      arguments: ["value": .string(isoString), "format": .string(format)], context: context)
    #expect(result == .string(expected))
  }

  @Test func formatsMillisecondsNumber() throws {
    let msSince1970: Double = 1_768_573_800_000  // Jan 16 2026
    let date = Date(timeIntervalSince1970: msSince1970 / 1000.0)
    let format = "yyyy-MM-dd"
    let expected = expectedFormat(date: date, format: format)

    let result = try function.evaluate(
      arguments: ["value": .number(msSince1970), "format": .string(format)], context: context)
    #expect(result == .string(expected))
  }

  @Test func formatsSecondsNumber() throws {
    let secondsSince1970: Double = 1_768_573_800  // Jan 16 2026
    let date = Date(timeIntervalSince1970: secondsSince1970)
    let format = "HH:mm"
    let expected = expectedFormat(date: date, format: format)

    let result = try function.evaluate(
      arguments: ["value": .number(secondsSince1970), "format": .string(format)], context: context)
    #expect(result == .string(expected))
  }

  @Test func formatsNumericStringMilliseconds() throws {
    let msString = "1768573800000"
    let date = Date(timeIntervalSince1970: 1_768_573_800)
    let format = "MMM dd"
    let expected = expectedFormat(date: date, format: format)

    let result = try function.evaluate(
      arguments: ["value": .string(msString), "format": .string(format)], context: context)
    #expect(result == .string(expected))
  }

  @Test func formatsFallbackYYYYMMDDString() throws {
    let dateString = "2026-01-16"
    let fallbackFormatter = DateFormatter()
    fallbackFormatter.dateFormat = "yyyy-MM-dd"
    let date = try #require(fallbackFormatter.date(from: dateString))

    let format = "MMMM d"
    let expected = expectedFormat(date: date, format: format)

    let result = try function.evaluate(
      arguments: ["value": .string(dateString), "format": .string(format)], context: context)
    #expect(result == .string(expected))
  }

  @Test func returnsEmptyStringWhenFormatIsMissing() throws {
    let result = try function.evaluate(
      arguments: ["value": .number(1_234_567_890)], context: context)
    #expect(result == .string(""))
  }

  @Test func returnsEmptyStringWhenValueIsMissing() throws {
    let result = try function.evaluate(
      arguments: ["format": .string("yyyy-MM-dd")], context: context)
    #expect(result == .string(""))
  }

  @Test func returnsEmptyStringWhenValueIsInvalidString() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("invalid date"), "format": .string("yyyy")], context: context)
    #expect(result == .string(""))
  }
}
