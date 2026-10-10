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

  /// Listener for outbound messages destined to the agent.
  public var outboundListener: (@Sendable (RendererToAgentMessage) -> Void)?

  /// The validation configuration controlling strictness.
  public let validationConfig: ValidationConfig

  let rpcHandler: RPCHandler
  private let registeredCatalogs: [AnyCatalog]
  private let catalogs: [String: AnyCatalog]
  private weak var actionHandler: (any ActionHandling)?
  private let actionForwarder = ProcessorActionForwarder()
  private let errorMapper = MessageErrorMapper()
  private let adapterFactory: VersionAdapterFactory
  private var activeRPCTasks: [String: Task<Void, Never>] = [:]
  private var payloadValidators: [String: PayloadValidator] = [:]

  /// Creates a new message processor with an array of catalogs.
  ///
  /// - Parameters:
  ///   - catalogs: The catalogs available to surfaces managed by this processor.
  ///   - actionHandler: An optional handler for client-side actions and errors.
  ///   - validationConfig: The validation configuration controlling strictness.
  ///     Defaults to `.relaxed` for streaming updates.
  ///   - adapterFactory: Optional version adapter factory. Defaults to `.shared`.
  public init(
    catalogs: [any CatalogProtocol],
    actionHandler: (any ActionHandling)? = nil,
    validationConfig: ValidationConfig = .relaxed,
    adapterFactory: VersionAdapterFactory = .shared
  ) {
    let anyCatalogs = catalogs.map { $0.eraseToAnyCatalog() }
    var uniqueCatalogs: [AnyCatalog] = []
    var catalogMap: [String: AnyCatalog] = [:]
    for cat in anyCatalogs {
      if catalogMap[cat.id] == nil {
        uniqueCatalogs.append(cat)
      }
      catalogMap[cat.id] = cat
    }
    self.registeredCatalogs = uniqueCatalogs
    self.catalogs = catalogMap
    self.validationConfig = validationConfig
    self.actionHandler = actionHandler
    self.surfaceGroupModel = SurfaceGroupModel()
    self.rpcHandler = RPCHandler()
    self.adapterFactory = adapterFactory
    self.actionForwarder.processor = self
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

  /// Returns the aggregated data model for active surfaces with `sendDataModel` enabled.
  ///
  /// - If `version` is provided, returns data models only for surfaces compatible with that
  ///   protocol version.
  /// - If `version` is omitted (`nil`), automatically derives the protocol version from the active
  ///   surfaces with `sendDataModel` enabled, or throws `A2UIValidationError` if active surfaces
  ///   have conflicting protocol versions.
  ///
  /// - Parameter version: Optional target protocol version to filter surfaces.
  /// - Returns: A `JSONValue` containing `"version"` and `"surfaces"`, or `nil` if no matching
  ///   surfaces have `sendDataModel` enabled.
  public func getRendererDataModel(
    version: A2UIProtocolVersion? = nil
  ) throws -> JSONValue? {
    let enabledEntries = surfaceGroupModel.surfacesMap
      .filter { $0.value.sendDataModel }
      .sorted { $0.key < $1.key }
    guard !enabledEntries.isEmpty else { return nil }

    if let version {
      var surfacesDict: OrderedDictionary<String, JSONValue> = [:]
      for (surfaceID, vm) in enabledEntries {
        if areVersionsCompatible(vm.protocolVersion, version)
          && isCatalogCompatible(vm.catalog, with: version)
        {
          surfacesDict[surfaceID] = vm.dataModel.data
        }
      }
      guard !surfacesDict.isEmpty else { return nil }
      return .object([
        "version": .string(version.rawValue),
        "surfaces": .object(surfacesDict),
      ])
    }

    let versionsSet = Set(enabledEntries.map(\.value.protocolVersion))
    if versionsSet.count > 1 {
      let sortedVersions = versionsSet.map(\.rawValue).sorted().joined(separator: ", ")
      throw A2UIValidationError(
        "Multiple protocol versions detected among active surfaces: \(sortedVersions). "
          + "Specify a target protocol version in getRendererDataModel(version:)."
      )
    }

    let inferredVersion = enabledEntries.first?.value.protocolVersion ?? .v10
    var surfacesDict: OrderedDictionary<String, JSONValue> = [:]
    for (surfaceID, vm) in enabledEntries {
      surfacesDict[surfaceID] = vm.dataModel.data
    }
    return .object([
      "version": .string(inferredVersion.rawValue),
      "surfaces": .object(surfacesDict),
    ])
  }

  /// Returns the data model for a specific surface ID, if it exists.
  public func getRendererDataModel(surfaceID: String) -> JSONValue? {
    surfaceGroupModel[surfaceID]?.dataModel.data
  }

  // MARK: - Capabilities Generation

  /// Options for generating renderer capabilities.
  public struct CapabilitiesOptions: Sendable {
    /// Protocol versions to generate capabilities for. Must contain at least one version.
    public var versions: [A2UIProtocolVersion]

    /// If true, full definitions of all catalogs will be included as inline catalogs.
    public var includeInlineCatalogs: Bool

    /// Optional JSON Schema `$ref` used as the base envelope for inline component schemas.
    public var componentEnvelopeRef: String?

    /// Creates a capabilities option instance with explicit protocol versions.
    ///
    /// - Parameters:
    ///   - versions: Protocol versions to generate capabilities for (must not be empty).
    ///   - includeInlineCatalogs: Whether to include inline catalog definitions.
    ///   - componentEnvelopeRef: Optional JSON Schema `$ref` for component envelopes.
    public init(
      versions: [A2UIProtocolVersion],
      includeInlineCatalogs: Bool = false,
      componentEnvelopeRef: String? = nil
    ) {
      self.versions = versions
      self.includeInlineCatalogs = includeInlineCatalogs
      self.componentEnvelopeRef = componentEnvelopeRef
    }

    /// Creates a capabilities option instance with a single `A2UIProtocolVersion`.
    ///
    /// - Parameters:
    ///   - protocolVersion: The `A2UIProtocolVersion` enum case.
    ///   - includeInlineCatalogs: Whether to include inline catalog definitions.
    ///   - componentEnvelopeRef: Optional JSON Schema `$ref` for component envelopes.
    public init(
      protocolVersion: A2UIProtocolVersion,
      includeInlineCatalogs: Bool = false,
      componentEnvelopeRef: String? = nil
    ) {
      self.versions = [protocolVersion]
      self.includeInlineCatalogs = includeInlineCatalogs
      self.componentEnvelopeRef = componentEnvelopeRef
    }
  }

  /// Generates the `a2uiRendererCapabilities` / `a2uiClientCapabilities` object for all
  /// registered catalogs across the requested protocol versions.
  ///
  /// - Parameter options: Configuration options for capability generation.
  /// - Returns: A `JSONValue` representing the capabilities structure keyed by protocol version.
  /// - Throws: `A2UIValidationError` if `options.versions` is empty.
  public func getRendererCapabilities(
    options: CapabilitiesOptions
  ) throws -> JSONValue {
    guard !options.versions.isEmpty else {
      throw A2UIValidationError(
        "At least one protocol version must be provided in CapabilitiesOptions "
          + "to generate renderer capabilities."
      )
    }

    var result: OrderedDictionary<String, JSONValue> = [:]
    for version in options.versions {
      let compatibleCatalogs = registeredCatalogs.filter {
        isCatalogCompatible($0, with: version)
      }
      let supportedCatalogIDs = compatibleCatalogs.map(\.id).sorted()
      var versionCaps: OrderedDictionary<String, JSONValue> = [
        "supportedCatalogIds": .array(supportedCatalogIDs.map { .string($0) })
      ]

      if options.includeInlineCatalogs {
        let inlineCatalogs = compatibleCatalogs.map {
          generateInlineCatalog($0, for: version, options: options)
        }
        versionCaps["inlineCatalogs"] = .array(inlineCatalogs)
      }

      result[version.rawValue] = .object(versionCaps)
    }

    return .object(result)
  }

  private func generateInlineCatalog(
    _ catalog: AnyCatalog,
    for version: A2UIProtocolVersion,
    options: CapabilitiesOptions
  ) -> JSONValue {
    var componentsDictionary: OrderedDictionary<String, JSONValue> = [:]
    let envelopeRef =
      options.componentEnvelopeRef ?? "common_types.json#/$defs/ComponentCommon"

    for name in catalog.components.keys.sorted() {
      guard let componentAPI = catalog.components[name] else { continue }
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
          .object(["$ref": .string(envelopeRef)]),
          .object([
            "properties": .object(properties),
            "required": .array(required),
          ]),
        ])
      ])
      componentsDictionary[name] = componentSchema
    }

    var catalogDictionary: OrderedDictionary<String, JSONValue> = [:]
    if version.isAtLeastV10 {
      let semver =
        version.rawValue.hasPrefix("v")
        ? String(version.rawValue.dropFirst())
        : version.rawValue
      catalogDictionary["protocolVersion"] = .string(semver)
    }
    catalogDictionary["catalogId"] = .string(catalog.id)
    if !componentsDictionary.isEmpty {
      catalogDictionary["components"] = .object(componentsDictionary)
    }

    if !catalog.functions.isEmpty {
      if version.isAtLeastV10 {
        var functionsDict: OrderedDictionary<String, JSONValue> = [:]
        for key in catalog.functions.keys.sorted() {
          guard let functionImplementation = catalog.functions[key] else { continue }
          let functionAPI = functionImplementation.api
          let schemaJSON = schemaToJSONValue(functionAPI.schema) ?? .object([:])
          let processedParameters = processRefs(schemaJSON)

          var argsDict = processedParameters.objectValue ?? ["type": .string("object")]
          let functionDescription = argsDict.removeValue(forKey: "description")?.stringValue
          if argsDict["type"] == nil {
            argsDict["type"] = .string("object")
          }
          if argsDict["unevaluatedProperties"] == nil {
            argsDict["unevaluatedProperties"] = .boolean(false)
          }

          var functionDefinition: OrderedDictionary<String, JSONValue> = [
            "type": .string("object")
          ]
          if let functionDescription {
            functionDefinition["description"] = .string(functionDescription)
          }
          functionDefinition["returnType"] = .string(functionAPI.returnType.rawValue)
          functionDefinition["allowedCallers"] = .string(functionAPI.allowedCallers.rawValue)
          functionDefinition["requiresUserActivation"] = .boolean(
            functionAPI.requiresUserActivation
          )
          functionDefinition["properties"] = .object([
            "@call": .object(["const": .string(functionAPI.name)]),
            "args": .object(argsDict),
          ])
          let requiredArgs = argsDict["required"]?.arrayValue ?? []
          var requiredFields: [JSONValue] = [.string("@call")]
          if !requiredArgs.isEmpty {
            requiredFields.append(.string("args"))
          }
          functionDefinition["required"] = .array(requiredFields)
          functionsDict[functionAPI.name] = .object(functionDefinition)
        }
        catalogDictionary["functions"] = .object(functionsDict)
      } else {
        var functionsArray: [JSONValue] = []
        for key in catalog.functions.keys.sorted() {
          guard let functionImplementation = catalog.functions[key] else { continue }
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
        catalogDictionary["functions"] = .array(functionsArray)
      }
    }

    if !version.isAtLeastV10, let themeSchema = catalog.themeSchema {
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

  /// Processes a single agent-to-renderer message by adapting it into version-neutral
  /// ``InternalOperation`` values and executing them.
  ///
  /// Any validation or lifecycle errors are mapped via `MessageErrorMapper`
  /// and reported to `ActionHandling`.
  public func process(message: AgentToRendererMessage) {
    do {
      let operations = try adaptToOperations(message)
      for operation in operations {
        try processOperation(operation)
      }
    } catch {
      let surfaceID = extractSurfaceID(from: error, fallback: message.surfaceID ?? "")
      let clientError = errorMapper.map(error, surfaceID: surfaceID, version: message.version)
      forwardError(clientError, from: surfaceID)
    }
  }

  /// Processes an array of agent-to-renderer messages.
  ///
  /// Any validation or lifecycle errors are mapped via `MessageErrorMapper`
  /// and reported to `ActionHandling`.
  public func process(messages: [AgentToRendererMessage]) {
    for message in messages {
      process(message: message)
    }
  }

  /// Processes a single version-neutral ``InternalOperation``.
  internal func process(operation: InternalOperation) {
    do {
      try processOperation(operation)
    } catch {
      let surfaceID = extractSurfaceID(from: error, fallback: operation.surfaceID ?? "")
      let version = resolveVersion(for: operation, surfaceID: surfaceID)
      let clientError = errorMapper.map(error, surfaceID: surfaceID, version: version)
      forwardError(clientError, from: surfaceID)
    }
  }

  /// Processes an array of version-neutral ``InternalOperation`` values.
  internal func process(operations: [InternalOperation]) {
    for operation in operations {
      process(operation: operation)
    }
  }

  /// Resolves a version adapter from a raw JSON payload, normalizes it into
  /// ``InternalOperation`` values, and executes them, forwarding any errors to
  /// `ActionHandling` and `outboundListener`.
  public func process(payload: JSONValue) {
    do {
      try processMessages(payload)
    } catch {
      let surfaceID = extractSurfaceID(from: error, fallback: "")
      let version = resolveVersion(for: payload, surfaceID: surfaceID)
      let clientError = errorMapper.map(error, surfaceID: surfaceID, version: version)
      forwardError(clientError, from: surfaceID)
    }
  }

  /// Resolves a version adapter from a raw JSON payload, normalizes it into
  /// ``InternalOperation`` values, and executes them, throwing any validation,
  /// integrity, recursion, or catalog errors directly.
  public func processMessages(_ payload: JSONValue) throws {
    let adapter = try adapterFactory.resolveFromPayload(payload)
    let operations = try adapter.extractOperations(from: payload)
    for operation in operations {
      try processOperation(operation)
    }
  }

  private func resolveVersion(
    for operation: InternalOperation,
    surfaceID: String
  ) -> A2UIProtocolVersion {
    switch operation {
    case .createSurface(let op):
      if let version = op.version { return version }
    case .callRendererFunction(let op):
      return op.version
    case .agentFunctionResponse(let op):
      return op.version
    case .updateComponents, .updateDataModel, .deleteSurface:
      break
    }
    if let surfaceVersion = surfaceGroupModel[surfaceID]?.protocolVersion {
      return surfaceVersion
    }
    return registeredCatalogs.first?.a2uiProtocolVersion ?? .v10
  }

  private func resolveVersion(
    for payload: JSONValue,
    surfaceID: String
  ) -> A2UIProtocolVersion {
    if let versionStr = payload["version"]?.stringValue,
      let version = A2UIProtocolVersion(rawValue: versionStr)
    {
      return version
    }
    if let firstItem = payload.arrayValue?.first,
      let versionStr = firstItem["version"]?.stringValue,
      let version = A2UIProtocolVersion(rawValue: versionStr)
    {
      return version
    }
    if let surfaceVersion = surfaceGroupModel[surfaceID]?.protocolVersion {
      return surfaceVersion
    }
    return registeredCatalogs.first?.a2uiProtocolVersion ?? .v10
  }

  private func adaptToOperations(_ message: AgentToRendererMessage) throws -> [InternalOperation] {
    let adapter = adapterFactory.getAdapter(for: message.version)
    return try adapter.adaptMessage(message)
  }

  private func extractSurfaceID(from error: Error, fallback: String) -> String {
    if let validationError = error as? ValidationFailedError {
      return validationError.surfaceID
    }
    if let genericError = error as? GenericError {
      return genericError.surfaceID ?? fallback
    }
    return fallback
  }

  // MARK: - Version-Neutral Operation Execution

  private func processOperation(_ operation: InternalOperation) throws {
    switch operation {
    case .createSurface(let op):
      try processCreateSurfaceOp(op)
    case .updateComponents(let op):
      try processUpdateComponentsOp(op)
    case .updateDataModel(let op):
      try processUpdateDataModelOp(op)
    case .deleteSurface(let op):
      try processDeleteSurfaceOp(op)
    case .callRendererFunction(let op):
      try processCallRendererFunctionOp(op)
    case .agentFunctionResponse(let op):
      try processAgentFunctionResponseOp(op)
    }
  }

  private func processCreateSurfaceOp(_ op: InternalCreateSurfaceOp) throws {
    guard surfaceGroupModel.surfacesMap[op.surfaceID] == nil else {
      throw A2UIIntegrityError(
        "Surface \(op.surfaceID) already exists.",
        details: [
          A2UIErrorDetail(
            path: "createSurface.surfaceId",
            code: "SURFACE_EXISTS",
            message: "Surface \(op.surfaceID) already exists."
          )
        ]
      )
    }
    var targetCatalog: AnyCatalog?
    if let catalogID = op.catalogID {
      guard let cat = findCatalog(catalogID, preferredVersion: op.version) else {
        throw A2UICatalogError(
          "Catalog not found: \(catalogID)",
          details: [
            A2UIErrorDetail(
              path: "createSurface.catalogId",
              code: "CATALOG_NOT_FOUND",
              message: "Catalog not found: \(catalogID)"
            )
          ]
        )
      }
      targetCatalog = cat
    } else if registeredCatalogs.count == 1 {
      targetCatalog = registeredCatalogs.first
    }

    if let targetCatalog, let opVersion = op.version,
      !isCatalogCompatible(targetCatalog, with: opVersion)
    {
      let catVerStr = targetCatalog.protocolVersion ?? "v0.9"
      let catalogName = op.catalogID ?? targetCatalog.id
      let msg =
        "Catalog '\(catalogName)' (version \(catVerStr)) is incompatible with surface version \(opVersion.rawValue)."
      throw A2UICatalogError(
        msg,
        details: [
          A2UIErrorDetail(
            path: "createSurface.catalogId",
            code: "INCOMPATIBLE_CATALOG_VERSION",
            message: msg
          )
        ]
      )
    }

    if let targetCatalog {
      try validateSurfaceTheme(op.theme, against: targetCatalog)
    }

    let vm = SurfaceViewModel(
      surfaceID: op.surfaceID,
      catalogs: catalogs,
      defaultCatalogID: op.catalogID,
      theme: op.theme,
      metadata: op.metadata,
      actionHandler: actionForwarder,
      sendDataModel: op.sendDataModel,
      protocolVersion: op.version ?? targetCatalog?.a2uiProtocolVersion
    )

    if let dataModel = op.dataModel {
      for (key, value) in dataModel {
        let escapedKey =
          key
          .replacingOccurrences(of: "~", with: "~0")
          .replacingOccurrences(of: "/", with: "~1")
        try vm.dataModel.setThrowing("/\(escapedKey)", value: value)
      }
    }

    if let components = op.components {
      try validateComponentsBatch(components, on: vm)
      applyComponentsBatch(components, to: vm)
    }

    surfaceGroupModel.addSurface(vm)
  }

  private func processCallRendererFunctionOp(_ op: InternalCallRendererFunctionOp) throws {
    let msg = CallRendererFunctionMessage(
      functionCallID: op.functionCallID,
      callFunction: CallFunctionPayload(
        call: op.call,
        catalogID: op.catalogID,
        args: op.args,
        returnType: op.returnType
      ),
      version: op.version
    )
    let userActivated = op.isUserActivated
    let (dataContext, defaultCatalogID) = resolveRPCDataContext(catalogID: op.catalogID)
    let callID = op.functionCallID
    activeRPCTasks[callID]?.cancel()
    let task = Task { @MainActor [weak self] in
      guard let self else { return }
      defer { self.activeRPCTasks.removeValue(forKey: callID) }
      let response = await self.rpcHandler.handleIncomingCall(
        msg,
        catalogs: self.catalogs,
        defaultCatalogID: defaultCatalogID,
        dataContext: dataContext,
        userActivationPresent: userActivated
      )
      guard !Task.isCancelled else { return }
      let outbound = RendererToAgentMessage.rendererFunctionResponse(response)
      self.outboundListener?(outbound)
    }
    activeRPCTasks[callID] = task
  }

  private func processAgentFunctionResponseOp(_ op: InternalAgentFunctionResponseOp) throws {
    let msg: AgentFunctionResponseMessage
    if let error = op.error {
      msg = AgentFunctionResponseMessage(
        functionCallID: op.functionCallID,
        error: error,
        version: op.version
      )
    } else {
      msg = AgentFunctionResponseMessage(
        functionCallID: op.functionCallID,
        value: op.value ?? .null,
        version: op.version
      )
    }
    rpcHandler.handleAgentResponse(msg)
  }

  /// Initiates a remote function call to the agent and awaits the response.
  ///
  /// - Parameters:
  ///   - surfaceID: The surface ID initiating the function call.
  ///   - functionName: The name of the function to execute on the agent.
  ///   - catalogID: Optional catalog identifier.
  ///   - args: Named argument dictionary.
  ///   - returnType: Expected return type name.
  ///   - version: The A2UI protocol version for the outbound message.
  ///   - timeoutSeconds: Maximum duration to wait before timing out (default 30s).
  /// - Returns: The evaluated JSONValue returned by the agent.
  @discardableResult
  public func callAgentFunction(
    surfaceID: String,
    functionName: String,
    catalogID: String? = nil,
    functionCallID: String? = nil,
    args: [String: JSONValue]? = nil,
    returnType: String? = nil,
    version: A2UIProtocolVersion,
    timeoutSeconds: TimeInterval = 30.0
  ) async throws -> JSONValue {
    guard let listener = outboundListener else {
      throw FunctionError.noListener(name: functionName)
    }
    return try await rpcHandler.callAgentFunction(
      surfaceID: surfaceID,
      functionName: functionName,
      catalogID: catalogID,
      functionCallID: functionCallID,
      args: args,
      returnType: returnType,
      version: version,
      timeoutSeconds: timeoutSeconds,
      sendOutbound: listener
    )
  }

  private func payloadValidator(
    for catalog: AnyCatalog,
    config: ValidationConfig
  ) -> PayloadValidator {
    let cacheKey =
      "\(catalog.id)|\(config.allowOrphanComponents)|\(config.allowDanglingReferences)|\(config.allowMissingRoot)|\(config.allowUnknownElements)|\(config.targetVersion ?? "")"
    if let cached = payloadValidators[cacheKey] {
      return cached
    }
    let validator = PayloadValidator(catalog: catalog, config: config)
    payloadValidators[cacheKey] = validator
    return validator
  }

  private func validateSurfaceTheme(
    _ theme: [String: JSONValue]?,
    against catalog: AnyCatalog
  ) throws {
    let validator = payloadValidator(for: catalog, config: validationConfig)
    try validator.validateTheme(theme)
  }

  private func processUpdateComponentsOp(_ op: InternalUpdateComponentsOp) throws {
    guard let surface = surfaceGroupModel.surfacesMap[op.surfaceID] else {
      throw A2UIIntegrityError(
        "Surface not found for message: \(op.surfaceID)",
        details: [
          A2UIErrorDetail(
            path: "updateComponents.surfaceId",
            code: "SURFACE_NOT_FOUND",
            message: "Surface not found for message: \(op.surfaceID)"
          )
        ]
      )
    }

    try validateComponentsBatch(op.components, on: surface)
    applyComponentsBatch(op.components, to: surface)
  }

  private func processUpdateDataModelOp(_ op: InternalUpdateDataModelOp) throws {
    guard let surface = surfaceGroupModel.surfacesMap[op.surfaceID] else {
      throw A2UIIntegrityError(
        "Surface not found for message: \(op.surfaceID)",
        details: [
          A2UIErrorDetail(
            path: "updateDataModel.surfaceId",
            code: "SURFACE_NOT_FOUND",
            message: "Surface not found for message: \(op.surfaceID)"
          )
        ]
      )
    }
    try surface.dataModel.setThrowing(op.path, value: op.value)
  }

  private func processDeleteSurfaceOp(_ op: InternalDeleteSurfaceOp) throws {
    guard surfaceGroupModel.surfacesMap[op.surfaceID] != nil else {
      return
    }
    surfaceGroupModel.removeSurface(id: op.surfaceID)
  }

  private func validateComponentsBatch(
    _ components: [[String: JSONValue]],
    on surface: SurfaceViewModel
  ) throws {
    var effectiveConfig = validationConfig
    if surface.protocolVersion.isAtLeastV10
      && !(effectiveConfig.protocolVersion?.isAtLeastV10 ?? false)
    {
      effectiveConfig.targetVersion = surface.protocolVersion.rawValue
    }

    for componentDict in components {
      guard let type = componentDict["component"]?.stringValue, !type.isEmpty else {
        throw A2UIValidationError(
          "Missing required key 'component'",
          details: [
            A2UIErrorDetail(
              path: "component",
              code: componentDict["component"] == nil ? "missing_field" : "type_mismatch",
              message: "Missing required key 'component'"
            )
          ]
        )
      }

      guard componentDict["id"]?.stringValue != nil else {
        throw A2UIValidationError(
          "Missing required key 'id'",
          details: [
            A2UIErrorDetail(
              path: "id",
              code: componentDict["id"] == nil ? "missing_field" : "type_mismatch",
              message: "Missing required key 'id'"
            )
          ]
        )
      }

      let componentCatalogID =
        componentDict["catalogId"]?.stringValue ?? surface.defaultCatalogID
      let resolvedCatalogID = componentCatalogID ?? "default"
      guard let targetCatalog = surface.getCatalog(id: componentCatalogID) else {
        throw A2UICatalogError(
          "Catalog not found: \(resolvedCatalogID)",
          details: [
            A2UIErrorDetail(
              path: "/catalogId",
              code: "CATALOG_NOT_FOUND",
              message: "Catalog not found: \(resolvedCatalogID)"
            )
          ]
        )
      }

      guard isCatalogCompatible(targetCatalog, with: surface.protocolVersion) else {
        let catVerStr = targetCatalog.protocolVersion ?? "v0.9"
        let msg =
          "Catalog '\(resolvedCatalogID)' (version \(catVerStr)) is incompatible with surface version \(surface.protocolVersion.rawValue)."
        throw A2UICatalogError(
          msg,
          details: [
            A2UIErrorDetail(
              path: "/catalogId",
              code: "INCOMPATIBLE_CATALOG_VERSION",
              message: msg
            )
          ]
        )
      }

      let validator = payloadValidator(for: targetCatalog, config: effectiveConfig)
      try validator.validateComponent(componentDict)
    }

    if !components.isEmpty {
      var allComponentsMap: [String: [String: JSONValue]] = [:]
      for existing in surface.componentsModel.components.values {
        var dict: [String: JSONValue] = [
          "id": .string(existing.id),
          "component": .string(existing.type),
        ]
        if let catID = existing.catalogID {
          dict["catalogId"] = .string(catID)
        }
        for (k, v) in existing.properties {
          dict[k] = v
        }
        allComponentsMap[existing.id] = dict
      }
      var batchIDs: Set<String> = []
      for comp in components {
        guard let id = comp["id"]?.stringValue else { continue }
        if batchIDs.contains(id) {
          throw A2UIIntegrityError("Duplicate component ID: \(id)")
        }
        batchIDs.insert(id)
        allComponentsMap[id] = comp
      }
      let allComponents = Array(allComponentsMap.values)

      try GraphTopologyValidator.validate(
        components: allComponents,
        rootID: "root",
        config: effectiveConfig,
        catalogs: surface.catalogs,
        defaultCatalogID: surface.defaultCatalogID
      )
    }
  }

  private func applyComponentsBatch(
    _ components: [[String: JSONValue]],
    to surface: SurfaceViewModel
  ) {
    var removedIDs: [String] = []
    var addedComponents: [ComponentModel] = []
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

      surface.nodeResolver.clearReportedExpressionErrors(forComponentID: id)
      let existing = surface.componentsModel.get(id)
      if let existing, existing.type != type || existing.catalogID != componentCatalogID {
        removedIDs.append(id)
      }
      addedComponents.append(
        ComponentModel(
          id: id,
          type: type,
          catalogID: componentCatalogID,
          properties: props
        )
      )
    }
    if !removedIDs.isEmpty || !addedComponents.isEmpty {
      surface.componentsModel.applyBatch(removing: removedIDs, adding: addedComponents)
    }
  }

  private func findCatalog(
    _ catalogID: String?,
    preferredVersion: A2UIProtocolVersion? = nil
  ) -> AnyCatalog? {
    guard let catalogID else {
      return registeredCatalogs.count == 1 ? registeredCatalogs.first : nil
    }
    return catalogs[catalogID]
  }

  /// Cancels all in-flight incoming and outgoing RPC function calls.
  public func cancelPendingCalls() {
    for (_, task) in activeRPCTasks {
      task.cancel()
    }
    activeRPCTasks.removeAll()
    rpcHandler.cancelAllPendingCalls()
  }

  /// Disposes the processor, cancelling all pending RPC tasks and clearing active surfaces.
  public func dispose() {
    for (_, task) in activeRPCTasks {
      task.cancel()
    }
    activeRPCTasks.removeAll()
    rpcHandler.disposeAllPendingCalls()
    for surfaceID in Array(surfaceGroupModel.surfacesMap.keys) {
      surfaceGroupModel.removeSurface(id: surfaceID)
    }
  }

  private func resolveRPCDataContext(catalogID: String?) -> (DataContext?, String?) {
    let sortedSurfaces = surfaceGroupModel.surfacesMap
      .sorted { $0.key < $1.key }
      .map(\.value)
    guard !sortedSurfaces.isEmpty else { return (nil, nil) }

    let matchedSurface: SurfaceViewModel?
    if let catalogID {
      matchedSurface =
        sortedSurfaces.first(where: {
          $0.defaultCatalogID == catalogID || $0.catalog.id == catalogID
        })
        ?? sortedSurfaces.first
    } else {
      matchedSurface = sortedSurfaces.first
    }

    guard let surface = matchedSurface else { return (nil, nil) }
    let context = DataContext(
      dataModel: surface.dataModel,
      path: "",
      functionHandler: surface,
      protocolVersion: surface.protocolVersion
    )
    return (context, surface.defaultCatalogID)
  }

  fileprivate func forwardAction(_ action: ResolvedAction, from surfaceID: String) {
    actionHandler?.handle(action: action, from: surfaceID)
    if case .event(let name, let context, let userMessage) = action.identity {
      let version =
        surfaceGroupModel[surfaceID]?.protocolVersion
        ?? registeredCatalogs.first?.a2uiProtocolVersion
        ?? .v10
      let rendererAction = RendererAction(
        name: name,
        surfaceID: surfaceID,
        sourceComponentID: action.sourceComponentID ?? "",
        timestamp: ISO8601DateFormatter().string(from: Date()),
        context: context ?? [:],
        userMessage: userMessage,
        version: version
      )
      outboundListener?(.action(rendererAction))
    }
  }

  fileprivate func forwardError(_ error: RendererError, from surfaceID: String) {
    actionHandler?.handle(error: error, from: surfaceID)
    outboundListener?(.error(error))
  }

  private func isCatalogCompatible(
    _ catalog: AnyCatalog,
    with version: A2UIProtocolVersion
  ) -> Bool {
    let catVersion = catalog.a2uiProtocolVersion ?? .v09
    return areVersionsCompatible(catVersion, version)
  }

  private func areVersionsCompatible(
    _ lhs: A2UIProtocolVersion,
    _ rhs: A2UIProtocolVersion
  ) -> Bool {
    if lhs == rhs { return true }
    if lhs.isV09Family && rhs.isV09Family { return true }
    if lhs.isAtLeastV10 && rhs.isAtLeastV10 { return true }
    return false
  }
}

private final class ProcessorActionForwarder: ActionHandling, @unchecked Sendable {
  weak var processor: MessageProcessor?

  init(processor: MessageProcessor? = nil) {
    self.processor = processor
  }

  func handle(action: ResolvedAction, from surfaceID: String) {
    if Thread.isMainThread {
      MainActor.assumeIsolated {
        processor?.forwardAction(action, from: surfaceID)
      }
    } else {
      Task { @MainActor [weak self] in
        self?.processor?.forwardAction(action, from: surfaceID)
      }
    }
  }

  func handle(error: RendererError, from surfaceID: String) {
    if Thread.isMainThread {
      MainActor.assumeIsolated {
        processor?.forwardError(error, from: surfaceID)
      }
    } else {
      Task { @MainActor [weak self] in
        self?.processor?.forwardError(error, from: surfaceID)
      }
    }
  }
}
