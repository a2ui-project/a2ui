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

/// An ISO 8601 `DateTimeInput` value and the shape it was written in.
///
/// `DateTimeInput` reads and writes values such as `2026-10-12`, `10:00`, `2026-10-12T10:00`,
/// `2026-10-12T10:00:00Z` and `2026-10-12T10:00+02:00`. A value is parsed only when the whole
/// string matches one of these shapes, and a picked date is written back in the shape of the
/// previous value, so the input does not change a value's time zone or precision.
package struct DateTimeInputValue {
  /// How a value is written.
  package enum Shape: Equatable, Sendable {
    /// `yyyy-MM-dd`.
    case date
    /// `HH:mm` or `HH:mm:ss`, in the local time zone.
    case time(includesSeconds: Bool)
    /// `yyyy-MM-ddTHH:mm` or `yyyy-MM-ddTHH:mm:ss`, followed by `zoneDesignator`: `Z`, an
    /// offset such as `+02:00`, or nothing for local time.
    case dateTime(includesSeconds: Bool, zoneDesignator: String)
  }

  /// The instant the value denotes.
  package let date: Date
  /// The shape the value was written in.
  package let shape: Shape

  /// Parses an ISO 8601 date, time or date-time, or returns `nil` when `string` is not one.
  package init?(parsing string: String) {
    guard let tIndex = string.firstIndex(of: "T") else {
      if let date = Self.date(from: string, format: "yyyy-MM-dd", in: .current) {
        self.init(date: date, shape: .date)
      } else if let includesSeconds = Self.includesSeconds(Substring(string)),
        let date = Self.date(from: string, format: Self.time(includesSeconds), in: .current)
      {
        self.init(date: date, shape: .time(includesSeconds: includesSeconds))
      } else {
        return nil
      }
      return
    }

    let day = string[..<tIndex]
    var rest = string[string.index(after: tIndex)...]
    let designator = Self.zoneDesignator(of: rest)
    rest = rest.dropLast(designator.count)
    guard let timeZone = Self.timeZone(for: designator) else { return nil }

    var fraction: TimeInterval = 0
    if let dot = rest.firstIndex(of: ".") {
      let digits = rest[rest.index(after: dot)...]
      guard !digits.isEmpty, digits.allSatisfy { $0.isASCII && $0.isNumber },
        let value = TimeInterval("0." + digits)
      else { return nil }
      fraction = value
      rest = rest[..<dot]
    }
    guard let includesSeconds = Self.includesSeconds(rest), fraction == 0 || includesSeconds,
      let date = Self.date(
        from: "\(day)T\(rest)",
        format: "yyyy-MM-dd'T'" + Self.time(includesSeconds),
        in: timeZone
      )
    else { return nil }
    self.init(
      date: date.addingTimeInterval(fraction),
      shape: .dateTime(includesSeconds: includesSeconds, zoneDesignator: designator)
    )
  }

  private init(date: Date, shape: Shape) {
    self.date = date
    self.shape = shape
  }

  /// Formats `date` for a `DateTimeInput` with the given `enableDate` and `enableTime`.
  ///
  /// The result keeps the time zone and precision of `previous` when it is a value of the same
  /// kind. A date-time with no usable previous value is written in UTC, as `yyyy-MM-ddTHH:mm:ssZ`.
  package static func format(
    _ date: Date,
    enableDate: Bool,
    enableTime: Bool,
    like previous: String?
  ) -> String {
    let shape = previous.flatMap(DateTimeInputValue.init(parsing:))?.shape
    switch (enableDate, enableTime) {
    case (true, true):
      let (includesSeconds, designator) =
        if case .dateTime(let includesSeconds, let designator) = shape {
          (includesSeconds, designator)
        } else {
          (true, "Z")
        }
      let timeZone = timeZone(for: designator) ?? .gmt
      let format = "yyyy-MM-dd'T'" + time(includesSeconds)
      return string(from: date, format: format, in: timeZone) + designator
    case (false, true):
      let includesSeconds =
        switch shape {
        case .time(let includesSeconds), .dateTime(let includesSeconds, _): includesSeconds
        case .date, nil: true
        }
      return string(from: date, format: time(includesSeconds), in: .current)
    default:
      return string(from: date, format: "yyyy-MM-dd", in: .current)
    }
  }

  /// Returns the `Z` or `±HH:mm` / `±HHmm` suffix of the time part of a date-time, or `""`.
  private static func zoneDesignator(of time: Substring) -> String {
    if time.hasSuffix("Z") { return "Z" }
    for length in [6, 5] where time.count > length {
      let suffix = time.suffix(length)
      if let sign = suffix.first, sign == "+" || sign == "-" {
        return String(suffix)
      }
    }
    return ""
  }

  /// Returns the time zone a zone designator denotes: local time for `""`, UTC for `Z`.
  private static func timeZone(for designator: String) -> TimeZone? {
    switch designator {
    case "": return .current
    case "Z": return .gmt
    default:
      let digits = designator.dropFirst().filter { $0 != ":" }
      guard digits.count == 4, digits.allSatisfy { $0.isASCII && $0.isNumber },
        designator.count == 5 || designator.dropFirst(3).first == ":",
        let hours = Int(digits.prefix(2)), let minutes = Int(digits.suffix(2)),
        hours <= 18, minutes < 60
      else { return nil }
      let seconds = (hours * 60 + minutes) * 60
      return TimeZone(secondsFromGMT: designator.hasPrefix("-") ? -seconds : seconds)
    }
  }

  /// Returns whether a time written as `HH:mm` or `HH:mm:ss` has seconds, or `nil` when it has
  /// another length.
  private static func includesSeconds(_ time: Substring) -> Bool? {
    switch time.count {
    case 5: false
    case 8: true
    default: nil
    }
  }

  private static func time(_ includesSeconds: Bool) -> String {
    includesSeconds ? "HH:mm:ss" : "HH:mm"
  }

  private static func date(from string: String, format: String, in timeZone: TimeZone) -> Date? {
    formatter(format, in: timeZone).date(from: string)
  }

  private static func string(from date: Date, format: String, in timeZone: TimeZone) -> String {
    formatter(format, in: timeZone).string(from: date)
  }

  private static func formatter(_ format: String, in timeZone: TimeZone) -> DateFormatter {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = timeZone
    formatter.dateFormat = format
    return formatter
  }
}
