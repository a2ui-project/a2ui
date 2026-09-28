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
import A2UISwiftUI
import BasicCatalog
import OrderedJSON
import SwiftUI

// MARK: - Component Implementation

@MainActor
extension BasicCatalogImplementation {
  public static let dateTimeInput = ComponentImplementation(
    api: BasicCatalogComponents.dateTimeInput
  ) { node in
    A2UIDateTimeInput(node: node)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `DateTimeInput` component.
public struct A2UIDateTimeInput: View {
  public let node: Node

  @State private var internalDate: Date = Date()

  public init(node: Node) {
    self.node = node
  }

  private var labelText: String {
    node.string(for: "label") ?? ""
  }

  private var enableDate: Bool {
    node.bool(for: "enableDate") ?? false
  }

  private var enableTime: Bool {
    node.bool(for: "enableTime") ?? false
  }

  private var minDate: Date? {
    guard let minStr = node.string(for: "min"), !minStr.isEmpty else { return nil }
    return parseISO8601(minStr)
  }

  private var maxDate: Date? {
    guard let maxStr = node.string(for: "max"), !maxStr.isEmpty else { return nil }
    return parseISO8601(maxStr)
  }

  private var displayedComponents: DatePickerComponents {
    if enableDate && enableTime {
      return [.date, .hourAndMinute]
    } else if enableTime && !enableDate {
      return [.hourAndMinute]
    } else {
      return [.date]
    }
  }

  private var dateBinding: Binding<Date> {
    Binding(
      get: {
        if let dateStr = node.string(for: "value"), let parsed = parseISO8601(dateStr) {
          return parsed
        }
        return internalDate
      },
      set: { newDate in
        internalDate = newDate
        if let dataBinding = node.dataBinding(for: "value") as DataBinding<String>? {
          dataBinding.set(formatISO8601(newDate))
        }
      }
    )
  }

  private var validationErrors: [String] {
    node.validationErrors
  }

  private var hasError: Bool {
    !validationErrors.isEmpty
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if !labelText.isEmpty {
        Text(labelText)
          .font(.subheadline.weight(.medium))
          .foregroundStyle(hasError ? Color.red : Color.secondary)
      }

      datePickerView
        .padding(.vertical, 2)
        .accessibilityIdentifier("A2UIDateTimeInput_\(node.id)")

      if let firstError = validationErrors.first {
        Text(firstError)
          .font(.caption)
          .foregroundStyle(Color.red)
          .accessibilityIdentifier("A2UIDateTimeInput_Error_\(node.id)")
      }
    }
  }

  @ViewBuilder
  private var datePickerView: some View {
    if let min = minDate, let max = maxDate, min <= max {
      DatePicker(
        "",
        selection: dateBinding,
        in: min...max,
        displayedComponents: displayedComponents
      )
      .labelsHidden()
      .accessibilityIdentifier("A2UIDateTimeInput_Picker_\(node.id)")
    } else if let min = minDate {
      DatePicker(
        "",
        selection: dateBinding,
        in: min...,
        displayedComponents: displayedComponents
      )
      .labelsHidden()
      .accessibilityIdentifier("A2UIDateTimeInput_Picker_\(node.id)")
    } else if let max = maxDate {
      DatePicker(
        "",
        selection: dateBinding,
        in: ...max,
        displayedComponents: displayedComponents
      )
      .labelsHidden()
      .accessibilityIdentifier("A2UIDateTimeInput_Picker_\(node.id)")
    } else {
      DatePicker(
        "",
        selection: dateBinding,
        displayedComponents: displayedComponents
      )
      .labelsHidden()
      .accessibilityIdentifier("A2UIDateTimeInput_Picker_\(node.id)")
    }
  }

  private func parseISO8601(_ string: String) -> Date? {
    guard !string.isEmpty else { return nil }

    let fractionalDateFormatter = ISO8601DateFormatter()
    fractionalDateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractionalDateFormatter.date(from: string) {
      return date
    }

    let standardDateFormatter = ISO8601DateFormatter()
    standardDateFormatter.formatOptions = [.withInternetDateTime]
    if let date = standardDateFormatter.date(from: string) {
      return date
    }

    let dateOnlyFormatter = ISO8601DateFormatter()
    dateOnlyFormatter.formatOptions = [.withFullDate]
    dateOnlyFormatter.timeZone = TimeZone.current
    if let date = dateOnlyFormatter.date(from: string) {
      return date
    }

    let fallbackDateFormatter = DateFormatter()
    fallbackDateFormatter.locale = Locale(identifier: "en_US_POSIX")
    fallbackDateFormatter.timeZone = TimeZone.current

    let formats = [
      "yyyy-MM-dd'T'HH:mm:ss",
      "yyyy-MM-dd",
      "HH:mm:ss",
      "HH:mm",
    ]
    for format in formats {
      fallbackDateFormatter.dateFormat = format
      if let date = fallbackDateFormatter.date(from: string) {
        return date
      }
    }

    return nil
  }

  private func formatISO8601(_ date: Date) -> String {
    if enableDate && enableTime {
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime]
      return formatter.string(from: date)
    } else if enableTime && !enableDate {
      let dateFormatter = DateFormatter()
      dateFormatter.locale = Locale(identifier: "en_US_POSIX")
      dateFormatter.timeZone = TimeZone.current
      dateFormatter.dateFormat = "HH:mm:ss"
      return dateFormatter.string(from: date)
    } else {
      let dateFormatter = DateFormatter()
      dateFormatter.locale = Locale(identifier: "en_US_POSIX")
      dateFormatter.timeZone = TimeZone.current
      dateFormatter.dateFormat = "yyyy-MM-dd"
      return dateFormatter.string(from: date)
    }
  }
}
