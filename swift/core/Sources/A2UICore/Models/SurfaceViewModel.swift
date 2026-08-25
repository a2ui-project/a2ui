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
/// and an optional theme. This is a pure state container — the
/// ``MessageProcessor`` handles message parsing, validation, and
/// mutation of these models.
///
/// `SurfaceViewModel` also hosts the tree resolution logic (dynamic value
/// evaluation, action resolution, child list expansion) that will
/// eventually move to a dedicated Binder/Context layer (Phase 4).
public final class SurfaceViewModel: @unchecked Sendable, ObservableObject {

  // MARK: - Properties

  public let surfaceID: String
  public let catalogs: [String: Catalog]
  public let defaultCatalogID: String?

  /// The primary default catalog associated with this surface, if available.
  public var catalog: Catalog {
    if let defaultCatalogID, let catalog = catalogs[defaultCatalogID] {
      return catalog
    }
    return catalogs.values.first ?? Catalog(id: "empty", components: [])
  }
  public let theme: [String: JSONValue]?
  public let sendDataModel: Bool

  public let dataModel: DataModel
  public let componentsModel: SurfaceComponentsModel

  public weak var actionHandler: (any ActionHandling)?

  private var cancellables = Set<AnyCancellable>()

  /// The root node of the resolved component tree, published to the UI
  /// on the Main Thread.
  @Published public private(set) var rootNode: Node?

  // MARK: - Initialization

  public init(
    surfaceID: String,
    catalogs: [String: Catalog],
    defaultCatalogID: String? = nil,
    theme: [String: JSONValue]? = nil,
    actionHandler: (any ActionHandling)? = nil,
    sendDataModel: Bool = false
  ) {
    self.surfaceID = surfaceID
    self.catalogs = catalogs
    self.defaultCatalogID = defaultCatalogID ?? catalogs.keys.sorted().first
    self.theme = theme
    self.sendDataModel = sendDataModel
    self.actionHandler = actionHandler
    self.dataModel = DataModel()
    self.componentsModel = SurfaceComponentsModel()

    setUpSubscriptions()
  }

  public convenience init(
    surfaceID: String,
    catalogs: [Catalog],
    defaultCatalogID: String? = nil,
    theme: [String: JSONValue]? = nil,
    actionHandler: (any ActionHandling)? = nil,
    sendDataModel: Bool = false
  ) {
    let dict = Dictionary(catalogs.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    self.init(
      surfaceID: surfaceID,
      catalogs: dict,
      defaultCatalogID: defaultCatalogID ?? catalogs.first?.id,
      theme: theme,
      actionHandler: actionHandler,
      sendDataModel: sendDataModel
    )
  }

  public convenience init(
    surfaceID: String,
    catalog: Catalog,
    theme: [String: JSONValue]? = nil,
    actionHandler: (any ActionHandling)? = nil,
    sendDataModel: Bool = false
  ) {
    self.init(
      surfaceID: surfaceID,
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      theme: theme,
      actionHandler: actionHandler,
      sendDataModel: sendDataModel
    )
  }

  /// Resolves a catalog by ID, falling back to the surface default catalog if nil.
  public func getCatalog(id: String? = nil) -> Catalog? {
    let targetCatalogID = id ?? defaultCatalogID
    if let targetCatalogID, let catalog = catalogs[targetCatalogID] {
      return catalog
    }
    if id == nil {
      return catalogs.values.first
    }
    return nil
  }

  private func setUpSubscriptions() {
    Publishers.CombineLatest(componentsModel.componentsPublisher, dataModel.dataPublisher)
      .sink { [weak self] components, data in
        self?.rebuildTree(components: components, data: data)
      }
      .store(in: &cancellables)
  }

  // MARK: - Tree Rebuilding

  /// Rebuilds the node tree and publishes the new root.
  private func rebuildTree(components: [String: ComponentModel], data: JSONValue) {
    let newRoot = resolveNode(id: "root", components: components, data: data)

    // Hopping to Main Thread to update the @Published property safely
    DispatchQueue.main.async { [weak self] in
      self?.rootNode = newRoot
    }
  }

  // MARK: - Property Classification

  private enum PropertyType {
    case dynamicBoolean
    case dynamicString
    case dynamicNumber
    case dynamicValue
    case dynamicStringList
    case checks
    case action
    case childList
    case componentId
    case number
    case integer
    case standard
  }

  /// Classifies a schema property into an A2UI property type by
  /// inspecting its raw JSON representation.
  private func classifySchema(_ schemaJSON: JSONValue) -> PropertyType {
    // Check for $ref to A2UI common types.
    // Extract the last path segment (e.g., "DynamicString" from
    // "...#/$defs/DynamicString") and match exactly to avoid
    // misidentifying types like "DynamicStringList" as "DynamicString".
    if let ref = schemaJSON["$ref"]?.stringValue {
      let typeName =
        ref
        .split(separator: "/")
        .last
        .map(String.init)
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
      case "ComponentId": return .componentId
      default: break
      }
    }

    // Check oneOf subschemas (Dynamic* types use oneOf)
    if let oneOf = schemaJSON["oneOf"]?.arrayValue {
      for sub in oneOf {
        let type = classifySchema(sub)
        if type != .standard { return type }
      }
    }

    // Check anyOf subschemas
    if let anyOf = schemaJSON["anyOf"]?.arrayValue {
      for sub in anyOf {
        let type = classifySchema(sub)
        if type != .standard { return type }
      }
    }

    // Check allOf subschemas (Dynamic* FunctionCall variants use allOf)
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

    // Check type keyword for number/integer primitives
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

  /// Recursively extracts all property schemas from a component's JSON schema (including nested allOf, anyOf, oneOf).
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

  // MARK: - Node Resolution

  /// Resolves a component by ID, using the component ID as both
  /// definition and instance ID.
  private func resolveNode(
    id: String,
    basePath: String? = nil,
    components: [String: ComponentModel],
    data: JSONValue
  ) -> Node? {
    resolveNode(
      definitionID: id,
      instanceID: id,
      basePath: basePath,
      visited: [],
      components: components,
      data: data
    )
  }

  /// Resolves a component definition into a specific instance Node.
  ///
  /// - Parameter visited: The set of instance IDs already being
  ///   resolved in the current traversal. Prevents infinite recursion
  ///   on cyclic component references while allowing legitimate
  ///   data-driven recursion (e.g. a "card" component that renders
  ///   nested "card" children from array data).
  private func resolveNode(
    definitionID: String,
    instanceID: String,
    basePath: String?,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue
  ) -> Node? {
    guard !visited.contains(instanceID) else {
      // Cycle detected: this instance is already being resolved
      // higher up the call stack.
      return nil
    }

    guard let component = components[definitionID] else {
      return nil
    }

    let type = component.type
    var visited = visited
    visited.insert(instanceID)

    // Get the schema for this component type to classify properties
    let effectiveCatalogID = component.catalogID ?? defaultCatalogID
    let targetCatalog = getCatalog(id: effectiveCatalogID)
    let schema = targetCatalog?.components[type]?.schema
    let schemaJSON = schema?.jsonValue ?? .object([:])
    let propertiesSchema = extractPropertiesSchema(from: schemaJSON)

    // Pre-resolve checks if present so action handlers and views have validation context
    var componentChecks: [ResolvedCheck] = []
    for (key, val) in component.properties {
      let propSchema = propertiesSchema[key] ?? .boolean(true)
      let propType = classifySchema(propSchema)
      if propType == .checks {
        componentChecks.append(contentsOf: resolveChecks(val, basePath: basePath, data: data))
      }
    }

    var resolvedProperties: [String: any Resolved] = [:]

    for (key, val) in component.properties {
      let propSchema = propertiesSchema[key] ?? .boolean(true)
      let propType = classifySchema(propSchema)

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
    case .componentId:
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
      // Check if schema describes an array of objects or typed items
      if let itemsSchema = schema["items"], let array = value.arrayValue {
        let itemsProps = extractPropertiesSchema(from: itemsSchema)
        if !itemsProps.isEmpty {
          var resolvedElements: [any Resolved] = []
          for item in array {
            if let obj = item.objectValue {
              var resolvedObj: [String: any Resolved] = [:]
              for (itemKey, itemVal) in obj {
                let itemPropSchema = itemsProps[itemKey] ?? .boolean(true)
                let itemPropType = classifySchema(itemPropSchema)
                if let resVal = resolveProperty(
                  value: itemVal,
                  schema: itemPropSchema,
                  type: itemPropType,
                  basePath: basePath,
                  componentID: componentID,
                  propertyKey: itemKey,
                  visited: visited,
                  components: components,
                  data: data,
                  checks: checks
                ) {
                  resolvedObj[itemKey] = resVal
                }
              }
              resolvedElements.append(ResolvedDictionary(resolvedObj))
            } else {
              resolvedElements.append(item)
            }
          }
          return ResolvedArray(resolvedElements)
        } else {
          let itemPropType = classifySchema(itemsSchema)
          if itemPropType != .standard {
            var resolvedElements: [any Resolved] = []
            for item in array {
              if let resVal = resolveProperty(
                value: item,
                schema: itemsSchema,
                type: itemPropType,
                basePath: basePath,
                componentID: componentID,
                propertyKey: propertyKey,
                visited: visited,
                components: components,
                data: data,
                checks: checks
              ) {
                resolvedElements.append(resVal)
              }
            }
            return ResolvedArray(resolvedElements)
          }
        }
      }

      // Check if schema describes an object with sub-properties
      if let obj = value.objectValue {
        let objProps = extractPropertiesSchema(from: schema)
        if !objProps.isEmpty {
          var resolvedObj: [String: any Resolved] = [:]
          for (k, v) in obj {
            let nestedPropSchema = objProps[k] ?? .boolean(true)
            let classified = classifySchema(nestedPropSchema)
            let nestedPropType: PropertyType
            if classified == .standard, v.objectValue?["path"] != nil {
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

  /// Resolves a dynamic value to its current literal `JSONValue`.
  private func evaluateDynamicValue(
    _ value: JSONValue,
    basePath: String?
  ) -> JSONValue {
    let context = DataContext(
      dataModel: dataModel,
      path: basePath ?? "",
      functionHandler: self
    )
    return context.resolveDynamicValue(value)
  }

  /// Coerces a JSON value to a string according to the A2UI type conversion rules.
  ///
  /// - Strings: Returns the unwrapped string.
  /// - Numbers and Booleans: Returns their standard string representation.
  /// - Null or missing values: Returns `nil`.
  /// - Objects and Arrays: Returns the serialized JSON string.
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
    if let dict = value.dictionaryValue, let pathStr = dict["path"]?.stringValue {
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
    if let dict = value.dictionaryValue, let pathStr = dict["path"]?.stringValue {
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
    if let dict = value.dictionaryValue, let pathStr = dict["path"]?.stringValue {
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
    if let dict = value.dictionaryValue, let pathStr = dict["path"]?.stringValue {
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
    if let dict = value.dictionaryValue, let pathStr = dict["path"]?.stringValue {
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

    if let eventObj = dict["event"]?.dictionaryValue,
      let name = eventObj["name"]?.stringValue
    {
      let contextDict = eventObj["context"]?.dictionaryValue
      let unresolvedIdentity = ResolvedAction.Identity.event(
        name: name,
        context: contextDict
      )

      return ResolvedAction(
        identity: unresolvedIdentity,
        trigger: { [weak self] in
          guard let self else { return }

          // Validate checks before executing action
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
    } else if let funcCallObj = dict["functionCall"]?.dictionaryValue,
      let call = funcCallObj["call"]?.stringValue
    {
      let argsDict = funcCallObj["args"]?.dictionaryValue
      let unresolvedIdentity = ResolvedAction.Identity.function(
        call: call,
        args: argsDict
      )

      return ResolvedAction(
        identity: unresolvedIdentity,
        trigger: { [weak self] in
          guard let self else { return }

          // Validate checks before executing action
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

          var resolvedArgs: [String: JSONValue] = [:]
          if let argsDict {
            for (argKey, argVal) in argsDict {
              resolvedArgs[argKey] = self.evaluateDynamicValue(argVal, basePath: basePath)
            }
          }

          let triggerAction = ResolvedAction(
            identity: .function(call: call, args: resolvedArgs),
            trigger: {}
          )

          self.actionHandler?.handle(action: triggerAction, from: self.surfaceID)
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

        if let childNode = resolveNode(
          definitionID: templateID,
          instanceID: itemID,
          basePath: itemBasePath,
          visited: visited,
          components: components,
          data: data
        ) {
          expandedNodes.append(childNode)
        }
      }

      return expandedNodes

    default:
      return nil
    }
  }
}

// MARK: - FunctionHandler

extension SurfaceViewModel: FunctionHandler {
  public func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    let callCatalogID = catalogID ?? defaultCatalogID
    var function = getCatalog(id: callCatalogID)?.functions[name]
    if function == nil && catalogID == nil {
      for catalog in catalogs.values {
        if let matchingFunction = catalog.functions[name] {
          function = matchingFunction
          break
        }
      }
    }
    return function
  }
}
