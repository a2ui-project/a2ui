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

import Foundation
import JSONSchema
import OrderedCollections
import OrderedJSON

/// The central controller for processing server-to-client messages,
/// maintaining active surface models, validating protocol updates,
/// and dispatching client-side actions and errors.
@MainActor
public final class MessageProcessor: ObservableObject {
  /// The surface group model owning all active surfaces.
  public let surfaceGroupModel: SurfaceGroupModel

  private let catalogs: [String: AnyCatalog]
  private let validator: A2UIValidator
  private weak var actionHandler: (any ActionHandling)?
  private let errorMapper = MessageErrorMapper()

  /// Creates a new message processor with an array of catalogs.
  ///
  /// - Parameters:
  ///   - catalogs: The catalogs available to surfaces managed by this processor.
  ///   - actionHandler: An optional handler for client-side actions and errors.
  ///   - validationConfig: The validation configuration controlling strictness.
  ///     Defaults to `.relaxed` for streaming updates.
  public init(
    catalogs: [any CatalogProtocol],
    actionHandler: (any ActionHandling)? = nil,
    validationConfig: ValidationConfig = .relaxed
  ) {
    let anyCatalogs = catalogs.map { $0.eraseToAnyCatalog() }
    self.catalogs = Dictionary(
      anyCatalogs.map { ($0.id, $0) },
      uniquingKeysWith: { _, last in last }
    )
    self.validator = A2UIValidator(catalogs: anyCatalogs, config: validationConfig)
    self.actionHandler = actionHandler
    self.surfaceGroupModel = SurfaceGroupModel()
  }

  /// Creates a new message processor with a single catalog.
  ///
  /// - Parameters:
  ///   - catalog: The catalog available to surfaces managed by this processor.
  ///   - actionHandler: An optional handler for client-side actions and errors.
  ///   - validationConfig: The validation configuration controlling strictness.
  ///     Defaults to `.relaxed` for streaming updates.
  public convenience init(
    catalog: any CatalogProtocol,
    actionHandler: (any ActionHandling)? = nil,
    validationConfig: ValidationConfig = .relaxed
  ) {
    self.init(catalogs: [catalog], actionHandler: actionHandler, validationConfig: validationConfig)
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

  private func generateInlineCatalog(_ catalog: AnyCatalog) -> JSONValue {
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

  private func mostSpecificError(from error: ValidationError) -> ValidationError {
    if let nestedErrors = error.errors, let firstNested = nestedErrors.first {
      return mostSpecificError(from: firstNested)
    }
    return error
  }

  // MARK: - Private Validation & Processing

  private func validateAndProcess(_ message: ServerToClientMessage) throws {
    switch message {
    case .createSurface(let msg):
      try processCreateSurface(msg)
    case .updateComponents(let msg):
      try processUpdateComponents(msg)
    case .updateDataModel(let msg):
      try processUpdateDataModel(msg)
    case .deleteSurface(let msg):
      try processDeleteSurface(msg)
    }
  }

  private func processCreateSurface(_ msg: CreateSurfaceMessage) throws {
    guard surfaceGroupModel.surfacesMap[msg.surfaceID] == nil else {
      throw A2UIIntegrityError(
        "Surface \(msg.surfaceID) already exists.",
        details: [
          A2UIErrorDetail(
            path: "createSurface.surfaceId",
            code: "SURFACE_EXISTS",
            message: "Surface \(msg.surfaceID) already exists."
          )
        ]
      )
    }
    guard let catalog = catalogs[msg.catalogID] else {
      throw A2UICatalogError(
        "Catalog not found: \(msg.catalogID)",
        details: [
          A2UIErrorDetail(
            path: "createSurface.catalogId",
            code: "CATALOG_NOT_FOUND",
            message: "Catalog not found: \(msg.catalogID)"
          )
        ]
      )
    }

    try validateSurfaceTheme(msg.theme, against: catalog)

    let vm = SurfaceViewModel(
      surfaceID: msg.surfaceID,
      catalogs: catalogs.isEmpty ? [catalog.id: catalog] : catalogs,
      defaultCatalogID: catalog.id,
      theme: msg.theme,
      actionHandler: actionHandler,
      sendDataModel: msg.shouldSendDataModel
    )
    surfaceGroupModel.addSurface(vm)
  }

  private func validateSurfaceTheme(
    _ theme: [String: JSONValue]?,
    against catalog: AnyCatalog
  ) throws {
    guard let theme, let themeSchema = catalog.themeSchema else { return }

    let themeInstance: JSONValue = .object(
      OrderedDictionary(uniqueKeysWithValues: theme)
    )
    let result = themeSchema.validate(themeInstance)
    guard !result.isValid else { return }

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
    throw A2UIValidationError(
      errorMessage,
      details: [
        A2UIErrorDetail(
          path: errorPath,
          code: "THEME_VALIDATION_FAILED",
          message: errorMessage
        )
      ]
    )
  }

  private func processUpdateComponents(_ msg: UpdateComponentsMessage) throws {
    guard let surface = surfaceGroupModel.surfacesMap[msg.surfaceID] else {
      throw A2UIIntegrityError(
        "Surface not found: \(msg.surfaceID)",
        details: [
          A2UIErrorDetail(
            path: "updateComponents.surfaceId",
            code: "SURFACE_NOT_FOUND",
            message: "Surface not found: \(msg.surfaceID)"
          )
        ]
      )
    }

    try validateComponentsBatch(msg.components, on: surface)
    applyComponentsBatch(msg.components, to: surface)
  }

  private func processUpdateDataModel(_ msg: UpdateDataModelMessage) throws {
    guard let surface = surfaceGroupModel.surfacesMap[msg.surfaceID] else {
      throw A2UIIntegrityError(
        "Surface not found: \(msg.surfaceID)",
        details: [
          A2UIErrorDetail(
            path: "updateDataModel.surfaceId",
            code: "SURFACE_NOT_FOUND",
            message: "Surface not found: \(msg.surfaceID)"
          )
        ]
      )
    }
    surface.dataModel.set(msg.path, value: msg.value)
  }

  private func processDeleteSurface(_ msg: DeleteSurfaceMessage) throws {
    guard surfaceGroupModel.surfacesMap[msg.surfaceID] != nil else {
      throw A2UIIntegrityError(
        "Surface not found: \(msg.surfaceID)",
        details: [
          A2UIErrorDetail(
            path: "deleteSurface.surfaceId",
            code: "SURFACE_NOT_FOUND",
            message: "Surface not found: \(msg.surfaceID)"
          )
        ]
      )
    }
    surfaceGroupModel.removeSurface(id: msg.surfaceID)
  }

  private func validateComponentsBatch(
    _ components: [[String: JSONValue]],
    on surface: SurfaceViewModel
  ) throws {
    for componentDict in components {
      guard let type = componentDict["component"]?.stringValue else {
        throw A2UIValidationError(
          "Missing required key 'component'",
          details: [
            A2UIErrorDetail(
              path: "/component",
              code: "MISSING_PROPERTY",
              message: "Missing required key 'component'"
            )
          ]
        )
      }

      guard let id = componentDict["id"]?.stringValue else {
        throw A2UIValidationError(
          "Missing required key 'id'",
          details: [
            A2UIErrorDetail(
              path: "/id",
              code: "MISSING_PROPERTY",
              message: "Missing required key 'id'"
            )
          ]
        )
      }

      let componentCatalogID =
        componentDict["catalogId"]?.stringValue ?? surface.defaultCatalogID
      guard let targetCatalog = surface.getCatalog(id: componentCatalogID) else {
        throw A2UICatalogError(
          "Catalog not found: \(componentCatalogID)",
          details: [
            A2UIErrorDetail(
              path: "/catalogId",
              code: "CATALOG_NOT_FOUND",
              message: "Catalog not found: \(componentCatalogID)"
            )
          ]
        )
      }

      guard let schema = targetCatalog.components[type]?.schema else {
        throw A2UICatalogError(
          "Unknown component type '\(type)' not registered in catalog",
          details: [
            A2UIErrorDetail(
              path: "/component",
              code: "UNKNOWN_COMPONENT",
              message: "Unknown component type '\(type)' not registered in catalog"
            )
          ]
        )
      }

      let instance: JSONValue = .object(
        OrderedDictionary(uniqueKeysWithValues: componentDict.map { ($0.key, $0.value) })
      )
      let result = schema.validate(instance)
      guard result.isValid else {
        let specificError = result.errors?.first.map(mostSpecificError(from:))
        let errorMessage = specificError?.message ?? "Validation failed"
        let errorPath = specificError?.instanceLocation.jsonPointerString ?? "/"
        throw A2UIValidationError(
          errorMessage,
          details: [
            A2UIErrorDetail(
              path: errorPath.isEmpty ? "/" : errorPath,
              code: "SCHEMA_VALIDATION_FAILED",
              message: errorMessage
            )
          ]
        )
      }
    }

    if !components.isEmpty {
      try GraphTopologyValidator.validate(
        components: components,
        rootID: "root",
        config: validator.config
      )
    }
  }

  private func applyComponentsBatch(
    _ components: [[String: JSONValue]],
    to surface: SurfaceViewModel
  ) {
    for componentDict in components {
      guard let type = componentDict["component"]?.stringValue,
        let id = componentDict["id"]?.stringValue
      else {
        continue
      }
      let componentCatalogID =
        componentDict["catalogId"]?.stringValue ?? surface.defaultCatalogID

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
        ComponentModel(
          id: id,
          type: type,
          catalogID: componentCatalogID,
          properties: props
        )
      )
    }
  }
}
