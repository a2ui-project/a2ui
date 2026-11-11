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

  /// Mixin keys at a v1.0 component root that never contain child references.
  private static let atChildSkippedRootKeys: Set<String> = [
    "id", "component", "catalogId", "@catalogId", "@metadata", "@accessibility", "@checks",
  ]

  static func lookupComponentAPI(
    type: String,
    catalogID: String?,
    catalogs: [String: AnyCatalog]?,
    defaultCatalogID: String?
  ) -> (any ComponentAPI)? {
    guard let catalogs, !catalogs.isEmpty else { return nil }

    if let catalogID, let catalog = catalogs[catalogID] {
      return catalog.components[type]
    }
    if let defaultCatalogID, let catalog = catalogs[defaultCatalogID] {
      return catalog.components[type]
    }
    if catalogs.count == 1, let soleCatalog = catalogs.values.first {
      return soleCatalog.components[type]
    }
    return nil
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
        let pointerField = Self.cleanCompositionPointer(toJSONPointerSegment(ref.field))
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

  private static func cleanCompositionPointer(_ pointer: String) -> String {
    if pointer.hasSuffix("/componentId") {
      return String(pointer.dropLast("/componentId".count))
    }
    if pointer.hasSuffix("/@child") {
      return String(pointer.dropLast("/@child".count))
    }
    return pointer
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

      let catalogID = componentCatalogID(of: component, defaultCatalogID: defaultCatalogID)
      let componentCatalog = resolveComponentCatalog(
        catalogID: catalogID,
        catalogs: catalogs,
        defaultCatalogID: defaultCatalogID
      )
      let componentSchema: JSONValue?
      if let type = component["component"]?.stringValue {
        componentSchema =
          componentCatalog?.components[type]?.schema.jsonValue
          ?? lookupComponentAPI(
            type: type,
            catalogID: catalogID,
            catalogs: catalogs,
            defaultCatalogID: defaultCatalogID
          )?.schema.jsonValue
      } else {
        componentSchema = nil
      }
      let isAtLeastV10 =
        config.protocolVersion?.isAtLeastV10
        ?? componentCatalog?.isAtLeastV10
        ?? (catalogs.map { !$0.isEmpty && $0.values.allSatisfy(\.isAtLeastV10) } ?? false)

      let references = extractReferences(
        from: component,
        schema: componentSchema,
        isAtLeastV10: isAtLeastV10
      )
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

  /// Extracts component reference pointers from a component property dictionary.
  public static func extractReferences(
    from component: [String: JSONValue],
    schema: JSONValue? = nil
  ) -> [Reference] {
    let isAtLeastV10: Bool
    if let schema {
      isAtLeastV10 = schemaHasV10Markers(schema, root: schema, visitedRefs: [])
    } else {
      isAtLeastV10 = true
    }
    return extractReferences(
      from: component,
      schema: schema,
      isAtLeastV10: isAtLeastV10
    )
  }

  /// Extracts component reference pointers from a component property dictionary under `version`.
  public static func extractReferences(
    from component: [String: JSONValue],
    schema: JSONValue?,
    protocolVersion: A2UIProtocolVersion
  ) -> [Reference] {
    extractReferences(
      from: component,
      schema: schema,
      isAtLeastV10: protocolVersion.isAtLeastV10
    )
  }

  static func extractReferences(
    from component: [String: JSONValue],
    schema: JSONValue?,
    isAtLeastV10: Bool
  ) -> [Reference] {
    var references: [Reference] = []
    if isAtLeastV10 {
      collectV10AtChildReferences(from: component, schema: schema, into: &references)
    }
    guard let schema else { return references }
    let rootSchema = schema
    // TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
    let propertySchemas = extractPropertiesSchema(from: schema, root: rootSchema)
    for (key, propertyValue) in component where !nonReferenceKeys.contains(key) {
      guard let propSchema = propertySchemas[key] else { continue }
      collectSchemaReferences(
        from: propertyValue,
        schema: propSchema,
        root: rootSchema,
        path: key,
        into: &references
      )
    }
    return references
  }

  private static func resolveComponentCatalog(
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
    if catalogs.count == 1 {
      return catalogs.values.first
    }
    return nil
  }

  private static func schemaHasV10Markers(
    _ schema: JSONValue,
    root: JSONValue,
    visitedRefs: Set<String>
  ) -> Bool {
    if let schemaID = schema["$id"]?.stringValue,
      schemaID.contains("/v1_0/") || schemaID == "common_types.json"
    {
      return true
    }
    if let ref = schema["$ref"]?.stringValue {
      if ref.contains("/v0_9") || ref.contains("/v0_8") || ref.contains("common.json#") {
        return false
      }
      if ref.contains("/v1_0/") || ref.hasPrefix("common_types.json#") {
        return true
      }
      if ref.hasPrefix("#") {
        var visited = visitedRefs
        if visited.insert(ref).inserted,
          let target = ComponentEnvelope.resolveLocalRef(ref, in: root),
          schemaHasV10Markers(target, root: root, visitedRefs: visited)
        {
          return true
        }
      }
    }
    if let desc = schema["description"]?.stringValue, desc.hasPrefix("REF:common_types.json#") {
      return true
    }
    if let props = schema["properties"]?.objectValue {
      let v10Keys: Set<String> = ["@catalogId", "@metadata", "@accessibility", "@checks"]
      if props.keys.contains(where: { v10Keys.contains($0) }) {
        return true
      }
      if props.values.contains(where: {
        schemaHasV10Markers($0, root: root, visitedRefs: visitedRefs)
      }) {
        return true
      }
    }
    if let items = schema["items"],
      schemaHasV10Markers(items, root: root, visitedRefs: visitedRefs)
    {
      return true
    }
    for combiner in ["allOf", "oneOf", "anyOf"] {
      if let branches = schema[combiner]?.arrayValue,
        branches.contains(where: {
          schemaHasV10Markers($0, root: root, visitedRefs: visitedRefs)
        })
      {
        return true
      }
    }
    return false
  }

  private static func collectV10AtChildReferences(
    from component: [String: JSONValue],
    schema: JSONValue?,
    into result: inout [Reference]
  ) {
    let bareMixins: Set<String> = ["metadata", "accessibility", "checks"]
    for (key, propertyValue) in component {
      guard !key.hasPrefix("@@"), !atChildSkippedRootKeys.contains(key) else { continue }
      if bareMixins.contains(key),
        let mixin = ComponentEnvelope.Mixin(rawValue: key),
        !ComponentEnvelope.declaresOwnProperty(mixin, in: schema)
      {
        continue
      }
      let propSchema = schema.flatMap {
        ComponentEnvelope.resolvedSubschema(forProperty: key, in: $0, root: $0)
      }
      collectAtChildReferences(
        from: propertyValue,
        schema: propSchema,
        rootSchema: schema,
        path: key,
        into: &result
      )
    }
  }

  private static func collectAtChildReferences(
    from value: JSONValue,
    schema: JSONValue?,
    rootSchema: JSONValue?,
    path: String,
    into result: inout [Reference]
  ) {
    if let schema, let rootSchema,
      ComponentEnvelope.isPureDynamicSchema(schema, root: rootSchema)
    {
      return
    }
    switch value {
    case .array(let items):
      let itemSchema = rootSchema.flatMap { root in
        schema.flatMap { ComponentEnvelope.resolvedArrayItemsSchema(in: $0, root: root) }
      }
      for (index, item) in items.enumerated() {
        collectAtChildReferences(
          from: item,
          schema: itemSchema,
          rootSchema: rootSchema,
          path: "\(path)/\(index)",
          into: &result
        )
      }
    case .object(let dict):
      if dict["@child"] != nil {
        if dict["@path"] != nil {
          if let templateID = dict["@child"]?.stringValue, !templateID.isEmpty {
            result.append((templateID, "\(path)/@child"))
          }
        } else if let childID = dict["@child"]?.stringValue, !childID.isEmpty {
          result.append((childID, path))
        } else if let childIDs = dict["@child"]?.arrayValue {
          for (index, item) in childIDs.enumerated() {
            if let childID = item.stringValue, !childID.isEmpty {
              result.append((childID, "\(path)/\(index)"))
            }
          }
        }
        return
      }
      if dict["@path"] != nil
        || dict["@call"] != nil
        || dict["@action"] != nil
        || dict["@functionCall"] != nil
      {
        return
      }
      for (subKey, subValue) in dict where !subKey.hasPrefix("@@") {
        let subSchema = rootSchema.flatMap { root in
          schema.flatMap {
            ComponentEnvelope.resolvedSubschema(forProperty: subKey, in: $0, root: root)
          }
        }
        collectAtChildReferences(
          from: subValue,
          schema: subSchema,
          rootSchema: rootSchema,
          path: "\(path)/\(subKey)",
          into: &result
        )
      }
    default:
      break
    }
  }

  private static func collectSchemaReferences(
    from value: JSONValue,
    schema: JSONValue,
    root: JSONValue,
    path: String,
    into result: inout [Reference]
  ) {
    // `@child` envelopes are already extracted by `collectV10AtChildReferences`.
    if value.objectValue?["@child"] != nil {
      return
    }
    if isChildListSchema(schema, root: root) {
      collectChildListReferences(from: value, path: path, into: &result)
      return
    }

    if isSingleChildSchema(schema, root: root) {
      if let childID = value.stringValue {
        result.append((childID, path))
      }
      return
    }

    // If the schema has an explicit $ref to another type (e.g. DynamicString, Action, CheckRule),
    // it is definitively not a child component reference.
    if let ref = schema["$ref"]?.stringValue {
      if ref.hasPrefix("#"),
        let resolved = ComponentEnvelope.resolveLocalRef(ref, in: root)
      {
        collectNestedSchemaReferences(
          from: value,
          schema: resolved,
          root: root,
          path: path,
          into: &result
        )
      }
      return
    }

    collectNestedSchemaReferences(
      from: value,
      schema: schema,
      root: root,
      path: path,
      into: &result
    )
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

  private static func collectNestedSchemaReferences(
    from value: JSONValue,
    schema: JSONValue,
    root: JSONValue,
    path: String,
    into result: inout [Reference]
  ) {
    switch value {
    case .array(let array):
      guard let itemsSchema = ComponentEnvelope.resolvedArrayItemsSchema(in: schema, root: root)
      else {
        break
      }
      for (index, item) in array.enumerated() {
        collectSchemaReferences(
          from: item,
          schema: itemsSchema,
          root: root,
          path: "\(path)[\(index)]",
          into: &result
        )
      }
    case .object(let dict):
      let subProperties = extractPropertiesSchema(from: schema, root: root)
      for (key, propValue) in dict {
        guard let subSchema = subProperties[key] else { continue }
        collectSchemaReferences(
          from: propValue,
          schema: subSchema,
          root: root,
          path: "\(path).\(key)",
          into: &result
        )
      }
    default:
      break
    }
  }

  private static func isChildListSchema(
    _ schema: JSONValue,
    root: JSONValue,
    visitedRefs: Set<String> = []
  ) -> Bool {
    if ComponentEnvelope.schemaRefName(schema) == "ChildList" {
      return true
    }
    if schema["type"]?.stringValue == "array", let items = schema["items"] {
      if isSingleChildSchema(items, root: root, visitedRefs: visitedRefs)
        || isChildListSchema(items, root: root, visitedRefs: visitedRefs)
      {
        return true
      }
    }
    var visitedRefs = visitedRefs
    if let ref = schema["$ref"]?.stringValue, ref.hasPrefix("#"),
      visitedRefs.insert(ref).inserted,
      let target = ComponentEnvelope.resolveLocalRef(ref, in: root),
      isChildListSchema(target, root: root, visitedRefs: visitedRefs)
    {
      return true
    }
    for combiner in ["oneOf", "anyOf", "allOf"] {
      if let subSchemas = schema[combiner]?.arrayValue,
        subSchemas.contains(where: {
          isChildListSchema($0, root: root, visitedRefs: visitedRefs)
        })
      {
        return true
      }
    }
    return false
  }

  private static func isSingleChildSchema(
    _ schema: JSONValue,
    root: JSONValue,
    visitedRefs: Set<String> = []
  ) -> Bool {
    if let refName = ComponentEnvelope.schemaRefName(schema),
      refName == "Child" || refName == "ComponentId"
    {
      return true
    }
    var visitedRefs = visitedRefs
    if let ref = schema["$ref"]?.stringValue, ref.hasPrefix("#"),
      visitedRefs.insert(ref).inserted,
      let target = ComponentEnvelope.resolveLocalRef(ref, in: root),
      isSingleChildSchema(target, root: root, visitedRefs: visitedRefs)
    {
      return true
    }
    for combiner in ["oneOf", "anyOf", "allOf"] {
      if let subSchemas = schema[combiner]?.arrayValue,
        subSchemas.contains(where: {
          isSingleChildSchema($0, root: root, visitedRefs: visitedRefs)
        })
      {
        return true
      }
    }
    return false
  }

  private static func extractPropertiesSchema(
    from schemaJSON: JSONValue,
    root: JSONValue,
    visitedRefs: Set<String> = []
  ) -> [String: JSONValue] {
    var result: [String: JSONValue] = [:]
    if let props = schemaJSON["properties"]?.objectValue {
      for (k, v) in props {
        result[k] = v
      }
    }
    var visitedRefs = visitedRefs
    if let ref = schemaJSON["$ref"]?.stringValue, ref.hasPrefix("#"),
      visitedRefs.insert(ref).inserted,
      let target = ComponentEnvelope.resolveLocalRef(ref, in: root)
    {
      let refProps = extractPropertiesSchema(from: target, root: root, visitedRefs: visitedRefs)
      for (k, v) in refProps {
        result[k] = v
      }
    }
    for combiner in ["allOf", "oneOf", "anyOf"] {
      if let subSchemas = schemaJSON[combiner]?.arrayValue {
        for subSchema in subSchemas {
          let subProps = extractPropertiesSchema(
            from: subSchema,
            root: root,
            visitedRefs: visitedRefs
          )
          for (k, v) in subProps {
            result[k] = v
          }
        }
      }
    }
    return result
  }
}
