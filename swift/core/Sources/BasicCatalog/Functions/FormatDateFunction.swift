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
    guard let format = arguments["format"]?.stringValue,
      let rawValue = arguments["value"],
      let timestamp = Timestamp(rawValue)
    else {
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
  /// `Z` may be lowercase, as RFC 3339 allows. Matched with `wholeMatch(of:)`, so a trailing
  /// newline is rejected.
  nonisolated(unsafe) private static let pattern =
    #/
    (?<year>[+-]?\d{4,6}) - (?<month>\d{2}) - (?<day>\d{2})
    (?:
      [Tt\ ] (?<hour>\d{2}) : (?<minute>\d{2})
      (?: : (?<second>\d{2}) (?: [.,] (?<fraction>\d+) )? )?
      (?:
        [zZ]
        | (?<offsetSign>[+-]) (?<offsetHours>\d{2}) (?: :? (?<offsetMinutes>\d{2}) )?
      )?
    )?
    /#.asciiOnlyDigits()

  let instant: Date
  let offsetSeconds: Int

  /// The largest distance from 1970, in seconds, of an instant that `formatDate` formats: the
  /// 100,000,000 days either side that a JavaScript `Date` can hold.
  private static let maxEpochSeconds = 8_640_000_000_000.0

  /// Reads a number, a numeric string or an ISO 8601 string.
  init?(_ value: JSONValue) {
    if let number = value.doubleValue {
      self.init(epoch: number)
    } else if let text = value.stringValue {
      if let number = Double(text) {
        self.init(epoch: number)
      } else {
        self.init(iso8601: text)
      }
    } else {
      return nil
    }
  }

  /// Reads seconds, or milliseconds when the magnitude is above 10^10, since 1970 as a UTC
  /// instant.
  ///
  /// Fails for a value that is not finite or lies outside ``maxEpochSeconds``.
  init?(epoch value: Double) {
    guard value.isFinite else { return nil }
    let seconds = abs(value) > 10_000_000_000 ? value / 1000.0 : value
    guard abs(seconds) <= Self.maxEpochSeconds else { return nil }
    instant = Date(timeIntervalSince1970: seconds)
    offsetSeconds = 0
  }

  /// Parses an ISO 8601 timestamp. A timestamp without an offset is read as UTC, never as
  /// host-local time, so its fields format as written.
  ///
  /// Fails for fields that do not exist, such as `2026-02-30` or `2026-09-04T24:30`, rather
  /// than rolling them over into the next month or day. Truncates the fraction to whole
  /// milliseconds, as web_core, Python and Dart do, so `23:59:59.9999` never rounds up into
  /// the next second or day.
  init?(iso8601 value: String) {
    guard let captures = value.wholeMatch(of: Self.pattern)?.output,
      let year = Int(captures.year),
      let month = Int(captures.month),
      let day = Int(captures.day)
    else { return nil }
    let fields = DateComponents(
      year: year,
      month: month,
      day: day,
      hour: captures.hour.flatMap { Int($0) } ?? 0,
      minute: captures.minute.flatMap { Int($0) } ?? 0,
      second: captures.second.flatMap { Int($0) } ?? 0
    )

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
    if let sign = captures.offsetSign,
      let hoursText = captures.offsetHours,
      let hours = Int(hoursText)
    {
      let minutes = captures.offsetMinutes.flatMap { Int($0) } ?? 0
      guard hours < 24, minutes < 60 else { return nil }
      offset = (sign == "-" ? -1 : 1) * (hours * 3600 + minutes * 60)
    }
    let milliseconds =
      captures.fraction.flatMap {
        Int($0.prefix(3).padding(toLength: 3, withPad: "0", startingAt: 0))
      } ?? 0

    instant = wallClock.addingTimeInterval(Double(milliseconds) / 1000.0 - Double(offset))
    offsetSeconds = offset
  }
}
