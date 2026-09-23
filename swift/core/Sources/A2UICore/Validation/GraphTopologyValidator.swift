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

  private static func lookupComponentAPI(
    type: String,
    catalogID: String?,
    catalogs: [String: AnyCatalog]?,
    defaultCatalogID: String?
  ) -> (any ComponentAPI)? {
    guard let catalogs, !catalogs.isEmpty else { return nil }

    func findCatalog(_ catID: String?) -> AnyCatalog? {
      guard let catID else { return nil }
      if let cat = catalogs[catID] { return cat }
      return catalogs.values.first {
        $0.id.hasSuffix("/\(catID)/catalog.json")
      }
    }

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

    // 1. Root component composition constraint: parent is conceptual "Surface"
    if let rootInfo = componentTypes[rootID] {
      if let rootCompAPI = lookupComponentAPI(
        type: rootInfo.type,
        catalogID: rootInfo.catalogID,
        catalogs: catalogs,
        defaultCatalogID: defaultCatalogID
      ),
        let allowedParents = rootCompAPI.allowedParents
      {
        if !allowedParents.contains("Surface") {
          let allowedFormatted = allowedParents.map { "'\($0)'" }.joined(separator: ", ")
          let msg =
            "Component '\(rootID)' (\(rootInfo.type)) cannot be placed under parent "
            + "'Surface' (Surface). Allowed parents: [\(allowedFormatted)]."
          let detail = A2UIErrorDetail(
            path: "\(rootID)",
            code: "UNALLOWED_PARENT",
            message: msg
          )
          throw A2UIValidationError(msg, details: [detail])
        }
      }
    }

    // 2. Validate all parent-child relationships in adjacencyList
    for (parentID, references) in adjacencyList {
      guard let parentInfo = componentTypes[parentID] else { continue }
      let parentCompAPI = lookupComponentAPI(
        type: parentInfo.type,
        catalogID: parentInfo.catalogID,
        catalogs: catalogs,
        defaultCatalogID: defaultCatalogID
      )

      for ref in references {
        let childID = ref.referenceID
        guard let childInfo = componentTypes[childID] else { continue }
        let childCompAPI = lookupComponentAPI(
          type: childInfo.type,
          catalogID: childInfo.catalogID,
          catalogs: catalogs,
          defaultCatalogID: defaultCatalogID
        )

        // Validate parent's allowedChildren
        if let allowedChildren = parentCompAPI?.allowedChildren {
          if !allowedChildren.contains(childInfo.type) {
            let allowedFormatted = allowedChildren.map { "'\($0)'" }.joined(separator: ", ")
            let msg =
              "Container '\(parentID)' (\(parentInfo.type)) cannot contain child "
              + "'\(childID)' (\(childInfo.type)). Allowed children: [\(allowedFormatted)]."
            let detail = A2UIErrorDetail(
              path: "\(parentID).\(ref.field)",
              code: "UNALLOWED_CHILD",
              message: msg
            )
            throw A2UIValidationError(msg, details: [detail])
          }
        }

        // Validate child's allowedParents
        if let allowedParents = childCompAPI?.allowedParents {
          if !allowedParents.contains(parentInfo.type) {
            let allowedFormatted = allowedParents.map { "'\($0)'" }.joined(separator: ", ")
            let msg =
              "Component '\(childID)' (\(childInfo.type)) cannot be placed under parent "
              + "'\(parentID)' (\(parentInfo.type)). Allowed parents: [\(allowedFormatted)]."
            let detail = A2UIErrorDetail(
              path: "\(childID)",
              code: "UNALLOWED_PARENT",
              message: msg
            )
            throw A2UIValidationError(msg, details: [detail])
          }
        }
      }
    }
  }

  private static func buildAdjacencyMap(
    from components: [[String: JSONValue]],
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

      let componentSchema: JSONValue?
      if let type = component["component"]?.stringValue {
        let catalogID = component["catalogId"]?.stringValue ?? defaultCatalogID
        componentSchema =
          lookupComponentAPI(
            type: type,
            catalogID: catalogID,
            catalogs: catalogs,
            defaultCatalogID: defaultCatalogID
          )?.schema.jsonValue
      } else {
        componentSchema = nil
      }

      let references = extractReferences(from: component, schema: componentSchema)
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
            "Circular component reference (Circular reference) detected involving component '\(neighbor)'"
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
    from component: [String: JSONValue],
    schema: JSONValue? = nil
  ) -> [Reference] {
    guard let schema else { return [] }
    var references: [Reference] = []
    let propertySchemas = extractPropertiesSchema(from: schema)
    for (key, propertyValue) in component
    where key != "id" && key != "component" && key != "catalogId" {
      guard let propSchema = propertySchemas[key] else { continue }
      collectSchemaReferences(
        from: propertyValue,
        schema: propSchema,
        path: key,
        into: &references
      )
    }
    return references
  }

  private static func collectSchemaReferences(
    from value: JSONValue,
    schema: JSONValue,
    path: String,
    into result: inout [Reference]
  ) {
    if isChildListSchema(schema, propertyName: path) {
      switch value {
      case .array(let array):
        for item in array {
          if let childID = item.stringValue {
            result.append((childID, path))
          }
        }
      case .object(let dict):
        if let componentID = dict["componentId"]?.stringValue {
          result.append((componentID, "\(path).componentId"))
        }
      default:
        break
      }
      return
    }

    if isSingleChildSchema(schema, propertyName: path) {
      if let childID = value.stringValue {
        result.append((childID, path))
      }
      return
    }

    // If the schema has an explicit $ref to another type (e.g. DynamicString, Action, CheckRule),
    // it is definitively not a child component reference.
    guard schema["$ref"]?.stringValue == nil else {
      return
    }

    switch value {
    case .array(let array):
      guard let itemsSchema = schema["items"] else { break }
      for (index, item) in array.enumerated() {
        collectSchemaReferences(
          from: item,
          schema: itemsSchema,
          path: "\(path)[\(index)]",
          into: &result
        )
      }
    case .object(let dict):
      let subProperties = extractPropertiesSchema(from: schema)
      for (key, propValue) in dict {
        guard let subSchema = subProperties[key] else { continue }
        collectSchemaReferences(
          from: propValue,
          schema: subSchema,
          path: "\(path).\(key)",
          into: &result
        )
      }
    default:
      break
    }
  }

  private static func isChildListSchema(_ schema: JSONValue, propertyName: String = "") -> Bool {
    if let ref = schema["$ref"]?.stringValue {
      let refName = ref.split(separator: "/").last.map(String.init)
      if refName == "ChildList" { return true }
    }
    if propertyName == "children",
      schema["type"]?.stringValue == "array",
      schema["items"]?["type"]?.stringValue == "string"
    {
      return true
    }
    for combiner in ["oneOf", "anyOf", "allOf"] {
      if let subSchemas = schema[combiner]?.arrayValue,
        subSchemas.contains(where: { isChildListSchema($0, propertyName: propertyName) })
      {
        return true
      }
    }
    return false
  }

  private static func isSingleChildSchema(_ schema: JSONValue, propertyName: String = "") -> Bool {
    if let ref = schema["$ref"]?.stringValue {
      let refName = ref.split(separator: "/").last.map(String.init)
      if refName == "Child" || refName == "ComponentId" { return true }
    }
    if propertyName == "child", schema["type"]?.stringValue == "string" {
      return true
    }
    for combiner in ["oneOf", "anyOf", "allOf"] {
      if let subSchemas = schema[combiner]?.arrayValue,
        subSchemas.contains(where: { isSingleChildSchema($0, propertyName: propertyName) })
      {
        return true
      }
    }
    return false
  }

  private static func extractPropertiesSchema(from schemaJSON: JSONValue) -> [String: JSONValue] {
    var result: [String: JSONValue] = [:]
    if let props = schemaJSON["properties"]?.objectValue {
      for (k, v) in props {
        result[k] = v
      }
    }
    for combiner in ["allOf", "oneOf", "anyOf"] {
      if let subSchemas = schemaJSON[combiner]?.arrayValue {
        for subSchema in subSchemas {
          let subProps = extractPropertiesSchema(from: subSchema)
          for (k, v) in subProps {
            result[k] = v
          }
        }
      }
    }
    return result
  }
}
