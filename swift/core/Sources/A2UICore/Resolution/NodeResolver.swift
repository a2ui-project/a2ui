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

  private struct CachedComponentSchema {
    let propertiesSchema: [String: JSONValue]
    let classifiedTypes: [String: PropertyType]
  }

  private struct ComponentIdentity: Equatable {
    let type: String
    let catalogID: String?
  }

  private struct NodeResolutionRecord {
    let nodeKey: String
    let definitionID: String
    let instanceID: String
    let basePath: String?
    let index: Int?
    let instanceSuffix: String?
    let visited: Set<String>
    var componentSnapshot: ComponentModel
    var childIdentities: [String: ComponentIdentity?]
    var readValues: [String: JSONValue?]
    var templateCounts: [String: Int]
    var directChildInstances: Set<String>
  }

  /// The number of `resolveNode` invocations executed during the most recent `resolveTree()` pass.
  package private(set) var lastResolvedNodeCount = 0

  private var activeNodes: [String: Node] = [:]
  private var schemaCache: [String: CachedComponentSchema] = [:]
  private var nodeRecords: [String: NodeResolutionRecord] = [:]
  private var nodesByDefinitionID: [String: Set<String>] = [:]
  private var parentsByChildDefinitionID: [String: Set<String>] = [:]
  private var parentsByChildInstanceID: [String: Set<String>] = [:]
  private var nodesByReadPath: [String: Set<String>] = [:]
  private var readPathsByAncestorPath: [String: Set<String>] = [:]
  private var nodesByTemplatePath: [String: Set<String>] = [:]
  private var dirtyComponentIDs: Set<String> = []
  private var dirtyDataPaths: Set<String> = []
  private var needsFullResolve = false
  private var resolvedInCurrentPass: Set<String> = []
  private var currentNodeReadValues: [String: JSONValue?]?
  private var currentNodeTemplateCounts: [String: Int]?
  private var currentNodeChildIdentities: [String: ComponentIdentity?]?
  private var currentNodeDirectChildren: Set<String>?
  private var reportedExpressionErrors: Set<String> = []
  private var currentPassExpressionErrors: Set<String> = []
  private var isResolvingTree = false
  private var currentComponentID: String?
  private var currentPropertyPath: String?
  private var modelCancellables = Set<AnyCancellable>()

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
    protocolVersion: A2UIProtocolVersion? = nil
  ) {
    self.surfaceID = surfaceID
    self.catalogs = catalogs
    let allCatalogsAtLeastV10 =
      !catalogs.isEmpty && catalogs.values.allSatisfy(\.isAtLeastV10)
    let isAtLeastV10 = protocolVersion?.isAtLeastV10 ?? allCatalogsAtLeastV10
    if let defaultCatalogID {
      self.defaultCatalogID = defaultCatalogID
    } else if !isAtLeastV10, catalogs.count == 1 {
      self.defaultCatalogID = catalogs.keys.first
    } else {
      self.defaultCatalogID = nil
    }
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
      protocolVersion: protocolVersion ?? surface.nodeResolver.protocolVersion
    )
  }

  public convenience init(
    surfaceID: String,
    catalogs: [any CatalogProtocol],
    defaultCatalogID: String? = nil,
    componentsModel: SurfaceComponentsModel? = nil,
    dataModel: DataModel? = nil,
    actionHandler: (any ActionHandling)? = nil,
    protocolVersion: A2UIProtocolVersion? = nil
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
      protocolVersion: protocolVersion
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
      resolvedInCurrentPass.removeAll()
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
    nodeRecords.removeAll()
    nodesByDefinitionID.removeAll()
    parentsByChildDefinitionID.removeAll()
    parentsByChildInstanceID.removeAll()
    nodesByReadPath.removeAll()
    readPathsByAncestorPath.removeAll()
    nodesByTemplatePath.removeAll()
    dirtyComponentIDs.removeAll()
    dirtyDataPaths.removeAll()
    needsFullResolve = false
    resolvedInCurrentPass.removeAll()
    reportedExpressionErrors.removeAll()
    currentPassExpressionErrors.removeAll()
  }

  private func resolveIncrementalChanges(
    components: [String: ComponentModel],
    currentData: JSONValue
  ) -> Node? {
    let changedCompIDs = dirtyComponentIDs
    let changedDataPaths = dirtyDataPaths
    dirtyComponentIDs.removeAll()
    dirtyDataPaths.removeAll()

    guard !changedCompIDs.isEmpty || !changedDataPaths.isEmpty else {
      return activeNodes["root"]
    }

    var affectedNodeIDs: Set<String> = []

    for compID in changedCompIDs {
      let currentComp = components[compID]
      let currentIdentity = componentIdentity(for: compID, in: components)

      let directPrefix = "\(compID):"
      let instancePrefixes = (nodesByDefinitionID[compID] ?? []).map { "\($0):" }
      let previousErrorCount = reportedExpressionErrors.count
      reportedExpressionErrors = reportedExpressionErrors.filter { key in
        guard !key.hasPrefix(directPrefix) else { return false }
        return !instancePrefixes.contains { key.hasPrefix($0) }
      }
      let hadClearedErrors = reportedExpressionErrors.count != previousErrorCount

      if let instances = nodesByDefinitionID[compID] {
        for nodeKey in instances {
          guard let record = nodeRecords[nodeKey] else { continue }
          if record.componentSnapshot != currentComp || hadClearedErrors {
            let previousIdentity = ComponentIdentity(
              type: record.componentSnapshot.type,
              catalogID: record.componentSnapshot.catalogID ?? defaultCatalogID
            )
            if currentIdentity == previousIdentity || nodeKey == "root" {
              affectedNodeIDs.insert(nodeKey)
            }
          }
        }
      }

      if let parentInstances = parentsByChildDefinitionID[compID] {
        for parentNodeKey in parentInstances {
          guard let parentRecord = nodeRecords[parentNodeKey] else { continue }
          if let recordedIdentity = parentRecord.childIdentities[compID],
            recordedIdentity != currentIdentity
          {
            affectedNodeIDs.insert(parentNodeKey)
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

    let sortedAffected = affectedNodeIDs.sorted {
      (nodeRecords[$0]?.visited.count ?? 0) < (nodeRecords[$1]?.visited.count ?? 0)
    }

    isResolvingTree = true
    resolvedInCurrentPass.removeAll()
    defer {
      resolvedInCurrentPass.removeAll()
      isResolvingTree = false
    }

    for nodeKey in sortedAffected {
      guard !resolvedInCurrentPass.contains(nodeKey),
        let record = nodeRecords[nodeKey],
        activeNodes[nodeKey] != nil
      else {
        continue
      }
      _ = resolveNode(
        definitionID: record.definitionID,
        instanceID: record.instanceID,
        basePath: record.basePath,
        index: record.index,
        instanceSuffix: record.instanceSuffix,
        visited: record.visited,
        components: components,
        data: currentData,
        recurseIntoChildren: false
      )
    }

    return activeNodes["root"]
  }

  private func componentIdentity(
    for definitionID: String,
    in components: [String: ComponentModel]
  ) -> ComponentIdentity? {
    guard let comp = components[definitionID] else { return nil }
    return ComponentIdentity(
      type: comp.type,
      catalogID: comp.catalogID ?? defaultCatalogID
    )
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
    var removedChildren: Set<String> = []

    if let oldRecord = nodeRecords[nodeKey] {
      if oldRecord.definitionID != record.definitionID {
        nodesByDefinitionID[oldRecord.definitionID]?.remove(nodeKey)
      }
      for oldChildDefID in oldRecord.childIdentities.keys
      where !record.childIdentities.keys.contains(oldChildDefID) {
        parentsByChildDefinitionID[oldChildDefID]?.remove(nodeKey)
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

      removedChildren = oldRecord.directChildInstances.subtracting(record.directChildInstances)
      let addedChildren = record.directChildInstances.subtracting(oldRecord.directChildInstances)
      for addedChild in addedChildren {
        parentsByChildInstanceID[addedChild, default: []].insert(nodeKey)
      }
    } else {
      for child in record.directChildInstances {
        parentsByChildInstanceID[child, default: []].insert(nodeKey)
      }
    }

    nodeRecords[nodeKey] = record
    nodesByDefinitionID[record.definitionID, default: []].insert(nodeKey)
    for childDefID in record.childIdentities.keys {
      parentsByChildDefinitionID[childDefID, default: []].insert(nodeKey)
    }
    for readPath in record.readValues.keys {
      nodesByReadPath[readPath, default: []].insert(nodeKey)
      for ancestor in ancestorPaths(of: readPath) {
        readPathsByAncestorPath[ancestor, default: []].insert(readPath)
      }
    }
    for templatePath in record.templateCounts.keys {
      nodesByTemplatePath[templatePath, default: []].insert(nodeKey)
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
    let prefix = "\(nodeKey):"
    reportedExpressionErrors = reportedExpressionErrors.filter { !$0.hasPrefix(prefix) }
    guard let record = nodeRecords.removeValue(forKey: nodeKey) else { return }

    nodesByDefinitionID[record.definitionID]?.remove(nodeKey)
    for childDefID in record.childIdentities.keys {
      parentsByChildDefinitionID[childDefID]?.remove(nodeKey)
    }
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

    for childNodeKey in record.directChildInstances {
      parentsByChildInstanceID[childNodeKey]?.remove(nodeKey)
      if parentsByChildInstanceID[childNodeKey]?.isEmpty ?? true {
        parentsByChildInstanceID.removeValue(forKey: childNodeKey)
        pruneSubtree(childNodeKey, protectedNodeKeys: protectedNodeKeys)
      }
    }
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
    if visited.contains(nodeKey) {
      return nil
    }

    guard let component = components[definitionID] else {
      return nil
    }

    lastResolvedNodeCount += 1
    resolvedInCurrentPass.insert(nodeKey)

    let ancestorVisited = visited
    let previousComponentID = currentComponentID
    let previousPropertyPath = currentPropertyPath
    let previousReadValues = currentNodeReadValues
    let previousTemplateCounts = currentNodeTemplateCounts
    let previousChildIdentities = currentNodeChildIdentities
    let previousDirectChildren = currentNodeDirectChildren
    let previousPassErrors = currentPassExpressionErrors
    currentComponentID = nodeKey
    currentNodeReadValues = [:]
    currentNodeTemplateCounts = [:]
    currentNodeChildIdentities = [:]
    currentNodeDirectChildren = []
    currentPassExpressionErrors = []
    defer {
      if isResolvingTree {
        let prefix = "\(nodeKey):"
        reportedExpressionErrors = reportedExpressionErrors.filter { !$0.hasPrefix(prefix) }
        reportedExpressionErrors.formUnion(currentPassExpressionErrors)
      }
      currentComponentID = previousComponentID
      currentPropertyPath = previousPropertyPath
      currentNodeReadValues = previousReadValues
      currentNodeTemplateCounts = previousTemplateCounts
      currentNodeChildIdentities = previousChildIdentities
      currentNodeDirectChildren = previousDirectChildren
      currentPassExpressionErrors = previousPassErrors
    }

    let type = component.type
    let effectiveCatalogID = component.catalogID ?? defaultCatalogID
    let targetCatalog = getCatalog(id: effectiveCatalogID)

    var visited = visited
    visited.insert(nodeKey)

    let cached = cachedSchema(for: type, catalogID: effectiveCatalogID, catalog: targetCatalog)
    let propertiesSchema = cached.propertiesSchema

    var componentChecks: [ResolvedCheck] = []
    var preResolvedChecksByKey: [String: [ResolvedCheck]] = [:]
    for (key, val) in component.properties where cached.classifiedTypes[key] == .checks {
      currentPropertyPath = key
      let resolved = resolveChecks(val, basePath: basePath, index: index, data: data)
      preResolvedChecksByKey[key] = resolved
      componentChecks.append(contentsOf: resolved)
    }

    var resolvedProperties: [String: any Resolved] = [:]
    for (key, val) in component.properties {
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
        componentID: instanceID,
        propertyKey: key,
        visited: visited,
        components: components,
        data: data,
        checks: componentChecks,
        recurseIntoChildren: recurseIntoChildren
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
      childIdentities: currentNodeChildIdentities ?? [:],
      readValues: currentNodeReadValues ?? [:],
      templateCounts: currentNodeTemplateCounts ?? [:],
      directChildInstances: currentNodeDirectChildren ?? []
    )
    registerNodeDependencies(record)

    if let existing = activeNodes[nodeKey],
      existing.type == type && existing.catalogID == effectiveCatalogID
    {
      let updated = existing.updatingProperties(resolvedProperties)
      activeNodes[nodeKey] = updated
      return updated
    }

    let node = Node(
      id: instanceID,
      type: type,
      catalogID: effectiveCatalogID,
      properties: resolvedProperties
    )
    activeNodes[nodeKey] = node
    return node
  }

  private func resolveChildReference(
    definitionID childID: String,
    instanceID childInstanceID: String,
    basePath: String?,
    index: Int?,
    instanceSuffix: String?,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    recurseIntoChildren: Bool
  ) -> Node? {
    let childIdentity = componentIdentity(for: childID, in: components)
    currentNodeChildIdentities?.updateValue(childIdentity, forKey: childID)

    let childNodeKey = makeNodeKey(instanceID: childInstanceID, basePath: basePath)
    guard !visited.contains(childNodeKey), let childIdentity else {
      return nil
    }

    let existingRecord = nodeRecords[childNodeKey]
    if !recurseIntoChildren,
      let existing = activeNodes[childNodeKey],
      let existingRecord,
      existingRecord.definitionID == childID,
      existingRecord.basePath == basePath,
      existingRecord.index == index,
      existingRecord.instanceSuffix == instanceSuffix,
      existingRecord.visited == visited,
      existing.type == childIdentity.type && existing.catalogID == childIdentity.catalogID
    {
      currentNodeDirectChildren?.insert(childNodeKey)
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
      currentNodeDirectChildren?.insert(childNodeKey)
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

  private func classifySchema(_ schemaJSON: JSONValue) -> PropertyType {
    if let ref = schemaJSON["$ref"]?.stringValue {
      let typeName = ref.split(separator: "/").last.map(String.init)
      switch typeName {
      case "DynamicBoolean": return .dynamicBoolean
      case "DynamicString": return .dynamicString
      case "DynamicNumber": return .dynamicNumber
      case "DynamicValue": return .dynamicValue
      case "DynamicStringList": return .dynamicStringList
      case "DataBinding": return .dynamicString
      case "CheckRule", "Checkable": return .checks
      case "Action": return .action
      case "ChildList": return .childList
      case "Child", "ComponentId": return .componentID
      default: break
      }
    }

    if let oneOf = schemaJSON["oneOf"]?.arrayValue {
      for sub in oneOf {
        let type = classifySchema(sub)
        if type != .standard { return type }
      }
    }

    if let anyOf = schemaJSON["anyOf"]?.arrayValue {
      for sub in anyOf {
        let type = classifySchema(sub)
        if type != .standard { return type }
      }
    }

    if let allOf = schemaJSON["allOf"]?.arrayValue {
      for sub in allOf {
        let type = classifySchema(sub)
        if type != .standard { return type }
      }
    }

    if let items = schemaJSON["items"] {
      let type = classifySchema(items)
      if type == .checks { return .checks }
    }

    if let type = schemaJSON["type"]?.stringValue {
      switch type {
      case "number": return .number
      case "integer": return .integer
      default: break
      }
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
    if let ref = schemaJSON["$ref"]?.stringValue {
      let typeName = ref.split(separator: "/").last.map(String.init) ?? ""
      let def =
        A2UICommonSchema.v10Document["$defs"]?.objectValue?[typeName]
        ?? A2UICommonSchema.document["$defs"]?.objectValue?[typeName]
      if let def {
        let defProps = extractPropertiesSchema(from: def)
        for (k, v) in defProps {
          result[k] = v
        }
      }
    }
    if let allOf = schemaJSON["allOf"]?.arrayValue {
      for subSchema in allOf {
        let subProps = extractPropertiesSchema(from: subSchema)
        for (k, v) in subProps {
          result[k] = v
        }
      }
    }
    if let oneOf = schemaJSON["oneOf"]?.arrayValue {
      for subSchema in oneOf {
        let subProps = extractPropertiesSchema(from: subSchema)
        for (k, v) in subProps {
          result[k] = v
        }
      }
    }
    if let anyOf = schemaJSON["anyOf"]?.arrayValue {
      for subSchema in anyOf {
        let subProps = extractPropertiesSchema(from: subSchema)
        for (k, v) in subProps {
          result[k] = v
        }
      }
    }
    return result
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
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    checks: [ResolvedCheck] = [],
    recurseIntoChildren: Bool = true
  ) -> (any Resolved)? {
    let previousPropertyPath = currentPropertyPath
    currentPropertyPath = propertyKey
    defer {
      currentPropertyPath = previousPropertyPath
    }
    switch type {
    case .dynamicBoolean:
      return resolveDynamicBoolean(value, basePath: basePath, index: index, data: data)
    case .dynamicString:
      return resolveDynamicString(value, basePath: basePath, index: index, data: data)
    case .dynamicNumber:
      return resolveDynamicNumber(value, basePath: basePath, index: index, data: data)
    case .dynamicValue:
      return resolveDynamicValueBinding(value, basePath: basePath, index: index, data: data)
    case .dynamicStringList:
      return resolveDynamicStringList(value, basePath: basePath, index: index, data: data)
    case .checks:
      return resolveChecks(value, basePath: basePath, index: index, data: data)
    case .action:
      return resolveAction(
        value,
        checks: checks,
        basePath: basePath,
        index: index,
        componentID: componentID,
        data: data
      )
    case .childList:
      return resolveChildList(
        value,
        basePath: basePath,
        index: index,
        instanceSuffix: instanceSuffix,
        componentID: componentID,
        propertyKey: propertyKey,
        visited: visited,
        components: components,
        data: data,
        recurseIntoChildren: recurseIntoChildren
      )
    case .componentID:
      guard let childID = value.stringValue else { return nil }
      let effectiveSuffix = instanceSuffix ?? index.map { "\($0)" }
      let childInstanceID = effectiveSuffix.map { "\(childID)_\($0)" } ?? childID
      return resolveChildReference(
        definitionID: childID,
        instanceID: childInstanceID,
        basePath: basePath,
        index: index,
        instanceSuffix: effectiveSuffix,
        visited: visited,
        components: components,
        data: data,
        recurseIntoChildren: recurseIntoChildren
      )
    case .number:
      return value.doubleValue
    case .integer:
      return value.intValue
    case .standard:
      if let array = value.arrayValue {
        let itemsSchema = schema["items"] ?? .boolean(true)
        let itemType = classifySchema(itemsSchema)
        if itemType == .checks {
          return resolveChecks(value, basePath: basePath, index: index, data: data)
        }
        let resolvedArray = array.enumerated().compactMap { itemIndex, item -> (any Resolved)? in
          if let resolved = resolveProperty(
            value: item,
            schema: itemsSchema,
            type: itemType,
            basePath: basePath,
            index: index,
            instanceSuffix: instanceSuffix,
            componentID: componentID,
            propertyKey: "\(propertyKey)/\(itemIndex)",
            visited: visited,
            components: components,
            data: data,
            checks: checks,
            recurseIntoChildren: recurseIntoChildren
          ) {
            return resolved
          }
          return item == .null ? item : nil
        }
        return ResolvedArray(resolvedArray)
      }

      if let obj = value.objectValue {
        let objProps = extractPropertiesSchema(from: schema)
        if !objProps.isEmpty {
          var resolvedObj: [String: any Resolved] = [:]
          for (k, v) in obj {
            let nestedPropSchema = objProps[k] ?? .boolean(true)
            let classified = classifySchema(nestedPropSchema)
            let nestedPropType: PropertyType
            let bindingKey = atLeastV10 ? "@path" : "path"
            if classified == .standard,
              v.objectValue?[bindingKey] != nil
            {
              nestedPropType = .dynamicValue
            } else {
              nestedPropType = classified
            }
            if let resVal = resolveProperty(
              value: v,
              schema: nestedPropSchema,
              type: nestedPropType,
              basePath: basePath,
              index: index,
              instanceSuffix: instanceSuffix,
              componentID: componentID,
              propertyKey: "\(propertyKey)/\(k)",
              visited: visited,
              components: components,
              data: data,
              checks: checks,
              recurseIntoChildren: recurseIntoChildren
            ) {
              resolvedObj[k] = resVal
            }
          }
          return ResolvedDictionary(resolvedObj)
        }
      }

      switch value {
      case .string(let str): return str
      case .boolean(let b): return b
      case .number(let n): return n
      case .integer(let i): return i
      case .null: return nil
      default: return value
      }
    }
  }

  // MARK: - Dynamic Value Evaluation

  private func evaluateDynamicValue(
    _ value: JSONValue,
    basePath: String?,
    index: Int? = nil
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
      index: index
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
      let resolvedValue = readData(absPath, from: data)?.boolValue
      return DataBinding<Bool>(
        identity: .path(absPath),
        value: resolvedValue,
        set: { [weak self] newValue in
          self?.dataModel.set(absPath, value: .boolean(newValue))
        }
      )
    }
    let resolvedValue = evaluateDynamicValue(value, basePath: basePath, index: index).boolValue
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
    let parseRule: (JSONValue) -> ResolvedCheck? = { [weak self] ruleJSON in
      guard let self else { return nil }
      let ruleDict = ruleJSON.dictionaryValue
      let conditionJSON = ruleDict?["condition"] ?? ruleJSON
      let fallbackMessage = ruleDict?["message"]?.stringValue ?? "Validation failed"

      let bindingKey = self.atLeastV10 ? "@path" : "path"
      if let dict = conditionJSON.dictionaryValue, let pathStr = dict[bindingKey]?.stringValue {
        let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
        let rawVal = self.readData(absPath, from: data)
        if let rawDict = rawVal?.objectValue, let valid = rawDict["valid"]?.boolValue {
          let code = rawDict["code"]?.stringValue
          let msg = rawDict["message"]?.stringValue ?? fallbackMessage
          let severity = rawDict["severity"]?.stringValue.flatMap {
            ValidationSeverity(rawValue: $0)
          }
          let result = ValidationResult(valid: valid, code: code, message: msg, severity: severity)
          return ResolvedCheck(
            condition: DataBinding(identity: .path(absPath), value: valid, set: { _ in }),
            message: msg,
            validationResult: result
          )
        } else {
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
      }

      let evaluated = self.evaluateDynamicValue(conditionJSON, basePath: basePath, index: index)
      if let evalDict = evaluated.objectValue, let valid = evalDict["valid"]?.boolValue {
        let code = evalDict["code"]?.stringValue
        let msg = evalDict["message"]?.stringValue ?? fallbackMessage
        let severity = evalDict["severity"]?.stringValue.flatMap {
          ValidationSeverity(rawValue: $0)
        }
        let result = ValidationResult(valid: valid, code: code, message: msg, severity: severity)
        return ResolvedCheck(
          condition: DataBinding(identity: .literal(conditionJSON), value: valid, set: { _ in }),
          message: msg,
          validationResult: result
        )
      } else if let b = evaluated.boolValue {
        let result = ValidationResult(
          valid: b,
          code: nil,
          message: fallbackMessage,
          severity: .error
        )
        return ResolvedCheck(
          condition: DataBinding(identity: .literal(conditionJSON), value: b, set: { _ in }),
          message: fallbackMessage,
          validationResult: result
        )
      } else {
        let result = ValidationResult(
          valid: false,
          code: nil,
          message: fallbackMessage,
          severity: .error
        )
        return ResolvedCheck(
          condition: DataBinding(identity: .literal(conditionJSON), value: false, set: { _ in }),
          message: fallbackMessage,
          validationResult: result
        )
      }
    }

    if let array = value.arrayValue {
      return array.compactMap(parseRule)
    } else if value.dictionaryValue != nil {
      return [parseRule(value)].compactMap { $0 }
    }
    return []
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

    let eventObj: [String: JSONValue]?
    if let wrapped = dict["event"]?.dictionaryValue {
      eventObj = wrapped
    } else if dict["name"]?.stringValue != nil {
      eventObj = dict
    } else {
      eventObj = nil
    }

    let callKey = atLeastV10 ? "@call" : "call"
    let funcCallVal: JSONValue?
    if let wrapped = value["functionCall"], wrapped.dictionaryValue != nil {
      funcCallVal = wrapped
    } else if dict[callKey]?.stringValue != nil {
      funcCallVal = value
    } else {
      funcCallVal = nil
    }

    if let eventObj, let name = eventObj["name"]?.stringValue {
      let contextDict = eventObj["context"]?.dictionaryValue
      let userMessageVal = eventObj["userMessage"]
      let unresolvedIdentity = ResolvedAction.Identity.event(
        name: name,
        context: contextDict,
        userMessage: userMessageVal?.stringValue
      )

      return ResolvedAction(
        identity: unresolvedIdentity,
        sourceComponentID: componentID,
        dataContextPath: basePath,
        rawUserMessage: userMessageVal,
        trigger: { [weak self] in
          guard let self else { return }

          let failedChecks = checks.filter { !$0.isValid }
          if !failedChecks.isEmpty {
            let errorMsg = failedChecks.map(\.message).joined(separator: ", ")
            let version = self.effectiveProtocolVersion ?? .v10
            self.actionHandler?.handle(
              error: .validationFailed(
                ValidationFailedError(
                  surfaceID: self.surfaceID,
                  path: componentID,
                  message: errorMsg,
                  version: version
                )
              ),
              from: self.surfaceID
            )
            return
          }

          var resolvedContext: [String: JSONValue] = [:]
          if let contextDict {
            for (key, val) in contextDict {
              resolvedContext[key] = self.evaluateDynamicValue(
                val, basePath: basePath, index: index)
            }
          }
          let resolvedUserMessage = userMessageVal.flatMap {
            self.evaluateDynamicValue($0, basePath: basePath, index: index).stringValue
          }

          let triggerAction = ResolvedAction(
            identity: .event(
              name: name, context: resolvedContext, userMessage: resolvedUserMessage),
            sourceComponentID: componentID,
            trigger: {}
          )

          self.actionHandler?.handle(action: triggerAction, from: self.surfaceID)
        }
      )
    } else if let funcCallVal, let funcCallDict = funcCallVal.dictionaryValue,
      let call = funcCallDict[callKey]?.stringValue
    {
      let argsDict = funcCallDict["args"]?.dictionaryValue
      let unresolvedIdentity = ResolvedAction.Identity.function(
        call: call,
        args: argsDict
      )

      return ResolvedAction(
        identity: unresolvedIdentity,
        sourceComponentID: componentID,
        dataContextPath: basePath,
        trigger: { [weak self] in
          guard let self else { return }

          let failedChecks = checks.filter { !$0.isValid }
          if !failedChecks.isEmpty {
            let errorMsg = failedChecks.map(\.message).joined(separator: ", ")
            let version = self.effectiveProtocolVersion ?? .v10
            self.actionHandler?.handle(
              error: .validationFailed(
                ValidationFailedError(
                  surfaceID: self.surfaceID,
                  path: componentID,
                  message: errorMsg,
                  version: version
                )
              ),
              from: self.surfaceID
            )
            return
          }

          _ = self.evaluateDynamicValue(funcCallVal, basePath: basePath, index: index)
        }
      )
    }

    return nil
  }

  // MARK: - Child List Resolution

  private func resolveChildList(
    _ value: JSONValue,
    basePath: String?,
    index: Int? = nil,
    instanceSuffix: String? = nil,
    componentID: String,
    propertyKey: String,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    recurseIntoChildren: Bool = true
  ) -> [Node]? {
    switch value {
    case .array(let arr):
      let effectiveSuffix = instanceSuffix ?? index.map { "\($0)" }
      var resolvedNodes: [Node] = []
      for item in arr {
        guard let childID = item.stringValue else { continue }
        let childInstanceID = effectiveSuffix.map { "\(childID)_\($0)" } ?? childID
        if let childNode = resolveChildReference(
          definitionID: childID,
          instanceID: childInstanceID,
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

    case .object(let dict):
      guard
        let templateID =
          (dict["componentId"]?.stringValue
            ?? dict["template"]?.stringValue),
        let pathStr = (dict["path"]?.stringValue ?? dict["data"]?.stringValue)
      else {
        return nil
      }

      let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
      let normalizedTemplatePath = normalizePath(absPath)
      currentNodeChildIdentities?.updateValue(
        componentIdentity(for: templateID, in: components),
        forKey: templateID
      )

      guard let dataListVal = data[normalizedTemplatePath],
        let dataItems = dataListVal.arrayValue
      else {
        currentNodeTemplateCounts?[normalizedTemplatePath] = 0
        return []
      }

      currentNodeTemplateCounts?[normalizedTemplatePath] = dataItems.count
      var expandedNodes: [Node] = []

      for (itemIndex, _) in dataItems.enumerated() {
        let itemSuffix =
          instanceSuffix.map { "\($0)_\(itemIndex)" } ?? "\(itemIndex)"
        let itemID = "\(templateID)_\(itemSuffix)"
        let itemBasePath = "\(normalizedTemplatePath)/\(itemIndex)"

        if let itemNode = resolveChildReference(
          definitionID: templateID,
          instanceID: itemID,
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

    default:
      return nil
    }
  }
}

// MARK: - FunctionHandler Conformance

extension NodeResolver: FunctionHandler {
  public func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    if name == "@index" {
      return catalogID == nil ? IndexFunction() : nil
    }
    let callCatalogID = catalogID ?? defaultCatalogID
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

  /// Reports a failed function call: unresolvable catalogs map through `MessageErrorMapper`
  /// (`CATALOG_ERROR`), while missing functions and errors thrown by `evaluate` are reported as
  /// `EXPRESSION_ERROR`, matching the other core SDKs.
  public func handleFunctionError(_ error: any Error, functionName: String) {
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
      rendererError = .generic(
        GenericError(
          code: "EXPRESSION_ERROR",
          surfaceID: surfaceID,
          message: message,
          expression: functionName,
          version: version
        )
      )
    }
    let dedupeKey =
      "\(currentComponentID ?? ""):\(currentPropertyPath ?? ""):\(functionName):\(rendererError)"
    if isResolvingTree {
      let isFirstInPass = currentPassExpressionErrors.insert(dedupeKey).inserted
      guard isFirstInPass && !reportedExpressionErrors.contains(dedupeKey) else {
        return
      }
    }
    actionHandler?.handle(error: rendererError, from: surfaceID)
  }
}
