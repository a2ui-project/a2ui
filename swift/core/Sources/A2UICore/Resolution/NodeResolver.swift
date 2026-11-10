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
import OrderedCollections
import OrderedJSON

/// Resolves raw component models, data model state, and catalog schemas
/// into a living tree of resolved ``Node`` instances.
///
/// Follows component references, validates schemas, evaluates dynamic values,
/// and builds the hierarchical view tree.
@MainActor
public final class NodeResolver: Sendable {

  // MARK: - Properties

  public let surfaceID: String
  public let catalogs: [String: AnyCatalog]
  public let defaultCatalogID: String?
  public let componentsModel: SurfaceComponentsModel
  public let dataModel: DataModel
  public weak var actionHandler: (any ActionHandling)?
  public let protocolVersion: A2UIProtocolVersion?

  /// The policy that every URL resolved or checked on this resolver goes through.
  ///
  /// Properties a catalog marks with `x-a2ui-url-context` (see ``URLSchema``), the basic catalog
  /// media properties, and the properties listed in ``URLSecurityPolicy/urlProperties`` resolve
  /// to the URL the policy returns, or to `null` when it blocks the URL.
  public let urlSecurityPolicy: any URLSecurityPolicy

  private struct CachedComponentSchema {
    let propertiesSchema: [String: JSONValue]
    let classifiedTypes: [String: PropertyType]
  }

  private struct ComponentIdentity: Equatable {
    let type: String
    let catalogID: String?
    let state: NodeState
  }

  private struct SlotLocation {
    let property: String
    var steps: [NodeBox.SlotStep] = []

    func appending(_ step: NodeBox.SlotStep) -> SlotLocation {
      var copy = self
      copy.steps.append(step)
      return copy
    }

    func makeSlot() -> NodeBox.ChildSlot {
      steps.isEmpty
        ? .direct(property: property)
        : .nested(property: property, steps: steps)
    }

    func makeListSlot(index: Int) -> NodeBox.ChildSlot {
      steps.isEmpty
        ? .listElement(property: property, index: index)
        : .nested(property: property, steps: steps + [.nodeListIndex(index)])
    }
  }

  private struct NodeResolutionRecord {
    let nodeKey: String
    let definitionID: String
    let instanceID: String
    let basePath: String?
    let index: Int?
    let instanceSuffix: String?
    let visited: Set<String>
    var componentSnapshot: ComponentModel?
    var readValues: [String: JSONValue?]
    var templateCounts: [String: Int]
    var childSlots: [String: [NodeBox.ChildSlot]] = [:]
    var agentCalls: Set<AgentFunctionCall>
    /// The keys in `activeCyclicNodes` of the cyclic placeholders this node references.
    var cyclicKeys: [String] = []
    /// Ancestor node keys whose cyclic placeholders this node references.
    var cyclicTargetNodeKeys: Set<String> = []
  }

  private struct ExpressionErrorKey: Hashable {
    let nodeKey: String
    let dedupeKey: String
  }

  /// The number of `resolveNode` invocations executed during the most recent `resolveTree()` pass.
  package private(set) var lastResolvedNodeCount = 0

  private var activeNodes: [String: Node] = [:]
  /// Cyclic placeholder nodes, keyed by the referencing node, the property that holds the
  /// reference, the repeated node and the occurrence of that reference within the property.
  private var activeCyclicNodes: [String: Node] = [:]
  private var schemaCache: [String: CachedComponentSchema] = [:]
  private var nodeRecords: [String: NodeResolutionRecord] = [:]
  private var nodesByDefinitionID: [String: Set<String>] = [:]
  private var parentsByChildInstanceID: [String: Set<String>] = [:]
  private var closersByCyclicTargetNodeKey: [String: Set<String>] = [:]
  private var nodesByReadPath: [String: Set<String>] = [:]
  private var readPathsByAncestorPath: [String: Set<String>] = [:]
  private var nodesByTemplatePath: [String: Set<String>] = [:]
  private var dirtyComponentIDs: Set<String> = []
  private var dirtyDataPaths: Set<String> = []
  private var needsFullResolve = false
  private var resolvedInCurrentPass: Set<String> = []
  private var isTrackingNodeReplacements = false
  private var replacedNodesInCurrentPass:
    OrderedDictionary<String, (oldBox: NodeBox, newNode: Node)> = [:]
  private var currentNodeReadValues: [String: JSONValue?]?
  private var currentNodeTemplateCounts: [String: Int]?
  private var currentNodeChildSlots: [String: [NodeBox.ChildSlot]]?
  /// The cyclic placeholder keys the node being resolved references, in order.
  private var currentNodeCyclicKeys: [String]?
  private var currentNodeCyclicTargetNodeKeys: Set<String>?
  private var reportedExpressionErrors: Set<ExpressionErrorKey> = []
  /// The error keys each node reported in the current pass, by node key. A node shared by several
  /// parents resolves once per parent, so these are committed to `reportedExpressionErrors` when
  /// the pass ends rather than after each visit.
  private var expressionErrorsInCurrentPass: [String: Set<ExpressionErrorKey>] = [:]
  /// Shared dedupe keys reported in the current pass, so nodes that report the same one in a
  /// pass report it once.
  private var sharedErrorsInCurrentPass: Set<String> = []
  private var isResolvingTree = false
  private var currentComponentID: String?
  private var currentPropertyPath: String?
  private var modelCancellables = Set<AnyCancellable>()

  /// The surface that sends calls to functions the renderer does not implement to the agent, and
  /// keeps their results; ``SurfaceViewModel`` sets itself.
  ///
  /// The resolver records which nodes make each such call, and resolves them again when the call
  /// settles.
  weak var agentCallHost: SurfaceViewModel? {
    didSet {
      agentCallCancellable = agentCallHost?.agentCallCache.settledCallSubject
        .sink { [weak self] call in
          self?.markAgentCallSettled(call)
        }
    }
  }
  private var agentCallCancellable: AnyCancellable?

  /// Agent function calls made while resolving a node, keyed to the nodes that made them.
  private var nodesByAgentCall: [AgentFunctionCall: Set<String>] = [:]
  /// The agent calls the node being resolved makes.
  private var currentNodeAgentCalls: Set<AgentFunctionCall>?
  /// The agent calls the action being run makes.
  private var currentActionAgentCalls: Set<AgentFunctionCall>?
  /// The agent calls the condition of the check rule being resolved makes.
  private var currentCheckAgentCalls: Set<AgentFunctionCall>?
  /// Per-action cache used while running an imperative action so action calls never read from or
  /// populate the surface-wide reactive ``AgentCallCache``.
  private var currentActionCallCache: AgentCallCache?
  /// Agent calls settled since the last pass, whose nodes must be resolved again.
  private var dirtyAgentCalls: Set<AgentFunctionCall> = []
  private var isDisposed = false
  private let agentCallSettledSubject = PassthroughSubject<Void, Never>()
  private let urlBlockedSubject = PassthroughSubject<URLBlockedWarning, Never>()
  /// Where the URLs of the node being resolved come from: the surface, catalog, component type
  /// and component identifier. The resolver adds the property name.
  private var currentURLCheckInfo: URLCheckInfo?
  /// The blocked URLs already reported, so each is reported once, oldest first.
  private var reportedBlockedURLs: Set<BlockedURLKey> = []
  private var reportedBlockedURLOrder: [BlockedURLKey] = []
  /// The most blocked URLs remembered as reported. Past it, the oldest is forgotten.
  private static let maxReportedBlockedURLs = 256

  /// Identifies a blocked URL by where it appears, to report it once.
  private struct BlockedURLKey: Hashable {
    let url: String
    let context: URLContext
    let componentID: String?
    let propertyName: String?
    let functionName: String?
  }

  /// Publishes a ``URLBlockedWarning`` the first time the URL security policy blocks a URL in a
  /// given place on this resolver: a component property or a function.
  public var urlBlockedPublisher: AnyPublisher<URLBlockedWarning, Never> {
    urlBlockedSubject.eraseToAnyPublisher()
  }

  /// Publishes when a call that a resolved node makes settles, so that the tree should be
  /// resolved again to pick up the result or the failure. ``SurfaceViewModel`` rebuilds its tree.
  var agentFunctionResultPublisher: AnyPublisher<Void, Never> {
    agentCallSettledSubject.eraseToAnyPublisher()
  }

  /// Whether this resolver follows v1.0 rules.
  ///
  /// Uses `protocolVersion` when set. Otherwise it is taken from the default catalog, or, with
  /// no default, it holds when every catalog is at least v1.0.
  public var atLeastV10: Bool {
    if let protocolVersion {
      return protocolVersion.isAtLeastV10
    }
    if let defaultCatalog {
      return defaultCatalog.isAtLeastV10
    }
    return !catalogs.isEmpty && catalogs.values.allSatisfy(\.isAtLeastV10)
  }

  /// The default catalog of this resolver, or an empty catalog when it has none.
  ///
  /// A resolver without a default catalog (allowed from v1.0) never falls back to one of its
  /// other catalogs, because components and function calls must name the catalog they run in.
  /// To resolve that catalog, use ``getCatalog(id:)``.
  public var catalog: AnyCatalog {
    defaultCatalog ?? Catalog(id: "empty", components: [])
  }

  /// The default catalog, if this resolver has one and it is available.
  private var defaultCatalog: AnyCatalog? {
    defaultCatalogID.flatMap { catalogs[$0] }
  }

  /// The protocol version used for evaluation and error envelopes: `protocolVersion` when set,
  /// else the default catalog's version, else v1.0 when every catalog is at least v1.0.
  private var effectiveProtocolVersion: A2UIProtocolVersion? {
    protocolVersion ?? defaultCatalog?.a2uiProtocolVersion ?? (atLeastV10 ? .v10 : nil)
  }

  // MARK: - Initialization

  public init(
    surfaceID: String,
    catalogs: [String: AnyCatalog],
    defaultCatalogID: String? = nil,
    componentsModel: SurfaceComponentsModel? = nil,
    dataModel: DataModel? = nil,
    actionHandler: (any ActionHandling)? = nil,
    protocolVersion: A2UIProtocolVersion? = nil,
    urlSecurityPolicy: (any URLSecurityPolicy)? = nil
  ) {
    self.surfaceID = surfaceID
    self.urlSecurityPolicy = urlSecurityPolicy ?? PermissiveURLSecurityPolicy()
    let compatibleCatalogs = catalogs.filterCompatible(with: protocolVersion)
    self.catalogs = compatibleCatalogs
    self.defaultCatalogID = compatibleCatalogs.resolveDefaultCatalogID(
      explicitDefaultID: defaultCatalogID,
      protocolVersion: protocolVersion
    )
    let resolvedComponentsModel = componentsModel ?? SurfaceComponentsModel()
    let resolvedDataModel = dataModel ?? DataModel()
    self.componentsModel = resolvedComponentsModel
    self.dataModel = resolvedDataModel
    self.actionHandler = actionHandler
    self.protocolVersion = protocolVersion

    resolvedComponentsModel.changedIDsSubject
      .sink { [weak self] ids in
        self?.dirtyComponentIDs.formUnion(ids)
      }
      .store(in: &modelCancellables)

    resolvedComponentsModel.metadataChangedSubject
      .sink { [weak self] compID, newMetadata in
        self?.applyMetadataUpdate(forComponentID: compID, newMetadata: newMetadata)
      }
      .store(in: &modelCancellables)

    resolvedDataModel.pathChangeSubject
      .sink { [weak self] path in
        self?.dirtyDataPaths.insert(path)
      }
      .store(in: &modelCancellables)
  }

  public convenience init(
    surface: SurfaceViewModel,
    actionHandler: (any ActionHandling)? = nil,
    protocolVersion: A2UIProtocolVersion? = nil
  ) {
    self.init(
      surfaceID: surface.surfaceID,
      catalogs: surface.catalogs,
      defaultCatalogID: surface.defaultCatalogID,
      componentsModel: surface.componentsModel,
      dataModel: surface.dataModel,
      actionHandler: actionHandler ?? surface.actionHandler,
      protocolVersion: protocolVersion ?? surface.nodeResolver.protocolVersion,
      urlSecurityPolicy: surface.urlSecurityPolicy
    )
  }

  public convenience init(
    surfaceID: String,
    catalogs: [any CatalogProtocol],
    defaultCatalogID: String? = nil,
    componentsModel: SurfaceComponentsModel? = nil,
    dataModel: DataModel? = nil,
    actionHandler: (any ActionHandling)? = nil,
    protocolVersion: A2UIProtocolVersion? = nil,
    urlSecurityPolicy: (any URLSecurityPolicy)? = nil
  ) {
    let anyCatalogs = catalogs.map { $0.eraseToAnyCatalog() }
    let dict = Dictionary(anyCatalogs.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    self.init(
      surfaceID: surfaceID,
      catalogs: dict,
      defaultCatalogID: defaultCatalogID,
      componentsModel: componentsModel,
      dataModel: dataModel,
      actionHandler: actionHandler,
      protocolVersion: protocolVersion,
      urlSecurityPolicy: urlSecurityPolicy
    )
  }

  // MARK: - Catalog Lookup

  /// Resolves a catalog by ID, falling back to the default catalog.
  public func getCatalog(id: String? = nil) -> AnyCatalog? {
    let targetCatalogID = id ?? defaultCatalogID
    if let targetCatalogID {
      return catalogs[targetCatalogID]
    }
    if id == nil, !atLeastV10, catalogs.count == 1 {
      return catalogs.values.first
    }
    return nil
  }

  // MARK: - Tree Resolution

  /// Resolves the component tree starting from the root component ("root")
  /// using the stored component and data models.
  public func resolveTree() -> Node? {
    if isResolvingTree {
      return resolveNode(
        definitionID: "root",
        instanceID: "root",
        basePath: nil,
        visited: [],
        components: componentsModel.components,
        data: dataModel.data,
        recurseIntoChildren: true
      )
    }

    lastResolvedNodeCount = 0
    let components = componentsModel.components
    guard components["root"] != nil else {
      resetResolutionState()
      return nil
    }

    if activeNodes["root"] != nil && !needsFullResolve {
      return resolveIncrementalChanges(components: components, currentData: dataModel.data)
    }

    resetResolutionState()
    isResolvingTree = true
    defer {
      commitExpressionErrorsOfCurrentPass()
      resolvedInCurrentPass.removeAll()
      sharedErrorsInCurrentPass.removeAll()
      isResolvingTree = false
    }
    return resolveNode(
      definitionID: "root",
      instanceID: "root",
      basePath: nil,
      visited: [],
      components: components,
      data: dataModel.data,
      recurseIntoChildren: true
    )
  }

  private func resetResolutionState() {
    activeNodes.removeAll()
    activeCyclicNodes.removeAll()
    nodeRecords.removeAll()
    nodesByDefinitionID.removeAll()
    parentsByChildInstanceID.removeAll()
    closersByCyclicTargetNodeKey.removeAll()
    nodesByReadPath.removeAll()
    readPathsByAncestorPath.removeAll()
    nodesByTemplatePath.removeAll()
    dirtyComponentIDs.removeAll()
    dirtyDataPaths.removeAll()
    needsFullResolve = false
    isTrackingNodeReplacements = false
    resolvedInCurrentPass.removeAll()
    replacedNodesInCurrentPass.removeAll()
    sharedErrorsInCurrentPass.removeAll()
    reportedExpressionErrors.removeAll()
    expressionErrorsInCurrentPass.removeAll()
    for call in nodesByAgentCall.keys {
      agentCallHost?.agentCallCache.forgetFailure(call)
    }
    nodesByAgentCall.removeAll()
    dirtyAgentCalls.removeAll()
  }

  private func resolveIncrementalChanges(
    components: [String: ComponentModel],
    currentData: JSONValue
  ) -> Node? {
    let changedCompIDs = dirtyComponentIDs
    let changedDataPaths = dirtyDataPaths
    let changedAgentCalls = dirtyAgentCalls
    dirtyComponentIDs.removeAll()
    dirtyDataPaths.removeAll()
    dirtyAgentCalls.removeAll()

    guard !changedCompIDs.isEmpty || !changedDataPaths.isEmpty || !changedAgentCalls.isEmpty
    else {
      return activeNodes["root"]
    }

    var affectedNodeIDs: Set<String> = []

    for call in changedAgentCalls {
      affectedNodeIDs.formUnion(nodesByAgentCall[call] ?? [])
    }

    for compID in changedCompIDs {
      let currentComp = components[compID]
      let currentIdentity = componentIdentity(for: compID, in: components)

      let hadClearedErrors: Bool
      if reportedExpressionErrors.isEmpty {
        hadClearedErrors = false
      } else {
        let previousErrorCount = reportedExpressionErrors.count
        let instances = nodesByDefinitionID[compID] ?? []
        reportedExpressionErrors = reportedExpressionErrors.filter { key in
          key.nodeKey != compID && !instances.contains(key.nodeKey)
        }
        hadClearedErrors = reportedExpressionErrors.count != previousErrorCount
      }

      if let instances = nodesByDefinitionID[compID] {
        for nodeKey in instances {
          guard let record = nodeRecords[nodeKey] else { continue }
          if record.componentSnapshot != currentComp || hadClearedErrors {
            if !closersByCyclicTargetNodeKey.isEmpty,
              let closers = closersByCyclicTargetNodeKey[nodeKey]
            {
              affectedNodeIDs.formUnion(closers)
            }
            let previousIdentity = record.componentSnapshot.map {
              componentIdentity(for: $0)
            }
            if let currentComp,
              let previousSnap = record.componentSnapshot,
              !hadClearedErrors,
              currentIdentity == previousIdentity,
              previousSnap.properties == currentComp.properties
            {
              var updatedRecord = record
              updatedRecord.componentSnapshot = currentComp
              nodeRecords[nodeKey] = updatedRecord
              if let existing = activeNodes[nodeKey] {
                existing.updateMetadata(currentComp.metadata)
              }
            } else if currentIdentity == previousIdentity || nodeKey == "root" {
              if currentIdentity != nil {
                affectedNodeIDs.insert(nodeKey)
              }
            } else {
              if let splitParents = multiParentSplitAncestors(for: nodeKey) {
                affectedNodeIDs.formUnion(splitParents)
              }
              affectedNodeIDs.insert(nodeKey)
            }
          }
        }
      }
    }

    var candidateReadPaths: Set<String> = []
    for rawChanged in changedDataPaths {
      let normChanged = normalizePath(rawChanged)

      if nodesByReadPath[normChanged] != nil {
        candidateReadPaths.insert(normChanged)
      }
      for ancestor in ancestorPaths(of: normChanged) where nodesByReadPath[ancestor] != nil {
        candidateReadPaths.insert(ancestor)
      }
      if let subReadPaths = readPathsByAncestorPath[normChanged] {
        candidateReadPaths.formUnion(subReadPaths)
      }

      for (templatePath, templateNodes) in nodesByTemplatePath
      where pathsOverlap(templatePath, normChanged) {
        let currentCount = currentData[templatePath]?.arrayValue?.count ?? 0
        for nodeKey in templateNodes {
          if nodeRecords[nodeKey]?.templateCounts[templatePath] != currentCount {
            affectedNodeIDs.insert(nodeKey)
          }
        }
      }
    }

    for readPath in candidateReadPaths {
      let currentVal = currentData[readPath]
      if let readers = nodesByReadPath[readPath] {
        for nodeKey in readers {
          if let record = nodeRecords[nodeKey],
            let recordedVal = record.readValues[readPath],
            recordedVal != currentVal
          {
            affectedNodeIDs.insert(nodeKey)
          }
        }
      }
    }

    guard !affectedNodeIDs.isEmpty else {
      return activeNodes["root"]
    }

    var depths: [String: Int] = [:]
    depths.reserveCapacity(affectedNodeIDs.count)
    for nodeKey in affectedNodeIDs {
      depths[nodeKey] =
        liveVisited(
          for: nodeKey,
          fallback: nodeRecords[nodeKey]?.visited ?? []
        ).count
    }
    let sortedAffected = affectedNodeIDs.sorted {
      (depths[$0] ?? 0) < (depths[$1] ?? 0)
    }

    isResolvingTree = true
    isTrackingNodeReplacements = true
    resolvedInCurrentPass.removeAll()
    replacedNodesInCurrentPass.removeAll()
    sharedErrorsInCurrentPass.removeAll()
    defer {
      commitExpressionErrorsOfCurrentPass()
      resolvedInCurrentPass.removeAll()
      replacedNodesInCurrentPass.removeAll()
      sharedErrorsInCurrentPass.removeAll()
      isTrackingNodeReplacements = false
      isResolvingTree = false
    }

    for nodeKey in sortedAffected {
      guard !resolvedInCurrentPass.contains(nodeKey),
        let record = nodeRecords[nodeKey]
      else {
        continue
      }
      _ = resolveNode(
        definitionID: record.definitionID,
        instanceID: record.instanceID,
        basePath: record.basePath,
        index: record.index,
        instanceSuffix: record.instanceSuffix,
        visited: liveVisited(for: nodeKey, fallback: record.visited),
        components: components,
        data: currentData,
        recurseIntoChildren: false
      )
    }

    // Re-resolve any surviving cycle closer whose cyclic target is no longer a live ancestor
    // (for example, when an intermediate node dropped the branch that closed the cycle).
    if !closersByCyclicTargetNodeKey.isEmpty {
      var brokenClosers: Set<String> = []
      for (targetKey, closers) in closersByCyclicTargetNodeKey {
        for closerKey in closers where !resolvedInCurrentPass.contains(closerKey) {
          guard nodeRecords[closerKey] != nil else { continue }
          if !isLiveAncestor(targetKey, of: closerKey) {
            brokenClosers.insert(closerKey)
          }
        }
      }
      if !brokenClosers.isEmpty {
        var closerDepths: [String: Int] = [:]
        closerDepths.reserveCapacity(brokenClosers.count)
        for closerKey in brokenClosers {
          closerDepths[closerKey] =
            liveVisited(
              for: closerKey,
              fallback: nodeRecords[closerKey]?.visited ?? []
            ).count
        }
        let sortedClosers = brokenClosers.sorted {
          (closerDepths[$0] ?? 0) < (closerDepths[$1] ?? 0)
        }
        for closerKey in sortedClosers where !resolvedInCurrentPass.contains(closerKey) {
          guard let record = nodeRecords[closerKey] else { continue }
          _ = resolveNode(
            definitionID: record.definitionID,
            instanceID: record.instanceID,
            basePath: record.basePath,
            index: record.index,
            instanceSuffix: record.instanceSuffix,
            visited: liveVisited(for: closerKey, fallback: record.visited),
            components: components,
            data: currentData,
            recurseIntoChildren: false
          )
        }
      }
    }

    var pendingParentReplacements: OrderedDictionary<String, [NodeBox.ChildSlotReplacement]> = [:]
    for (nodeKey, replacement) in replacedNodesInCurrentPass
    where activeNodes[nodeKey]?.box === replacement.newNode.box {
      guard let parentKeys = parentsByChildInstanceID[nodeKey] else { continue }
      for parentKey in parentKeys where !resolvedInCurrentPass.contains(parentKey) {
        guard let slots = nodeRecords[parentKey]?.childSlots[nodeKey] else { continue }
        pendingParentReplacements[parentKey, default: []].append(
          NodeBox.ChildSlotReplacement(
            slots: slots,
            oldBox: replacement.oldBox,
            newNode: replacement.newNode
          )
        )
      }
    }

    for (parentKey, replacements) in pendingParentReplacements {
      activeNodes[parentKey]?.box.replaceChildSlots(replacements)
    }

    return activeNodes["root"]
  }

  /// Returns the parent set at the nearest multi-parent ancestor of `nodeKey` (including
  /// `nodeKey` itself), or `nil` when `nodeKey` has a single path from `"root"`.
  private func multiParentSplitAncestors(for nodeKey: String) -> Set<String>? {
    guard let directParents = parentsByChildInstanceID[nodeKey] else { return nil }
    guard directParents.count == 1, let firstParent = directParents.first else {
      return directParents.count > 1 ? directParents : nil
    }
    if firstParent == "root" {
      return nil
    }
    var visitedAncestors: Set<String> = [nodeKey, firstParent]
    var current = firstParent
    while let parents = parentsByChildInstanceID[current] {
      guard parents.count == 1, let parent = parents.first else {
        return parents.count > 1 ? parents : nil
      }
      if parent == "root" {
        return nil
      }
      guard visitedAncestors.insert(parent).inserted else {
        return parents
      }
      current = parent
    }
    return nil
  }

  /// Computes a live ancestor `visited` set for `nodeKey` so that a node whose previous parent
  /// branch was pruned does not reuse stale ancestors.
  private func liveVisited(for nodeKey: String, fallback: Set<String>) -> Set<String> {
    if nodeKey == "root" { return [] }
    let cleanFallback = fallback.contains(nodeKey) ? fallback.subtracting([nodeKey]) : fallback
    guard let directParents = parentsByChildInstanceID[nodeKey] else {
      return cleanFallback
    }
    if directParents.count == 1, let firstParent = directParents.first {
      if firstParent == "root" {
        return cleanFallback.count == 1 && cleanFallback.contains("root") ? cleanFallback : ["root"]
      }
      var ancestors: Set<String> = [firstParent]
      var current = firstParent
      while let parents = parentsByChildInstanceID[current], parents.count == 1,
        let parent = parents.first
      {
        guard parent != nodeKey, ancestors.insert(parent).inserted else {
          return cleanFallback
        }
        current = parent
      }
      if current == "root" {
        return ancestors
      }
    }
    if let preserved = findLiveAncestorPath(for: nodeKey, within: cleanFallback) {
      return preserved
    }
    if let reconstructed = findLiveAncestorPath(for: nodeKey, within: nil) {
      return reconstructed
    }
    return cleanFallback
  }

  private func isLiveAncestor(_ targetKey: String, of nodeKey: String) -> Bool {
    guard targetKey == "root" || activeNodes[targetKey] != nil else {
      return false
    }
    var seen: Set<String> = [nodeKey]
    var stack: [String] = [nodeKey]
    while let current = stack.popLast() {
      guard let parents = parentsByChildInstanceID[current] else { continue }
      for parent in parents {
        if parent == targetKey {
          return targetKey == "root"
            || findLiveAncestorPath(for: targetKey, within: nil, excluding: nodeKey) != nil
        }
        if seen.insert(parent).inserted {
          stack.append(parent)
        }
      }
    }
    return false
  }

  private func findLiveAncestorPath(
    for nodeKey: String,
    within allowedAncestors: Set<String>?,
    excluding excludedKey: String? = nil
  ) -> Set<String>? {
    if nodeKey == "root" { return [] }
    if let allowedAncestors, !allowedAncestors.contains("root") { return nil }
    var childByAncestor: [String: String] = [:]
    var queue: [String] = [nodeKey]
    var head = 0
    while head < queue.count {
      let current = queue[head]
      head += 1
      guard let parents = parentsByChildInstanceID[current] else { continue }
      if parents.contains("root") {
        var path: Set<String> = ["root"]
        var step = current
        while step != nodeKey {
          path.insert(step)
          guard let next = childByAncestor[step] else { break }
          step = next
        }
        return path
      }
      for parent in parents
      where parent != nodeKey
        && parent != excludedKey
        && childByAncestor[parent] == nil
        && (allowedAncestors?.contains(parent) ?? true)
      {
        childByAncestor[parent] = current
        queue.append(parent)
      }
    }
    return nil
  }

  private func recordNodeReplacementIfNeeded(for nodeKey: String, newNode: Node) {
    guard isTrackingNodeReplacements,
      let previousBox = activeNodes[nodeKey]?.box,
      previousBox !== newNode.box
    else {
      return
    }
    let originalOldBox = replacedNodesInCurrentPass[nodeKey]?.oldBox ?? previousBox
    replacedNodesInCurrentPass[nodeKey] = (oldBox: originalOldBox, newNode: newNode)
  }

  private func componentIdentity(
    for definitionID: String,
    in components: [String: ComponentModel]
  ) -> ComponentIdentity? {
    guard let comp = components[definitionID] else { return nil }
    return componentIdentity(for: comp)
  }

  private func componentIdentity(for comp: ComponentModel) -> ComponentIdentity {
    let effectiveCatalogID = comp.catalogID ?? defaultCatalogID
    let targetCatalog = getCatalog(id: effectiveCatalogID)
    let isRegistered = targetCatalog?.components[comp.type] != nil
    return ComponentIdentity(
      type: comp.type,
      catalogID: effectiveCatalogID,
      state: isRegistered ? .resolved : .unknownType
    )
  }

  private func applyMetadataUpdate(
    forComponentID compID: String,
    newMetadata: [String: JSONValue]?
  ) {
    guard let instances = nodesByDefinitionID[compID] else { return }
    let currentComp = componentsModel.get(compID)
    for nodeKey in instances {
      if let existing = activeNodes[nodeKey] {
        existing.updateMetadata(newMetadata)
      }
      if var record = nodeRecords[nodeKey],
        let currentComp,
        let snapshot = record.componentSnapshot,
        snapshot.type == currentComp.type,
        snapshot.catalogID == currentComp.catalogID,
        snapshot.properties == currentComp.properties
      {
        record.componentSnapshot = currentComp
        nodeRecords[nodeKey] = record
      }
    }
  }

  private func makeNodeKey(instanceID: String, basePath: String?) -> String {
    guard let basePath, !basePath.isEmpty else { return instanceID }
    return "\(instanceID)@\(normalizePath(basePath))"
  }

  private func pathsOverlap(_ pathA: String, _ pathB: String) -> Bool {
    if pathA == pathB || pathA == "/" || pathB == "/" { return true }
    let prefixA = pathA + "/"
    let prefixB = pathB + "/"
    return pathA.hasPrefix(prefixB) || pathB.hasPrefix(prefixA)
  }

  private func normalizePath(_ path: String) -> String {
    let segments = JSONValue.parsePath(path).map { segment in
      segment
        .replacingOccurrences(of: "~", with: "~0")
        .replacingOccurrences(of: "/", with: "~1")
    }
    return segments.isEmpty ? "/" : "/" + segments.joined(separator: "/")
  }

  private func ancestorPaths(of normalizedPath: String) -> [String] {
    guard normalizedPath != "/" else { return [] }
    var result: [String] = ["/"]
    var current = ""
    let parts = normalizedPath.dropFirst().split(separator: "/", omittingEmptySubsequences: false)
    for part in parts.dropLast() {
      current += "/" + part
      result.append(current)
    }
    return result
  }

  private func recordReadPath(_ path: String, in data: JSONValue) {
    let normalized = normalizePath(path)
    currentNodeReadValues?.updateValue(data[normalized], forKey: normalized)
  }

  private func readData(_ absPath: String, from data: JSONValue) -> JSONValue? {
    let normalized = normalizePath(absPath)
    let value = data[normalized]
    currentNodeReadValues?.updateValue(value, forKey: normalized)
    return value
  }

  private func registerNodeDependencies(_ record: NodeResolutionRecord) {
    let nodeKey = record.nodeKey
    var removedChildren: [String] = []

    if let oldRecord = nodeRecords[nodeKey] {
      if oldRecord.definitionID != record.definitionID {
        nodesByDefinitionID[oldRecord.definitionID]?.remove(nodeKey)
      }
      for oldReadPath in oldRecord.readValues.keys
      where !record.readValues.keys.contains(oldReadPath) {
        nodesByReadPath[oldReadPath]?.remove(nodeKey)
        if nodesByReadPath[oldReadPath]?.isEmpty == true {
          nodesByReadPath.removeValue(forKey: oldReadPath)
          for ancestor in ancestorPaths(of: oldReadPath) {
            readPathsByAncestorPath[ancestor]?.remove(oldReadPath)
          }
        }
      }
      for oldTemplatePath in oldRecord.templateCounts.keys
      where !record.templateCounts.keys.contains(oldTemplatePath) {
        nodesByTemplatePath[oldTemplatePath]?.remove(nodeKey)
      }
      for oldCall in oldRecord.agentCalls where !record.agentCalls.contains(oldCall) {
        unregisterAgentCall(oldCall, for: nodeKey)
      }
      for oldCyclicKey in Set(oldRecord.cyclicKeys).subtracting(record.cyclicKeys) {
        activeCyclicNodes.removeValue(forKey: oldCyclicKey)
      }
      for oldTarget in oldRecord.cyclicTargetNodeKeys
      where !record.cyclicTargetNodeKeys.contains(oldTarget) {
        closersByCyclicTargetNodeKey[oldTarget]?.remove(nodeKey)
        if closersByCyclicTargetNodeKey[oldTarget]?.isEmpty == true {
          closersByCyclicTargetNodeKey.removeValue(forKey: oldTarget)
        }
      }

      for oldChild in oldRecord.childSlots.keys where record.childSlots[oldChild] == nil {
        removedChildren.append(oldChild)
      }
      for addedChild in record.childSlots.keys where oldRecord.childSlots[addedChild] == nil {
        parentsByChildInstanceID[addedChild, default: []].insert(nodeKey)
      }
    } else {
      for child in record.childSlots.keys {
        parentsByChildInstanceID[child, default: []].insert(nodeKey)
      }
    }

    nodeRecords[nodeKey] = record
    nodesByDefinitionID[record.definitionID, default: []].insert(nodeKey)
    for readPath in record.readValues.keys {
      nodesByReadPath[readPath, default: []].insert(nodeKey)
      for ancestor in ancestorPaths(of: readPath) {
        readPathsByAncestorPath[ancestor, default: []].insert(readPath)
      }
    }
    for templatePath in record.templateCounts.keys {
      nodesByTemplatePath[templatePath, default: []].insert(nodeKey)
    }
    for call in record.agentCalls {
      nodesByAgentCall[call, default: []].insert(nodeKey)
    }
    for target in record.cyclicTargetNodeKeys {
      closersByCyclicTargetNodeKey[target, default: []].insert(nodeKey)
    }

    for removedChild in removedChildren {
      parentsByChildInstanceID[removedChild]?.remove(nodeKey)
      if parentsByChildInstanceID[removedChild]?.isEmpty ?? true {
        parentsByChildInstanceID.removeValue(forKey: removedChild)
        if !record.visited.contains(removedChild) {
          pruneSubtree(removedChild, protectedNodeKeys: record.visited)
        }
      }
    }
  }

  private func pruneSubtree(_ nodeKey: String, protectedNodeKeys: Set<String> = []) {
    guard !protectedNodeKeys.contains(nodeKey) else { return }
    activeNodes.removeValue(forKey: nodeKey)
    if !reportedExpressionErrors.isEmpty {
      reportedExpressionErrors = reportedExpressionErrors.filter { $0.nodeKey != nodeKey }
    }
    expressionErrorsInCurrentPass.removeValue(forKey: nodeKey)
    guard let record = nodeRecords.removeValue(forKey: nodeKey) else { return }

    nodesByDefinitionID[record.definitionID]?.remove(nodeKey)
    for readPath in record.readValues.keys {
      nodesByReadPath[readPath]?.remove(nodeKey)
      if nodesByReadPath[readPath]?.isEmpty == true {
        nodesByReadPath.removeValue(forKey: readPath)
        for ancestor in ancestorPaths(of: readPath) {
          readPathsByAncestorPath[ancestor]?.remove(readPath)
        }
      }
    }
    for templatePath in record.templateCounts.keys {
      nodesByTemplatePath[templatePath]?.remove(nodeKey)
    }
    for call in record.agentCalls {
      unregisterAgentCall(call, for: nodeKey)
    }
    for cyclicKey in record.cyclicKeys {
      activeCyclicNodes.removeValue(forKey: cyclicKey)
    }
    for target in record.cyclicTargetNodeKeys {
      closersByCyclicTargetNodeKey[target]?.remove(nodeKey)
      if closersByCyclicTargetNodeKey[target]?.isEmpty == true {
        closersByCyclicTargetNodeKey.removeValue(forKey: target)
      }
    }

    for childNodeKey in record.childSlots.keys {
      parentsByChildInstanceID[childNodeKey]?.remove(nodeKey)
      if parentsByChildInstanceID[childNodeKey]?.isEmpty ?? true {
        parentsByChildInstanceID.removeValue(forKey: childNodeKey)
        pruneSubtree(childNodeKey, protectedNodeKeys: protectedNodeKeys)
      }
    }
  }

  /// Removes a node from the nodes making an agent call.
  private func unregisterAgentCall(_ call: AgentFunctionCall, for nodeKey: String) {
    nodesByAgentCall[call]?.remove(nodeKey)
    if nodesByAgentCall[call]?.isEmpty ?? true {
      nodesByAgentCall.removeValue(forKey: call)
      // A call that failed for nodes is sent again once a node makes it anew.
      agentCallHost?.agentCallCache.forgetFailure(call)
    }
  }

  /// Disposes the resolver: cancels model change subscriptions, clears cached resolution state,
  /// and suppresses late async callbacks.
  public func dispose() {
    isDisposed = true
    modelCancellables.removeAll()
    agentCallCancellable = nil
    nodesByAgentCall.removeAll()
    dirtyAgentCalls.removeAll()
    activeNodes.removeAll()
    activeCyclicNodes.removeAll()
    nodeRecords.removeAll()
    closersByCyclicTargetNodeKey.removeAll()
    replacedNodesInCurrentPass.removeAll()
    isTrackingNodeReplacements = false
    reportedBlockedURLs.removeAll()
    reportedBlockedURLOrder.removeAll()
  }

  private func cachedSchema(
    for type: String,
    catalogID: String?,
    catalog: AnyCatalog?
  ) -> CachedComponentSchema {
    let cacheKey = "\(catalogID ?? ""):\(type)"
    if let cached = schemaCache[cacheKey] {
      return cached
    }
    let schemaJSON = catalog?.components[type]?.schema.jsonValue ?? .object([:])
    var propertiesSchema = extractPropertiesSchema(from: schemaJSON)
    // `accessibility` comes from `ComponentCommon`, so a component schema need not declare it.
    if propertiesSchema["accessibility"] == nil {
      propertiesSchema["accessibility"] = .object([
        "$ref": .string(A2UICommonSchema.v10URI(for: "AccessibilityAttributes"))
      ])
    }
    let entry = CachedComponentSchema(
      propertiesSchema: propertiesSchema,
      classifiedTypes: propertiesSchema.mapValues { classifySchema($0) }
    )
    schemaCache[cacheKey] = entry
    return entry
  }

  /// Resolves a component definition into a concrete ``Node``.
  ///
  /// - Parameters:
  ///   - definitionID: The ID of the component in `components`.
  ///   - instanceID: The unique identifier for this instance in the tree.
  ///   - basePath: The data model base path for relative bindings.
  ///   - visited: The set of node keys currently being resolved in the stack.
  ///   - components: The current map of component models on the surface.
  ///   - data: The current data model JSON snapshot.
  /// - Returns: A resolved node, or `nil` if missing, cyclic, or unregistered.
  private func resolveNode(
    definitionID: String,
    instanceID: String,
    basePath: String? = nil,
    index: Int? = nil,
    instanceSuffix: String? = nil,
    visited: Set<String> = [],
    components: [String: ComponentModel],
    data: JSONValue,
    recurseIntoChildren: Bool = true
  ) -> Node? {
    let nodeKey = makeNodeKey(instanceID: instanceID, basePath: basePath)
    let effectiveDataPath = normalizePath(basePath ?? "/")
    if visited.contains(nodeKey) {
      return resolveCyclicNode(
        definitionID: definitionID,
        instanceID: instanceID,
        nodeKey: nodeKey,
        parentKey: currentComponentID,
        basePath: basePath,
        dataContextPath: effectiveDataPath
      )
    }

    guard let component = components[definitionID] else {
      guard !(definitionID == "root" && basePath == nil && visited.isEmpty) else {
        return nil
      }
      return resolvePendingNode(
        definitionID: definitionID,
        instanceID: instanceID,
        nodeKey: nodeKey,
        basePath: basePath,
        dataContextPath: effectiveDataPath,
        index: index,
        instanceSuffix: instanceSuffix,
        visited: visited
      )
    }

    lastResolvedNodeCount += 1
    resolvedInCurrentPass.insert(nodeKey)

    let ancestorVisited = visited
    let previousComponentID = currentComponentID
    let previousPropertyPath = currentPropertyPath
    let previousReadValues = currentNodeReadValues
    let previousTemplateCounts = currentNodeTemplateCounts
    let previousChildSlots = currentNodeChildSlots
    let previousAgentCalls = currentNodeAgentCalls
    let previousCyclicKeys = currentNodeCyclicKeys
    let previousCyclicTargetNodeKeys = currentNodeCyclicTargetNodeKeys
    let previousURLCheckInfo = currentURLCheckInfo
    currentComponentID = nodeKey
    currentNodeReadValues = [:]
    currentNodeTemplateCounts = [:]
    currentNodeChildSlots = [:]
    currentNodeAgentCalls = []
    currentNodeCyclicKeys = []
    currentNodeCyclicTargetNodeKeys = []
    defer {
      currentComponentID = previousComponentID
      currentPropertyPath = previousPropertyPath
      currentNodeReadValues = previousReadValues
      currentNodeTemplateCounts = previousTemplateCounts
      currentNodeChildSlots = previousChildSlots
      currentNodeAgentCalls = previousAgentCalls
      currentNodeCyclicKeys = previousCyclicKeys
      currentNodeCyclicTargetNodeKeys = previousCyclicTargetNodeKeys
      currentURLCheckInfo = previousURLCheckInfo
    }

    let type = component.type
    let effectiveCatalogID = component.catalogID ?? defaultCatalogID
    let targetCatalog = getCatalog(id: effectiveCatalogID)
    currentURLCheckInfo = URLCheckInfo(
      surfaceID: surfaceID,
      catalogID: targetCatalog?.id ?? effectiveCatalogID,
      componentType: type,
      componentID: definitionID
    )
    let isRegisteredType = targetCatalog?.components[type] != nil
    let nodeState: NodeState = isRegisteredType ? .resolved : .unknownType
    if !isRegisteredType {
      let catalogLabel = targetCatalog?.id ?? effectiveCatalogID ?? "none"
      reportResolutionError(
        code: "UNKNOWN_COMPONENT_TYPE",
        message: "Component '\(definitionID)' has type '\(type)', which is not in catalog "
          + "'\(catalogLabel)'.",
        dedupeKey: "UNKNOWN_COMPONENT_TYPE:\(type)"
      )
    }

    var visited = visited
    visited.insert(nodeKey)

    let cached = cachedSchema(for: type, catalogID: effectiveCatalogID, catalog: targetCatalog)
    let propertiesSchema = cached.propertiesSchema

    // An unknown-type node stays inert like the `pending` and `cyclic` placeholders: its
    // properties are not resolved, so it reads no data, makes no calls and has no children.
    let resolvesProperties = nodeState == .resolved
    var componentChecks: [ResolvedCheck] = []
    var preResolvedChecksByKey: [String: [ResolvedCheck]] = [:]
    for (key, val) in component.properties
    where resolvesProperties && cached.classifiedTypes[key] == .checks {
      currentPropertyPath = key
      let resolved = resolveChecks(val, basePath: basePath, index: index, data: data)
      preResolvedChecksByKey[key] = resolved
      componentChecks.append(contentsOf: resolved)
    }

    var resolvedProperties: [String: any Resolved] = [:]
    for (key, val) in component.properties where resolvesProperties {
      if let preResolved = preResolvedChecksByKey[key] {
        resolvedProperties[key] = preResolved
        continue
      }
      let propSchema = propertiesSchema[key] ?? .boolean(true)
      let propType = cached.classifiedTypes[key] ?? .standard

      if let resolvedVal = resolveProperty(
        value: val,
        schema: propSchema,
        type: propType,
        basePath: basePath,
        index: index,
        instanceSuffix: instanceSuffix,
        componentID: definitionID,
        propertyKey: key,
        slotLocation: SlotLocation(property: key),
        visited: visited,
        components: components,
        data: data,
        checks: componentChecks,
        recurseIntoChildren: recurseIntoChildren,
        urlContext: urlContext(
          ofProperty: key,
          schema: propSchema,
          componentType: type,
          catalogID: targetCatalog?.id ?? effectiveCatalogID
        )
      ) {
        resolvedProperties[key] = resolvedVal
      }
    }

    let record = NodeResolutionRecord(
      nodeKey: nodeKey,
      definitionID: definitionID,
      instanceID: instanceID,
      basePath: basePath,
      index: index,
      instanceSuffix: instanceSuffix,
      visited: ancestorVisited,
      componentSnapshot: component,
      readValues: currentNodeReadValues ?? [:],
      templateCounts: currentNodeTemplateCounts ?? [:],
      childSlots: currentNodeChildSlots ?? [:],
      agentCalls: currentNodeAgentCalls ?? [],
      cyclicKeys: currentNodeCyclicKeys ?? [],
      cyclicTargetNodeKeys: currentNodeCyclicTargetNodeKeys ?? []
    )
    registerNodeDependencies(record)

    if let existing = activeNodes[nodeKey],
      existing.state == nodeState
        && existing.type == type
        && existing.catalogID == effectiveCatalogID
    {
      existing.updateProperties(resolvedProperties, metadata: component.metadata)
      return existing
    }

    let node = Node(
      id: instanceID,
      type: type,
      catalogID: effectiveCatalogID,
      state: nodeState,
      scopeKey: basePath,
      dataContextPath: effectiveDataPath,
      properties: resolvedProperties,
      metadata: component.metadata
    )
    recordNodeReplacementIfNeeded(for: nodeKey, newNode: node)
    activeNodes[nodeKey] = node
    return node
  }

  private func resolvePendingNode(
    definitionID: String,
    instanceID: String,
    nodeKey: String,
    basePath: String?,
    dataContextPath: String,
    index: Int?,
    instanceSuffix: String?,
    visited: Set<String>
  ) -> Node {
    resolvedInCurrentPass.insert(nodeKey)
    let record = NodeResolutionRecord(
      nodeKey: nodeKey,
      definitionID: definitionID,
      instanceID: instanceID,
      basePath: basePath,
      index: index,
      instanceSuffix: instanceSuffix,
      visited: visited,
      componentSnapshot: nil,
      readValues: [:],
      templateCounts: [:],
      agentCalls: []
    )
    registerNodeDependencies(record)

    if let existing = activeNodes[nodeKey], existing.state == .pending {
      return existing
    }
    let node = Node.pending(id: instanceID, scopeKey: basePath, dataContextPath: dataContextPath)
    recordNodeReplacementIfNeeded(for: nodeKey, newNode: node)
    activeNodes[nodeKey] = node
    return node
  }

  private func resolveCyclicNode(
    definitionID: String,
    instanceID: String,
    nodeKey: String,
    parentKey: String?,
    basePath: String?,
    dataContextPath: String
  ) -> Node {
    // Every descendant that repeats this ancestor closes the same cycle, so the report is
    // shared and keyed by the repeated node, as in the other core SDKs.
    reportResolutionError(
      code: "CYCLIC_REFERENCE",
      message: "Component '\(definitionID)' at '\(dataContextPath)' is referenced by one of its "
        + "own descendants; omitting the reference.",
      dedupeKey: "CYCLIC_REFERENCE:\(nodeKey)",
      sharedAcrossNodes: true
    )
    // Each reference that closes a cycle gets its own placeholder, so two slots that repeat the
    // same ancestor never share one node.
    let slotKey = "\(parentKey ?? "")/\(currentPropertyPath ?? "")->\(nodeKey)"
    let occurrence = currentNodeCyclicKeys?.filter { $0.hasPrefix("\(slotKey)#") }.count ?? 0
    let cyclicKey = "\(slotKey)#\(occurrence)"
    currentNodeCyclicKeys?.append(cyclicKey)
    currentNodeCyclicTargetNodeKeys?.insert(nodeKey)
    if let existing = activeCyclicNodes[cyclicKey] {
      return existing
    }
    let node = Node.cyclic(id: instanceID, scopeKey: basePath, dataContextPath: dataContextPath)
    activeCyclicNodes[cyclicKey] = node
    return node
  }

  private func resolveChildReference(
    definitionID childID: String,
    instanceID childInstanceID: String,
    slot: NodeBox.ChildSlot,
    basePath: String?,
    index: Int?,
    instanceSuffix: String?,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    recurseIntoChildren: Bool
  ) -> Node? {
    let childIdentity = componentIdentity(for: childID, in: components)

    let childNodeKey = makeNodeKey(instanceID: childInstanceID, basePath: basePath)
    if visited.contains(childNodeKey) {
      return resolveCyclicNode(
        definitionID: childID,
        instanceID: childInstanceID,
        nodeKey: childNodeKey,
        parentKey: currentComponentID,
        basePath: basePath,
        dataContextPath: normalizePath(basePath ?? "/")
      )
    }

    let existingRecord = nodeRecords[childNodeKey]
    let expectedState = childIdentity?.state ?? .pending
    let expectedType = childIdentity?.type ?? "Placeholder"
    if !recurseIntoChildren,
      let existing = activeNodes[childNodeKey],
      let existingRecord,
      existingRecord.definitionID == childID,
      existingRecord.basePath == basePath,
      existingRecord.index == index,
      existingRecord.instanceSuffix == instanceSuffix,
      existingRecord.visited == visited,
      existing.state == expectedState,
      existing.type == expectedType && existing.catalogID == childIdentity?.catalogID
    {
      currentNodeChildSlots?[childNodeKey, default: []].append(slot)
      return existing
    }

    let shouldRecurse =
      recurseIntoChildren
      || (existingRecord != nil
        && (existingRecord?.basePath != basePath
          || existingRecord?.index != index
          || existingRecord?.instanceSuffix != instanceSuffix
          || existingRecord?.visited != visited))
    if let childNode = resolveNode(
      definitionID: childID,
      instanceID: childInstanceID,
      basePath: basePath,
      index: index,
      instanceSuffix: instanceSuffix,
      visited: visited,
      components: components,
      data: data,
      recurseIntoChildren: shouldRecurse
    ) {
      currentNodeChildSlots?[childNodeKey, default: []].append(slot)
      return childNode
    }
    return nil
  }

  // MARK: - Property Classification & Extraction

  private enum PropertyType {
    case dynamicBoolean
    case dynamicString
    case dynamicNumber
    case dynamicValue
    case dynamicStringList
    case checks
    case action
    case childList
    case componentID
    case number
    case integer
    case standard
  }

  private static let refPropertyTypes: [String: PropertyType] = [
    "DynamicBoolean": .dynamicBoolean,
    "DynamicString": .dynamicString,
    "DynamicNumber": .dynamicNumber,
    "DynamicValue": .dynamicValue,
    "DynamicStringList": .dynamicStringList,
    "DataBinding": .dynamicString,
    "CheckRule": .checks,
    "Checkable": .checks,
    "Action": .action,
    "ChildList": .childList,
    "Child": .componentID,
    "ComponentId": .componentID,
  ]

  private func classifySchema(_ schemaJSON: JSONValue) -> PropertyType {
    if let ref = schemaJSON["$ref"]?.stringValue,
      let typeName = ref.split(separator: "/").last.map(String.init),
      let matched = Self.refPropertyTypes[typeName]
    {
      return matched
    }
    if let composite = classifyCompositeSchema(schemaJSON) {
      return composite
    }
    if let items = schemaJSON["items"], classifySchema(items) == .checks {
      return .checks
    }
    return classifyNumericTypeSchema(schemaJSON)
  }

  private func classifyCompositeSchema(_ schemaJSON: JSONValue) -> PropertyType? {
    for keyword in ["oneOf", "anyOf", "allOf"] {
      guard let subSchemas = schemaJSON[keyword]?.arrayValue else { continue }
      for sub in subSchemas {
        let type = classifySchema(sub)
        if type != .standard { return type }
      }
    }
    return nil
  }

  private func classifyNumericTypeSchema(_ schemaJSON: JSONValue) -> PropertyType {
    if let type = schemaJSON["type"]?.stringValue {
      if type == "number" { return .number }
      if type == "integer" { return .integer }
    } else if let types = schemaJSON["type"]?.arrayValue {
      let typeStrings = types.compactMap(\.stringValue)
      if typeStrings.contains("number") { return .number }
      if typeStrings.contains("integer") { return .integer }
    }
    return .standard
  }

  private func extractPropertiesSchema(from schemaJSON: JSONValue) -> [String: JSONValue] {
    var result: [String: JSONValue] = [:]
    if let props = schemaJSON["properties"]?.objectValue {
      for (k, v) in props {
        result[k] = v
      }
    }
    if let ref = schemaJSON["$ref"]?.stringValue,
      let def = lookupCommonDef(ref: ref)
    {
      result.merge(extractPropertiesSchema(from: def)) { _, new in new }
    }
    for keyword in ["allOf", "oneOf", "anyOf"] {
      for subSchema in schemaJSON[keyword]?.arrayValue ?? [] {
        result.merge(extractPropertiesSchema(from: subSchema)) { _, new in new }
      }
    }
    return result
  }

  private func lookupCommonDef(ref: String) -> JSONValue? {
    let typeName = ref.split(separator: "/").last.map(String.init) ?? ""
    return A2UICommonSchema.v10Document["$defs"]?.objectValue?[typeName]
      ?? A2UICommonSchema.document["$defs"]?.objectValue?[typeName]
  }

  // MARK: - Property Resolution

  private func resolveProperty(
    value: JSONValue,
    schema: JSONValue,
    type: PropertyType,
    basePath: String?,
    index: Int? = nil,
    instanceSuffix: String? = nil,
    componentID: String,
    propertyKey: String,
    slotLocation: SlotLocation,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    checks: [ResolvedCheck] = [],
    recurseIntoChildren: Bool = true,
    urlContext: URLContext? = nil
  ) -> (any Resolved)? {
    let previousPropertyPath = currentPropertyPath
    currentPropertyPath = propertyKey
    defer {
      currentPropertyPath = previousPropertyPath
    }
    let resolved: (any Resolved)?
    switch type {
    case .dynamicBoolean:
      resolved = resolveDynamicBoolean(value, basePath: basePath, index: index, data: data)
    case .dynamicString:
      resolved = resolveDynamicString(value, basePath: basePath, index: index, data: data)
    case .dynamicNumber:
      resolved = resolveDynamicNumber(value, basePath: basePath, index: index, data: data)
    case .dynamicValue:
      resolved = resolveDynamicValueBinding(value, basePath: basePath, index: index, data: data)
    case .dynamicStringList:
      resolved = resolveDynamicStringList(value, basePath: basePath, index: index, data: data)
    case .checks:
      resolved = resolveChecks(value, basePath: basePath, index: index, data: data)
    case .action:
      resolved = resolveAction(
        value,
        checks: checks,
        basePath: basePath,
        index: index,
        componentID: componentID,
        data: data
      )
    case .childList:
      resolved = resolveChildList(
        value,
        basePath: basePath,
        index: index,
        instanceSuffix: instanceSuffix,
        componentID: componentID,
        slotLocation: slotLocation,
        visited: visited,
        components: components,
        data: data,
        recurseIntoChildren: recurseIntoChildren
      )
    case .componentID:
      resolved = resolveComponentIDProperty(
        value: value,
        slotLocation: slotLocation,
        basePath: basePath,
        index: index,
        instanceSuffix: instanceSuffix,
        visited: visited,
        components: components,
        data: data,
        recurseIntoChildren: recurseIntoChildren
      )
    case .number:
      resolved = value.doubleValue
    case .integer:
      resolved = value.intValue
    case .standard:
      resolved = resolveStandardProperty(
        value: value,
        schema: schema,
        basePath: basePath,
        index: index,
        instanceSuffix: instanceSuffix,
        componentID: componentID,
        propertyKey: propertyKey,
        slotLocation: slotLocation,
        visited: visited,
        components: components,
        data: data,
        checks: checks,
        recurseIntoChildren: recurseIntoChildren
      )
    }
    guard let urlContext else { return resolved }
    return filterURL(resolved, context: urlContext, propertyPath: propertyKey)
  }

  private func resolveComponentIDProperty(
    value: JSONValue,
    slotLocation: SlotLocation,
    basePath: String?,
    index: Int?,
    instanceSuffix: String?,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    recurseIntoChildren: Bool = true
  ) -> (any Resolved)? {
    guard let childID = value.stringValue else { return nil }
    let effectiveSuffix = instanceSuffix ?? index.map { "\($0)" }
    let childInstanceID = effectiveSuffix.map { "\(childID)_\($0)" } ?? childID
    return resolveChildReference(
      definitionID: childID,
      instanceID: childInstanceID,
      slot: slotLocation.makeSlot(),
      basePath: basePath,
      index: index,
      instanceSuffix: effectiveSuffix,
      visited: visited,
      components: components,
      data: data,
      recurseIntoChildren: recurseIntoChildren
    )
  }

  private func resolveStandardProperty(
    value: JSONValue,
    schema: JSONValue,
    basePath: String?,
    index: Int?,
    instanceSuffix: String?,
    componentID: String,
    propertyKey: String,
    slotLocation: SlotLocation,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    checks: [ResolvedCheck],
    recurseIntoChildren: Bool = true
  ) -> (any Resolved)? {
    if let array = value.arrayValue {
      return resolveStandardArrayProperty(
        array: array,
        rawValue: value,
        schema: schema,
        basePath: basePath,
        index: index,
        instanceSuffix: instanceSuffix,
        componentID: componentID,
        propertyKey: propertyKey,
        slotLocation: slotLocation,
        visited: visited,
        components: components,
        data: data,
        checks: checks,
        recurseIntoChildren: recurseIntoChildren
      )
    }
    if let object = value.objectValue {
      let objectProperties = extractPropertiesSchema(from: schema)
      if !objectProperties.isEmpty {
        return resolveStandardObjectProperty(
          object: object,
          objectProperties: objectProperties,
          basePath: basePath,
          index: index,
          instanceSuffix: instanceSuffix,
          componentID: componentID,
          propertyKey: propertyKey,
          slotLocation: slotLocation,
          visited: visited,
          components: components,
          data: data,
          checks: checks,
          recurseIntoChildren: recurseIntoChildren
        )
      }
    }
    return resolvePrimitiveValue(value)
  }

  private func resolveStandardArrayProperty(
    array: [JSONValue],
    rawValue: JSONValue,
    schema: JSONValue,
    basePath: String?,
    index: Int?,
    instanceSuffix: String?,
    componentID: String,
    propertyKey: String,
    slotLocation: SlotLocation,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    checks: [ResolvedCheck],
    recurseIntoChildren: Bool = true
  ) -> (any Resolved)? {
    let itemsSchema = schema["items"] ?? .boolean(true)
    let itemType = classifySchema(itemsSchema)
    if itemType == .checks {
      return resolveChecks(rawValue, basePath: basePath, index: index, data: data)
    }
    var resolvedArray: [any Resolved] = []
    resolvedArray.reserveCapacity(array.count)
    for (itemIndex, item) in array.enumerated() {
      let itemSlotLocation = slotLocation.appending(.arrayIndex(resolvedArray.count))
      if let resolved = resolveProperty(
        value: item,
        schema: itemsSchema,
        type: itemType,
        basePath: basePath,
        index: index,
        instanceSuffix: instanceSuffix,
        componentID: componentID,
        propertyKey: "\(propertyKey)/\(itemIndex)",
        slotLocation: itemSlotLocation,
        visited: visited,
        components: components,
        data: data,
        checks: checks,
        recurseIntoChildren: recurseIntoChildren,
        urlContext: URLSchema.annotation(of: itemsSchema)?.urlContext
      ) {
        resolvedArray.append(resolved)
      } else if item == .null {
        resolvedArray.append(item)
      }
    }
    return ResolvedArray(resolvedArray)
  }

  private func resolveStandardObjectProperty(
    object: OrderedDictionary<String, JSONValue>,
    objectProperties: [String: JSONValue],
    basePath: String?,
    index: Int?,
    instanceSuffix: String?,
    componentID: String,
    propertyKey: String,
    slotLocation: SlotLocation,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    checks: [ResolvedCheck],
    recurseIntoChildren: Bool = true
  ) -> ResolvedDictionary {
    var resolvedObject: [String: any Resolved] = [:]
    let bindingKey = atLeastV10 ? "@path" : "path"
    for (key, propertyValue) in object {
      let nestedPropSchema = objectProperties[key] ?? .boolean(true)
      let classified = classifySchema(nestedPropSchema)
      let nestedPropType: PropertyType =
        (classified == .standard && propertyValue.objectValue?[bindingKey] != nil)
        ? .dynamicValue : classified
      if let resolvedValue = resolveProperty(
        value: propertyValue,
        schema: nestedPropSchema,
        type: nestedPropType,
        basePath: basePath,
        index: index,
        instanceSuffix: instanceSuffix,
        componentID: componentID,
        propertyKey: "\(propertyKey)/\(key)",
        slotLocation: slotLocation.appending(.key(key)),
        visited: visited,
        components: components,
        data: data,
        checks: checks,
        recurseIntoChildren: recurseIntoChildren,
        urlContext: URLSchema.annotation(of: nestedPropSchema)?.urlContext
      ) {
        resolvedObject[key] = resolvedValue
      }
    }
    return ResolvedDictionary(resolvedObject)
  }

  private func resolvePrimitiveValue(_ value: JSONValue) -> (any Resolved)? {
    switch value {
    case .string(let str): return str
    case .boolean(let b): return b
    case .number(let n): return n
    case .integer(let i): return i
    case .null: return nil
    default: return value
    }
  }

  // MARK: - Dynamic Value Evaluation

  private func evaluateDynamicValue(
    _ value: JSONValue,
    basePath: String?,
    index: Int? = nil,
    userActivation: Bool = false
  ) -> JSONValue {
    let currentData = dataModel.data
    let previousReadHook = dataModel.onReadPath
    if currentNodeReadValues != nil {
      dataModel.onReadPath = { [weak self] path in
        self?.recordReadPath(path, in: currentData)
      }
    }
    defer {
      dataModel.onReadPath = previousReadHook
    }
    let context = DataContext(
      dataModel: dataModel,
      path: basePath ?? "",
      functionHandler: self,
      protocolVersion: effectiveProtocolVersion,
      index: index,
      isUserActivated: userActivation
    )
    return context.resolveDynamicValue(value)
  }

  private func coerceToString(_ value: JSONValue?) -> String? {
    guard let value, value != .null else { return nil }
    switch value {
    case .string(let s):
      return s
    case .integer(let i):
      return String(i)
    case .number(let d):
      if let exactInt = Int(exactly: d) {
        return String(exactInt)
      } else {
        return String(d)
      }
    case .boolean(let b):
      return b ? "true" : "false"
    default:
      if let encoded = try? JSONEncoder().encode(value),
        let str = String(data: encoded, encoding: .utf8)
      {
        return str
      }
      return "\(value)"
    }
  }

  // MARK: - Dynamic Type-Specific Resolvers

  private func resolveDynamicBoolean(
    _ value: JSONValue,
    basePath: String?,
    index: Int? = nil,
    data: JSONValue
  ) -> DataBinding<Bool> {
    let bindingKey = atLeastV10 ? "@path" : "path"
    if let dict = value.dictionaryValue,
      let pathStr = dict[bindingKey]?.stringValue
    {
      let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
      let resolvedValue = readData(absPath, from: data)?.coercedDynamicBoolean ?? false
      return DataBinding<Bool>(
        identity: .path(absPath),
        value: resolvedValue,
        set: { [weak self] newValue in
          self?.dataModel.set(absPath, value: .boolean(newValue))
        }
      )
    }
    let resolvedValue = evaluateDynamicValue(
      value, basePath: basePath, index: index
    ).coercedDynamicBoolean
    return DataBinding<Bool>(
      identity: .literal(value),
      value: resolvedValue,
      set: { _ in }
    )
  }

  private func resolveDynamicString(
    _ value: JSONValue,
    basePath: String?,
    index: Int? = nil,
    data: JSONValue
  ) -> DataBinding<String> {
    let bindingKey = atLeastV10 ? "@path" : "path"
    if let dict = value.dictionaryValue,
      let pathStr = dict[bindingKey]?.stringValue
    {
      let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
      let resolvedValue = coerceToString(readData(absPath, from: data))
      return DataBinding<String>(
        identity: .path(absPath),
        value: resolvedValue,
        set: { [weak self] newValue in
          self?.dataModel.set(absPath, value: .string(newValue))
        }
      )
    }
    let evaluated = evaluateDynamicValue(value, basePath: basePath, index: index)
    let resolvedValue = coerceToString(evaluated)
    return DataBinding<String>(
      identity: .literal(value),
      value: resolvedValue,
      set: { _ in }
    )
  }

  private func resolveDynamicNumber(
    _ value: JSONValue,
    basePath: String?,
    index: Int? = nil,
    data: JSONValue
  ) -> DataBinding<Double> {
    let bindingKey = atLeastV10 ? "@path" : "path"
    if let dict = value.dictionaryValue,
      let pathStr = dict[bindingKey]?.stringValue
    {
      let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
      let resolvedValue = readData(absPath, from: data)?.doubleValue
      return DataBinding<Double>(
        identity: .path(absPath),
        value: resolvedValue,
        set: { [weak self] newValue in
          self?.dataModel.set(absPath, value: .number(newValue))
        }
      )
    }
    let resolvedValue = evaluateDynamicValue(value, basePath: basePath, index: index).doubleValue
    return DataBinding<Double>(
      identity: .literal(value),
      value: resolvedValue,
      set: { _ in }
    )
  }

  private func resolveDynamicValueBinding(
    _ value: JSONValue,
    basePath: String?,
    index: Int? = nil,
    data: JSONValue
  ) -> DataBinding<JSONValue> {
    let bindingKey = atLeastV10 ? "@path" : "path"
    if let dict = value.dictionaryValue,
      let pathStr = dict[bindingKey]?.stringValue
    {
      let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
      let resolvedValue = readData(absPath, from: data)
      return DataBinding<JSONValue>(
        identity: .path(absPath),
        value: resolvedValue,
        set: { [weak self] newValue in
          self?.dataModel.set(absPath, value: newValue)
        }
      )
    }
    let resolvedValue = evaluateDynamicValue(value, basePath: basePath, index: index)
    return DataBinding<JSONValue>(
      identity: .literal(value),
      value: resolvedValue,
      set: { _ in }
    )
  }

  private func resolveDynamicStringList(
    _ value: JSONValue,
    basePath: String?,
    index: Int? = nil,
    data: JSONValue
  ) -> DataBinding<[String]> {
    let bindingKey = atLeastV10 ? "@path" : "path"
    if let dict = value.dictionaryValue,
      let pathStr = dict[bindingKey]?.stringValue
    {
      let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
      let resolvedValue = readData(absPath, from: data)?.arrayValue?.compactMap {
        self.coerceToString($0)
      }
      return DataBinding<[String]>(
        identity: .path(absPath),
        value: resolvedValue,
        set: { [weak self] newValue in
          self?.dataModel.set(absPath, value: .array(newValue.map { .string($0) }))
        }
      )
    }
    let resolvedValue = evaluateDynamicValue(value, basePath: basePath, index: index).arrayValue?
      .compactMap {
        self.coerceToString($0)
      }
    return DataBinding<[String]>(
      identity: .literal(value),
      value: resolvedValue,
      set: { _ in }
    )
  }

  // MARK: - Validation Checks Resolution

  private func resolveChecks(
    _ value: JSONValue,
    basePath: String?,
    index: Int? = nil,
    data: JSONValue
  ) -> [ResolvedCheck] {
    if let array = value.arrayValue {
      return array.compactMap {
        parseSingleCheckRule($0, basePath: basePath, index: index, data: data)
      }
    }
    if value.dictionaryValue != nil,
      let check = parseSingleCheckRule(value, basePath: basePath, index: index, data: data)
    {
      return [check]
    }
    return []
  }

  private func parseSingleCheckRule(
    _ ruleJSON: JSONValue,
    basePath: String?,
    index: Int?,
    data: JSONValue
  ) -> ResolvedCheck? {
    let ruleDict = ruleJSON.dictionaryValue
    let conditionJSON = ruleDict?["condition"] ?? ruleJSON
    let fallbackMessage = ruleDict?["message"]?.stringValue ?? "Validation failed"
    let explicitRuleMessage = ruleDict?["message"]?.stringValue
    let bindingKey = atLeastV10 ? "@path" : "path"

    if let dict = conditionJSON.dictionaryValue, let pathStr = dict[bindingKey]?.stringValue {
      let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
      return makePathBoundCheck(
        absPath: absPath,
        rawVal: readData(absPath, from: data),
        fallbackMessage: fallbackMessage
      )
    }

    let previousCheckAgentCalls = currentCheckAgentCalls
    currentCheckAgentCalls = []
    let evaluated = evaluateDynamicValue(conditionJSON, basePath: basePath, index: index)
    let agentCalls = currentCheckAgentCalls ?? []
    currentCheckAgentCalls = previousCheckAgentCalls
    // A condition waiting on the agent neither passes nor fails until the call settles.
    if evaluated == .null, agentCalls.contains(where: isAgentCallPending) {
      return ResolvedCheck(
        condition: DataBinding(identity: .literal(conditionJSON), value: nil, set: { _ in }),
        message: explicitRuleMessage ?? fallbackMessage,
        isPending: true
      )
    }
    return makeEvaluatedCheck(
      conditionJSON: conditionJSON,
      evaluated: evaluated,
      fallbackMessage: fallbackMessage,
      explicitRuleMessage: explicitRuleMessage
    )
  }

  /// Whether `call`, routed to the agent from a binding or check, awaits the agent's response.
  private func isAgentCallPending(_ call: AgentFunctionCall) -> Bool {
    guard case .pending = agentCallHost?.agentCallCache[call] else { return false }
    return true
  }

  private func makePathBoundCheck(
    absPath: String,
    rawVal: JSONValue?,
    fallbackMessage: String
  ) -> ResolvedCheck {
    if let rawDict = rawVal?.objectValue, let valid = rawDict["valid"]?.boolValue {
      let result = parseValidationResultObject(
        rawDict,
        valid: valid,
        fallbackMessage: fallbackMessage
      )
      return ResolvedCheck(
        condition: DataBinding(identity: .path(absPath), value: valid, set: { _ in }),
        message: result.message ?? fallbackMessage,
        validationResult: result
      )
    }
    let valid = rawVal?.boolValue ?? false
    let result = ValidationResult(
      valid: valid,
      code: nil,
      message: fallbackMessage,
      severity: .error
    )
    return ResolvedCheck(
      condition: DataBinding(
        identity: .path(absPath),
        value: valid,
        set: { [weak self] newValue in
          self?.dataModel.set(absPath, value: .boolean(newValue))
        }
      ),
      message: fallbackMessage,
      validationResult: result
    )
  }

  private func makeEvaluatedCheck(
    conditionJSON: JSONValue,
    evaluated: JSONValue,
    fallbackMessage: String,
    explicitRuleMessage: String? = nil
  ) -> ResolvedCheck {
    if let evalDict = evaluated.objectValue, let valid = evalDict["valid"]?.boolValue {
      let result = parseValidationResultObject(
        evalDict,
        valid: valid,
        fallbackMessage: fallbackMessage,
        explicitRuleMessage: explicitRuleMessage
      )
      return ResolvedCheck(
        condition: DataBinding(identity: .literal(conditionJSON), value: valid, set: { _ in }),
        message: result.message ?? explicitRuleMessage ?? fallbackMessage,
        validationResult: result
      )
    }
    let valid = evaluated.boolValue ?? false
    let result = ValidationResult(
      valid: valid,
      code: nil,
      message: explicitRuleMessage ?? fallbackMessage,
      severity: .error
    )
    return ResolvedCheck(
      condition: DataBinding(identity: .literal(conditionJSON), value: valid, set: { _ in }),
      message: explicitRuleMessage ?? fallbackMessage,
      validationResult: result
    )
  }

  private func parseValidationResultObject(
    _ dict: OrderedDictionary<String, JSONValue>,
    valid: Bool,
    fallbackMessage: String,
    explicitRuleMessage: String? = nil
  ) -> ValidationResult {
    let code = dict["code"]?.stringValue
    let msg = explicitRuleMessage ?? dict["message"]?.stringValue ?? fallbackMessage
    let severity =
      dict["severity"]?.stringValue.flatMap { ValidationSeverity(rawValue: $0) } ?? .error
    return ValidationResult(valid: valid, code: code, message: msg, severity: severity)
  }

  // MARK: - Action Resolution

  private func resolveAction(
    _ value: JSONValue,
    checks: [ResolvedCheck] = [],
    basePath: String?,
    index: Int? = nil,
    componentID: String,
    data: JSONValue
  ) -> ResolvedAction? {
    guard let dict = value.dictionaryValue else { return nil }
    if let eventObj = extractEventActionObject(dict),
      let name = eventObj["name"]?.stringValue
    {
      return makeEventResolvedAction(
        name: name,
        eventObject: eventObj,
        outerObject: dict,
        checks: checks,
        basePath: basePath,
        index: index,
        componentID: componentID
      )
    }
    let callKey = atLeastV10 ? "@call" : "call"
    if let funcCallVal = extractFunctionCallActionValue(value, dict: dict, callKey: callKey),
      let funcCallDict = funcCallVal.dictionaryValue,
      let call = funcCallDict[callKey]?.stringValue
    {
      return makeFunctionResolvedAction(
        call: call,
        functionCallValue: funcCallVal,
        functionCallDictionary: funcCallDict,
        checks: checks,
        basePath: basePath,
        index: index,
        componentID: componentID
      )
    }
    return nil
  }

  private func extractEventActionObject(_ dict: [String: JSONValue]) -> [String: JSONValue]? {
    if let wrapped = dict["event"]?.dictionaryValue { return wrapped }
    if dict["name"]?.stringValue != nil { return dict }
    return nil
  }

  private func extractFunctionCallActionValue(
    _ value: JSONValue,
    dict: [String: JSONValue],
    callKey: String
  ) -> JSONValue? {
    if let wrapped = value["functionCall"], wrapped.dictionaryValue != nil { return wrapped }
    if dict[callKey]?.stringValue != nil { return value }
    return nil
  }

  private func makeEventResolvedAction(
    name: String,
    eventObject: [String: JSONValue],
    outerObject: [String: JSONValue],
    checks: [ResolvedCheck],
    basePath: String?,
    index: Int?,
    componentID: String
  ) -> ResolvedAction {
    let contextDictionary = eventObject["context"]?.dictionaryValue
    // The entries of `context`, in the order the decoded object holds them.
    let contextEntries = eventObject["context"]?.objectValue
    let userMessageValue = eventObject["userMessage"]
    let rawMetadata = eventObject["metadata"] ?? outerObject["metadata"]
    let actionMetadata = try? MetadataValidator.validate(
      rawMetadata,
      pathPrefix: "action.metadata"
    )
    let unresolvedIdentity = ResolvedAction.Identity.event(
      name: name,
      context: contextDictionary,
      userMessage: userMessageValue?.stringValue
    )
    return ResolvedAction(
      identity: unresolvedIdentity,
      sourceComponentID: componentID,
      dataContextPath: basePath,
      rawUserMessage: userMessageValue,
      metadata: actionMetadata,
      triggerWithUserActivation: { [weak self] userActivation, callMetadata in
        guard let self else { return }
        guard self.reportFailedActionChecksIfNeeded(checks, componentID: componentID) else {
          return
        }
        let validatedBase = try MetadataValidator.validate(
          rawMetadata,
          pathPrefix: "action.metadata"
        )
        let mergedMetadata = try MetadataValidator.mergeActionMetadata(
          base: validatedBase,
          override: callMetadata
        )
        self.runEventAction(
          name: name,
          contextEntries: contextEntries,
          userMessageValue: userMessageValue,
          metadata: mergedMetadata,
          basePath: basePath,
          index: index,
          componentID: componentID,
          isUserActivated: userActivation
        )
      }
    )
  }

  private func makeFunctionResolvedAction(
    call: String,
    functionCallValue: JSONValue,
    functionCallDictionary: [String: JSONValue],
    checks: [ResolvedCheck],
    basePath: String?,
    index: Int?,
    componentID: String
  ) -> ResolvedAction {
    let argsDictionary = functionCallDictionary["args"]?.dictionaryValue
    let unresolvedIdentity = ResolvedAction.Identity.function(call: call, args: argsDictionary)
    return ResolvedAction(
      identity: unresolvedIdentity,
      sourceComponentID: componentID,
      dataContextPath: basePath,
      triggerWithUserActivation: { [weak self] userActivation, _ in
        guard let self else { return }
        guard self.reportFailedActionChecksIfNeeded(checks, componentID: componentID) else {
          return
        }
        self.runActionFunctionCall(
          functionCallValue,
          basePath: basePath,
          index: index,
          isUserActivated: userActivation
        )
      }
    )
  }

  private func reportFailedActionChecksIfNeeded(
    _ checks: [ResolvedCheck],
    componentID: String
  ) -> Bool {
    let failedChecks = checks.filter { !$0.isValid }
    guard !failedChecks.isEmpty else { return true }
    let errorMessage = failedChecks.map(\.message).joined(separator: ", ")
    let version = effectiveProtocolVersion ?? .v10
    actionHandler?.handle(
      error: .validationFailed(
        ValidationFailedError(
          surfaceID: surfaceID,
          path: componentID,
          message: errorMessage,
          version: version
        )
      ),
      from: surfaceID
    )
    return false
  }

  /// The outcome of resolving one value of an action: an entry of an event's `context`, its
  /// `userMessage`, or the function call of an action.
  private enum ActionValueResolution {
    /// The value resolved.
    case resolved(JSONValue)
    /// The value waits on these calls routed to the agent.
    case pending(Set<AgentFunctionCall>)
    /// A call failed, and its error was reported. The action stops.
    case failed
  }

  /// Resolves one value of an action run in response to a user gesture, with `actionCache`
  /// holding the agent's answers for this run of the action.
  private func resolveActionValue(
    _ value: JSONValue,
    in context: DataContext,
    actionCache: AgentCallCache
  ) -> ActionValueResolution {
    let previousActionCallCache = currentActionCallCache
    let previousActionAgentCalls = currentActionAgentCalls
    currentActionCallCache = actionCache
    currentActionAgentCalls = []
    let resolved = context.resolveDynamicValue(value)
    let agentCalls = currentActionAgentCalls ?? []
    currentActionCallCache = previousActionCallCache
    currentActionAgentCalls = previousActionAgentCalls

    if context.hasFailedFunctionCall {
      actionCache.stop()
      return .failed
    }
    let pendingCalls = agentCalls.filter { call in
      if case .pending = actionCache[call] { return true }
      return false
    }
    return pendingCalls.isEmpty ? .resolved(resolved) : .pending(pendingCalls)
  }

  /// Runs `resume` once every call in `calls` has been answered, unless one of them fails or the
  /// action stops first.
  private func resumeAction(
    after calls: Set<AgentFunctionCall>,
    in actionCache: AgentCallCache,
    _ resume: @escaping @MainActor () -> Void
  ) {
    Task { @MainActor in
      for call in calls {
        guard await actionCache.awaitSettlement(of: call), !actionCache.isStopped else { return }
      }
      resume()
    }
  }

  /// Runs an event action, waiting for any agent function calls in `context` or `userMessage` to
  /// settle before dispatching the event. When no agent calls are pending, the event is
  /// dispatched synchronously.
  ///
  /// The `context` entries are resolved one at a time, in the order the `context` object holds
  /// them, then `userMessage`. That is the payload's order unless the JSON decoder reordered the
  /// keys, as Foundation's `JSONDecoder` may. An entry that waits on the agent is awaited before
  /// the next entry is resolved, so no later entry sends a call before it settles. The first entry
  /// that fails stops the action: no later entry is
  /// resolved, and the event isn't dispatched. Each run resolves the entries again, reading the
  /// answers already received from `actionCache`.
  ///
  /// A `userMessage` that resolves to null is absent. One that resolves to any other non-string,
  /// whether at once or after an agent call, stops the action with an `INVALID_ACTION` error, and
  /// the event isn't dispatched.
  private func runEventAction(
    name: String,
    contextEntries: OrderedDictionary<String, JSONValue>?,
    userMessageValue: JSONValue?,
    metadata: [String: JSONValue]?,
    basePath: String?,
    index: Int?,
    componentID: String,
    isUserActivated: Bool = true,
    actionCache: AgentCallCache = AgentCallCache()
  ) {
    guard !isDisposed, !actionCache.isStopped else { return }
    let context = DataContext(
      dataModel: dataModel,
      path: basePath ?? "",
      functionHandler: self,
      protocolVersion: effectiveProtocolVersion,
      index: index,
      isUserActivated: isUserActivated
    )
    let resume: @MainActor () -> Void = { [weak self] in
      self?.runEventAction(
        name: name,
        contextEntries: contextEntries,
        userMessageValue: userMessageValue,
        metadata: metadata,
        basePath: basePath,
        index: index,
        componentID: componentID,
        isUserActivated: isUserActivated,
        actionCache: actionCache
      )
    }
    var resolvedContext: [String: JSONValue] = [:]
    for (key, value) in contextEntries ?? [:] {
      if let reason = invalidDynamicValueReason(value) {
        actionCache.stop()
        reportInvalidEventValue("Action event context entry '\(key)' is invalid: \(reason)")
        return
      }
      switch resolveActionValue(value, in: context, actionCache: actionCache) {
      case .resolved(let resolved):
        resolvedContext[key] = resolved
      case .pending(let calls):
        resumeAction(after: calls, in: actionCache, resume)
        return
      case .failed:
        return
      }
    }
    var resolvedUserMessage: String?
    if let userMessageValue {
      if let reason = invalidDynamicValueReason(userMessageValue) {
        actionCache.stop()
        reportInvalidEventValue("Action event userMessage is invalid: \(reason)")
        return
      }
      switch resolveActionValue(userMessageValue, in: context, actionCache: actionCache) {
      case .resolved(.null):
        // A `userMessage` that resolves to null, such as a missing path, is absent.
        resolvedUserMessage = nil
      case .resolved(let resolved):
        guard let message = resolved.stringValue else {
          reportInvalidUserMessage()
          return
        }
        resolvedUserMessage = message
      case .pending(let calls):
        resumeAction(after: calls, in: actionCache, resume)
        return
      case .failed:
        return
      }
    }
    let triggerAction = ResolvedAction(
      identity: .event(
        name: name,
        context: resolvedContext,
        userMessage: resolvedUserMessage
      ),
      sourceComponentID: componentID,
      metadata: metadata,
      trigger: {}
    )
    actionHandler?.handle(action: triggerAction, from: surfaceID)
  }

  /// Returns why `value` isn't a well-formed dynamic value, or `nil` if it is.
  ///
  /// From v1.0, an object key that starts with `@` must be `@path` or `@call` (`@@` escapes a
  /// literal `@`). A data binding's path and a function call's name must be strings, and a
  /// function call's `args` must be an object. Nested values are checked too.
  private func invalidDynamicValueReason(_ value: JSONValue) -> String? {
    let pathKey = atLeastV10 ? "@path" : "path"
    let callKey = atLeastV10 ? "@call" : "call"
    switch value {
    case .array(let elements):
      return elements.lazy.compactMap { self.invalidDynamicValueReason($0) }.first
    case .object(let members):
      if atLeastV10,
        let unknownKey = members.keys.first(where: {
          $0.hasPrefix("@") && !$0.hasPrefix("@@") && $0 != "@path" && $0 != "@call"
        })
      {
        return "'\(unknownKey)' is not a known expression key."
      }
      if let path = members[pathKey], path.stringValue == nil,
        atLeastV10 || members["componentId"] == nil
      {
        return "'\(pathKey)' must be a string."
      }
      if let call = members[callKey] {
        guard let name = call.stringValue else {
          return "'\(callKey)' must be a string."
        }
        if let args = members["args"], args.objectValue == nil {
          return "the 'args' of '\(name)' must be an object."
        }
      }
      return members.values.lazy.compactMap { self.invalidDynamicValueReason($0) }.first
    default:
      return nil
    }
  }

  /// Reports a malformed `context` entry or `userMessage` of an event action.
  private func reportInvalidEventValue(_ message: String) {
    actionHandler?.handle(
      error: .generic(
        GenericError(
          code: "EXPRESSION_ERROR",
          surfaceID: surfaceID,
          message: message,
          version: effectiveProtocolVersion ?? .v10
        )
      ),
      from: surfaceID
    )
  }

  /// Reports an event action whose `userMessage` didn't resolve to a string.
  private func reportInvalidUserMessage() {
    actionHandler?.handle(
      error: .generic(
        GenericError(
          code: "INVALID_ACTION",
          surfaceID: surfaceID,
          message: "Action event 'userMessage' must resolve to a string.",
          version: effectiveProtocolVersion ?? .v10
        )
      ),
      from: surfaceID
    )
  }

  /// Runs the function call of an action, in response to a user gesture.
  ///
  /// Each action invocation uses its own `actionCache`, so action calls never read from or write
  /// to the surface-wide reactive ``AgentCallCache`` or share in-flight calls across clicks. A
  /// function call whose arguments include calls routed to the agent runs once those calls have
  /// settled in `actionCache`. The run stops at the first call that fails, after reporting its
  /// error once; the failures of sibling calls that settle later are not reported.
  private func runActionFunctionCall(
    _ functionCall: JSONValue,
    basePath: String?,
    index: Int?,
    isUserActivated: Bool = true,
    actionCache: AgentCallCache = AgentCallCache()
  ) {
    guard !isDisposed, !actionCache.isStopped else { return }
    let context = DataContext(
      dataModel: dataModel,
      path: basePath ?? "",
      functionHandler: self,
      protocolVersion: effectiveProtocolVersion,
      index: index,
      isUserActivated: isUserActivated
    )
    // Run again only once the agent calls in the arguments settle. A call sent to the agent
    // itself, rather than deferred, needs no second run.
    let resolution = resolveActionValue(functionCall, in: context, actionCache: actionCache)
    guard case .pending(let calls) = resolution, context.hasDeferredFunctionCall else { return }
    resumeAction(after: calls, in: actionCache) { [weak self] in
      self?.runActionFunctionCall(
        functionCall,
        basePath: basePath,
        index: index,
        isUserActivated: isUserActivated,
        actionCache: actionCache
      )
    }
  }

  // MARK: - Child List Resolution

  private func resolveChildList(
    _ value: JSONValue,
    basePath: String?,
    index: Int? = nil,
    instanceSuffix: String? = nil,
    componentID: String,
    slotLocation: SlotLocation,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    recurseIntoChildren: Bool = true
  ) -> [Node]? {
    switch value {
    case .array(let arr):
      return resolveStaticChildList(
        arr,
        slotLocation: slotLocation,
        basePath: basePath,
        index: index,
        instanceSuffix: instanceSuffix,
        visited: visited,
        components: components,
        data: data,
        recurseIntoChildren: recurseIntoChildren
      )
    case .object(let dict):
      return resolveTemplateChildList(
        dict,
        slotLocation: slotLocation,
        basePath: basePath,
        instanceSuffix: instanceSuffix,
        visited: visited,
        components: components,
        data: data,
        recurseIntoChildren: recurseIntoChildren
      )
    default:
      return nil
    }
  }

  private func resolveStaticChildList(
    _ arr: [JSONValue],
    slotLocation: SlotLocation,
    basePath: String?,
    index: Int?,
    instanceSuffix: String?,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    recurseIntoChildren: Bool = true
  ) -> [Node] {
    let effectiveSuffix = instanceSuffix ?? index.map { "\($0)" }
    var resolvedNodes: [Node] = []
    for item in arr {
      guard let childID = item.stringValue else { continue }
      let childInstanceID = effectiveSuffix.map { "\(childID)_\($0)" } ?? childID
      let slot = slotLocation.makeListSlot(index: resolvedNodes.count)
      if let childNode = resolveChildReference(
        definitionID: childID,
        instanceID: childInstanceID,
        slot: slot,
        basePath: basePath,
        index: index,
        instanceSuffix: effectiveSuffix,
        visited: visited,
        components: components,
        data: data,
        recurseIntoChildren: recurseIntoChildren
      ) {
        resolvedNodes.append(childNode)
      }
    }
    return resolvedNodes
  }

  private func resolveTemplateChildList(
    _ dict: OrderedDictionary<String, JSONValue>,
    slotLocation: SlotLocation,
    basePath: String?,
    instanceSuffix: String?,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    recurseIntoChildren: Bool = true
  ) -> [Node]? {
    guard
      let templateID = dict["componentId"]?.stringValue ?? dict["template"]?.stringValue,
      let pathStr = dict["path"]?.stringValue ?? dict["data"]?.stringValue
    else {
      return nil
    }
    let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
    let normalizedTemplatePath = normalizePath(absPath)
    guard let dataItems = data[normalizedTemplatePath]?.arrayValue else {
      currentNodeTemplateCounts?[normalizedTemplatePath] = 0
      return []
    }
    currentNodeTemplateCounts?[normalizedTemplatePath] = dataItems.count
    var expandedNodes: [Node] = []
    for itemIndex in dataItems.indices {
      let itemSuffix = instanceSuffix.map { "\($0)_\(itemIndex)" } ?? "\(itemIndex)"
      let itemID = "\(templateID)_\(itemSuffix)"
      let itemBasePath = "\(normalizedTemplatePath)/\(itemIndex)"
      let slot = slotLocation.makeListSlot(index: expandedNodes.count)
      if let itemNode = resolveChildReference(
        definitionID: templateID,
        instanceID: itemID,
        slot: slot,
        basePath: itemBasePath,
        index: itemIndex,
        instanceSuffix: itemSuffix,
        visited: visited,
        components: components,
        data: data,
        recurseIntoChildren: recurseIntoChildren
      ) {
        expandedNodes.append(itemNode)
      }
    }
    return expandedNodes
  }
}

// MARK: - FunctionHandler Conformance

extension NodeResolver: FunctionHandler {
  public func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    if name == "@index" {
      return catalogID == nil ? IndexFunction() : nil
    }
    let callCatalogID = atLeastV10 ? (catalogID ?? defaultCatalogID) : defaultCatalogID
    return getCatalog(id: callCatalogID)?.functions[name]
  }

  /// Checks that the catalog a v1.0 function call runs in resolves on this surface: the
  /// catalog the call names, else the default catalog.
  ///
  /// - Throws: `A2UICatalogError` with the detail code `CATALOG_ERROR` if the named catalog is
  ///   not available, or the call names none and there is no default catalog.
  public func validateFunctionCatalog(id catalogID: String?, functionName: String) throws {
    let path = CatalogResolutionErrors.callCatalogIDPath(functionName: functionName)
    let code = CatalogResolutionErrors.runtimeCatalogErrorCode
    if let catalogID {
      guard catalogs[catalogID] != nil else {
        throw CatalogResolutionErrors.catalogNotFound(catalogID, path: path, code: code)
      }
      return
    }
    guard let defaultCatalogID else {
      throw CatalogResolutionErrors.noDefaultCatalog(
        subject: "Function call '\(functionName)'",
        surfaceID: surfaceID,
        path: path,
        code: code
      )
    }
    guard catalogs[defaultCatalogID] != nil else {
      throw CatalogResolutionErrors.catalogNotFound(defaultCatalogID, path: path, code: code)
    }
  }

  /// Returns the catalog a v1.0 call is sent to the agent with: the catalog it names, else the
  /// default catalog. Returns `nil` before v1.0, or when the surface has no
  /// ``SurfaceViewModel/agentFunctionCaller``.
  public func agentFunctionCatalogID(forCallCatalogID catalogID: String?) -> String? {
    guard atLeastV10, agentCallHost?.agentFunctionCaller != nil else { return nil }
    return catalogID ?? defaultCatalogID
  }

  /// Sends a call to the agent through the surface, returning its result if available.
  ///
  /// While a node is being resolved, the call is recorded as a dependency of that node, and the
  /// node is resolved again when the agent answers it (see ``agentFunctionResultPublisher``).
  /// For reactive bindings and checks, the surface keeps the result so an identical call made
  /// again reads it instead of being sent again. For imperative actions, each action invocation
  /// uses its own ``currentActionCallCache`` and always sends a fresh call.
  ///
  /// An agent error or timeout is reported as an `EXPRESSION_ERROR`, and the value is `null`.
  ///
  /// - Returns: The agent's result if already received, else `nil`.
  public func agentFunctionValue(for call: AgentFunctionCall) -> JSONValue? {
    guard !isDisposed else { return nil }
    let hadCallInCurrentPass = currentNodeAgentCalls?.contains(call) == true
    currentNodeAgentCalls?.insert(call)
    currentActionAgentCalls?.insert(call)
    currentCheckAgentCalls?.insert(call)
    guard let agentCallHost else {
      handleFunctionError(FunctionError.noListener(name: call.name), functionName: call.name)
      return nil
    }
    if let actionCache = currentActionCallCache {
      return agentCallHost.actionAgentFunctionValue(for: call, in: actionCache)
    }
    if let nodeKey = currentComponentID,
      !hadCallInCurrentPass,
      !(nodesByAgentCall[call]?.contains(nodeKey) ?? false)
    {
      agentCallHost.agentCallCache.forgetFailure(call)
    }
    return agentCallHost.agentFunctionValue(
      for: call,
      isRequestedByNode: currentNodeAgentCalls != nil
    )
  }

  /// Makes the next ``resolveTree()`` resolve every node again, discarding cached resolutions.
  func setNeedsFullResolve() {
    needsFullResolve = true
  }

  /// Whether a resolved node makes `call`.
  func hasNodes(makingAgentCall call: AgentFunctionCall) -> Bool {
    nodesByAgentCall[call] != nil
  }

  /// Marks the nodes making `call` for resolution once it has settled, and publishes on
  /// ``agentFunctionResultPublisher`` if there are any.
  ///
  /// A failed call is resolved again too, so that a check waiting on it becomes invalid.
  private func markAgentCallSettled(_ call: AgentFunctionCall) {
    guard nodesByAgentCall[call] != nil else { return }
    dirtyAgentCalls.insert(call)
    agentCallSettledSubject.send()
  }

  /// Reports a failed function call: unresolvable catalogs map through `MessageErrorMapper`
  /// (`CATALOG_ERROR`), while missing functions and errors thrown by `evaluate` are reported as
  /// `EXPRESSION_ERROR`, matching the other core SDKs. A local function that throws while an
  /// action runs is reported as `EXECUTION_ERROR`. A call cancelled with the RPC code
  /// `CANCELLED`, such as when its surface is deleted, reports nothing.
  public func handleFunctionError(_ error: any Error, functionName: String) {
    guard !isDisposed else { return }
    var error = error
    var code = "EXPRESSION_ERROR"
    if let executionError = error as? ActionExecutionError {
      error = executionError.underlying
      code = "EXECUTION_ERROR"
    }
    if error is URLBlockedError {
      code = URLBlockedError.code
    }
    if let functionError = error as? FunctionError, functionError.rpcCode == "CANCELLED" {
      return
    }
    let version = effectiveProtocolVersion ?? .v09
    let rendererError: RendererError
    if let catalogError = error as? A2UICatalogError {
      rendererError = MessageErrorMapper().map(
        catalogError,
        surfaceID: surfaceID,
        version: version
      )
    } else {
      let message: String
      if let a2uiError = error as? any A2UIError {
        message = a2uiError.message
      } else if let description = (error as? any LocalizedError)?.errorDescription {
        message = description
      } else {
        message = String(describing: error)
      }
      if let functionCallID = (error as? FunctionError)?.functionCallID {
        rendererError = .generic(
          GenericError(
            code: code,
            functionCallID: functionCallID,
            message: message,
            expression: functionName,
            version: version
          )
        )
      } else {
        rendererError = .generic(
          GenericError(
            code: code,
            surfaceID: surfaceID,
            message: message,
            expression: functionName,
            version: version
          )
        )
      }
    }
    report(
      rendererError,
      dedupeKey: "\(currentPropertyPath ?? ""):\(functionName):\(rendererError)"
    )
  }
}

// MARK: - Error Reporting

extension NodeResolver {
  /// Replaces the errors recorded for each node resolved in the pass with the ones it reported in
  /// the pass, so an error is reported again only after its node resolves without it.
  private func commitExpressionErrorsOfCurrentPass() {
    if !reportedExpressionErrors.isEmpty {
      reportedExpressionErrors = reportedExpressionErrors.filter {
        !resolvedInCurrentPass.contains($0.nodeKey)
      }
    }
    if !expressionErrorsInCurrentPass.isEmpty {
      for nodeKey in resolvedInCurrentPass {
        if let keys = expressionErrorsInCurrentPass[nodeKey] {
          reportedExpressionErrors.formUnion(keys)
        }
      }
      expressionErrorsInCurrentPass.removeAll()
    }
  }

  /// Reports a `GenericError` for a problem in the component tree.
  private func reportResolutionError(
    code: String,
    message: String,
    dedupeKey: String,
    sharedAcrossNodes: Bool = false
  ) {
    let error = GenericError(
      code: code,
      surfaceID: surfaceID,
      message: message,
      version: effectiveProtocolVersion ?? .v09
    )
    report(.generic(error), dedupeKey: dedupeKey, sharedAcrossNodes: sharedAcrossNodes)
  }

  /// Reports an error to the action handler.
  ///
  /// While resolving the tree, an error is keyed to the node being resolved and reported once
  /// until that node resolves without it, so re-renders don't repeat it.
  ///
  /// - Parameter sharedAcrossNodes: Whether nodes reporting the same `dedupeKey` share one
  ///   report. Each node still records the key, so the error is reported again only once no node
  ///   reports it.
  private func report(_ error: RendererError, dedupeKey: String, sharedAcrossNodes: Bool = false) {
    if isResolvingTree {
      let nodeKey = currentComponentID ?? ""
      let key = ExpressionErrorKey(nodeKey: nodeKey, dedupeKey: dedupeKey)
      let isFirstInPass = expressionErrorsInCurrentPass[nodeKey, default: []].insert(key).inserted
      guard isFirstInPass, !reportedExpressionErrors.contains(key) else {
        return
      }
      if sharedAcrossNodes {
        guard sharedErrorsInCurrentPass.insert(dedupeKey).inserted,
          !reportedExpressionErrors.contains(where: { $0.dedupeKey == dedupeKey })
        else {
          return
        }
      }
    }
    actionHandler?.handle(error: error, from: surfaceID)
  }
}

// MARK: - URL Security

extension NodeResolver {
  /// Checks a URL against ``urlSecurityPolicy``: the baseline, the policy, and the baseline again
  /// on a rewritten URL.
  ///
  /// A blocked URL is published once on ``urlBlockedPublisher`` as a ``URLBlockedWarning``,
  /// which carries a redacted form of the URL and never the full URL.
  ///
  /// - Parameters:
  ///   - url: The URL to check.
  ///   - context: How the URL is used.
  ///   - info: Where the URL comes from. The surface identifier is filled in.
  /// - Returns: The URL to use, possibly rewritten, or `nil` when it is blocked.
  public func sanitizeURL(_ url: String, context: URLContext, info: URLCheckInfo?) -> String? {
    var fullInfo = info ?? URLCheckInfo()
    fullInfo.surfaceID = surfaceID
    let result = URLPolicyEvaluator.apply(
      urlSecurityPolicy, to: url, context: context, info: fullInfo)
    if result == nil {
      reportBlockedURL(url, context: context, info: fullInfo)
    }
    return result
  }

  /// Returns the URL context of a component property: the host's
  /// ``URLSecurityPolicy/urlProperties`` entry, else the schema's `x-a2ui-url-context`
  /// annotation, else the basic catalog's built-in list. Returns `nil` for a property that is
  /// not a URL or is marked `none`.
  private func urlContext(
    ofProperty property: String,
    schema: JSONValue,
    componentType: String,
    catalogID: String?
  ) -> URLContext? {
    if let catalogID,
      let hostAnnotation = urlSecurityPolicy.urlProperties?[catalogID]?[componentType]?[property]
    {
      return hostAnnotation.urlContext
    }
    let annotation =
      URLSchema.annotation(of: schema)
      ?? BasicCatalogURLProperties.annotation(
        catalogID: catalogID, componentType: componentType, property: property)
    return annotation?.urlContext
  }

  /// Passes a resolved value of a URL property through ``sanitizeURL(_:context:info:)``.
  ///
  /// A string value becomes the URL the policy returns. A blocked value, or a value that is not
  /// a string, becomes `JSONValue.null`, so the component sees no URL and makes no request. The
  /// component doesn't check the result again, which keeps a rewritten URL (such as a proxy
  /// URL) from being checked against the allowlist a second time.
  private func filterURL(
    _ resolved: (any Resolved)?,
    context: URLContext,
    propertyPath: String
  ) -> (any Resolved)? {
    guard let resolved else { return nil }
    var info = currentURLCheckInfo ?? URLCheckInfo(surfaceID: surfaceID)
    info.propertyName = Self.urlPropertyName(fromPath: propertyPath)
    let sanitize = { (url: String) in self.sanitizeURL(url, context: context, info: info) }
    switch resolved {
    case let binding as DataBinding<String>:
      guard let value = binding.value else { return binding }
      guard let allowed = sanitize(value) else { return JSONValue.null }
      guard allowed != value else { return binding }
      return DataBinding<String>(identity: binding.identity, value: allowed) { binding.set($0) }
    case let string as String:
      guard let allowed = sanitize(string) else { return JSONValue.null }
      return allowed
    case let binding as DataBinding<JSONValue>:
      guard let value = binding.value, value != .null else { return binding }
      guard let string = value.stringValue, let allowed = sanitize(string) else {
        return JSONValue.null
      }
      guard allowed != string else { return binding }
      return DataBinding<JSONValue>(identity: binding.identity, value: .string(allowed)) {
        binding.set($0)
      }
    case let json as JSONValue:
      guard json != .null else { return json }
      guard let string = json.stringValue, let allowed = sanitize(string) else {
        return JSONValue.null
      }
      return JSONValue.string(allowed)
    default:
      return JSONValue.null
    }
  }

  /// Writes a resolver property path as ``URLCheckInfo/propertyName`` does: dotted, with `[]`
  /// for list items, such as `items[].imageUrl` for `items/0/imageUrl`.
  private static func urlPropertyName(fromPath path: String) -> String {
    var name = ""
    for segment in path.split(separator: "/", omittingEmptySubsequences: false) {
      if !segment.isEmpty, segment.allSatisfy({ $0.isASCII && $0.isNumber }) {
        name += "[]"
      } else {
        name += name.isEmpty ? String(segment) : ".\(segment)"
      }
    }
    return name
  }

  /// Publishes a warning for a blocked URL, unless the same URL in the same place was reported
  /// already.
  private func reportBlockedURL(_ url: String, context: URLContext, info: URLCheckInfo) {
    guard !isDisposed else { return }
    let key = BlockedURLKey(
      url: url,
      context: context,
      componentID: info.componentID,
      propertyName: info.propertyName,
      functionName: info.functionName
    )
    guard reportedBlockedURLs.insert(key).inserted else { return }
    reportedBlockedURLOrder.append(key)
    if reportedBlockedURLOrder.count > Self.maxReportedBlockedURLs {
      reportedBlockedURLs.remove(reportedBlockedURLOrder.removeFirst())
    }
    let source: String
    if let propertyName = info.propertyName {
      source = "property '\(propertyName)'" + (info.componentID.map { " of '\($0)'" } ?? "")
    } else if let functionName = info.functionName {
      source = "function '\(functionName)'"
    } else {
      source = "a component"
    }
    // The full URL may carry the data being exfiltrated in its path or query, so only a
    // redacted form leaves the resolver.
    let redactedURL = URLBaseline.redact(url)
    urlBlockedSubject.send(
      URLBlockedWarning(
        surfaceID: surfaceID,
        context: context,
        redactedURL: redactedURL,
        info: info,
        message: "The URL security policy blocked a \(context.rawValue) URL (\(redactedURL)) "
          + "in \(source)."
      )
    )
  }
}
