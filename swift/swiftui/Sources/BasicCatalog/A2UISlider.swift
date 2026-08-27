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
  public static let slider = ComponentImplementation(api: BasicCatalogComponents.slider) { node in
    A2UISlider(node: node)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `Slider` range input component.
public struct A2UISlider: View {
  public let node: Node

  public init(node: Node) {
    self.node = node
  }

  private var labelText: String {
    node.string(for: "label") ?? ""
  }

  private var minValue: Double {
    node.double(for: "min") ?? 0
  }

  private var maxValue: Double {
    node.double(for: "max") ?? 100
  }

  private var sliderBinding: Binding<Double> {
    node.binding(for: "value", default: minValue)
  }

  private var formattedValueText: String {
    let val = sliderBinding.wrappedValue
    if val.truncatingRemainder(dividingBy: 1) == 0 {
      return String(Int(val))
    }
    return String(val)
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if !labelText.isEmpty {
        HStack {
          Text(labelText)
            .font(.subheadline.weight(.medium))
            .foregroundStyle(!node.isValid ? Color.red : Color.secondary)
          Spacer()
          Text(formattedValueText)
            .font(.subheadline.monospacedDigit())
            .foregroundStyle(.secondary)
        }
      }

      Slider(
        value: sliderBinding,
        in: minValue...max(minValue + 0.001, maxValue)
      )

      if let firstError = node.validationErrors.first {
        Text(firstError)
          .font(.caption)
          .foregroundStyle(Color.red)
          .accessibilityIdentifier("A2UISlider_Error_\(node.id)")
      }
    }
  }
}
