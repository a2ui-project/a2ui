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

import BasicCatalogSwiftUI
import Foundation
import Testing

struct DateTimeInputValueTests {

  @Test(arguments: [
    ("2026-10-12T10:00+02:00", "2026-10-12T08:00:00Z"),
    ("2026-10-12T10:00:00+02:00", "2026-10-12T08:00:00Z"),
    ("2026-10-12T10:00:00-05:30", "2026-10-12T15:30:00Z"),
    ("2026-10-12T10:00Z", "2026-10-12T10:00:00Z"),
    ("2026-10-12T10:00:00Z", "2026-10-12T10:00:00Z"),
    ("2026-10-12T10:00+0200", "2026-10-12T08:00:00Z"),
    ("2026-10-12T10:00+02", "2026-10-12T08:00:00Z"),
    ("2026-10-12T10:00:00-05", "2026-10-12T15:00:00Z"),
    ("2026-10-12t10:00z", "2026-10-12T10:00:00Z"),
    ("2026-10-12t10:00:00+02:00", "2026-10-12T08:00:00Z"),
  ])
  func parsesTheInstantOfAValueWithAnOffset(value: String, utc: String) throws {
    let expected = try #require(ISO8601DateFormatter().date(from: utc))
    #expect(DateTimeInputValue(parsing: value)?.date == expected)
  }

  @Test func parsesFractionalSeconds() throws {
    let expected = try #require(ISO8601DateFormatter().date(from: "2026-10-12T10:00:00Z"))
    let parsed = try #require(DateTimeInputValue(parsing: "2026-10-12T10:00:00.250Z"))
    #expect(parsed.date == expected.addingTimeInterval(0.25))
  }

  @Test(arguments: ["2026-10-12T10:00", "2026-10-12T10:00:00"])
  func parsesALocalValueAsLocalWallClockTime(value: String) throws {
    let parsed = try #require(DateTimeInputValue(parsing: value))
    let components = Calendar.current.dateComponents(
      [.year, .month, .day, .hour, .minute, .second],
      from: parsed.date
    )
    #expect(components.year == 2026)
    #expect(components.month == 10)
    #expect(components.day == 12)
    #expect(components.hour == 10)
    #expect(components.minute == 0)
    #expect(components.second == 0)
  }

  @Test(arguments: [
    "", "2026-10-12T", "2026-10-12Tnoon", "2026-10-12T10:00+99:00", "noon",
    // Fractional seconds without seconds.
    "2026-10-12T10:00.000Z", "2026-10-12T10:00.5",
    // Dates that are not `yyyy-MM-dd`.
    "2026-1-12", "2026-10-1", "26-10-12", "02026-10-12", "2026-1-12T10:00Z",
    // Malformed offsets.
    "2026-10-12T10:00+2", "2026-10-12T10:00+020", "2026-10-12T10:00+02:0", "2026-10-12T10:00+0:200",
  ])
  func rejectsMalformedValues(value: String) {
    #expect(DateTimeInputValue(parsing: value) == nil)
  }

  @Test(arguments: [
    ("2026-10-12T10:00:00Z", true, true),
    ("2026-10-12T10:00Z", true, true),
    ("2026-10-12T10:00:00+02:00", true, true),
    ("2026-10-12T10:00+02:00", true, true),
    ("2026-10-12T10:00:00-05:30", true, true),
    ("2026-10-12T10:00:00", true, true),
    ("2026-10-12T10:00", true, true),
    ("2026-10-12", true, false),
    ("10:00:00", false, true),
    ("10:00", false, true),
  ])
  func writesAnUnchangedValueBackAsItWasRead(
    value: String,
    enableDate: Bool,
    enableTime: Bool
  ) throws {
    let parsed = try #require(DateTimeInputValue(parsing: value))
    let written = DateTimeInputValue.format(
      parsed.date,
      enableDate: enableDate,
      enableTime: enableTime,
      like: value
    )
    #expect(written == value)
  }

  @Test(arguments: [
    ("2026-10-12T10:00:00Z", "2026-10-12T11:30:00Z"),
    ("2026-10-12T10:00+02:00", "2026-10-12T11:30+02:00"),
    ("2026-10-12T10:00:00-05:30", "2026-10-12T11:30:00-05:30"),
    ("2026-10-12T10:00", "2026-10-12T11:30"),
    ("2026-10-12T10:00:00", "2026-10-12T11:30:00"),
    ("2026-10-12T10:00+0200", "2026-10-12T11:30+0200"),
    ("2026-10-12T10:00:00-05", "2026-10-12T11:30:00-05"),
    ("2026-10-12t10:00z", "2026-10-12T11:30Z"),
    ("2026-10-12t10:00:00+02", "2026-10-12T11:30:00+02"),
  ])
  func writesAPickedTimeInTheShapeOfThePreviousValue(previous: String, expected: String) throws {
    let parsed = try #require(DateTimeInputValue(parsing: previous))
    let written = DateTimeInputValue.format(
      parsed.date.addingTimeInterval(90 * 60),
      enableDate: true,
      enableTime: true,
      like: previous
    )
    #expect(written == expected)
  }

  @Test func writesAPickedTimeInUTCWhenThereIsNoPreviousValue() throws {
    let date = try #require(ISO8601DateFormatter().date(from: "2026-10-12T08:00:00Z"))
    let written = DateTimeInputValue.format(date, enableDate: true, enableTime: true, like: nil)
    #expect(written == "2026-10-12T08:00:00Z")
  }

  @Test func parsesTheSameValueOnManyThreadsAtOnce() async throws {
    let expected = try #require(ISO8601DateFormatter().date(from: "2026-10-12T08:00:00Z"))
    let dates = await withTaskGroup(of: Date?.self) { group in
      for _ in 0..<200 {
        group.addTask { DateTimeInputValue(parsing: "2026-10-12T10:00:00+02:00")?.date }
      }
      return await group.reduce(into: []) { $0.append($1) }
    }
    #expect(dates.count == 200)
    #expect(dates.allSatisfy { $0 == expected })
  }
}
