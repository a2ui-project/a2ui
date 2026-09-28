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
  public static let list = ComponentImplementation(api: BasicCatalogComponents.list) { node in
    A2UIList(node: node)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `List` scrollable container component.
public struct A2UIList: View {
  public let node: Node

  public init(node: Node) {
    self.node = node
  }

  private var children: [Node] {
    node.children(for: "children")
  }

  private var direction: String {
    node.string(for: "direction") ?? "vertical"
  }

  private var align: String {
    node.string(for: "align") ?? "stretch"
  }

  public var body: some View {
    if direction == "horizontal" {
      ScrollView(.horizontal, showsIndicators: false) {
        LazyHStack(alignment: verticalAlignment, spacing: 12) {
          ForEach(children) { childNode in
            ComponentNodeView(node: childNode)
              .frame(
                maxHeight: align == "stretch" ? .infinity : nil, alignment: horizontalChildAlignment
              )
          }
        }
        .padding(.horizontal, 4)
      }
      .accessibilityIdentifier("A2UIList_\(node.id)")
    } else {
      ScrollView(.vertical, showsIndicators: true) {
        LazyVStack(alignment: horizontalAlignment, spacing: 8) {
          ForEach(children) { childNode in
            ComponentNodeView(node: childNode)
              .frame(
                maxWidth: align == "stretch" ? .infinity : nil, alignment: verticalChildAlignment)
          }
        }
        .padding(.vertical, 4)
      }
      .frame(maxWidth: align == "stretch" ? .infinity : nil)
      .accessibilityIdentifier("A2UIList_\(node.id)")
    }
  }

  private var horizontalAlignment: HorizontalAlignment {
    switch align {
    case "start", "stretch": return .leading
    case "end": return .trailing
    case "center": return .center
    default: return .leading
    }
  }

  private var verticalAlignment: VerticalAlignment {
    switch align {
    case "start": return .top
    case "end": return .bottom
    case "center", "stretch": return .center
    default: return .center
    }
  }

  private var verticalChildAlignment: Alignment {
    switch align {
    case "start", "stretch": return .leading
    case "end": return .trailing
    case "center": return .center
    default: return .leading
    }
  }

  private var horizontalChildAlignment: Alignment {
    switch align {
    case "start": return .top
    case "end": return .bottom
    case "center", "stretch": return .center
    default: return .center
    }
  }
}
