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

/// Renders a component's view model by looking up its view builder from the active component
/// catalogs in the SwiftUI environment.
///
/// The view observes the ``ComponentNode`` and re-renders when it publishes. Containers render
/// each child with the child view model they hold, so a component's view keeps observing the same
/// view model across updates.
///
/// The rendered view gets the node's `accessibility` attributes applied through
/// ``A2UIAccessibilityModifier``. When the component applied the label and hint to its own
/// control with ``SwiftUI/View/a2uiAccessibilityControl(for:)``, they are left off the root.
public struct ComponentNodeView: View {
  @Environment(\.a2uiCatalogs) private var catalogs
  @Environment(\.a2uiDefaultCatalogID) private var defaultCatalogID

  @ObservedObject private var componentNode: ComponentNode

  /// Whether the rendered component reported applying its label and hint to its own control.
  @State private var controlCarriesLabel = false

  public init(componentNode: ComponentNode) {
    self.componentNode = componentNode
  }

  public var body: some View {
    if let renderedView = Surface.render(
      componentNode: componentNode, using: catalogs, defaultCatalogID: defaultCatalogID)
    {
      renderedView
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
    } else {
      fallbackView
    }
  }

  private var fallbackView: some View {
    print("[A2UI] Component view builder not found for type: \(componentNode.node.type)")
    return EmptyView()
  }
}
