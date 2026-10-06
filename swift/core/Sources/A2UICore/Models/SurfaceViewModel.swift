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
@MainActor
public final class SurfaceViewModel: ObservableObject {

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
  public let protocolVersion: String?

  public let dataModel: DataModel
  public let componentsModel: SurfaceComponentsModel
  public let nodeResolver: NodeResolver

  public weak var actionHandler: (any ActionHandling)? {
    didSet {
      nodeResolver.actionHandler = actionHandler
    }
  }

  private var cancellables = Set<AnyCancellable>()
  private var isRebuilding = false
  private var needsRebuild = false

  /// The most tree passes one model update may trigger through handlers that
  /// change the model while the tree is rebuilt.
  static let maxRebuildPassesPerUpdate = 100

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
    sendDataModel: Bool = false,
    protocolVersion: String? = nil
  ) {
    self.surfaceID = surfaceID
    self.catalogs = catalogs
    self.defaultCatalogID = defaultCatalogID ?? catalogs.keys.sorted().first
    self.theme = theme
    self.sendDataModel = sendDataModel
    self.actionHandler = actionHandler
    self.protocolVersion = protocolVersion
    self.dataModel = DataModel()
    self.componentsModel = SurfaceComponentsModel()
    self.nodeResolver = NodeResolver(
      surfaceID: surfaceID,
      catalogs: catalogs,
      defaultCatalogID: self.defaultCatalogID,
      componentsModel: self.componentsModel,
      dataModel: self.dataModel,
      actionHandler: actionHandler,
      protocolVersion: protocolVersion
    )

    setUpSubscriptions()
  }

  public convenience init(
    surfaceID: String,
    catalogs: [any CatalogProtocol],
    defaultCatalogID: String? = nil,
    theme: [String: JSONValue]? = nil,
    actionHandler: (any ActionHandling)? = nil,
    sendDataModel: Bool = false,
    protocolVersion: String? = nil
  ) {
    let anyCatalogs = catalogs.map { $0.eraseToAnyCatalog() }
    let dict = Dictionary(anyCatalogs.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    self.init(
      surfaceID: surfaceID,
      catalogs: dict,
      defaultCatalogID: defaultCatalogID ?? catalogs.first?.id,
      theme: theme,
      actionHandler: actionHandler,
      sendDataModel: sendDataModel,
      protocolVersion: protocolVersion
    )
  }

  public convenience init(
    surfaceID: String,
    catalog: any CatalogProtocol,
    theme: [String: JSONValue]? = nil,
    actionHandler: (any ActionHandling)? = nil,
    sendDataModel: Bool = false,
    protocolVersion: String? = nil
  ) {
    let anyCatalog = catalog.eraseToAnyCatalog()
    self.init(
      surfaceID: surfaceID,
      catalogs: [anyCatalog.id: anyCatalog],
      defaultCatalogID: anyCatalog.id,
      theme: theme,
      actionHandler: actionHandler,
      sendDataModel: sendDataModel,
      protocolVersion: protocolVersion
    )
  }

  /// Resolves a catalog by ID, falling back to the surface default catalog if nil.
  public func getCatalog(id: String? = nil) -> AnyCatalog? {
    nodeResolver.getCatalog(id: id)
  }

  // Separate sinks rather than `CombineLatest`, which drops values sent from
  // inside its own downstream, such as a model change made by an error handler.
  private func setUpSubscriptions() {
    componentsModel.componentsPublisher
      .sink { [weak self] _ in
        self?.rebuildTree()
      }
      .store(in: &cancellables)
    // The components subscription already rendered the initial data.
    dataModel.dataPublisher
      .dropFirst()
      .sink { [weak self] _ in
        self?.rebuildTree()
      }
      .store(in: &cancellables)
  }

  // MARK: - Tree Rebuilding

  /// Rebuilds the node tree, publishes the new root, then dispatches errors
  /// raised while resolving it.
  ///
  /// A model change made while rebuilding, e.g. by an error handler, schedules
  /// one more pass instead of resolving the tree reentrantly. A handler that
  /// changes the model on every pass is stopped after
  /// ``maxRebuildPassesPerUpdate`` passes, leaving the last published root.
  private func rebuildTree() {
    needsRebuild = true
    guard !isRebuilding else { return }
    isRebuilding = true
    defer { isRebuilding = false }
    var passes = 0
    while needsRebuild {
      guard passes < Self.maxRebuildPassesPerUpdate else {
        needsRebuild = false
        assertionFailure(
          "Surface '\(surfaceID)' rebuilt \(passes) times in one update; a handler likely "
            + "changes the model on every pass."
        )
        return
      }
      passes += 1
      needsRebuild = false
      self.rootNode = nodeResolver.resolveTreeDeferringErrors()
      nodeResolver.flushPendingErrors()
    }
  }
}

// MARK: - FunctionHandler Conformance

extension SurfaceViewModel: FunctionHandler {
  public func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    nodeResolver.function(named: name, catalogID: catalogID)
  }

  public func reportExpressionError(functionName: String, catalogID: String?, error: Error?) {
    nodeResolver.reportExpressionError(
      functionName: functionName, catalogID: catalogID, error: error)
  }
}
