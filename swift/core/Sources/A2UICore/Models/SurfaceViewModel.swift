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

  /// The default catalog of this surface, or an empty catalog when it has none.
  ///
  /// A surface without a default catalog (allowed from v1.0) never falls back to one of its
  /// other catalogs, because components and function calls must name the catalog they run in.
  /// To resolve that catalog, use ``getCatalog(id:)``.
  public var catalog: AnyCatalog {
    if let defaultCatalogID, let catalog = catalogs[defaultCatalogID] {
      return catalog
    }
    return Catalog(id: "empty", components: [])
  }
  public let theme: [String: JSONValue]?
  public let metadata: [String: JSONValue]?
  public let sendDataModel: Bool
  public let protocolVersion: A2UIProtocolVersion

  public let dataModel: DataModel
  public let componentsModel: SurfaceComponentsModel
  public let nodeResolver: NodeResolver

  public weak var actionHandler: (any ActionHandling)? {
    didSet {
      nodeResolver.actionHandler = actionHandler
    }
  }

  /// Sends calls to functions the renderer does not implement to the agent.
  ///
  /// When set on a v1.0 surface, a function call in a binding, check or action whose function has
  /// no local implementation in the catalog it resolves to (undeclared, or declared schema-only)
  /// is sent here, through ``callAgentFunction(_:)``, instead of failing, as the v1.0 fallback
  /// routing defines. The value is `null` until the agent answers. When unset, such a call fails
  /// with an `EXPRESSION_ERROR`.
  ///
  /// Setting or clearing it resolves the component tree again, so that calls already resolved
  /// are sent to the agent, or fail locally.
  ///
  /// ``MessageProcessor`` sets this on each v1.0 surface while it has an `outboundListener`.
  public var agentFunctionCaller: AgentFunctionCaller? {
    didSet {
      guard (oldValue == nil) != (agentFunctionCaller == nil) else { return }
      nodeResolver.setNeedsFullResolve()
      if componentsModel.components["root"] != nil {
        rebuildTree()
      }
    }
  }

  /// An agent function call awaiting a response, shared by identical calls.
  private struct InFlightAgentCall {
    /// Tells this call apart from a later identical one.
    let id: UUID
    let task: Task<JSONValue, any Error>
  }

  /// Agent function calls awaiting a response, keyed by call.
  private var inFlightAgentCalls: [AgentFunctionCall: InFlightAgentCall] = [:]

  /// The calls routed to the agent from bindings, checks and actions, and their results.
  let agentCallCache = AgentCallCache()

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
    metadata: [String: JSONValue]? = nil,
    actionHandler: (any ActionHandling)? = nil,
    sendDataModel: Bool = false,
    protocolVersion: A2UIProtocolVersion? = nil
  ) {
    self.surfaceID = surfaceID
    self.catalogs = catalogs
    let allCatalogsAtLeastV10 =
      !catalogs.isEmpty && catalogs.values.allSatisfy(\.isAtLeastV10)
    let isAtLeastV10 = protocolVersion?.isAtLeastV10 ?? allCatalogsAtLeastV10
    let resolvedDefaultCatalogID: String?
    if let defaultCatalogID {
      resolvedDefaultCatalogID = defaultCatalogID
    } else if !isAtLeastV10, catalogs.count == 1 {
      resolvedDefaultCatalogID = catalogs.keys.first
    } else {
      resolvedDefaultCatalogID = nil
    }
    self.defaultCatalogID = resolvedDefaultCatalogID
    self.theme = theme
    self.metadata = metadata
    self.sendDataModel = sendDataModel
    self.actionHandler = actionHandler
    let explicitVersion: A2UIProtocolVersion?
    if let protocolVersion {
      explicitVersion = protocolVersion
    } else if let resolvedDefaultCatalogID,
      let defaultCat = catalogs[resolvedDefaultCatalogID],
      let catVer = defaultCat.a2uiProtocolVersion
    {
      explicitVersion = catVer
    } else if allCatalogsAtLeastV10 {
      explicitVersion = .v10
    } else if catalogs.count == 1, let onlyCatVer = catalogs.values.first?.a2uiProtocolVersion {
      explicitVersion = onlyCatVer
    } else {
      explicitVersion = nil
    }
    self.protocolVersion = explicitVersion ?? .v091
    self.dataModel = DataModel()
    self.componentsModel = SurfaceComponentsModel()
    self.nodeResolver = NodeResolver(
      surfaceID: surfaceID,
      catalogs: catalogs,
      defaultCatalogID: resolvedDefaultCatalogID,
      componentsModel: self.componentsModel,
      dataModel: self.dataModel,
      actionHandler: actionHandler,
      protocolVersion: explicitVersion
    )

    setUpSubscriptions()
  }

  public convenience init(
    surfaceID: String,
    catalogs: [any CatalogProtocol],
    defaultCatalogID: String? = nil,
    theme: [String: JSONValue]? = nil,
    metadata: [String: JSONValue]? = nil,
    actionHandler: (any ActionHandling)? = nil,
    sendDataModel: Bool = false,
    protocolVersion: A2UIProtocolVersion? = nil
  ) {
    let anyCatalogs = catalogs.map { $0.eraseToAnyCatalog() }
    let dict = Dictionary(anyCatalogs.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    self.init(
      surfaceID: surfaceID,
      catalogs: dict,
      defaultCatalogID: defaultCatalogID,
      theme: theme,
      metadata: metadata,
      actionHandler: actionHandler,
      sendDataModel: sendDataModel,
      protocolVersion: protocolVersion
    )
  }

  public convenience init(
    surfaceID: String,
    catalog: any CatalogProtocol,
    theme: [String: JSONValue]? = nil,
    metadata: [String: JSONValue]? = nil,
    actionHandler: (any ActionHandling)? = nil,
    sendDataModel: Bool = false,
    protocolVersion: A2UIProtocolVersion? = nil
  ) {
    let anyCatalog = catalog.eraseToAnyCatalog()
    self.init(
      surfaceID: surfaceID,
      catalogs: [anyCatalog.id: anyCatalog],
      defaultCatalogID: anyCatalog.id,
      theme: theme,
      metadata: metadata,
      actionHandler: actionHandler,
      sendDataModel: sendDataModel,
      protocolVersion: protocolVersion
    )
  }

  /// Resolves a catalog by ID, falling back to the surface default catalog if nil.
  public func getCatalog(id: String? = nil) -> AnyCatalog? {
    nodeResolver.getCatalog(id: id)
  }

  /// Sends a function call to the agent through ``agentFunctionCaller``.
  ///
  /// A call identical to one still awaiting its response (same catalog, function and arguments)
  /// shares that response instead of sending another message. Once answered, the same call is
  /// sent again.
  ///
  /// - Parameter call: The call to send, naming the catalog it resolved to.
  /// - Returns: The agent's result.
  /// - Throws: ``FunctionError/noListener(name:)`` if no ``agentFunctionCaller`` is set, or the
  ///   error of the caller, such as an agent error or a timeout.
  public func callAgentFunction(_ call: AgentFunctionCall) async throws -> JSONValue {
    guard let caller = agentFunctionCaller else {
      throw FunctionError.noListener(name: call.name)
    }
    return try await inFlightTask(for: call, caller: caller).value
  }

  /// Returns the task awaiting the agent's response to `call`, sending the call unless an
  /// identical one is still awaiting its response.
  ///
  /// The task drops itself from the calls in flight as soon as the caller returns, so an
  /// identical call made after that is sent again.
  private func inFlightTask(
    for call: AgentFunctionCall,
    caller: @escaping AgentFunctionCaller
  ) -> Task<JSONValue, any Error> {
    if let inFlight = inFlightAgentCalls[call] {
      return inFlight.task
    }
    let id = UUID()
    let task = Task { @MainActor [weak self] in
      defer {
        if self?.inFlightAgentCalls[call]?.id == id {
          self?.inFlightAgentCalls.removeValue(forKey: call)
        }
      }
      return try await caller(call)
    }
    inFlightAgentCalls[call] = InFlightAgentCall(id: id, task: task)
    return task
  }

  /// Returns the agent's result for a call routed from a binding, check or action, sending the
  /// call if the surface has no result for it yet.
  ///
  /// The agent's value is kept in ``agentCallCache``, so every later evaluation of the same call
  /// reads it without sending the call again; ``NodeResolver`` resolves the nodes that made the
  /// call again once it arrives. A failed call has no value. A node keeps reading it as failed,
  /// rather than sending it again on each resolution pass, while an evaluation outside a pass
  /// sends it again.
  ///
  /// - Parameters:
  ///   - call: The call, naming the catalog it resolved to and its resolved arguments.
  ///   - isRequestedByNode: Whether a node resolution pass makes the call. The failure of a call
  ///     that only nodes asked for is reported only while a node still makes it.
  /// - Returns: The agent's value, or `nil` while the call is pending or after it failed.
  func agentFunctionValue(
    for call: AgentFunctionCall,
    isRequestedByNode: Bool
  ) -> JSONValue? {
    switch agentCallCache[call] {
    case .answered(let value):
      return value
    case .pending:
      if !isRequestedByNode {
        agentCallCache.markRequestedDirectly(call)
      }
      return nil
    case .failed:
      if isRequestedByNode {
        return nil
      }
    case nil:
      break
    }
    guard let caller = agentFunctionCaller else {
      handleFunctionError(FunctionError.noListener(name: call.name), functionName: call.name)
      return nil
    }
    let task = inFlightTask(for: call, caller: caller)
    let settlement = Task { @MainActor [weak self] () -> Bool in
      let result = await task.result
      self?.settleAgentCall(call, result: result)
      if case .success = result {
        return true
      }
      return false
    }
    agentCallCache.markPending(
      call,
      settlement: settlement,
      isRequestedDirectly: !isRequestedByNode
    )
    return nil
  }

  /// Waits until `call`, routed to the agent from a binding, check or action, has settled.
  ///
  /// - Returns: Whether the agent answered the call with a value; `false` after a failure, which
  ///   has been reported, or if the call was never sent.
  func awaitAgentCallSettlement(_ call: AgentFunctionCall) async -> Bool {
    switch agentCallCache[call] {
    case .pending(let settlement, _):
      return await settlement.value
    case .answered:
      return true
    case .failed, nil:
      return false
    }
  }

  /// Records the agent's answer to a call routed from a binding, check or action.
  ///
  /// An error is reported as an `EXPRESSION_ERROR`, unless only nodes asked for the call and none
  /// of them makes it anymore, such as after the component was removed.
  private func settleAgentCall(_ call: AgentFunctionCall, result: Result<JSONValue, any Error>) {
    switch result {
    case .success(let value):
      agentCallCache.answer(call, with: value)
    case .failure(let error):
      var isRequestedDirectly = false
      if case .pending(_, let requestedDirectly) = agentCallCache[call] {
        isRequestedDirectly = requestedDirectly
      }
      agentCallCache.fail(call)
      guard isRequestedDirectly || nodeResolver.hasNodes(makingAgentCall: call) else { return }
      handleFunctionError(error, functionName: call.name)
    }
  }

  private func setUpSubscriptions() {
    componentsModel.componentsPublisher
      .sink { [weak self] _ in
        self?.rebuildTree()
      }
      .store(in: &cancellables)

    dataModel.dataPublisher
      .sink { [weak self] _ in
        self?.rebuildTree()
      }
      .store(in: &cancellables)

    nodeResolver.agentCallHost = self
    nodeResolver.agentFunctionResultPublisher
      .sink { [weak self] _ in
        self?.rebuildTree()
      }
      .store(in: &cancellables)
  }

  // MARK: - Tree Rebuilding

  /// Rebuilds the node tree and publishes the new root only if the root node identity changed.
  private func rebuildTree() {
    let newRoot = nodeResolver.resolveTree()
    if self.rootNode?.box !== newRoot?.box {
      self.rootNode = newRoot
    }
  }
}

// MARK: - FunctionHandler Conformance

extension SurfaceViewModel: FunctionHandler {
  public func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    nodeResolver.function(named: name, catalogID: catalogID)
  }

  public func handleFunctionError(_ error: any Error, functionName: String) {
    nodeResolver.handleFunctionError(error, functionName: functionName)
  }

  public func validateFunctionCatalog(id catalogID: String?, functionName: String) throws {
    try nodeResolver.validateFunctionCatalog(id: catalogID, functionName: functionName)
  }

  public func agentFunctionCatalogID(forCallCatalogID catalogID: String?) -> String? {
    nodeResolver.agentFunctionCatalogID(forCallCatalogID: catalogID)
  }

  public func agentFunctionValue(for call: AgentFunctionCall) -> JSONValue? {
    agentFunctionValue(for: call, isRequestedByNode: false)
  }
}
