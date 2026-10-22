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
import JSONSchema

public final class FormatDateFunction: FunctionImplementation, Sendable {
  public let api = FunctionAPI(
    name: "formatDate",
    returnType: .string,
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "value": {},
            "format": { "type": "string" }
          },
          "required": ["format", "value"]
        }
        """
    )
  )

  public init() {}

  public func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let format = arguments["format"]?.stringValue else {
      return .string("")
    }

    let timestamp: Timestamp
    if let valueDouble = arguments["value"]?.doubleValue {
      guard let parsed = Timestamp(epoch: valueDouble) else { return .string("") }
      timestamp = parsed
    } else if let valueString = arguments["value"]?.stringValue {
      if let parsedNumber = Double(valueString) {
        guard let parsed = Timestamp(epoch: parsedNumber) else { return .string("") }
        timestamp = parsed
      } else if let parsed = Timestamp(iso8601: valueString) {
        timestamp = parsed
      } else {
        return .string("")
      }
    } else {
      return .string("")
    }

    if format == "ISO" {
      let formatter = DateFormatter()
      formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
      formatter.timeZone = TimeZone(secondsFromGMT: 0)
      formatter.locale = Locale(identifier: "en_US_POSIX")
      return .string(formatter.string(from: timestamp.instant))
    }

    // Format in the offset the timestamp was written with, so the output shows the written
    // wall-clock fields and does not depend on the host time zone.
    guard let timeZone = TimeZone(secondsFromGMT: timestamp.offsetSeconds) else {
      return .string("")
    }
    let formatter = DateFormatter()
    formatter.dateFormat = format
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone

    return .string(formatter.string(from: timestamp.instant))
  }
}

/// A timestamp's instant, and the UTC offset of the wall-clock fields it was written with.
private struct Timestamp {
  /// The calendar fields of an ISO 8601 timestamp: year, month, day, then optionally hour,
  /// minute, second, fraction and an offset (`Z`, `+hh`, `+hhmm` or `+hh:mm`). The `T` and
  /// `Z` may be lowercase, as RFC 3339 allows.
  private static let pattern = try! NSRegularExpression(
    pattern: #"^([+-]?\d{4,6})-(\d{2})-(\d{2})"#
      + #"(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?"#
      + #"(?:([zZ])|([+-])(\d{2})(?::?(\d{2}))?)?)?$"#
  )

  let instant: Date
  let offsetSeconds: Int

  /// The largest distance from 1970, in seconds, of an instant that `formatDate` formats: the
  /// 100,000,000 days either side that a JavaScript `Date` can hold.
  private static let maxEpochSeconds = 8_640_000_000_000.0

  /// Reads seconds, or milliseconds above 10^10, since 1970 as a UTC instant.
  ///
  /// Fails for a value that is not finite or lies outside ``maxEpochSeconds``.
  init?(epoch value: Double) {
    guard value.isFinite else { return nil }
    let seconds = value > 10_000_000_000 ? value / 1000.0 : value
    guard abs(seconds) <= Self.maxEpochSeconds else { return nil }
    instant = Date(timeIntervalSince1970: seconds)
    offsetSeconds = 0
  }

  /// Parses an ISO 8601 timestamp. A timestamp without an offset is read as UTC, never as
  /// host-local time, so its fields format as written.
  ///
  /// Fails for fields that do not exist, such as `2026-02-30` or `2026-09-04T24:30`, rather
  /// than rolling them over into the next month or day.
  init?(iso8601 value: String) {
    let range = NSRange(value.startIndex..., in: value)
    guard let match = Self.pattern.firstMatch(in: value, range: range) else { return nil }
    func group(_ index: Int) -> String? {
      Range(match.range(at: index), in: value).map { String(value[$0]) }
    }
    func number(_ index: Int) -> Int? { group(index).flatMap { Int($0) } }

    guard let year = number(1), let month = number(2), let day = number(3) else { return nil }
    let fields = DateComponents(
      year: year, month: month, day: day, hour: number(4) ?? 0, minute: number(5) ?? 0,
      second: number(6) ?? 0)

    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale(identifier: "en_US_POSIX")
    guard let utc = TimeZone(secondsFromGMT: 0) else { return nil }
    calendar.timeZone = utc
    guard let wallClock = calendar.date(from: fields) else { return nil }
    let parsed = calendar.dateComponents(
      [.year, .month, .day, .hour, .minute, .second], from: wallClock)
    guard parsed.year == fields.year, parsed.month == fields.month, parsed.day == fields.day,
      parsed.hour == fields.hour, parsed.minute == fields.minute, parsed.second == fields.second
    else { return nil }

    var offset = 0
    if let sign = group(9), let hours = number(10) {
      let minutes = number(11) ?? 0
      guard hours < 24, minutes < 60 else { return nil }
      offset = (sign == "-" ? -1 : 1) * (hours * 3600 + minutes * 60)
    }
    let fraction = group(7).flatMap { Double("0.\($0)") } ?? 0

    instant = wallClock.addingTimeInterval(fraction - Double(offset))
    offsetSeconds = offset
  }
}
