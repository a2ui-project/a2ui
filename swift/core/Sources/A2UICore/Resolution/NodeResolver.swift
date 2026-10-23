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
  private var reportedExpressionErrors: Set<String> = []
  private var currentPassExpressionErrors: Set<String> = []
  private var isResolvingTree = false
  private var currentComponentID: String?
  private var currentPropertyPath: String?

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
    self.componentsModel = componentsModel ?? SurfaceComponentsModel()
    self.dataModel = dataModel ?? DataModel()
    self.actionHandler = actionHandler
    self.protocolVersion = protocolVersion
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

  /// Clears previously reported expression errors so subsequent evaluations re-emit.
  public func clearReportedExpressionErrors(forComponentID componentID: String? = nil) {
    if let componentID {
      let prefix = "\(componentID):"
      reportedExpressionErrors = reportedExpressionErrors.filter { !$0.hasPrefix(prefix) }
    } else {
      reportedExpressionErrors.removeAll()
    }
  }

  /// Resolves the component tree starting from the root component ("root")
  /// using the stored component and data models.
  public func resolveTree() -> Node? {
    let wasResolvingTree = isResolvingTree
    if !wasResolvingTree {
      isResolvingTree = true
      currentPassExpressionErrors.removeAll()
    }
    defer {
      if !wasResolvingTree {
        reportedExpressionErrors = currentPassExpressionErrors
        currentPassExpressionErrors.removeAll()
        isResolvingTree = false
      }
    }
    return resolveNode(
      definitionID: "root",
      instanceID: "root",
      basePath: nil,
      visited: [],
      components: componentsModel.components,
      data: dataModel.data
    )
  }

  /// Resolves a component definition into a concrete ``Node``.
  ///
  /// - Parameters:
  ///   - definitionID: The ID of the component in `components`.
  ///   - instanceID: The unique identifier for this instance in the tree.
  ///   - basePath: The data model base path for relative bindings.
  ///   - visited: The set of instance IDs currently being resolved in the stack.
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
    data: JSONValue
  ) -> Node? {
    if visited.contains(instanceID) {
      return nil
    }

    guard let component = components[definitionID] else {
      return nil
    }

    let previousComponentID = currentComponentID
    let previousPropertyPath = currentPropertyPath
    currentComponentID = instanceID
    defer {
      currentComponentID = previousComponentID
      currentPropertyPath = previousPropertyPath
    }

    let type = component.type
    let effectiveCatalogID = component.catalogID ?? defaultCatalogID
    let targetCatalog = getCatalog(id: effectiveCatalogID)

    var visited = visited
    visited.insert(instanceID)

    let schemaJSON = targetCatalog?.components[type]?.schema.jsonValue ?? .object([:])
    var propertiesSchema = extractPropertiesSchema(from: schemaJSON)
    // `accessibility` comes from `ComponentCommon`, so a component schema need not declare it.
    if propertiesSchema["accessibility"] == nil {
      propertiesSchema["accessibility"] = .object([
        "$ref": .string(A2UICommonSchema.v10URI(for: "AccessibilityAttributes"))
      ])
    }

    var componentChecks: [ResolvedCheck] = []
    var preResolvedChecksByKey: [String: [ResolvedCheck]] = [:]
    for (key, val) in component.properties {
      let propSchema = propertiesSchema[key] ?? .boolean(true)
      let propType = classifySchema(propSchema)
      if propType == .checks {
        currentPropertyPath = key
        let resolved = resolveChecks(val, basePath: basePath, index: index, data: data)
        preResolvedChecksByKey[key] = resolved
        componentChecks.append(contentsOf: resolved)
      }
    }

    var resolvedProperties: [String: any Resolved] = [:]
    for (key, val) in component.properties {
      if let preResolved = preResolvedChecksByKey[key] {
        resolvedProperties[key] = preResolved
        continue
      }
      let propSchema = propertiesSchema[key] ?? .boolean(true)
      let propType = classifySchema(propSchema)

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
        checks: componentChecks
      ) {
        resolvedProperties[key] = resolvedVal
      }
    }

    return Node(
      id: instanceID,
      type: type,
      catalogID: effectiveCatalogID,
      properties: resolvedProperties
    )
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
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    checks: [ResolvedCheck] = []
  ) -> (any Resolved)? {
    let previousComponentID = currentComponentID
    let previousPropertyPath = currentPropertyPath
    currentComponentID = componentID
    currentPropertyPath = propertyKey
    defer {
      currentComponentID = previousComponentID
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
        data: data
      )
    case .componentID:
      return resolveComponentIDProperty(
        value: value,
        basePath: basePath,
        index: index,
        instanceSuffix: instanceSuffix,
        visited: visited,
        components: components,
        data: data
      )
    case .number:
      return value.doubleValue
    case .integer:
      return value.intValue
    case .standard:
      return resolveStandardProperty(
        value: value,
        schema: schema,
        basePath: basePath,
        index: index,
        instanceSuffix: instanceSuffix,
        componentID: componentID,
        propertyKey: propertyKey,
        visited: visited,
        components: components,
        data: data,
        checks: checks
      )
    }
  }

  private func resolveComponentIDProperty(
    value: JSONValue,
    basePath: String?,
    index: Int?,
    instanceSuffix: String?,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue
  ) -> (any Resolved)? {
    guard let childID = value.stringValue else { return nil }
    let effectiveSuffix = instanceSuffix ?? index.map { "\($0)" }
    let childInstanceID = effectiveSuffix.map { "\(childID)_\($0)" } ?? childID
    return resolveNode(
      definitionID: childID,
      instanceID: childInstanceID,
      basePath: basePath,
      index: index,
      instanceSuffix: effectiveSuffix,
      visited: visited,
      components: components,
      data: data
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
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    checks: [ResolvedCheck]
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
        visited: visited,
        components: components,
        data: data,
        checks: checks
      )
    }
    if let obj = value.objectValue {
      let objProps = extractPropertiesSchema(from: schema)
      if !objProps.isEmpty {
        return resolveStandardObjectProperty(
          obj: obj,
          objProps: objProps,
          basePath: basePath,
          index: index,
          instanceSuffix: instanceSuffix,
          componentID: componentID,
          propertyKey: propertyKey,
          visited: visited,
          components: components,
          data: data,
          checks: checks
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
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    checks: [ResolvedCheck]
  ) -> (any Resolved)? {
    let itemsSchema = schema["items"] ?? .boolean(true)
    let itemType = classifySchema(itemsSchema)
    if itemType == .checks {
      return resolveChecks(rawValue, basePath: basePath, index: index, data: data)
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
        checks: checks
      ) {
        return resolved
      }
      return item == .null ? item : nil
    }
    return ResolvedArray(resolvedArray)
  }

  private func resolveStandardObjectProperty(
    obj: OrderedDictionary<String, JSONValue>,
    objProps: [String: JSONValue],
    basePath: String?,
    index: Int?,
    instanceSuffix: String?,
    componentID: String,
    propertyKey: String,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    checks: [ResolvedCheck]
  ) -> ResolvedDictionary {
    var resolvedObj: [String: any Resolved] = [:]
    let bindingKey = atLeastV10 ? "@path" : "path"
    for (k, v) in obj {
      let nestedPropSchema = objProps[k] ?? .boolean(true)
      let classified = classifySchema(nestedPropSchema)
      let nestedPropType: PropertyType =
        (classified == .standard && v.objectValue?[bindingKey] != nil)
        ? .dynamicValue : classified
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
        checks: checks
      ) {
        resolvedObj[k] = resVal
      }
    }
    return ResolvedDictionary(resolvedObj)
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
    index: Int? = nil
  ) -> JSONValue {
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
      let resolvedValue = data[absPath]?.boolValue
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
      let resolvedValue = coerceToString(data[absPath])
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
      let resolvedValue = data[absPath]?.doubleValue
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
      let resolvedValue = data[absPath]
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
      let resolvedValue = data[absPath]?.arrayValue?.compactMap { self.coerceToString($0) }
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
    let bindingKey = atLeastV10 ? "@path" : "path"

    if let dict = conditionJSON.dictionaryValue, let pathStr = dict[bindingKey]?.stringValue {
      let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
      return makePathBoundCheck(
        absPath: absPath,
        rawVal: data[absPath],
        fallbackMessage: fallbackMessage
      )
    }

    let evaluated = evaluateDynamicValue(conditionJSON, basePath: basePath, index: index)
    return makeEvaluatedCheck(
      conditionJSON: conditionJSON,
      evaluated: evaluated,
      fallbackMessage: fallbackMessage
    )
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
    fallbackMessage: String
  ) -> ResolvedCheck {
    if let evalDict = evaluated.objectValue, let valid = evalDict["valid"]?.boolValue {
      let result = parseValidationResultObject(
        evalDict,
        valid: valid,
        fallbackMessage: fallbackMessage
      )
      return ResolvedCheck(
        condition: DataBinding(identity: .literal(conditionJSON), value: valid, set: { _ in }),
        message: result.message ?? fallbackMessage,
        validationResult: result
      )
    }
    let valid = evaluated.boolValue ?? false
    let result = ValidationResult(
      valid: valid,
      code: nil,
      message: fallbackMessage,
      severity: .error
    )
    return ResolvedCheck(
      condition: DataBinding(identity: .literal(conditionJSON), value: valid, set: { _ in }),
      message: fallbackMessage,
      validationResult: result
    )
  }

  private func parseValidationResultObject(
    _ dict: OrderedDictionary<String, JSONValue>,
    valid: Bool,
    fallbackMessage: String
  ) -> ValidationResult {
    let code = dict["code"]?.stringValue
    let msg = dict["message"]?.stringValue ?? fallbackMessage
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
        eventObj: eventObj,
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
        funcCallVal: funcCallVal,
        funcCallDict: funcCallDict,
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
    eventObj: [String: JSONValue],
    checks: [ResolvedCheck],
    basePath: String?,
    index: Int?,
    componentID: String
  ) -> ResolvedAction {
    let contextDict = eventObj["context"]?.dictionaryValue
    let userMessageVal = eventObj["userMessage"]
    let initialUserMessage = userMessageVal.flatMap {
      self.evaluateDynamicValue($0, basePath: basePath, index: index).stringValue
    }
    let unresolvedIdentity = ResolvedAction.Identity.event(
      name: name,
      context: contextDict,
      userMessage: initialUserMessage
    )
    return ResolvedAction(
      identity: unresolvedIdentity,
      sourceComponentID: componentID,
      dataContextPath: basePath,
      trigger: { [weak self] in
        guard let self else { return }
        guard self.reportFailedActionChecksIfNeeded(checks, componentID: componentID) else {
          return
        }
        let resolvedContext = self.evaluateActionContext(
          contextDict,
          basePath: basePath,
          index: index
        )
        let resolvedUserMessage = userMessageVal.flatMap {
          self.evaluateDynamicValue($0, basePath: basePath, index: index).stringValue
        }
        let triggerAction = ResolvedAction(
          identity: .event(
            name: name,
            context: resolvedContext,
            userMessage: resolvedUserMessage
          ),
          sourceComponentID: componentID,
          trigger: {}
        )
        self.actionHandler?.handle(action: triggerAction, from: self.surfaceID)
      }
    )
  }

  private func makeFunctionResolvedAction(
    call: String,
    funcCallVal: JSONValue,
    funcCallDict: [String: JSONValue],
    checks: [ResolvedCheck],
    basePath: String?,
    index: Int?,
    componentID: String
  ) -> ResolvedAction {
    let argsDict = funcCallDict["args"]?.dictionaryValue
    let unresolvedIdentity = ResolvedAction.Identity.function(call: call, args: argsDict)
    return ResolvedAction(
      identity: unresolvedIdentity,
      sourceComponentID: componentID,
      dataContextPath: basePath,
      trigger: { [weak self] in
        guard let self else { return }
        guard self.reportFailedActionChecksIfNeeded(checks, componentID: componentID) else {
          return
        }
        _ = self.evaluateDynamicValue(funcCallVal, basePath: basePath, index: index)
      }
    )
  }

  private func reportFailedActionChecksIfNeeded(
    _ checks: [ResolvedCheck],
    componentID: String
  ) -> Bool {
    let failedChecks = checks.filter { !$0.isValid }
    guard !failedChecks.isEmpty else { return true }
    let errorMsg = failedChecks.map(\.message).joined(separator: ", ")
    let version = effectiveProtocolVersion ?? .v10
    actionHandler?.handle(
      error: .validationFailed(
        ValidationFailedError(
          surfaceID: surfaceID,
          path: componentID,
          message: errorMsg,
          version: version
        )
      ),
      from: surfaceID
    )
    return false
  }

  private func evaluateActionContext(
    _ contextDict: [String: JSONValue]?,
    basePath: String?,
    index: Int?
  ) -> [String: JSONValue] {
    guard let contextDict else { return [:] }
    var resolvedContext: [String: JSONValue] = [:]
    for (key, val) in contextDict {
      resolvedContext[key] = evaluateDynamicValue(val, basePath: basePath, index: index)
    }
    return resolvedContext
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
    data: JSONValue
  ) -> [Node]? {
    switch value {
    case .array(let arr):
      return resolveStaticChildList(
        arr,
        basePath: basePath,
        index: index,
        instanceSuffix: instanceSuffix,
        visited: visited,
        components: components,
        data: data
      )
    case .object(let dict):
      return resolveTemplateChildList(
        dict,
        basePath: basePath,
        instanceSuffix: instanceSuffix,
        visited: visited,
        components: components,
        data: data
      )
    default:
      return nil
    }
  }

  private func resolveStaticChildList(
    _ arr: [JSONValue],
    basePath: String?,
    index: Int?,
    instanceSuffix: String?,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue
  ) -> [Node] {
    let effectiveSuffix = instanceSuffix ?? index.map { "\($0)" }
    var resolvedNodes: [Node] = []
    for item in arr {
      guard let childID = item.stringValue else { continue }
      let childInstanceID = effectiveSuffix.map { "\(childID)_\($0)" } ?? childID
      if let childNode = resolveNode(
        definitionID: childID,
        instanceID: childInstanceID,
        basePath: basePath,
        index: index,
        instanceSuffix: effectiveSuffix,
        visited: visited,
        components: components,
        data: data
      ) {
        resolvedNodes.append(childNode)
      }
    }
    return resolvedNodes
  }

  private func resolveTemplateChildList(
    _ dict: OrderedDictionary<String, JSONValue>,
    basePath: String?,
    instanceSuffix: String?,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue
  ) -> [Node]? {
    guard
      let templateID = dict["componentId"]?.stringValue ?? dict["template"]?.stringValue,
      let pathStr = dict["path"]?.stringValue ?? dict["data"]?.stringValue
    else {
      return nil
    }
    let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
    guard let dataItems = data[absPath]?.arrayValue else {
      return []
    }
    var expandedNodes: [Node] = []
    for itemIndex in dataItems.indices {
      let itemSuffix = instanceSuffix.map { "\($0)_\(itemIndex)" } ?? "\(itemIndex)"
      let itemID = "\(templateID)_\(itemSuffix)"
      let itemBasePath = "\(absPath)/\(itemIndex)"
      if let itemNode = resolveNode(
        definitionID: templateID,
        instanceID: itemID,
        basePath: itemBasePath,
        index: itemIndex,
        instanceSuffix: itemSuffix,
        visited: visited,
        components: components,
        data: data
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
