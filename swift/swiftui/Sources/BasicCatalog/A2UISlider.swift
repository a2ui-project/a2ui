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
  public static let slider = ComponentImplementation(api: BasicCatalogComponents.slider) {
    A2UISlider(componentNode: $0)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `Slider` range input component.
public struct A2UISlider: View {
  @ObservedObject private var componentNode: ComponentNode

  public init(componentNode: ComponentNode) {
    self.componentNode = componentNode
  }

  private var node: Node {
    componentNode.node
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

  /// The snapping increment derived from the v1.0 `steps` property, or `nil` for a continuous
  /// slider. `steps` is the number of divisions across `min...max`, so the increment is
  /// `(max - min) / steps`. Missing, non-positive, or non-integer `steps` and `max <= min`
  /// all keep the slider continuous.
  public var stepValue: Double? {
    guard let steps = node.int(for: "steps"), steps > 0, maxValue > minValue else {
      return nil
    }
    let step = (maxValue - minValue) / Double(steps)
    return step > 0 ? step : nil
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
            .accessibilityHidden(true)
          Spacer()
          Text(formattedValueText)
            .font(.subheadline.monospacedDigit())
            .foregroundStyle(.secondary)
        }
      }

      if let stepValue {
        Slider(
          value: sliderBinding,
          in: minValue...max(minValue + 0.001, maxValue),
          step: stepValue
        )
        .a2uiAccessibilityControl(for: node, defaultLabel: labelText)
      } else {
        Slider(
          value: sliderBinding,
          in: minValue...max(minValue + 0.001, maxValue)
        )
        .a2uiAccessibilityControl(for: node, defaultLabel: labelText)
      }

      if let firstError = node.validationErrors.first {
        Text(firstError)
          .font(.caption)
          .foregroundStyle(Color.red)
          .accessibilityIdentifier("A2UISlider_Error_\(node.id)")
      }
    }
  }
}
