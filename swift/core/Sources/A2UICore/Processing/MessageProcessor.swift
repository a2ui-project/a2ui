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

import Combine
import Foundation
import JSONSchema
import OrderedCollections
import OrderedJSON

/// The central processor for A2UI server-to-client messages.
///
/// Mirrors `MessageProcessor` in the core blueprint and `web_core`.
/// Accepts strongly-typed ``ServerToClientMessage`` values,
/// validates component declarations against catalog schemas, and mutates
/// the corresponding ``SurfaceViewModel`` state via ``SurfaceGroupModel``.
@MainActor
public final class MessageProcessor: ObservableObject {
  /// The surface group model owning all active surfaces.
  public let surfaceGroupModel: SurfaceGroupModel

  private let catalogs: [String: Catalog]
  private weak var actionHandler: (any ActionHandling)?
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

  /// Returns the aggregated data model for surfaces with `sendDataModel` enabled.
  public func getRendererDataModel() -> JSONValue? {
    var result: OrderedDictionary<String, JSONValue> = [:]
    for (surfaceID, vm) in surfaceGroupModel.surfacesMap {
      if vm.sendDataModel {
        result[surfaceID] = vm.dataModel.data
      }
    }
    guard !result.isEmpty else { return nil }
    return .object(result)
  }

  // MARK: - Capabilities Generation

  /// Options for generating client capabilities.
  public struct CapabilitiesOptions: Sendable {
    /// If true, full definitions of all catalogs will be included as inline catalogs.
    public var includeInlineCatalogs: Bool

    /// The protocol version to generate capabilities for.
    public var version: String

    /// Creates a capabilities option instance with an explicit protocol version.
    ///
    /// - Parameters:
    ///   - includeInlineCatalogs: Whether to include inline catalog definitions.
    ///   - version: The protocol version string (e.g., "v0.9.1").
    public init(
      includeInlineCatalogs: Bool = false,
      version: String
    ) {
      self.includeInlineCatalogs = includeInlineCatalogs
      self.version = version
    }

    /// Creates a capabilities option instance defaulting to protocol version "v0.9.1".
    ///
    /// - Parameter includeInlineCatalogs: Whether to include inline catalog definitions.
    @available(
      *,
      deprecated,
      message: "Specify the protocol version explicitly using init(includeInlineCatalogs:version:)"
    )
    public init(
      includeInlineCatalogs: Bool = false
    ) {
      self.includeInlineCatalogs = includeInlineCatalogs
      self.version = "v0.9.1"
    }
  }

  /// Generates the `a2uiClientCapabilities` object for all registered catalogs.
  ///
  /// - Parameter options: Configuration options for capability generation.
  /// - Returns: A `JSONValue` representing the capabilities structure.
  public func getRendererCapabilities(
    options: CapabilitiesOptions
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

  /// Generates `a2uiClientCapabilities` using default options for protocol version "v0.9.1".
  ///
  /// - Returns: A `JSONValue` representing the capabilities structure.
  @available(
    *,
    deprecated,
    message: "Specify capabilities options explicitly using getRendererCapabilities(options:)"
  )
  public func getRendererCapabilities() -> JSONValue {
    getRendererCapabilities(
      options: CapabilitiesOptions(includeInlineCatalogs: false, version: "v0.9.1")
    )
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

  // MARK: - Message Processing

  /// Processes a single server-to-client message.
  ///
  /// Any validation or lifecycle errors are mapped via `MessageErrorMapper`
  /// and reported to `ActionHandling`.
  public func process(message: ServerToClientMessage) {
    do {
      try validateAndProcess(message)
    } catch {
      let surfaceID = extractSurfaceID(from: error, fallback: message.surfaceID)
      let clientError = errorMapper.map(error, surfaceID: surfaceID)
      actionHandler?.handle(error: clientError, from: surfaceID)
    }
  }

  /// Processes an array of server-to-client messages.
  ///
  /// Any validation or lifecycle errors are mapped via `MessageErrorMapper`
  /// and reported to `ActionHandling`.
  public func process(messages: [ServerToClientMessage]) {
    for message in messages {
      process(message: message)
    }
  }

  private func extractSurfaceID(from error: Error, fallback: String) -> String {
    if let validationError = error as? ValidationFailedError {
      return validationError.surfaceID
    }
    if let genericError = error as? GenericError {
      return genericError.surfaceID
    }
    return fallback
  }

  // MARK: - Private Surface Mutations & Validation

  private func createSurface(
    surfaceID: String,
    catalogID: String,
    theme: [String: JSONValue]? = nil,
    sendDataModel: Bool = false
  ) throws -> SurfaceViewModel? {
    guard let catalog = catalogs[catalogID] else { return nil }
    return try createSurface(
      surfaceID: surfaceID,
      catalog: catalog,
      theme: theme,
      sendDataModel: sendDataModel
    )
  }

  private func mostSpecificError(from error: ValidationError) -> ValidationError {
    if let nestedErrors = error.errors, let firstNested = nestedErrors.first {
      return mostSpecificError(from: firstNested)
    }
    return error
  }

  @discardableResult
  private func createSurface(
    surfaceID: String,
    catalog: Catalog,
    theme: [String: JSONValue]? = nil,
    sendDataModel: Bool = false
  ) throws -> SurfaceViewModel {
    if let theme, let themeSchema = catalog.themeSchema {
      let themeInstance: JSONValue = .object(
        OrderedDictionary(uniqueKeysWithValues: theme)
      )
      let result = themeSchema.validate(themeInstance)
      if !result.isValid {
        let specificError = result.errors?.first.map(mostSpecificError(from:))
        let errorMessage = specificError?.message ?? "Theme validation failed"
        let subpath = specificError?.instanceLocation.jsonPointerString ?? ""
        let errorPath: String
        if subpath.isEmpty || subpath == "/" {
          errorPath = "/theme"
        } else if subpath.hasPrefix("/") {
          errorPath = "/theme\(subpath)"
        } else {
          errorPath = "/theme/\(subpath)"
        }
        let error = ValidationFailedError(
          surfaceID: surfaceID,
          path: errorPath,
          message: errorMessage
        )
        throw error
      }
    }
    let vm = SurfaceViewModel(
      surfaceID: surfaceID,
      catalogs: catalogs.isEmpty ? [catalog.id: catalog] : catalogs,
      defaultCatalogID: catalog.id,
      theme: theme,
      actionHandler: actionHandler,
      sendDataModel: sendDataModel
    )
    surfaceGroupModel.addSurface(vm)
    return vm
  }

  private func deleteSurface(_ surfaceID: String) {
    surfaceGroupModel.removeSurface(id: surfaceID)
  }

  private func updateComponents(
    surfaceID: String,
    components: [[String: JSONValue]]
  ) {
    guard let surface = surfaceGroupModel.surfacesMap[surfaceID] else {
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

    // Pass 1: Validation Pass
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
        return
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
        return
      }

      let componentCatalogID = componentDict["catalogId"]?.stringValue ?? surface.defaultCatalogID
      let targetCatalog = surface.getCatalog(id: componentCatalogID)
      guard let schema = targetCatalog?.components[type]?.schema else {
        let error = ClientServerError.validationFailed(
          ValidationFailedError(
            surfaceID: surfaceID,
            path: "/component",
            message: "Unknown component type '\(type)' not registered in catalog"
          )
        )
        actionHandler?.handle(error: error, from: surfaceID)
        return
      }

      let instance: JSONValue = .object(
        OrderedDictionary(
          uniqueKeysWithValues: componentDict.map { ($0.key, $0.value) }
        )
      )
      let result = schema.validate(instance)
      guard result.isValid else {
        let specificError = result.errors?.first.map(mostSpecificError(from:))
        let errorMessage = specificError?.message ?? "Validation failed"
        let errorPath = specificError?.instanceLocation.jsonPointerString ?? "/"
        let error = ClientServerError.validationFailed(
          ValidationFailedError(
            surfaceID: surfaceID,
            path: errorPath.isEmpty ? "/" : errorPath,
            message: errorMessage
          )
        )
        actionHandler?.handle(error: error, from: surfaceID)
        return
      }
    }

    // Pass 2: Mutation Pass
    for componentDict in components {
      guard let type = componentDict["component"]?.stringValue,
        let id = componentDict["id"]?.stringValue
      else {
        continue
      }
      let componentCatalogID = componentDict["catalogId"]?.stringValue ?? surface.defaultCatalogID

      var props: [String: JSONValue] = [:]
      for (key, val) in componentDict
      where key != "id" && key != "component" && key != "catalogId" {
        props[key] = val
      }

      let existing = surface.componentsModel.get(id)
      if let existing, existing.type != type {
        surface.componentsModel.removeComponent(id)
      }
      surface.componentsModel.addComponent(
        ComponentModel(id: id, type: type, catalogID: componentCatalogID, properties: props)
      )
    }
  }

  private func updateDataModel(
    surfaceID: String,
    path: String,
    value: JSONValue?
  ) {
    guard let surface = surfaceGroupModel.surfacesMap[surfaceID] else {
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
  }

  // MARK: - Private Validation & Processing

  private func validateAndProcess(_ message: ServerToClientMessage) throws {
    switch message {
    case .createSurface(let msg):
      guard surfaceGroupModel.surfacesMap[msg.surfaceID] == nil else {
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
      try createSurface(
        surfaceID: msg.surfaceID,
        catalog: catalog,
        theme: msg.theme,
        sendDataModel: msg.shouldSendDataModel
      )

    case .updateComponents(let msg):
      guard surfaceGroupModel.surfacesMap[msg.surfaceID] != nil else {
        let error = GenericError(
          code: "SURFACE_NOT_FOUND",
          surfaceID: msg.surfaceID,
          message: "Surface not found: \(msg.surfaceID)"
        )
        throw error
      }
      updateComponents(surfaceID: msg.surfaceID, components: msg.components)

    case .updateDataModel(let msg):
      guard surfaceGroupModel.surfacesMap[msg.surfaceID] != nil else {
        let error = GenericError(
          code: "SURFACE_NOT_FOUND",
          surfaceID: msg.surfaceID,
          message: "Surface not found: \(msg.surfaceID)"
        )
        throw error
      }
      updateDataModel(surfaceID: msg.surfaceID, path: msg.path, value: msg.value)

    case .deleteSurface(let msg):
      guard surfaceGroupModel.surfacesMap[msg.surfaceID] != nil else {
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
