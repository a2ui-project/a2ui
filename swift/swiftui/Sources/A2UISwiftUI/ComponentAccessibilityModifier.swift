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

import SwiftUI

/// Applies a component's `accessibility` attributes to the view ``ComponentNode/makeView()``
/// makes, through ``A2UIAccessibilityModifier``.
///
/// It observes the view model, so the attributes follow the component's latest node. When the
/// component applied the label and hint to its own control with
/// ``SwiftUI/View/a2uiAccessibilityControl(for:)``, they are left off the root.
struct ComponentAccessibilityModifier: ViewModifier {
  @ObservedObject var componentNode: ComponentNode

  /// Whether the rendered component reported applying its label and hint to its own control.
  @State private var controlCarriesLabel = false

  func body(content: Content) -> some View {
    content
      .modifier(
        A2UIAccessibilityModifier(
          node: componentNode.node, appliesLabelAndHint: !controlCarriesLabel)
      )
      .onPreferenceChange(A2UIAccessibilityControlKey.self) { carriesLabel in
        // SwiftUI delivers preference changes on the main thread. Updating synchronously avoids
        // a frame where both the root and the control carry the label.
        MainActor.assumeIsolated {
          if controlCarriesLabel != carriesLabel {
            controlCarriesLabel = carriesLabel
          }
        }
      }
      // A nested component's control must not affect its ancestors.
      .transformPreference(A2UIAccessibilityControlKey.self) { $0 = false }
  }
}
