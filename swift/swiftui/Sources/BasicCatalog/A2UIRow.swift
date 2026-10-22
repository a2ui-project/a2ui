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
  public static let row = ComponentImplementation(api: BasicCatalogComponents.row) {
    A2UIRow(componentNode: $0)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `Row` layout component.
public struct A2UIRow: View {
  @ObservedObject private var componentNode: ComponentNode

  public init(componentNode: ComponentNode) {
    self.componentNode = componentNode
  }

  private var node: Node {
    componentNode.node
  }

  private var children: [Node] {
    node.children(for: "children")
  }

  private var align: String {
    node.string(for: "align") ?? "stretch"
  }

  private var justify: String {
    node.string(for: "justify") ?? "start"
  }

  private var isDistributed: Bool {
    justify == "spaceBetween" || justify == "spaceAround" || justify == "spaceEvenly"
  }

  public var body: some View {
    content.a2uiWeight(node)
  }

  @ViewBuilder private var content: some View {
    A2UIFlexLayout(axis: .horizontal, justify: justify, align: align, spacing: spacing) {
      ForEach(children, id: \.id) { childNode in
        ComponentNode.child(for: childNode, in: componentNode).makeView()
          .frame(maxWidth: justify == "stretch" ? .infinity : nil)
          .frame(maxHeight: align == "stretch" ? .infinity : nil)
      }
    }
    .environment(\.a2uiLayoutAxis, .horizontal)
    .a2uiAccessibilityElement(for: node, children: .contain)
  }

  private var spacing: CGFloat {
    isDistributed ? 0 : 8
  }
}
