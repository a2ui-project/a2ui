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
import Combine

/// The view model tree of one surface.
///
/// Holds the surface's root ``ComponentNode``. Each view model resolves only its own node and keeps
/// it up to date as the data and component definitions it uses change, so the surface no longer
/// resolves the whole tree.
@MainActor
public final class ComponentNodeTree: ObservableObject {

  /// The view model of the root component, or `nil` while the surface has no root.
  @Published public private(set) var root: ComponentNode?

  private let surface: SurfaceViewModel
  private let catalogs: [String: Catalog<ComponentImplementation>]
  private let defaultCatalogID: String?
  private var cancellable: AnyCancellable?

  /// Creates the view model tree of a surface.
  ///
  /// Turns off ``SurfaceViewModel/resolvesTree``, so the surface's ``SurfaceViewModel/rootNode``
  /// no longer updates.
  ///
  /// - Parameters:
  ///   - surface: The surface to build the tree of.
  ///   - catalogs: The catalogs to look up the implementations that render the view models in.
  ///   - defaultCatalogID: The catalog to look in first for a node without a catalog ID.
  public init(
    surface: SurfaceViewModel,
    catalogs: [String: Catalog<ComponentImplementation>] = [:],
    defaultCatalogID: String? = nil
  ) {
    self.surface = surface
    self.catalogs = catalogs
    self.defaultCatalogID = defaultCatalogID
    surface.resolvesTree = false
    cancellable = surface.componentsModel.watchIdentity(NodeContext.root.componentID) {
      [weak self] _ in
      self?.updateRoot()
    }
    updateRoot()
  }

  /// Replaces the root view model when the root component appears or disappears, or its type or
  /// catalog changes.
  ///
  /// Other changes are handled by the root view model itself.
  private func updateRoot() {
    let definition = surface.componentsModel.get(NodeContext.root.componentID)
    let catalogID = definition?.catalogID ?? surface.nodeResolver.defaultCatalogID
    if root?.type == definition?.type && (definition == nil || root?.catalogID == catalogID) {
      return
    }
    root?.detach()
    root = surface.nodeResolver.resolveNode(.root, resolvingChildren: false).map {
      ComponentNode(
        node: $0, surface: surface, catalogs: catalogs, defaultCatalogID: defaultCatalogID)
    }
  }
}
