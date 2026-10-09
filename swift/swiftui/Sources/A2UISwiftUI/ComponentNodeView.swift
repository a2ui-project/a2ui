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

/// Renders a single resolved A2UI engine node by looking up its view builder
/// from the active component catalogs in the SwiftUI environment.
///
/// The rendered view gets the node's `accessibility` attributes applied through
/// ``A2UIAccessibilityModifier``. When the component applied the label and hint to its own
/// control with ``SwiftUI/View/a2uiAccessibilityControl(for:)``, they are left off the root.
public struct ComponentNodeView: View {
  @Environment(\.a2uiCatalogs) private var catalogs
  @Environment(\.a2uiDefaultCatalogID) private var defaultCatalogID

  /// Whether the rendered component reported applying its label and hint to its own control.
  @State private var controlCarriesLabel = false

  public let node: Node

  public init(node: Node) {
    self.node = node
  }

  public var body: some View {
    if let renderedView = Surface.render(
      node: node, using: catalogs, defaultCatalogID: defaultCatalogID)
    {
      Group {
        if isLayoutContainer {
          renderedView
            .a2uiAccessibilityElement(for: node, children: .contain)
        } else {
          renderedView
        }
      }
      .modifier(
        A2UIAccessibilityModifier(node: node, appliesLabelAndHint: !controlCarriesLabel)
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

  /// A node with child components and no action is laid out as a stack, which needs its own
  /// accessibility element before it can carry a label. Interactive nodes such as buttons
  /// already are an element.
  private var isLayoutContainer: Bool {
    !node.allChildNodes.isEmpty
      && !node.properties.values.contains { $0 is ResolvedAction }
  }

  private var fallbackView: some View {
    print("[A2UI] Component view builder not found for type: \(node.type)")
    return EmptyView()
  }
}
