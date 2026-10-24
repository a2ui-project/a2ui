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
import JSONSchema
import Testing

@MainActor
private final class MockFunctionHandler: FunctionHandler {
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    return nil
  }
}

/// Every expectation is a literal string, so these tests pass or fail the same way whatever the
/// host time zone (try `TZ=America/Los_Angeles swift test` and `TZ=Asia/Tokyo swift test`).
@MainActor
struct FormatDateFunctionTests {

  let function = FormatDateFunction()
  let context = DataContext(
    dataModel: DataModel(), path: "", functionHandler: MockFunctionHandler())

  private func format(_ value: JSONValue, _ pattern: String) throws -> JSONValue {
    try function.evaluate(
      arguments: ["value": value, "format": .string(pattern)], context: context)
  }

  // MARK: - Initialization

  @Test func initializesWithExpectedAPI() {
    #expect(function.api.name == "formatDate")
    #expect(function.api.returnType == .string)
  }

  // MARK: - Evaluation

  @Test func formatsISO8601String() throws {
    #expect(try format(.string("2026-01-16T14:30:00Z"), "MMM dd, yyyy") == .string("Jan 16, 2026"))
  }

  @Test func formatsMillisecondsNumberInUTC() throws {
    #expect(
      try format(.number(1_768_573_800_000), "yyyy-MM-dd HH:mm") == .string("2026-01-16 14:30"))
  }

  @Test func formatsSecondsNumberInUTC() throws {
    #expect(try format(.number(1_768_573_800), "HH:mm") == .string("14:30"))
  }

  @Test func formatsNumericStringMillisecondsInUTC() throws {
    #expect(try format(.string("1768573800000"), "MMM dd HH:mm") == .string("Jan 16 14:30"))
  }

  @Test func formatsDateOnlyStringAsWritten() throws {
    #expect(try format(.string("2026-01-16"), "MMMM d") == .string("January 16"))
    #expect(try format(.string("2026-01-16"), "ISO") == .string("2026-01-16T00:00:00.000Z"))
  }

  // MARK: - Written wall-clock time

  @Test func keepsWallClockTimeOfNegativeOffset() throws {
    let value = JSONValue.string("2026-09-04T23:30:00-05:00")
    #expect(try format(value, "yyyy-MM-dd HH:mm") == .string("2026-09-04 23:30"))
    #expect(try format(value, "EEEE h:mm a") == .string("Friday 11:30 PM"))
  }

  @Test func keepsWallClockTimeOfPositiveOffset() throws {
    let value = JSONValue.string("2026-09-05T06:15:00+09:00")
    #expect(try format(value, "yyyy-MM-dd HH:mm") == .string("2026-09-05 06:15"))
    #expect(try format(value, "EEEE") == .string("Saturday"))
  }

  @Test func keepsWallClockTimeOfUTCTimestamp() throws {
    #expect(
      try format(.string("2026-09-04T23:30:00Z"), "yyyy-MM-dd HH:mm") == .string("2026-09-04 23:30")
    )
  }

  @Test func keepsWallClockTimeOfFractionalTimestamp() throws {
    let value = JSONValue.string("2026-09-04T23:30:15.250+02:00")
    #expect(try format(value, "HH:mm:ss") == .string("23:30:15"))
    #expect(try format(value, "ISO") == .string("2026-09-04T21:30:15.250Z"))
  }

  @Test func readsTimestampWithoutOffsetAsWritten() throws {
    let value = JSONValue.string("2026-09-04T23:30:00")
    #expect(try format(value, "yyyy-MM-dd HH:mm") == .string("2026-09-04 23:30"))
    #expect(try format(value, "ISO") == .string("2026-09-04T23:30:00.000Z"))
    #expect(try format(.string("2026-09-04T23:30"), "HH:mm") == .string("23:30"))
  }

  @Test func acceptsSpaceSeparatorAndCompactOffset() throws {
    let value = JSONValue.string("2026-09-04 23:30:00+0530")
    #expect(try format(value, "yyyy-MM-dd HH:mm") == .string("2026-09-04 23:30"))
    #expect(try format(value, "ISO") == .string("2026-09-04T18:00:00.000Z"))
  }

  @Test func acceptsLowercaseTimeSeparatorAndUTCDesignator() throws {
    let value = JSONValue.string("2026-09-04t23:30:00-05:00")
    #expect(try format(value, "yyyy-MM-dd HH:mm") == .string("2026-09-04 23:30"))
    #expect(try format(value, "ISO") == .string("2026-09-05T04:30:00.000Z"))
    #expect(try format(.string("2026-09-04t23:30"), "HH:mm") == .string("23:30"))
    #expect(
      try format(.string("2026-09-04t23:30:00z"), "ISO") == .string("2026-09-04T23:30:00.000Z"))
  }

  @Test func isoPatternEmitsUTCInstant() throws {
    #expect(
      try format(.string("2026-09-04T23:30:00-05:00"), "ISO") == .string("2026-09-05T04:30:00.000Z")
    )
  }

  @Test func returnsEmptyStringForFieldsThatDoNotExist() throws {
    #expect(try format(.string("2026-02-30T10:00:00Z"), "yyyy-MM-dd") == .string(""))
    #expect(try format(.string("2026-13-01"), "yyyy-MM-dd") == .string(""))
    #expect(try format(.string("2026-09-04T24:30:00"), "yyyy-MM-dd") == .string(""))
  }

  @Test func returnsEmptyStringForNonFiniteEpoch() throws {
    #expect(try format(.number(.nan), "yyyy-MM-dd") == .string(""))
    #expect(try format(.number(.infinity), "yyyy-MM-dd") == .string(""))
    #expect(try format(.number(-.infinity), "ISO") == .string(""))
    #expect(try format(.string("NaN"), "yyyy-MM-dd") == .string(""))
    #expect(try format(.string("inf"), "yyyy-MM-dd") == .string(""))
    #expect(try format(.string("-Infinity"), "ISO") == .string(""))
  }

  @Test func returnsEmptyStringForEpochOutOfRange() throws {
    #expect(try format(.number(1e300), "yyyy-MM-dd") == .string(""))
    #expect(try format(.number(8_640_000_000_000_001), "yyyy-MM-dd") == .string(""))
    #expect(try format(.number(-8_640_000_000_001), "yyyy-MM-dd") == .string(""))
    #expect(try format(.string("1e300"), "ISO") == .string(""))
  }

  @Test func formatsEpochAtEndOfRange() throws {
    #expect(
      try format(.number(8_640_000_000_000_000), "yyyy-MM-dd HH:mm")
        == .string("275760-09-13 00:00"))
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
