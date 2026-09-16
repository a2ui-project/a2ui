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
  public static let card = ComponentImplementation(api: BasicCatalogComponents.card) { node in
    A2UICard(node: node)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `Card` container component.
public struct A2UICard: View {
  public let node: Node

  public init(node: Node) {
    self.node = node
  }

  private var childNode: Node? {
    node.child(for: "child")
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let childNode {
        ComponentNodeView(node: childNode)
      }
    }
    .padding(16)
    .background(Color.gray.opacity(0.1))
    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .stroke(Color.primary.opacity(0.08), lineWidth: 1)
    )
    .shadow(color: Color.black.opacity(0.04), radius: 6, x: 0, y: 2)
  }
}
