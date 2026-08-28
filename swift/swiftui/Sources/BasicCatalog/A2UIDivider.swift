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
  public static let divider = ComponentImplementation(api: BasicCatalogComponents.divider) { node in
    A2UIDivider(node: node)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `Divider` component.
public struct A2UIDivider: View {
  public let node: Node

  public init(node: Node) {
    self.node = node
  }

  private var axis: String {
    node.string(for: "axis") ?? "horizontal"
  }

  public var body: some View {
    if axis == "vertical" {
      Divider()
        .frame(width: 1)
    } else {
      Divider()
        .frame(maxWidth: .infinity)
    }
  }
}
