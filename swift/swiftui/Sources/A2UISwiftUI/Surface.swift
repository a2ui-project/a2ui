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

/// The root SwiftUI view for a single A2UI surface.
///
/// `Surface` observes a ``SurfaceViewModel`` and renders the resolved
/// component tree using registered component view builders from the active
/// ``CatalogImplementation``. The active theme and catalog implementation are
/// propagated through the environment.
public struct Surface: View {
  @ObservedObject public var viewModel: SurfaceViewModel

  public let catalogImplementation: CatalogImplementation?
  public let surfaceID: String

  public init(
    viewModel: SurfaceViewModel,
    catalogImplementation: CatalogImplementation? = nil
  ) {
    self.viewModel = viewModel
    self.catalogImplementation = catalogImplementation
    self.surfaceID = viewModel.surfaceID
  }

  public var body: some View {
    if let rootNode = viewModel.rootNode {
      ComponentNodeView(node: rootNode)
        .environment(\.a2uiTheme, viewModel.theme)
        .environment(\.a2uiCatalogImplementation, catalogImplementation)
    } else {
      ProgressView()
    }
  }
}

extension Surface {
  /// Resolves the view builder for a node from a catalog implementation and invokes it to render.
  ///
  /// - Parameters:
  ///   - node: The resolved engine node to render.
  ///   - catalogImplementation: The catalog implementation defining available component builders.
  /// - Returns: The rendered `AnyView`, or `nil` if no corresponding view builder was found.
  public static func render(
    node: Node,
    using catalogImplementation: CatalogImplementation?
  ) -> AnyView? {
    guard let catalogImplementation else { return nil }
    if let builder = catalogImplementation.builder(catalogID: node.catalogID, type: node.type) {
      return builder(node)
    }
    return nil
  }
}
