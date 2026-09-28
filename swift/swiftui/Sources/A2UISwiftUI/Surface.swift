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
/// component tree using registered component view builders from the provided
/// SwiftUI component catalogs. The active theme and catalogs are propagated through
/// the SwiftUI environment.
public struct Surface: View {
  @ObservedObject public var viewModel: SurfaceViewModel

  public let catalogs: [String: Catalog<ComponentImplementation>]
  public let defaultCatalogID: String?
  public let surfaceID: String

  public init(
    viewModel: SurfaceViewModel,
    catalogs: [Catalog<ComponentImplementation>] = [],
    defaultCatalogID: String? = nil
  ) {
    self.viewModel = viewModel
    let dict = Dictionary(catalogs.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    self.catalogs = dict
    self.defaultCatalogID = defaultCatalogID ?? catalogs.first?.id
    self.surfaceID = viewModel.surfaceID
  }

  public init(
    viewModel: SurfaceViewModel,
    catalogs: [String: Catalog<ComponentImplementation>],
    defaultCatalogID: String? = nil
  ) {
    self.viewModel = viewModel
    self.catalogs = catalogs
    self.defaultCatalogID = defaultCatalogID ?? catalogs.keys.sorted().first
    self.surfaceID = viewModel.surfaceID
  }

  public init(
    viewModel: SurfaceViewModel,
    catalog: Catalog<ComponentImplementation>
  ) {
    self.init(viewModel: viewModel, catalogs: [catalog], defaultCatalogID: catalog.id)
  }

  public var body: some View {
    if let rootNode = viewModel.rootNode {
      ComponentNodeView(node: rootNode)
        .environment(\.a2uiTheme, viewModel.theme)
        .environment(\.a2uiCatalogs, catalogs)
        .environment(\.a2uiDefaultCatalogID, defaultCatalogID)
    } else {
      ProgressView()
    }
  }
}

extension Surface {
  /// Resolves the view builder for a node from available component catalogs and invokes it to render.
  ///
  /// - Parameters:
  ///   - node: The resolved engine node to render.
  ///   - catalogs: The dictionary of available component catalogs.
  ///   - defaultCatalogID: The fallback default catalog ID if the node has no catalog ID.
  /// - Returns: The rendered `AnyView`, or `nil` if no corresponding view builder was found.
  public static func render(
    node: Node,
    using catalogs: [String: Catalog<ComponentImplementation>],
    defaultCatalogID: String? = nil
  ) -> AnyView? {
    if let catalogID = node.catalogID, let catalog = catalogs[catalogID],
      let component = catalog.components[node.type]
    {
      return component.builder(node)
    }
    let targetCatalogID = node.catalogID ?? defaultCatalogID
    if let targetCatalogID, let catalog = catalogs[targetCatalogID],
      let component = catalog.components[node.type]
    {
      return component.builder(node)
    }
    for catalog in catalogs.values {
      if let component = catalog.components[node.type] {
        return component.builder(node)
      }
    }
    return nil
  }
}
