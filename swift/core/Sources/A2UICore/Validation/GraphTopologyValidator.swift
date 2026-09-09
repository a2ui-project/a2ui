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
  private static let maxGlobalDepth = 50

  public typealias Reference = (referenceID: String, field: String)
  public typealias AdjacencyMap = [String: [Reference]]

  /// Validates the topology, integrity, and composition constraints of a list of component JSON objects.
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
    let (allComponentIDs, adjacencyList) = try buildAdjacencyMap(from: components)

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

  private static func validateCompositionConstraints(
    components: [[String: JSONValue]],
    allIDs: Set<String>,
    adjacencyList: AdjacencyMap,
    rootID: String,
    catalogs: [String: AnyCatalog],
    defaultCatalogID: String?
  ) throws {
    var componentTypes: [String: (type: String, catalogID: String?)] = [:]
    for component in components {
      guard let id = component["id"]?.stringValue,
        let type = component["component"]?.stringValue
      else { continue }
      let catalogID = component["catalogId"]?.stringValue ?? defaultCatalogID
      componentTypes[id] = (type, catalogID)
    }

    func findCatalog(_ catID: String?) -> AnyCatalog? {
      guard let catID else { return nil }
      if let cat = catalogs[catID] { return cat }
      return catalogs.values.first {
        $0.id.hasSuffix("/\(catID)/catalog.json")
      }
    }

    func getComponentAPI(type: String, catalogID: String?) -> (any ComponentAPI)? {
      if let catalogID, let catalog = findCatalog(catalogID), let comp = catalog.components[type] {
        return comp
      }
      if let defaultCatalogID, let catalog = findCatalog(defaultCatalogID),
        let comp = catalog.components[type]
      {
        return comp
      }
      for catalog in catalogs.values {
        if let comp = catalog.components[type] {
          return comp
        }
      }
      return nil
    }

    // 1. Root component composition constraint: parent is conceptual "Surface"
    if let rootInfo = componentTypes[rootID] {
      if let rootCompAPI = getComponentAPI(type: rootInfo.type, catalogID: rootInfo.catalogID),
        let allowedParents = rootCompAPI.allowedParents
      {
        if !allowedParents.contains("Surface") {
          let detail = A2UIErrorDetail(
            path: "\(rootID)",
            code: "UNALLOWED_PARENT",
            message:
              "Component '\(rootID)' of type '\(rootInfo.type)' cannot have parent of type 'Surface'"
          )
          throw A2UIValidationError(
            "Component '\(rootID)' of type '\(rootInfo.type)' has unallowed parent 'Surface'",
            details: [detail]
          )
        }
      }
    }

    // 2. Validate all parent-child relationships in adjacencyList
    for (parentID, references) in adjacencyList {
      guard let parentInfo = componentTypes[parentID] else { continue }
      let parentCompAPI = getComponentAPI(type: parentInfo.type, catalogID: parentInfo.catalogID)

      for ref in references {
        let childID = ref.referenceID
        guard let childInfo = componentTypes[childID] else { continue }
        let childCompAPI = getComponentAPI(type: childInfo.type, catalogID: childInfo.catalogID)

        // Validate parent's allowedChildren
        if let allowedChildren = parentCompAPI?.allowedChildren {
          if !allowedChildren.contains(childInfo.type) {
            let detail = A2UIErrorDetail(
              path: "\(parentID).\(ref.field)",
              code: "UNALLOWED_CHILD",
              message:
                "Component '\(parentID)' of type '\(parentInfo.type)' cannot have child of type '\(childInfo.type)'"
            )
            throw A2UIValidationError(
              "Component '\(parentID)' of type '\(parentInfo.type)' has unallowed child '\(childInfo.type)'",
              details: [detail]
            )
          }
        }

        // Validate child's allowedParents
        if let allowedParents = childCompAPI?.allowedParents {
          if !allowedParents.contains(parentInfo.type) {
            let detail = A2UIErrorDetail(
              path: "\(childID)",
              code: "UNALLOWED_PARENT",
              message:
                "Component '\(childID)' of type '\(childInfo.type)' cannot have parent of type '\(parentInfo.type)'"
            )
            throw A2UIValidationError(
              "Component '\(childID)' of type '\(childInfo.type)' has unallowed parent '\(parentInfo.type)'",
              details: [detail]
            )
          }
        }
      }
    }
  }

  private static func buildAdjacencyMap(
    from components: [[String: JSONValue]]
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

      let references = extractReferences(from: component)
      for reference in references {
        if reference.referenceID == componentID {
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
            Component '\(componentID)' references non-existent component \
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

    func depthFirstSearch(nodeID: String, depth: Int) throws {
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
            try depthFirstSearch(nodeID: neighbor, depth: depth + 1)
          }
        } else if recursionStack.contains(neighbor) {
          throw A2UIRecursionError(
            "Circular reference detected involving component '\(neighbor)'"
          )
        }
      }
      recursionStack.remove(nodeID)
    }

    if config.allowMissingRoot {
      for nodeID in allIDs.sorted() {
        if !visited.contains(nodeID) {
          try depthFirstSearch(nodeID: nodeID, depth: 0)
        }
      }
    } else if allIDs.contains(rootID) {
      try depthFirstSearch(nodeID: rootID, depth: 0)

      if !config.allowOrphanComponents {
        let orphans = allIDs.subtracting(visited)
        if let firstOrphan = orphans.sorted().first {
          throw A2UIIntegrityError("Component '\(firstOrphan)' is not reachable from '\(rootID)'")
        }
      }
    }
  }

  /// Extracts component reference pointers from a component property dictionary.
  public static func extractReferences(
    from component: [String: JSONValue]
  ) -> [Reference] {
    var references: [Reference] = []

    for (key, propertyValue) in component
    where key != "id" && key != "component" && key != "catalogId" {
      collectReferences(from: propertyValue, path: key, into: &references)
    }
    return references
  }

  private static func collectReferences(
    from value: JSONValue,
    path: String,
    into result: inout [Reference]
  ) {
    switch value {
    case .string(let stringValue):
      let lowercasedPath = path.lowercased()
      if lowercasedPath.hasSuffix("child") || lowercasedPath.hasSuffix("componentid") {
        result.append((stringValue, path))
      }

    case .array(let array):
      for (index, item) in array.enumerated() {
        if let stringValue = item.stringValue {
          let lowercasedPath = path.lowercased()
          if lowercasedPath.contains("child") {
            result.append((stringValue, path))
          }
        } else {
          collectReferences(from: item, path: "\(path)[\(index)]", into: &result)
        }
      }

    case .object(let dictionary):
      if let componentID = dictionary["componentId"]?.stringValue {
        result.append((componentID, "\(path).componentId"))
      } else {
        for (key, propertyValue) in dictionary {
          collectReferences(from: propertyValue, path: "\(path).\(key)", into: &result)
        }
      }

    default:
      break
    }
  }
}
