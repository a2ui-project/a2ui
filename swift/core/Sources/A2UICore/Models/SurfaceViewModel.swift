// Copyright 2026 Google LLC
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
  public let catalog: Catalog

  public let dataModel: DataModel
  public let componentsModel: SurfaceComponentsModel

  public weak var actionHandler: (any ActionHandling)?

  private let lock = NSRecursiveLock()
  private var activeTheme: (any SurfaceTheme)?

  /// The root node of the resolved component tree, published to the UI
  /// on the Main Thread.
  @Published public private(set) var rootNode: Node?

  // MARK: - Initialization

  public init(
    surfaceID: String,
    catalog: Catalog,
    actionHandler: (any ActionHandling)? = nil
  ) {
    self.surfaceID = surfaceID
    self.catalog = catalog
    self.actionHandler = actionHandler
    self.dataModel = DataModel()
    self.componentsModel = SurfaceComponentsModel()
  }

  // MARK: - Theme

  /// Updates the active surface theme and triggers a tree rebuild.
  public func updateTheme(_ theme: any SurfaceTheme) {
    lock.withLock {
      activeTheme = theme
    }
    rebuildTree()
  }

  /// Retrieves a thread-safe copy of the active theme.
  public func getActiveTheme() -> (any SurfaceTheme)? {
    lock.withLock { activeTheme }
  }

  // MARK: - Tree Rebuilding

  /// Rebuilds the node tree and publishes the new root.
  func rebuildTree() {
    let newRoot = resolveNode(id: "root")

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
    case action
    case childList
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
      let typeName = ref
        .split(separator: "/")
        .last
        .map(String.init)
      switch typeName {
      case "DynamicBoolean": return .dynamicBoolean
      case "DynamicString": return .dynamicString
      case "DynamicNumber": return .dynamicNumber
      case "DynamicValue": return .dynamicValue
      case "Action": return .action
      case "ChildList": return .childList
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

    return .standard
  }

  // MARK: - Node Resolution

  /// Resolves a component by ID, using the component ID as both
  /// definition and instance ID.
  func resolveNode(id: String, basePath: String? = nil) -> Node? {
    resolveNode(definitionID: id, instanceID: id, basePath: basePath, visited: [])
  }

  /// Resolves a component definition into a specific instance Node.
  ///
  /// - Parameter visited: The set of instance IDs already being
  ///   resolved in the current traversal. Prevents infinite recursion
  ///   on cyclic component references while allowing legitimate
  ///   data-driven recursion (e.g. a "card" component that renders
  ///   nested "card" children from array data).
  func resolveNode(
    definitionID: String,
    instanceID: String,
    basePath: String?,
    visited: Set<String>
  ) -> Node? {
    guard !visited.contains(instanceID) else {
      // Cycle detected: this instance is already being resolved
      // higher up the call stack.
      return nil
    }

    guard let component = componentsModel.get(definitionID) else {
      return nil
    }

    let type = component.type
    var visited = visited
    visited.insert(instanceID)

    // Get the schema for this component type to classify properties
    let schema = catalog.components[type]?.schema
    let schemaJSON = schema?.jsonValue ?? .object([:])
    let propertiesSchema = schemaJSON["properties"]?.objectValue

    var resolvedProperties: [String: any Resolved] = [:]

    for (key, val) in component.properties {
      let propSchema = propertiesSchema?[key] ?? .boolean(true)
      let propType = classifySchema(propSchema)

      if let resolvedVal = resolveProperty(
        value: val,
        type: propType,
        basePath: basePath,
        componentID: instanceID,
        propertyKey: key,
        visited: visited
      ) {
        resolvedProperties[key] = resolvedVal
      }
    }

    return Node(id: instanceID, type: type, properties: resolvedProperties)
  }

  private func resolveProperty(
    value: JSONValue,
    type: PropertyType,
    basePath: String?,
    componentID: String,
    propertyKey: String,
    visited: Set<String>
  ) -> (any Resolved)? {
    switch type {
    case .dynamicBoolean:
      return resolveDynamicBoolean(value, basePath: basePath)
    case .dynamicString:
      return resolveDynamicString(value, basePath: basePath)
    case .dynamicNumber:
      return resolveDynamicNumber(value, basePath: basePath)
    case .dynamicValue:
      return resolveDynamicValueBinding(value, basePath: basePath)
    case .action:
      return resolveAction(value, basePath: basePath, componentID: componentID)
    case .childList:
      return resolveChildList(
        value,
        basePath: basePath,
        componentID: componentID,
        propertyKey: propertyKey,
        visited: visited
      )
    case .standard:
      return value
    }
  }

  // MARK: - Dynamic Value Evaluation

  /// Resolves a dynamic value to its current literal `JSONValue`.
  func evaluateDynamicValue(
    _ value: JSONValue,
    basePath: String?
  ) -> JSONValue {
    switch value {
    case .object(let dict):
      if let pathStr = dict["path"]?.stringValue {
        let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
        return dataModel.get(absPath) ?? .null
      } else if let callName = dict["call"]?.stringValue {
        guard let function = catalog.functions[callName] else {
          return .null
        }
        var resolvedArgs: [String: JSONValue] = [:]
        if let argsObj = dict["args"]?.dictionaryValue {
          for (argKey, argVal) in argsObj {
            resolvedArgs[argKey] = evaluateDynamicValue(argVal, basePath: basePath)
          }
        }
        do {
          return try function.evaluate(arguments: resolvedArgs)
        } catch {
          return .null
        }
      }
      return value
    default:
      return value
    }
  }

  // MARK: - Dynamic Type-Specific Resolvers

  private func resolveDynamicBoolean(
    _ value: JSONValue,
    basePath: String?
  ) -> DataBinding<Bool> {
    if let dict = value.dictionaryValue, let pathStr = dict["path"]?.stringValue {
      let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
      return DataBinding<Bool>(
        identity: .path(absPath),
        get: { [weak self] in
          guard let self else { return false }
          return self.lock.withLock {
            self.dataModel.get(absPath)?.boolValue ?? false
          }
        },
        set: { [weak self] newValue in
          guard let self else { return }
          self.lock.withLock {
            self.dataModel.set(absPath, value: .boolean(newValue))
          }
          self.rebuildTree()
        }
      )
    }
    return DataBinding<Bool>(
      identity: .literal(value),
      get: { [weak self] in
        guard let self else { return value.boolValue ?? false }
        return self.lock.withLock {
          self.evaluateDynamicValue(value, basePath: basePath).boolValue ?? false
        }
      },
      set: { _ in }
    )
  }

  private func resolveDynamicString(
    _ value: JSONValue,
    basePath: String?
  ) -> DataBinding<String> {
    if let dict = value.dictionaryValue, let pathStr = dict["path"]?.stringValue {
      let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
      return DataBinding<String>(
        identity: .path(absPath),
        get: { [weak self] in
          guard let self else { return "" }
          return self.lock.withLock {
            self.dataModel.get(absPath)?.stringValue ?? ""
          }
        },
        set: { [weak self] newValue in
          guard let self else { return }
          self.lock.withLock {
            self.dataModel.set(absPath, value: .string(newValue))
          }
          self.rebuildTree()
        }
      )
    }
    return DataBinding<String>(
      identity: .literal(value),
      get: { [weak self] in
        guard let self else { return value.stringValue ?? "" }
        return self.lock.withLock {
          self.evaluateDynamicValue(value, basePath: basePath).stringValue ?? ""
        }
      },
      set: { _ in }
    )
  }

  private func resolveDynamicNumber(
    _ value: JSONValue,
    basePath: String?
  ) -> DataBinding<Double> {
    if let dict = value.dictionaryValue, let pathStr = dict["path"]?.stringValue {
      let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
      return DataBinding<Double>(
        identity: .path(absPath),
        get: { [weak self] in
          guard let self else { return 0.0 }
          return self.lock.withLock {
            self.dataModel.get(absPath)?.doubleValue ?? 0.0
          }
        },
        set: { [weak self] newValue in
          guard let self else { return }
          self.lock.withLock {
            self.dataModel.set(absPath, value: .number(newValue))
          }
          self.rebuildTree()
        }
      )
    }
    return DataBinding<Double>(
      identity: .literal(value),
      get: { [weak self] in
        guard let self else { return value.doubleValue ?? 0.0 }
        return self.lock.withLock {
          self.evaluateDynamicValue(value, basePath: basePath).doubleValue ?? 0.0
        }
      },
      set: { _ in }
    )
  }

  private func resolveDynamicValueBinding(
    _ value: JSONValue,
    basePath: String?
  ) -> DataBinding<JSONValue> {
    if let dict = value.dictionaryValue, let pathStr = dict["path"]?.stringValue {
      let absPath = JSONValue.absolutePath(for: pathStr, in: basePath)
      return DataBinding<JSONValue>(
        identity: .path(absPath),
        get: { [weak self] in
          guard let self else { return .null }
          return self.lock.withLock {
            self.dataModel.get(absPath) ?? .null
          }
        },
        set: { [weak self] newValue in
          guard let self else { return }
          self.lock.withLock {
            self.dataModel.set(absPath, value: newValue)
          }
          self.rebuildTree()
        }
      )
    }
    return DataBinding<JSONValue>(
      identity: .literal(value),
      get: { [weak self] in
        guard let self else { return value }
        return self.lock.withLock {
          self.evaluateDynamicValue(value, basePath: basePath)
        }
      },
      set: { _ in }
    )
  }

  // MARK: - Action Resolution

  private func resolveAction(
    _ value: JSONValue,
    basePath: String?,
    componentID: String
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
          var resolvedContext: [String: JSONValue] = [:]
          if let contextDict {
            self.lock.withLock {
              for (key, val) in contextDict {
                resolvedContext[key] = self.evaluateDynamicValue(
                  val,
                  basePath: basePath
                )
              }
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
          var resolvedArgs: [String: JSONValue] = [:]
          if let argsDict {
            self.lock.withLock {
              for (key, val) in argsDict {
                resolvedArgs[key] = self.evaluateDynamicValue(
                  val,
                  basePath: basePath
                )
              }
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
    visited: Set<String>
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
          visited: visited
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

      guard let dataListVal = dataModel.get(absPath),
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
          visited: visited
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
