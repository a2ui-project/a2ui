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
import SwiftUI

/// Applies the weight of a direct child of a row or column, like CSS `flex-grow`.
///
/// The component declares its own weight, so its container doesn't read its properties:
/// ``A2UIFlexLayout`` reads it as a layout value and gives the component a share of the free
/// space, which the component fills along the container's main axis. The modifier clears the axis
/// for the component's own content, so only direct children of a row or column use it.
struct WeightModifier: ViewModifier {
  let weight: Double?

  @Environment(\.a2uiLayoutAxis) private var layoutAxis

  func body(content: Content) -> some View {
    let content = content.environment(\.a2uiLayoutAxis, nil)
    if let weight, weight > 0, let layoutAxis {
      switch layoutAxis {
      case .horizontal:
        content.frame(maxWidth: .infinity, alignment: .leading)
          .layoutValue(key: A2UIWeightKey.self, value: weight)
      case .vertical:
        content.frame(maxHeight: .infinity, alignment: .top)
          .layoutValue(key: A2UIWeightKey.self, value: weight)
      }
    } else {
      content
    }
  }
}

extension View {
  /// Applies the `weight` property of a Basic Catalog component.
  func a2uiWeight(_ node: Node) -> some View {
    modifier(WeightModifier(weight: node.double(for: "weight")))
  }
}
