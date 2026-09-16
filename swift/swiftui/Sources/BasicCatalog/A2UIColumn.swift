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
  public static let column = ComponentImplementation(api: BasicCatalogComponents.column) { node in
    A2UIColumn(node: node)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `Column` layout component.
public struct A2UIColumn: View {
  public let node: Node

  public init(node: Node) {
    self.node = node
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
    VStack(alignment: horizontalAlignment, spacing: spacing) {
      if justify == "end" || justify == "center" || justify == "spaceAround"
        || justify == "spaceEvenly"
      {
        Spacer(minLength: 0)
      }

      ForEach(Array(children.enumerated()), id: \.element.id) { index, childNode in
        ComponentNodeView(node: childNode)
          .frame(maxWidth: align == "stretch" ? .infinity : nil, alignment: childAlignment)

        if justify == "spaceBetween" && index < children.count - 1 {
          Spacer(minLength: 0)
        } else if (justify == "spaceAround" || justify == "spaceEvenly")
          && index < children.count - 1
        {
          Spacer(minLength: 0)
        }
      }

      if justify == "center" || justify == "spaceAround" || justify == "spaceEvenly" {
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: align == "stretch" ? .infinity : nil, alignment: frameAlignment)
  }

  private var horizontalAlignment: HorizontalAlignment {
    switch align {
    case "start", "stretch": return .leading
    case "end": return .trailing
    case "center": return .center
    default: return .leading
    }
  }

  private var frameAlignment: Alignment {
    switch align {
    case "start", "stretch": return .leading
    case "end": return .trailing
    case "center": return .center
    default: return .leading
    }
  }

  private var childAlignment: Alignment {
    switch align {
    case "start", "stretch": return .leading
    case "end": return .trailing
    case "center": return .center
    default: return .leading
    }
  }

  private var spacing: CGFloat? {
    if isDistributed {
      return 0
    }
    return 8
  }
}
