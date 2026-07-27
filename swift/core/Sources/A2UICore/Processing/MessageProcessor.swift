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
import JSONSchema
import OrderedCollections
import OrderedJSON

/// The central processor for A2UI server-to-client messages.
///
/// Mirrors `MessageProcessor` in the core blueprint and `web_core`.
/// Accepts strongly-typed ``ServerToClientMessage`` values or raw JSON lines,
///// The central processor for A2UI server-to-client messages.
///
/// Mirrors `MessageProcessor` in the core blueprint and `web_core`.
/// Accepts strongly-typed ``ServerToClientMessage`` values or raw JSON lines,
/// validates component declarations against catalog schemas, and mutates
/// the corresponding ``SurfaceViewModel`` state via ``SurfaceGroupModel``.
@MainActor
public final class MessageProcessor: ObservableObject {
  /// The surface group model owning all active surfaces.
  public let surfaceGroupModel: SurfaceGroupModel

  private let catalogs: [String: Catalog]
  private weak var actionHandler: (any ActionHandling)?
  private let parser = MessageParser()
  private let errorMapper = MessageErrorMapper()

  /// Creates a new message processor with an array of catalogs.
  public init(
    catalogs: [Catalog],
    actionHandler: (any ActionHandling)? = nil
  ) {
    self.catalogs = Dictionary(
      catalogs.map { ($0.id, $0) },
      uniquingKeysWith: { _, last in last }
    )
    self.actionHandler = actionHandler
    self.surfaceGroupModel = SurfaceGroupModel()
  }

  /// Creates a new message processor with a dictionary of catalogs.
  public init(
    catalogs: [String: Catalog],
    actionHandler: (any ActionHandling)? = nil
  ) {
    self.catalogs = catalogs
    self.actionHandler = actionHandler
    self.surfaceGroupModel = SurfaceGroupModel()
  }

  // MARK: - Surface Lookup & Management

  /// Returns the surface model for the given ID, if it exists.
  public func getSurface(_ id: String) -> SurfaceViewModel? {
    surfaceGroupModel.surface(id: id)
  }

  /// Creates a surface using a catalog ID lookup.
  public func createSurface(
    surfaceID: String,
    catalogID: String
  ) -> SurfaceViewModel? {
    guard let catalog = catalogs[catalogID] else { return nil }
    return createSurface(surfaceID: surfaceID, catalog: catalog)
  }

  /// Creates a surface directly with a given catalog instance.
  @discardableResult
  public func createSurface(
    surfaceID: String,
    catalog: Catalog
  ) -> SurfaceViewModel {
    let vm = SurfaceViewModel(
      surfaceID: surfaceID,
      catalog: catalog,
      actionHandler: actionHandler
    )
    surfaceGroupModel.addSurface(vm)
    return vm
  }

  /// Deletes the surface with the given ID.
  public func deleteSurface(_ surfaceID: String) {
    surfaceGroupModel.removeSurface(id: surfaceID)
  }

  /// Returns a snapshot of all active surfaces.
  public func allSurfaces() -> [String: SurfaceViewModel] {
    surfaceGroupModel.allSurfaces()
  }

  /// Returns the aggregated data model for surfaces with `sendDataModel` enabled.
  public func getClientDataModel() -> JSONValue? {
    surfaceGroupModel.getClientDataModel()
  }

  // MARK: - Capabilities Generation

  /// Options for generating client capabilities.
  public struct CapabilitiesOptions: Sendable {
    /// If true, full definitions of all catalogs will be included as inline catalogs.
    public var includeInlineCatalogs: Bool

    /// The protocol version to generate capabilities for (defaults to "v0.9.1").
    public var version: String

    public init(
      includeInlineCatalogs: Bool = false,
      version: String = "v0.9.1"
    ) {
      self.includeInlineCatalogs = includeInlineCatalogs
      self.version = version
    }
  }

  /// Generates the `a2uiClientCapabilities` object for all registered catalogs.
  ///
  /// - Parameter options: Configuration options for capability generation.
  /// - Returns: A `JSONValue` representing the capabilities structure.
  public func getClientCapabilities(
    options: CapabilitiesOptions = CapabilitiesOptions()
  ) -> JSONValue {
    let supportedCatalogIDs = Array(catalogs.keys).sorted()
    var versionCaps: OrderedDictionary<String, JSONValue> = [
      "supportedCatalogIds": .array(supportedCatalogIDs.map { .string($0) })
    ]

    if options.includeInlineCatalogs {
      let inlineCatalogs = catalogs.values.map { generateInlineCatalog($0) }
      versionCaps["inlineCatalogs"] = .array(inlineCatalogs)
    }

    return .object([
      options.version: .object(versionCaps)
    ])
  }

  private func generateInlineCatalog(_ catalog: Catalog) -> JSONValue {
    var componentsDictionary: OrderedDictionary<String, JSONValue> = [:]

    for (name, componentAPI) in catalog.components {
      let schemaJSON = schemaToJSONValue(componentAPI.schema) ?? .object([:])
      let processedSchema = processRefs(schemaJSON)

      var properties: OrderedDictionary<String, JSONValue> = [
        "component": .object(["const": .string(name)])
      ]
      var required: [JSONValue] = [.string("component")]

      if let originalProperties = processedSchema["properties"]?.objectValue {
        for (key, value) in originalProperties {
          properties[key] = value
        }
      }
      if let originalRequired = processedSchema["required"]?.arrayValue {
        for requiredProperty in originalRequired {
          if !required.contains(requiredProperty) {
            required.append(requiredProperty)
          }
        }
      }

      let componentSchema: JSONValue = .object([
        "allOf": .array([
          .object(["$ref": .string("common_types.json#/$defs/ComponentCommon")]),
          .object([
            "properties": .object(properties),
            "required": .array(required),
          ]),
        ])
      ])
      componentsDictionary[name] = componentSchema
    }

    var functionsArray: [JSONValue] = []
    for (_, functionImplementation) in catalog.functions {
      let functionAPI = functionImplementation.api
      let schemaJSON = schemaToJSONValue(functionAPI.schema) ?? .object([:])
      let processedParameters = processRefs(schemaJSON)

      var functionDictionary: OrderedDictionary<String, JSONValue> = [
        "name": .string(functionAPI.name),
        "returnType": .string(functionAPI.returnType.rawValue),
      ]
      if let functionDescription = processedParameters["description"]?.stringValue {
        functionDictionary["description"] = .string(functionDescription)
      }
      functionDictionary["parameters"] = processedParameters
      functionsArray.append(.object(functionDictionary))
    }

    var catalogDictionary: OrderedDictionary<String, JSONValue> = [
      "catalogId": .string(catalog.id),
      "components": .object(componentsDictionary),
    ]
    if !functionsArray.isEmpty {
      catalogDictionary["functions"] = .array(functionsArray)
    }

    if let themeSchema = catalog.themeSchema {
      let schemaJSON = schemaToJSONValue(themeSchema) ?? .object([:])
      let processedTheme = processRefs(schemaJSON)
      if let themeProperties = processedTheme["properties"] {
        catalogDictionary["theme"] = themeProperties
      } else {
        catalogDictionary["theme"] = processedTheme
      }
    }

    return .object(catalogDictionary)
  }

  private func schemaToJSONValue(_ schema: Schema) -> JSONValue? {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(schema),
      let json = try? JSONValue.parse(data)
    else {
      return nil
    }
    return json
  }

  private func processRefs(_ value: JSONValue) -> JSONValue {
    switch value {
    case .object(let dict):
      if let desc = dict["description"]?.stringValue, desc.hasPrefix("REF:") {
        let parts = desc.dropFirst(4).split(separator: "|")
        let refPart = parts.first.map(String.init) ?? ""
        let customDescription = parts.count > 1 ? String(parts[1]) : nil
        var resultDict: OrderedDictionary<String, JSONValue> = ["$ref": .string(refPart)]
        if let customDescription, !customDescription.isEmpty {
          resultDict["description"] = .string(customDescription)
        }
        return .object(resultDict)
      }
      var newDict: OrderedDictionary<String, JSONValue> = [:]
      for (k, v) in dict {
        newDict[k] = processRefs(v)
      }
      return .object(newDict)

    case .array(let arr):
      return .array(arr.map { processRefs($0) })

    default:
      return value
    }
  }

  // MARK: - Message Processing (JSONL Line)

  /// Processes a single JSONL line containing an incoming message envelope.
  ///
  /// Throws on any failure (decoding error, missing surface, missing catalog).
  /// Thrown parsing errors are also routed to `ActionHandling` via `MessageErrorMapper`.
  public func process(line: String) throws {
    let surfaceID = parser.extractSurfaceID(fromLine: line) ?? "unknown"
    do {
      let message = try parser.parse(jsonString: line)
      try validateAndProcess(message)
    } catch {
      let clientError = errorMapper.map(error, surfaceID: surfaceID)
      actionHandler?.handle(error: clientError, from: surfaceID)
      throw error
    }
  }

  // MARK: - Message Processing (Strongly-Typed)

  /// Processes a single server-to-client message.
  public func processMessage(_ message: ServerToClientMessage) {
    do {
      try validateAndProcess(message)
    } catch {
      let surfaceID: String
      switch message {
      case .createSurface(let msg): surfaceID = msg.surfaceID
      case .updateComponents(let msg): surfaceID = msg.surfaceID
      case .updateDataModel(let msg): surfaceID = msg.surfaceID
      case .deleteSurface(let msg): surfaceID = msg.surfaceID
      }
      let clientError = errorMapper.map(error, surfaceID: surfaceID)
      actionHandler?.handle(error: clientError, from: surfaceID)
    }
  }

  /// Processes an array of server-to-client messages.
  public func processMessages(_ messages: [ServerToClientMessage]) {
    for message in messages {
      processMessage(message)
    }
  }

  // MARK: - Direct Surface Mutations & Validation

  /// Updates components on a surface, validating each against the catalog's schema.
  public func updateComponents(
    surfaceID: String,
    components: [[String: JSONValue]]
  ) {
    guard let surface = surfaceGroupModel.surface(id: surfaceID) else {
      let error = ClientServerError.generic(
        GenericError(
          code: "SURFACE_NOT_FOUND",
          surfaceID: surfaceID,
          message: "Surface not found: \(surfaceID)"
        )
      )
      actionHandler?.handle(error: error, from: surfaceID)
      return
    }

    for componentDict in components {
      guard let type = componentDict["component"]?.stringValue else {
        let error = ClientServerError.validationFailed(
          ValidationFailedError(
            surfaceID: surfaceID,
            path: "/component",
            message: "Missing required key 'component'"
          )
        )
        actionHandler?.handle(error: error, from: surfaceID)
        continue
      }

      guard let id = componentDict["id"]?.stringValue else {
        let error = ClientServerError.validationFailed(
          ValidationFailedError(
            surfaceID: surfaceID,
            path: "/id",
            message: "Missing required key 'id'"
          )
        )
        actionHandler?.handle(error: error, from: surfaceID)
        continue
      }

      guard let schema = surface.catalog.components[type]?.schema else {
        let error = ClientServerError.validationFailed(
          ValidationFailedError(
            surfaceID: surfaceID,
            path: "/component",
            message: "Unknown component type '\(type)' not registered in catalog"
          )
        )
        actionHandler?.handle(error: error, from: surfaceID)
        continue
      }

      let instance: JSONValue = .object(
        OrderedDictionary(
          uniqueKeysWithValues: componentDict.map { ($0.key, $0.value) }
        )
      )
      let result = schema.validate(instance)

      if result.isValid {
        var props: [String: JSONValue] = [:]
        for (key, val) in componentDict where key != "id" && key != "component" {
          props[key] = val
        }

        let existing = surface.componentsModel.get(id)
        if existing != nil && existing?.type != type {
          // Component type changed: recreate component to reset state
          surface.componentsModel.removeComponent(id)
          surface.componentsModel.addComponent(
            ComponentModel(id: id, type: type, properties: props)
          )
        } else {
          surface.componentsModel.addComponent(
            ComponentModel(id: id, type: type, properties: props)
          )
        }
      } else {
        let errorMessage = result.errors?.first?.message ?? "Validation failed"
        let errorPath = result.errors?.first?.instanceLocation.jsonPointerString ?? "/"
        let error = ClientServerError.validationFailed(
          ValidationFailedError(
            surfaceID: surfaceID,
            path: errorPath,
            message: errorMessage
          )
        )
        actionHandler?.handle(error: error, from: surfaceID)
      }
    }

    surface.rebuildTree()
  }

  /// Updates a path in a surface's data model.
  public func updateDataModel(
    surfaceID: String,
    path: String,
    value: JSONValue?
  ) {
    guard let surface = surfaceGroupModel.surface(id: surfaceID) else {
      let error = ClientServerError.generic(
        GenericError(
          code: "SURFACE_NOT_FOUND",
          surfaceID: surfaceID,
          message: "Surface not found: \(surfaceID)"
        )
      )
      actionHandler?.handle(error: error, from: surfaceID)
      return
    }
    surface.dataModel.set(path, value: value)
    surface.rebuildTree()
  }

  // MARK: - Private Validation & Processing

  private func validateAndProcess(_ message: ServerToClientMessage) throws {
    switch message {
    case .createSurface(let msg):
      guard surfaceGroupModel.surface(id: msg.surfaceID) == nil else {
        let error = GenericError(
          code: "SURFACE_EXISTS",
          surfaceID: msg.surfaceID,
          message: "Surface \(msg.surfaceID) already exists."
        )
        throw error
      }
      guard let catalog = catalogs[msg.catalogID] else {
        let error = GenericError(
          code: "CATALOG_NOT_FOUND",
          surfaceID: msg.surfaceID,
          message: "Catalog not found: \(msg.catalogID)"
        )
        throw error
      }
      let vm = SurfaceViewModel(
        surfaceID: msg.surfaceID,
        catalog: catalog,
        actionHandler: actionHandler
      )
      if msg.shouldSendDataModel {
        surfaceGroupModel.setSendDataModel(surfaceID: msg.surfaceID, enabled: true)
      }
      surfaceGroupModel.addSurface(vm)

    case .updateComponents(let msg):
      guard surfaceGroupModel.surface(id: msg.surfaceID) != nil else {
        let error = GenericError(
          code: "SURFACE_NOT_FOUND",
          surfaceID: msg.surfaceID,
          message: "Surface not found: \(msg.surfaceID)"
        )
        throw error
      }
      updateComponents(surfaceID: msg.surfaceID, components: msg.components)

    case .updateDataModel(let msg):
      guard surfaceGroupModel.surface(id: msg.surfaceID) != nil else {
        let error = GenericError(
          code: "SURFACE_NOT_FOUND",
          surfaceID: msg.surfaceID,
          message: "Surface not found: \(msg.surfaceID)"
        )
        throw error
      }
      updateDataModel(surfaceID: msg.surfaceID, path: msg.path, value: msg.value)

    case .deleteSurface(let msg):
      guard surfaceGroupModel.surface(id: msg.surfaceID) != nil else {
        let error = GenericError(
          code: "SURFACE_NOT_FOUND",
          surfaceID: msg.surfaceID,
          message: "Surface not found: \(msg.surfaceID)"
        )
        throw error
      }
      surfaceGroupModel.removeSurface(id: msg.surfaceID)
    }
  }
}
