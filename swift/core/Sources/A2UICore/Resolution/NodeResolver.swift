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
    componentsModel: SurfaceComponentsModel = SurfaceComponentsModel(),
    dataModel: DataModel = DataModel(),
    actionHandler: (any ActionHandling)? = nil
  ) {
    self.surfaceID = surfaceID
    self.catalogs = catalogs
    self.defaultCatalogID = defaultCatalogID ?? catalogs.keys.sorted().first
    self.componentsModel = componentsModel
    self.dataModel = dataModel
    self.actionHandler = actionHandler
  }

  public convenience init(
    surface: SurfaceViewModel,
    actionHandler: (any ActionHandling)? = nil
  ) {
    self.init(
      surfaceID: surface.surfaceID,
      catalogs: surface.catalogs,
      defaultCatalogID: surface.defaultCatalogID,
      componentsModel: surface.componentsModel,
      dataModel: surface.dataModel,
      actionHandler: actionHandler ?? surface.actionHandler
    )
  }

  public convenience init(
    surfaceID: String,
    catalogs: [any CatalogProtocol],
    defaultCatalogID: String? = nil,
    componentsModel: SurfaceComponentsModel = SurfaceComponentsModel(),
    dataModel: DataModel = DataModel(),
    actionHandler: (any ActionHandling)? = nil
  ) {
    let anyCatalogs = catalogs.map { $0.eraseToAnyCatalog() }
    let dict = Dictionary(anyCatalogs.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    self.init(
      surfaceID: surfaceID,
      catalogs: dict,
      defaultCatalogID: defaultCatalogID ?? catalogs.first?.id,
      componentsModel: componentsModel,
      dataModel: dataModel,
      actionHandler: actionHandler
    )
  }

  // MARK: - Catalog Lookup

  /// Resolves a catalog by ID, falling back to the default catalog.
  public func getCatalog(id: String? = nil) -> AnyCatalog? {
    let targetCatalogID = id ?? defaultCatalogID
    if let targetCatalogID {
      if let catalog = catalogs[targetCatalogID] {
        return catalog
      }
      if let catalog = catalogs.values.first(where: {
        $0.id.hasSuffix("/\(targetCatalogID)/catalog.json")
          && $0.isV10
      }) {
        return catalog
      }
      if let catalog = catalogs.values.first(where: {
        $0.id.hasSuffix("/\(targetCatalogID)/catalog.json")
      }) {
        return catalog
      }
    }
    if id == nil {
      return catalogs.values.first
    }
    return nil
  }

  // MARK: - Tree Resolution

  /// Resolves the component tree starting from the root component ("root")
  /// using the stored component and data models.
  public func resolveTree() -> Node? {
    resolveNode(
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

    let schemaJSON = targetCatalog?.components[type]?.schema.jsonValue ?? .object([:])
    let propertiesSchema = extractPropertiesSchema(from: schemaJSON)

    var componentChecks: [ResolvedCheck] = []
    for (key, val) in component.properties {
      let propSchema = propertiesSchema[key] ?? .boolean(true)
      let propType = classifySchema(propSchema)
      if propType == .checks {
        componentChecks.append(
          contentsOf: resolveChecks(val, basePath: basePath, index: index, data: data)
        )
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
        index: index,
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
    index: Int? = nil,
    componentID: String,
    propertyKey: String,
    visited: Set<String>,
    components: [String: ComponentModel],
    data: JSONValue,
    checks: [ResolvedCheck] = []
  ) -> (any Resolved)? {
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
        componentID: componentID,
        propertyKey: propertyKey,
        visited: visited,
        components: components,
        data: data
      )
    case .componentID:
      guard let childID = value.stringValue else { return nil }
      let childInstanceID = (index != nil) ? "\(childID)_\(index!)" : childID
      return resolveNode(
        definitionID: childID,
        instanceID: childInstanceID,
        basePath: basePath,
        index: index,
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
          return resolveChecks(value, basePath: basePath, index: index, data: data)
        }
        let resolvedArray = array.compactMap { item in
          if let resolved = resolveProperty(
            value: item,
            schema: itemsSchema,
            type: itemType,
            basePath: basePath,
            index: index,
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
              index: index,
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
    basePath: String?,
    index: Int? = nil
  ) -> JSONValue {
    let context = DataContext(
      dataModel: dataModel,
      path: basePath ?? "",
      functionHandler: self,
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

      if let dict = conditionJSON.dictionaryValue, let pathStr = dict["path"]?.stringValue {
        let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
        let rawVal = data[absPath]
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
              resolvedContext[key] = self.evaluateDynamicValue(
                val, basePath: basePath, index: index)
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
              resolvedArgs[argKey] = self.evaluateDynamicValue(
                argVal, basePath: basePath, index: index)
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
    index: Int? = nil,
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
        let childInstanceID = index.map { "\(childID)_\($0)" } ?? childID
        if let childNode = resolveNode(
          definitionID: childID,
          instanceID: childInstanceID,
          basePath: basePath,
          index: index,
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
          index: index,
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
}
