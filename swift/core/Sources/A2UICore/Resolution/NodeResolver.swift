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
  public let protocolVersion: String?

  /// Identifies a render-time expression error for de-duplication across tree passes.
  private struct ExpressionErrorKey: Hashable {
    let componentID: String
    let basePath: String
    let propertyKey: String
    let functionName: String
    let message: String
    /// Counts identical failures earlier in the same pass, e.g. two check rules
    /// or two arguments calling the same missing function.
    let occurrence: Int
  }

  /// The component property being resolved, used to scope render-time expression errors.
  private var resolutionScope: (componentID: String, basePath: String, propertyKey: String)?
  private var isResolvingTree = false
  private var isFlushingErrors = false
  private var pendingErrors: [ClientServerError] = []
  /// Expression errors reported by the previous tree pass, suppressed while they persist.
  private var reportedExpressionErrors: Set<ExpressionErrorKey> = []
  /// Expression errors raised so far by the tree pass in progress.
  private var currentPassExpressionErrors: Set<ExpressionErrorKey> = []

  public var isV10: Bool {
    guard let version = protocolVersion else { return false }
    let core = version.hasPrefix("v") ? String(version.dropFirst()) : version
    guard let major = Int(core.split(separator: ".").first ?? "") else { return false }
    return major >= 1
  }

  /// The primary default catalog associated with this resolver.
  public var catalog: AnyCatalog {
    if let defaultCatalogID, let catalog = catalogs[defaultCatalogID] {
      return catalog
    }
    return catalogs.values.first ?? Catalog(id: "empty", components: [])
  }

  // MARK: - Initialization

  public init(
    surfaceID: String,
    catalogs: [String: AnyCatalog],
    defaultCatalogID: String? = nil,
    componentsModel: SurfaceComponentsModel? = nil,
    dataModel: DataModel? = nil,
    actionHandler: (any ActionHandling)? = nil,
    protocolVersion: String? = nil
  ) {
    self.surfaceID = surfaceID
    self.catalogs = catalogs
    self.defaultCatalogID = defaultCatalogID ?? catalogs.keys.sorted().first
    self.componentsModel = componentsModel ?? SurfaceComponentsModel()
    self.dataModel = dataModel ?? DataModel()
    self.actionHandler = actionHandler
    self.protocolVersion = protocolVersion
  }

  public convenience init(
    surface: SurfaceViewModel,
    actionHandler: (any ActionHandling)? = nil,
    protocolVersion: String? = nil
  ) {
    self.init(
      surfaceID: surface.surfaceID,
      catalogs: surface.catalogs,
      defaultCatalogID: surface.defaultCatalogID,
      componentsModel: surface.componentsModel,
      dataModel: surface.dataModel,
      actionHandler: actionHandler ?? surface.actionHandler,
      protocolVersion: protocolVersion ?? surface.protocolVersion
    )
  }

  public convenience init(
    surfaceID: String,
    catalogs: [any CatalogProtocol],
    defaultCatalogID: String? = nil,
    componentsModel: SurfaceComponentsModel? = nil,
    dataModel: DataModel? = nil,
    actionHandler: (any ActionHandling)? = nil,
    protocolVersion: String? = nil
  ) {
    let anyCatalogs = catalogs.map { $0.eraseToAnyCatalog() }
    let dict = Dictionary(anyCatalogs.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    self.init(
      surfaceID: surfaceID,
      catalogs: dict,
      defaultCatalogID: defaultCatalogID ?? catalogs.first?.id,
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
    if let targetCatalogID, let catalog = catalogs[targetCatalogID] {
      return catalog
    }
    if id == nil {
      return catalogs.values.first
    }
    return nil
  }

  // MARK: - Tree Resolution

  /// Resolves the component tree starting from the root component ("root")
  /// using the stored component and data models.
  ///
  /// Expression errors raised while resolving are dispatched to the action
  /// handler once the tree is resolved.
  public func resolveTree() -> Node? {
    let root = resolveTreeDeferringErrors()
    flushPendingErrors()
    return root
  }

  /// Resolves the tree, queueing expression errors until ``flushPendingErrors()``.
  ///
  /// An error handler may synchronously mutate the data model, which triggers
  /// another rebuild. Deferring dispatch lets the caller publish the new root
  /// first, so a nested rebuild never races a half-published tree.
  ///
  /// Unlike web_core, which reports on every evaluation, and Dart, which reports
  /// whenever a binding recomputes, a render-time error is dispatched once per
  /// failure while it persists across passes, and again if it recovers and then
  /// recurs. A failure is identified by component instance, path, property,
  /// function, message, and its occurrence among identical failures in the pass,
  /// so repeated identical failures in one property are each reported once.
  /// Swift re-resolves the whole tree on every change, so reporting on every
  /// pass would repeat unchanged failures.
  func resolveTreeDeferringErrors() -> Node? {
    isResolvingTree = true
    currentPassExpressionErrors = []
    defer {
      isResolvingTree = false
      reportedExpressionErrors = currentPassExpressionErrors
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

  /// Dispatches queued errors to the action handler.
  ///
  /// Reentrant calls return immediately; the outermost call drains errors
  /// queued by handlers that trigger further rebuilds.
  func flushPendingErrors() {
    guard !isFlushingErrors else { return }
    isFlushingErrors = true
    defer { isFlushingErrors = false }
    while !pendingErrors.isEmpty {
      let error = pendingErrors.removeFirst()
      actionHandler?.handle(error: error, from: surfaceID)
    }
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

    let type = component.type
    let effectiveCatalogID = component.catalogID ?? defaultCatalogID
    let targetCatalog = getCatalog(id: effectiveCatalogID)

    var visited = visited
    visited.insert(instanceID)

    let outerScope = resolutionScope
    defer { resolutionScope = outerScope }

    let schemaJSON = targetCatalog?.components[type]?.schema.jsonValue ?? .object([:])
    let propertiesSchema = extractPropertiesSchema(from: schemaJSON)

    // Checks are resolved first so actions can gate on them, and only once per
    // pass so each failing condition is evaluated, and reported, a single time.
    var componentChecks: [ResolvedCheck] = []
    var resolvedChecksByKey: [String: [ResolvedCheck]] = [:]
    for (key, val) in component.properties {
      let propSchema = propertiesSchema[key] ?? .boolean(true)
      let propType = classifySchema(propSchema)
      if propType == .checks {
        resolutionScope = (componentID: instanceID, basePath: basePath ?? "", propertyKey: key)
        let checks = resolveChecks(val, basePath: basePath, data: data)
        resolvedChecksByKey[key] = checks
        componentChecks.append(contentsOf: checks)
      }
    }

    var resolvedProperties: [String: any Resolved] = [:]
    for (key, val) in component.properties {
      if let checks = resolvedChecksByKey[key] {
        resolvedProperties[key] = checks
        continue
      }
      let propSchema = propertiesSchema[key] ?? .boolean(true)
      let propType = classifySchema(propSchema)
      resolutionScope = (componentID: instanceID, basePath: basePath ?? "", propertyKey: key)

      if let resolvedVal = resolveProperty(
        value: val,
        schema: propSchema,
        type: propType,
        basePath: basePath,
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
      case "ComponentId": return .componentID
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
      if let def = A2UICommonSchema.document["$defs"]?.objectValue?[typeName] {
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
    componentID: String,
    propertyKey: String,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    checks: [ResolvedCheck] = []
  ) -> (any Resolved)? {
    switch type {
    case .dynamicBoolean:
      return resolveDynamicBoolean(value, basePath: basePath, data: data)
    case .dynamicString:
      return resolveDynamicString(value, basePath: basePath, data: data)
    case .dynamicNumber:
      return resolveDynamicNumber(value, basePath: basePath, data: data)
    case .dynamicValue:
      return resolveDynamicValueBinding(value, basePath: basePath, data: data)
    case .dynamicStringList:
      return resolveDynamicStringList(value, basePath: basePath, data: data)
    case .checks:
      return resolveChecks(value, basePath: basePath, data: data)
    case .action:
      return resolveAction(
        value,
        checks: checks,
        basePath: basePath,
        componentID: componentID,
        data: data
      )
    case .childList:
      return resolveChildList(
        value,
        basePath: basePath,
        componentID: componentID,
        propertyKey: propertyKey,
        visited: visited,
        components: components,
        data: data
      )
    case .componentID:
      guard let childID = value.stringValue else { return nil }
      return resolveNode(
        definitionID: childID,
        instanceID: childID,
        basePath: basePath,
        visited: visited,
        components: components,
        data: data
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
          return resolveChecks(value, basePath: basePath, data: data)
        }
        let resolvedArray = array.compactMap { item in
          if let resolved = resolveProperty(
            value: item,
            schema: itemsSchema,
            type: itemType,
            basePath: basePath,
            componentID: componentID,
            propertyKey: propertyKey,
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

      if let obj = value.objectValue {
        let objProps = extractPropertiesSchema(from: schema)
        if !objProps.isEmpty {
          var resolvedObj: [String: any Resolved] = [:]
          for (k, v) in obj {
            let nestedPropSchema = objProps[k] ?? .boolean(true)
            let classified = classifySchema(nestedPropSchema)
            let nestedPropType: PropertyType
            let bindingKey = isV10 ? "@path" : "path"
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
              componentID: componentID,
              propertyKey: k,
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
    basePath: String?
  ) -> JSONValue {
    let context = DataContext(
      dataModel: dataModel,
      path: basePath ?? "",
      functionHandler: self,
      protocolVersion: protocolVersion
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
    data: JSONValue
  ) -> DataBinding<Bool> {
    let bindingKey = isV10 ? "@path" : "path"
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
    let resolvedValue = evaluateDynamicValue(value, basePath: basePath).boolValue
    return DataBinding<Bool>(
      identity: .literal(value),
      value: resolvedValue,
      set: { _ in }
    )
  }

  private func resolveDynamicString(
    _ value: JSONValue,
    basePath: String?,
    data: JSONValue
  ) -> DataBinding<String> {
    let bindingKey = isV10 ? "@path" : "path"
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
    let evaluated = evaluateDynamicValue(value, basePath: basePath)
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
    data: JSONValue
  ) -> DataBinding<Double> {
    let bindingKey = isV10 ? "@path" : "path"
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
    let resolvedValue = evaluateDynamicValue(value, basePath: basePath).doubleValue
    return DataBinding<Double>(
      identity: .literal(value),
      value: resolvedValue,
      set: { _ in }
    )
  }

  private func resolveDynamicValueBinding(
    _ value: JSONValue,
    basePath: String?,
    data: JSONValue
  ) -> DataBinding<JSONValue> {
    let bindingKey = isV10 ? "@path" : "path"
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
    let resolvedValue = evaluateDynamicValue(value, basePath: basePath)
    return DataBinding<JSONValue>(
      identity: .literal(value),
      value: resolvedValue,
      set: { _ in }
    )
  }

  private func resolveDynamicStringList(
    _ value: JSONValue,
    basePath: String?,
    data: JSONValue
  ) -> DataBinding<[String]> {
    let bindingKey = isV10 ? "@path" : "path"
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
    let resolvedValue = evaluateDynamicValue(value, basePath: basePath).arrayValue?.compactMap {
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
    data: JSONValue
  ) -> [ResolvedCheck] {
    if let array = value.arrayValue {
      return array.compactMap { ruleJSON in
        guard let ruleDict = ruleJSON.dictionaryValue else { return nil }
        let conditionJSON = ruleDict["condition"] ?? ruleJSON
        let message = ruleDict["message"]?.stringValue ?? "Validation failed"
        let condition = resolveDynamicBoolean(conditionJSON, basePath: basePath, data: data)
        return ResolvedCheck(condition: condition, message: message)
      }
    } else if let ruleDict = value.dictionaryValue {
      let conditionJSON = ruleDict["condition"] ?? value
      let message = ruleDict["message"]?.stringValue ?? "Validation failed"
      let condition = resolveDynamicBoolean(conditionJSON, basePath: basePath, data: data)
      return [ResolvedCheck(condition: condition, message: message)]
    }
    return []
  }

  // MARK: - Action Resolution

  private func resolveAction(
    _ value: JSONValue,
    checks: [ResolvedCheck] = [],
    basePath: String?,
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

    let funcCallVal: JSONValue?
    if let wrapped = value["functionCall"], wrapped.dictionaryValue != nil {
      funcCallVal = wrapped
    } else if dict["call"]?.stringValue != nil {
      funcCallVal = value
    } else {
      funcCallVal = nil
    }

    if let eventObj, let name = eventObj["name"]?.stringValue {
      let contextDict = eventObj["context"]?.dictionaryValue
      let unresolvedIdentity = ResolvedAction.Identity.event(
        name: name,
        context: contextDict
      )

      return ResolvedAction(
        identity: unresolvedIdentity,
        trigger: { [weak self] in
          guard let self else { return }

          let failedChecks = checks.filter { !$0.isValid }
          if !failedChecks.isEmpty {
            let errorMsg = failedChecks.map(\.message).joined(separator: ", ")
            self.actionHandler?.handle(
              error: .validationFailed(
                ValidationFailedError(
                  surfaceID: self.surfaceID, path: componentID, message: errorMsg)
              ),
              from: self.surfaceID
            )
            return
          }

          var resolvedContext: [String: JSONValue] = [:]
          if let contextDict {
            for (key, val) in contextDict {
              resolvedContext[key] = self.evaluateDynamicValue(val, basePath: basePath)
            }
          }

          let triggerAction = ResolvedAction(
            identity: .event(name: name, context: resolvedContext),
            trigger: {}
          )

          self.actionHandler?.handle(action: triggerAction, from: self.surfaceID)
        }
      )
    } else if let funcCallVal, let funcCallDict = funcCallVal.dictionaryValue,
      let call = funcCallDict["call"]?.stringValue
    {
      let argsDict = funcCallDict["args"]?.dictionaryValue
      let unresolvedIdentity = ResolvedAction.Identity.function(
        call: call,
        args: argsDict
      )

      return ResolvedAction(
        identity: unresolvedIdentity,
        trigger: { [weak self] in
          guard let self else { return }

          let failedChecks = checks.filter { !$0.isValid }
          if !failedChecks.isEmpty {
            let errorMsg = failedChecks.map(\.message).joined(separator: ", ")
            self.actionHandler?.handle(
              error: .validationFailed(
                ValidationFailedError(
                  surfaceID: self.surfaceID, path: componentID, message: errorMsg)
              ),
              from: self.surfaceID
            )
            return
          }

          _ = self.evaluateDynamicValue(funcCallVal, basePath: basePath)
        }
      )
    }

    return nil
  }

  // MARK: - Child List Resolution

  private func resolveChildList(
    _ value: JSONValue,
    basePath: String?,
    componentID: String,
    propertyKey: String,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue
  ) -> [Node]? {
    switch value {
    case .array(let arr):
      var resolvedNodes: [Node] = []
      for item in arr {
        guard let childID = item.stringValue else { continue }
        if let childNode = resolveNode(
          definitionID: childID,
          instanceID: childID,
          basePath: basePath,
          visited: visited,
          components: components,
          data: data
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

      guard let dataListVal = data[absPath],
        let dataItems = dataListVal.arrayValue
      else {
        return []
      }

      var expandedNodes: [Node] = []

      for (index, _) in dataItems.enumerated() {
        let itemID = "\(templateID)_\(index)"
        let itemBasePath = "\(absPath)/\(index)"

        if let itemNode = resolveNode(
          definitionID: templateID,
          instanceID: itemID,
          basePath: itemBasePath,
          visited: visited,
          components: components,
          data: data
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
    let callCatalogID = catalogID ?? defaultCatalogID
    var targetFunction = getCatalog(id: callCatalogID)?.functions[name]
    if targetFunction == nil && catalogID == nil {
      for catalog in catalogs.values {
        if let matchingFunction = catalog.functions[name] {
          targetFunction = matchingFunction
          break
        }
      }
    }
    return targetFunction
  }

  public func reportExpressionError(functionName: String, catalogID: String?, error: Error?) {
    let resolvedCatalogID = catalogID ?? defaultCatalogID ?? ""
    let message: String
    if let error {
      if let a2uiError = error as? any A2UIError {
        message = a2uiError.message
      } else if let description = (error as? any LocalizedError)?.errorDescription {
        message = description
      } else {
        message = String(describing: error)
      }
    } else {
      message = "Function not found in catalog '\(resolvedCatalogID)': \(functionName)"
    }

    let report = ClientServerError.generic(
      GenericError(
        code: "EXPRESSION_ERROR",
        surfaceID: surfaceID,
        message: message,
        expression: functionName
      )
    )

    guard isResolvingTree else {
      // Evaluated outside a tree pass, e.g. by a triggered action: report every time.
      pendingErrors.append(report)
      flushPendingErrors()
      return
    }

    if let resolutionScope {
      var occurrence = 0
      var key: ExpressionErrorKey
      repeat {
        key = ExpressionErrorKey(
          componentID: resolutionScope.componentID,
          basePath: resolutionScope.basePath,
          propertyKey: resolutionScope.propertyKey,
          functionName: functionName,
          message: message,
          occurrence: occurrence
        )
        occurrence += 1
      } while currentPassExpressionErrors.contains(key)
      currentPassExpressionErrors.insert(key)
      guard !reportedExpressionErrors.contains(key) else { return }
    }
    pendingErrors.append(report)
  }
}
