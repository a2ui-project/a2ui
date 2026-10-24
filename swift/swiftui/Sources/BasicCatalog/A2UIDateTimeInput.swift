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
    return DateTimeInputValue(parsing: minStr)?.date
  }

  private var maxDate: Date? {
    guard let maxStr = node.string(for: "max"), !maxStr.isEmpty else { return nil }
    return DateTimeInputValue(parsing: maxStr)?.date
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
        if let dateStr = node.string(for: "value"),
          let parsed = DateTimeInputValue(parsing: dateStr)
        {
          return parsed.date
        }
        return internalDate
      },
      set: { newDate in
        internalDate = newDate
        if let dataBinding = node.dataBinding(for: "value") as DataBinding<String>? {
          let value = DateTimeInputValue.format(
            newDate,
            enableDate: enableDate,
            enableTime: enableTime,
            like: node.string(for: "value")
          )
          dataBinding.set(value)
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
          .accessibilityHidden(true)
      }

      datePickerView
        .padding(.vertical, 2)
        .accessibilityIdentifier("A2UIDateTimeInput_\(node.id)")
        .a2uiAccessibilityControl(for: node, defaultLabel: labelText)

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
}
