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

import OrderedCollections
import OrderedJSON

/// Validates component graph topology, hierarchy completeness, and structural cycles.
public enum GraphTopologyValidator {
  static let maxGlobalDepth = 50

  public typealias Reference = (referenceID: String, field: String)
  public typealias AdjacencyMap = [String: [Reference]]

  /// Validates the topology, integrity, and composition constraints of a list of component
  /// JSON objects.
  ///
  /// - Parameters:
  ///   - components: The component JSON dictionaries to validate.
  ///   - rootID: The expected root component ID (default "root").
  ///   - config: The validation configuration controlling strictness.
  ///   - catalogs: Optional dictionary of registered catalogs to validate composition constraints.
  ///   - defaultCatalogID: Optional default catalog identifier.
  /// - Throws: `A2UIIntegrityError`, `A2UIRecursionError`, or `A2UIValidationError` on violations.
  public static func validate(
    components: [[String: JSONValue]],
    rootID: String = "root",
    config: ValidationConfig = .strict,
    catalogs: [String: AnyCatalog]? = nil,
    defaultCatalogID: String? = nil
  ) throws {
    let (allComponentIDs, adjacencyList) = try buildAdjacencyMap(
      from: components,
      config: config,
      catalogs: catalogs,
      defaultCatalogID: defaultCatalogID
    )

    try validateRootPresence(allIDs: allComponentIDs, rootID: rootID, config: config)
    try validateNoDanglingReferences(
      components: components,
      allIDs: allComponentIDs,
      adjacencyList: adjacencyList,
      config: config
    )
    try validateCyclesAndReachability(
      allIDs: allComponentIDs,
      adjacencyList: adjacencyList,
      rootID: rootID,
      config: config
    )

    if let catalogs, !catalogs.isEmpty {
      try validateCompositionConstraints(
        components: components,
        allIDs: allComponentIDs,
        adjacencyList: adjacencyList,
        rootID: rootID,
        catalogs: catalogs,
        defaultCatalogID: defaultCatalogID
      )
    }
  }

  /// Returns the catalog a component runs in: the one its `@catalogId` (or legacy `catalogId`)
  /// names, else the default catalog.
  static func componentCatalogID(
    of component: [String: JSONValue],
    defaultCatalogID: String?
  ) -> String? {
    component["@catalogId"]?.stringValue ?? component["catalogId"]?.stringValue
      ?? defaultCatalogID
  }

  /// The component keys that never hold component references: the structural keys, and the
  /// catalog id and metadata mixins.
  private static let nonReferenceKeys: Set<String> = [
    "id", "component", "catalogId", "@catalogId", "@metadata",
  ]

  static func lookupCatalog(
    catalogID: String?,
    catalogs: [String: AnyCatalog]?,
    defaultCatalogID: String?
  ) -> AnyCatalog? {
    guard let catalogs, !catalogs.isEmpty else { return nil }
    if let catalogID, let catalog = catalogs[catalogID] {
      return catalog
    }
    if let defaultCatalogID, let catalog = catalogs[defaultCatalogID] {
      return catalog
    }
    if catalogs.count == 1, let soleCatalog = catalogs.values.first {
      return soleCatalog
    }
    return nil
  }

  static func lookupComponentAPI(
    type: String,
    catalogID: String?,
    catalogs: [String: AnyCatalog]?,
    defaultCatalogID: String?
  ) -> (any ComponentAPI)? {
    lookupCatalog(catalogID: catalogID, catalogs: catalogs, defaultCatalogID: defaultCatalogID)?
      .components[type]
  }

  private struct ComponentMeta {
    let type: String
    let catalogID: String?
    let index: Int
  }

  private static func validateCompositionConstraints(
    components: [[String: JSONValue]],
    allIDs: Set<String>,
    adjacencyList: AdjacencyMap,
    rootID: String,
    catalogs: [String: AnyCatalog],
    defaultCatalogID: String?
  ) throws {
    var componentMeta: [String: ComponentMeta] = [:]
    for (index, component) in components.enumerated() {
      guard let id = component["id"]?.stringValue,
        let type = component["component"]?.stringValue
      else { continue }
      let catalogID = componentCatalogID(of: component, defaultCatalogID: defaultCatalogID)
      componentMeta[id] = ComponentMeta(type: type, catalogID: catalogID, index: index)
    }

    try validateRootComposition(
      rootID: rootID,
      componentMeta: componentMeta,
      catalogs: catalogs,
      defaultCatalogID: defaultCatalogID
    )

    for component in components {
      guard let parentID = component["id"]?.stringValue,
        let parentInfo = componentMeta[parentID],
        let references = adjacencyList[parentID]
      else { continue }

      for ref in references {
        try validateEdgeComposition(
          parentID: parentID,
          parentInfo: parentInfo,
          ref: ref,
          componentMeta: componentMeta,
          catalogs: catalogs,
          defaultCatalogID: defaultCatalogID
        )
      }
    }
  }

  private static func validateRootComposition(
    rootID: String,
    componentMeta: [String: ComponentMeta],
    catalogs: [String: AnyCatalog],
    defaultCatalogID: String?
  ) throws {
    guard let rootInfo = componentMeta[rootID],
      let rootCompAPI = lookupComponentAPI(
        type: rootInfo.type,
        catalogID: rootInfo.catalogID,
        catalogs: catalogs,
        defaultCatalogID: defaultCatalogID
      ),
      let allowedParents = rootCompAPI.allowedParents,
      !allowedParents.contains("Surface")
    else { return }

    let allowedFormatted = allowedParents.map { "'\($0)'" }.joined(separator: ", ")
    let msg =
      "Component '\(rootID)' (\(rootInfo.type)) cannot be placed under parent "
      + "'Surface' (Surface). Allowed parents: [\(allowedFormatted)]."
    let detail = A2UIErrorDetail(
      path: "/components/\(rootInfo.index)",
      code: "UNALLOWED_PARENT",
      message: msg
    )
    throw A2UIValidationError(msg, details: [detail])
  }

  private static func validateEdgeComposition(
    parentID: String,
    parentInfo: ComponentMeta,
    ref: Reference,
    componentMeta: [String: ComponentMeta],
    catalogs: [String: AnyCatalog],
    defaultCatalogID: String?
  ) throws {
    let childID = ref.referenceID
    guard let childInfo = componentMeta[childID] else { return }

    let parentComponentAPI = lookupComponentAPI(
      type: parentInfo.type,
      catalogID: parentInfo.catalogID,
      catalogs: catalogs,
      defaultCatalogID: defaultCatalogID
    )
    let childComponentAPI = lookupComponentAPI(
      type: childInfo.type,
      catalogID: childInfo.catalogID,
      catalogs: catalogs,
      defaultCatalogID: defaultCatalogID
    )

    if let allowedChildren = parentComponentAPI?.allowedChildren {
      guard allowedChildren.contains(childInfo.type) else {
        let allowedFormatted = allowedChildren.map { "'\($0)'" }.joined(separator: ", ")
        let message =
          "Container '\(parentID)' (\(parentInfo.type)) cannot contain child "
          + "'\(childID)' (\(childInfo.type)). Allowed children: [\(allowedFormatted)]."
        let pointerField = toJSONPointerSegment(ref.field)
        let detail = A2UIErrorDetail(
          path: "/components/\(parentInfo.index)/\(pointerField)",
          code: "UNALLOWED_CHILD",
          message: message
        )
        throw A2UIValidationError(message, details: [detail])
      }
    }

    if let allowedParents = childComponentAPI?.allowedParents {
      guard allowedParents.contains(parentInfo.type) else {
        let allowedFormatted = allowedParents.map { "'\($0)'" }.joined(separator: ", ")
        let message =
          "Component '\(childID)' (\(childInfo.type)) cannot be placed under parent "
          + "'\(parentID)' (\(parentInfo.type)). Allowed parents: [\(allowedFormatted)]."
        let detail = A2UIErrorDetail(
          path: "/components/\(childInfo.index)",
          code: "UNALLOWED_PARENT",
          message: message
        )
        throw A2UIValidationError(message, details: [detail])
      }
    }
  }

  private static func toJSONPointerSegment(_ field: String) -> String {
    field
      .replacingOccurrences(of: "[", with: "/")
      .replacingOccurrences(of: "]", with: "")
      .replacingOccurrences(of: ".", with: "/")
  }

  private static func buildAdjacencyMap(
    from components: [[String: JSONValue]],
    config: ValidationConfig,
    catalogs: [String: AnyCatalog]?,
    defaultCatalogID: String?
  ) throws -> (allIDs: Set<String>, adjacencyList: AdjacencyMap) {
    var allComponentIDs: Set<String> = []
    var adjacencyList: AdjacencyMap = [:]

    for component in components {
      guard let componentID = component["id"]?.stringValue else { continue }
      if allComponentIDs.contains(componentID) {
        throw A2UIIntegrityError("Duplicate component ID: \(componentID)")
      }
      allComponentIDs.insert(componentID)
      adjacencyList[componentID] = []

      let references: [Reference]
      if let type = component["component"]?.stringValue {
        let catalogID = componentCatalogID(of: component, defaultCatalogID: defaultCatalogID)
        let targetCatalog = lookupCatalog(
          catalogID: catalogID,
          catalogs: catalogs,
          defaultCatalogID: defaultCatalogID
        )
        let componentAPI = targetCatalog?.components[type]
        references = extractReferences(
          from: component,
          componentAPI: componentAPI,
          types: targetCatalog?.types ?? [:]
        )
      } else {
        references = []
      }
      for reference in references {
        if reference.referenceID == componentID, !config.allowCyclicReferences {
          throw A2UIRecursionError(
            """
            Self-reference detected: Component '\(componentID)' \
            references itself in field '\(reference.field)'
            """
          )
        }
        adjacencyList[componentID, default: []].append(reference)
      }
    }
    return (allComponentIDs, adjacencyList)
  }

  private static func validateRootPresence(
    allIDs: Set<String>,
    rootID: String,
    config: ValidationConfig
  ) throws {
    if !config.allowMissingRoot && !allIDs.contains(rootID) {
      throw A2UIIntegrityError("Missing root component: No component has id='\(rootID)'")
    }
  }

  private static func validateNoDanglingReferences(
    components: [[String: JSONValue]],
    allIDs: Set<String>,
    adjacencyList: AdjacencyMap,
    config: ValidationConfig
  ) throws {
    guard !config.allowDanglingReferences else { return }

    for component in components {
      guard let componentID = component["id"]?.stringValue else { continue }
      for reference in adjacencyList[componentID] ?? [] {
        if !allIDs.contains(reference.referenceID) {
          throw A2UIIntegrityError(
            """
            Dangling reference: Component '\(componentID)' references non-existent component \
            '\(reference.referenceID)' in field '\(reference.field)'
            """
          )
        }
      }
    }
  }

  private static func validateCyclesAndReachability(
    allIDs: Set<String>,
    adjacencyList: AdjacencyMap,
    rootID: String,
    config: ValidationConfig
  ) throws {
    var visited: Set<String> = []
    var recursionStack: Set<String> = []

    if config.allowMissingRoot {
      for nodeID in allIDs.sorted() where !visited.contains(nodeID) {
        try depthFirstSearch(
          nodeID: nodeID,
          depth: 0,
          allIDs: allIDs,
          adjacencyList: adjacencyList,
          allowsCycles: config.allowCyclicReferences,
          visited: &visited,
          recursionStack: &recursionStack
        )
      }
      return
    }

    guard allIDs.contains(rootID) else { return }
    try depthFirstSearch(
      nodeID: rootID,
      depth: 0,
      allIDs: allIDs,
      adjacencyList: adjacencyList,
      allowsCycles: config.allowCyclicReferences,
      visited: &visited,
      recursionStack: &recursionStack
    )

    guard !config.allowOrphanComponents else { return }
    let orphans = allIDs.subtracting(visited)
    if let firstOrphan = orphans.sorted().first {
      throw A2UIIntegrityError("Component '\(firstOrphan)' is not reachable from '\(rootID)'")
    }
  }

  private static func depthFirstSearch(
    nodeID: String,
    depth: Int,
    allIDs: Set<String>,
    adjacencyList: AdjacencyMap,
    allowsCycles: Bool,
    visited: inout Set<String>,
    recursionStack: inout Set<String>
  ) throws {
    if depth > maxGlobalDepth {
      throw A2UIRecursionError(
        "Global recursion limit exceeded: logical depth > \(maxGlobalDepth)"
      )
    }
    visited.insert(nodeID)
    recursionStack.insert(nodeID)

    for reference in adjacencyList[nodeID] ?? [] {
      let neighbor = reference.referenceID
      if !visited.contains(neighbor) {
        if allIDs.contains(neighbor) {
          try depthFirstSearch(
            nodeID: neighbor,
            depth: depth + 1,
            allIDs: allIDs,
            adjacencyList: adjacencyList,
            allowsCycles: allowsCycles,
            visited: &visited,
            recursionStack: &recursionStack
          )
        }
      } else if !allowsCycles, recursionStack.contains(neighbor) {
        throw A2UIRecursionError(
          "Circular component reference (Circular reference detected) involving component '\(neighbor)'"
        )
      }
    }
    recursionStack.remove(nodeID)
  }

  /// Extracts component reference pointers directly from a canonical ``ComponentDefinition``
  /// without walking JSON Schema ASTs.
  public static func extractReferences(
    from component: [String: JSONValue],
    definition: ComponentDefinition,
    types: [String: TypeDefinition] = [:]
  ) -> [Reference] {
    var references: [Reference] = []
    for param in definition.parameters where !nonReferenceKeys.contains(param.name) {
      guard let propertyValue = component[param.name] else { continue }
      collectTypeReferences(
        from: propertyValue,
        type: param.type,
        types: types,
        path: param.name,
        visitedRefs: [],
        into: &references
      )
    }
    return references
  }

  static func extractReferences(
    from component: [String: JSONValue],
    componentAPI: (any ComponentAPI)?,
    types: [String: TypeDefinition] = [:]
  ) -> [Reference] {
    guard let componentAPI else { return [] }
    return extractReferences(from: component, definition: componentAPI.definition, types: types)
  }

  /// Extracts component reference pointers from a component property dictionary and legacy JSON
  /// Schema.
  public static func extractReferences(
    from component: [String: JSONValue],
    schema: JSONValue? = nil
  ) -> [Reference] {
    guard let schema else { return [] }
    let def = CatalogJSONSchemaCodec.componentDefinition(from: "_Component", schema: schema)
    return extractReferences(from: component, definition: def)
  }

  private static func collectTypeReferences(
    from value: JSONValue,
    type: TypeDefinition,
    types: [String: TypeDefinition],
    path: String,
    visitedRefs: Set<String>,
    into result: inout [Reference]
  ) {
    switch type.kind {
    case .childList:
      collectChildListReferences(from: value, path: path, into: &result)
    case .child:
      if let childID = value.stringValue {
        result.append((childID, path))
      }
    case .array(_, let items, _, _, _, _):
      guard let items, case .array(let array) = value else { return }
      for (index, item) in array.enumerated() {
        // Descending into a strict JSON sub-value resets `visitedRefs`.
        collectTypeReferences(
          from: item,
          type: items,
          types: types,
          path: "\(path)[\(index)]",
          visitedRefs: [],
          into: &result
        )
      }
    case .object(_, let properties, let additionalProperties, _, _):
      guard case .object(let dict) = value else { return }
      for param in properties {
        guard let propValue = dict[param.name] else { continue }
        collectTypeReferences(
          from: propValue,
          type: param.type,
          types: types,
          path: "\(path).\(param.name)",
          visitedRefs: [],
          into: &result
        )
      }
      if let extraType = additionalProperties.typedSchema {
        let declared = Set(properties.map(\.name))
        for (key, propValue) in dict where !declared.contains(key) {
          collectTypeReferences(
            from: propValue,
            type: extraType,
            types: types,
            path: "\(path).\(key)",
            visitedRefs: [],
            into: &result
          )
        }
      }
    case .union(let variants, _, _, _):
      for variant in variants {
        var candidateRefs: [Reference] = []
        collectTypeReferences(
          from: value,
          type: variant,
          types: types,
          path: path,
          visitedRefs: visitedRefs,
          into: &candidateRefs
        )
        if !candidateRefs.isEmpty {
          result.append(contentsOf: candidateRefs)
          return
        }
      }
    case .ref(let refName, _):
      guard !visitedRefs.contains(refName), let target = types[refName] else { return }
      var nextVisited = visitedRefs
      nextVisited.insert(refName)
      collectTypeReferences(
        from: value,
        type: target,
        types: types,
        path: path,
        visitedRefs: nextVisited,
        into: &result
      )
    case .rawJSONSchema(let raw):
      if case .array(let array) = value, let itemRaw = raw["items"] {
        let itemType = CatalogJSONSchemaCodec.translateStandalonePropertyType(itemRaw)
        for (index, item) in array.enumerated() {
          collectTypeReferences(
            from: item,
            type: itemType,
            types: types,
            path: "\(path)[\(index)]",
            visitedRefs: [],
            into: &result
          )
        }
      } else if case .object(let dict) = value, let propsObj = raw["properties"]?.objectValue {
        for (key, propValue) in dict {
          guard let propRaw = propsObj[key] else { continue }
          let propType = CatalogJSONSchemaCodec.translateStandalonePropertyType(propRaw)
          collectTypeReferences(
            from: propValue,
            type: propType,
            types: types,
            path: "\(path).\(key)",
            visitedRefs: [],
            into: &result
          )
        }
      }
    case .string, .number, .integer, .boolean, .enum, .const, .any,
      .dataBinding, .functionCall, .action, .checkRule, .accessibility:
      break
    }
  }

  private static func collectChildListReferences(
    from value: JSONValue,
    path: String,
    into result: inout [Reference]
  ) {
    switch value {
    case .array(let array):
      for (index, item) in array.enumerated() {
        if let childID = item.stringValue {
          result.append((childID, "\(path)[\(index)]"))
        }
      }
    case .object(let dict):
      if let componentID = dict["componentId"]?.stringValue {
        result.append((componentID, "\(path).componentId"))
      }
    default:
      break
    }
  }
}
