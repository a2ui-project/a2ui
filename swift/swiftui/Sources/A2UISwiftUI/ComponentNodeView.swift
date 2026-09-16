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
public struct ComponentNodeView: View {
  @Environment(\.a2uiCatalogs) private var catalogs
  @Environment(\.a2uiDefaultCatalogID) private var defaultCatalogID

  public let node: Node

  public init(node: Node) {
    self.node = node
  }

  public var body: some View {
    if let renderedView = Surface.render(
      node: node, using: catalogs, defaultCatalogID: defaultCatalogID)
    {
      renderedView
    } else {
      fallbackView
    }
  }

  private var fallbackView: some View {
    print("[A2UI] Component view builder not found for type: \(node.type)")
    return EmptyView()
  }
}
