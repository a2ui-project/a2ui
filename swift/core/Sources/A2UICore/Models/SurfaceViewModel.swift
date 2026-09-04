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

import A2UIJSON
import Combine
import Foundation
import OrderedJSON

/// The state model for a single UI surface.
///
/// Mirrors `SurfaceViewModel` in the core blueprint and `web_core`.
/// Composes a ``DataModel``, ``SurfaceComponentsModel``, ``Catalog``,
/// and an optional theme. Tree resolution is delegated to a dedicated
/// ``NodeResolver`` instance.
public final class SurfaceViewModel: @unchecked Sendable, ObservableObject {

  // MARK: - Properties

  public let surfaceID: String
  public let catalogs: [String: AnyCatalog]
  public let defaultCatalogID: String?

  /// The primary default catalog associated with this surface, if available.
  public var catalog: AnyCatalog {
    if let defaultCatalogID, let catalog = catalogs[defaultCatalogID] {
      return catalog
    }
    return catalogs.values.first ?? Catalog(id: "empty", components: [])
  }
  public let theme: [String: JSONValue]?
  public let sendDataModel: Bool

  public let dataModel: DataModel
  public let componentsModel: SurfaceComponentsModel
  public let nodeResolver: NodeResolver

  public weak var actionHandler: (any ActionHandling)? {
    didSet {
      nodeResolver.actionHandler = actionHandler
    }
  }

  private var cancellables = Set<AnyCancellable>()

  /// The root node of the resolved component tree, published to the UI
  /// on the Main Thread.
  @Published public private(set) var rootNode: Node?

  // MARK: - Initialization

  public init(
    surfaceID: String,
    catalogs: [String: AnyCatalog],
    defaultCatalogID: String? = nil,
    theme: [String: JSONValue]? = nil,
    actionHandler: (any ActionHandling)? = nil,
    sendDataModel: Bool = false
  ) {
    self.surfaceID = surfaceID
    self.catalogs = catalogs
    self.defaultCatalogID = defaultCatalogID ?? catalogs.keys.sorted().first
    self.theme = theme
    self.sendDataModel = sendDataModel
    self.actionHandler = actionHandler
    self.dataModel = DataModel()
    self.componentsModel = SurfaceComponentsModel()
    self.nodeResolver = NodeResolver(
      surfaceID: surfaceID,
      catalogs: catalogs,
      defaultCatalogID: self.defaultCatalogID,
      dataModel: self.dataModel,
      actionHandler: actionHandler
    )

    setUpSubscriptions()
  }

  public convenience init(
    surfaceID: String,
    catalogs: [any CatalogProtocol],
    defaultCatalogID: String? = nil,
    theme: [String: JSONValue]? = nil,
    actionHandler: (any ActionHandling)? = nil,
    sendDataModel: Bool = false
  ) {
    let anyCatalogs = catalogs.map { $0.eraseToAnyCatalog() }
    let dict = Dictionary(anyCatalogs.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    self.init(
      surfaceID: surfaceID,
      catalogs: dict,
      defaultCatalogID: defaultCatalogID ?? catalogs.first?.id,
      theme: theme,
      actionHandler: actionHandler,
      sendDataModel: sendDataModel
    )
  }

  public convenience init(
    surfaceID: String,
    catalog: any CatalogProtocol,
    theme: [String: JSONValue]? = nil,
    actionHandler: (any ActionHandling)? = nil,
    sendDataModel: Bool = false
  ) {
    let anyCatalog = catalog.eraseToAnyCatalog()
    self.init(
      surfaceID: surfaceID,
      catalogs: [anyCatalog.id: anyCatalog],
      defaultCatalogID: anyCatalog.id,
      theme: theme,
      actionHandler: actionHandler,
      sendDataModel: sendDataModel
    )
  }

  /// Resolves a catalog by ID, falling back to the surface default catalog if nil.
  public func getCatalog(id: String? = nil) -> AnyCatalog? {
    nodeResolver.getCatalog(id: id)
  }

  private func setUpSubscriptions() {
    Publishers.CombineLatest(componentsModel.componentsPublisher, dataModel.dataPublisher)
      .sink { [weak self] components, data in
        self?.rebuildTree(components: components, data: data)
      }
      .store(in: &cancellables)
  }

  // MARK: - Tree Rebuilding

  /// Rebuilds the node tree and publishes the new root.
  private func rebuildTree(components: [String: ComponentModel], data: JSONValue) {
    let newRoot = nodeResolver.resolveTree(components: components, data: data)

    // Hopping to Main Thread to update the @Published property safely
    DispatchQueue.main.async { [weak self] in
      self?.rootNode = newRoot
    }
  }

  /// Resolves a single component definition into a concrete ``Node``.
  public func resolveNode(
    definitionID: String,
    instanceID: String? = nil,
    basePath: String? = nil
  ) -> Node? {
    nodeResolver.resolveNode(
      definitionID: definitionID,
      instanceID: instanceID ?? definitionID,
      basePath: basePath,
      visited: [],
      components: componentsModel.components,
      data: dataModel.data
    )
  }
}

// MARK: - FunctionHandler Conformance

extension SurfaceViewModel: FunctionHandler {
  public func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    nodeResolver.function(named: name, catalogID: catalogID)
  }
}
