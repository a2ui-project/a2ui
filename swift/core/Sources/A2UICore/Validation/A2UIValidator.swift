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

/// Validates A2UI message protocol envelopes, JSON schemas, and component graph topologies.
public final class A2UIValidator: Sendable {
  private static let validPathRegex = try! NSRegularExpression(
    pattern: "^(?:(?:/(?:[^~/]|~[01])*)*|(?:[^~/]|~[01])+(?:/(?:[^~/]|~[01])*)*)$"
  )
  private static let maxFunctionDepth = 5

  /// The catalogs registered for component and theme schema validation.
  public let catalogs: [String: AnyCatalog]

  /// The validation configuration controlling strictness.
  public let config: ValidationConfig

  /// Creates a validator with a collection of catalogs and a configuration.
  public init(
    catalogs: [any CatalogProtocol] = [],
    config: ValidationConfig = .strict
  ) {
    let anyCatalogs = catalogs.map { $0.eraseToAnyCatalog() }
    var catalogMap: [String: AnyCatalog] = [:]
    for cat in anyCatalogs {
      catalogMap[cat.id] = cat
    }
    for cat in anyCatalogs {
      guard let url = URL(string: cat.id), url.lastPathComponent == "catalog.json" else {
        continue
      }
      let shorthand = url.deletingLastPathComponent().lastPathComponent
      guard !shorthand.isEmpty, catalogMap[shorthand] == nil || cat.isAtLeastV10 else {
        continue
      }
      catalogMap[shorthand] = cat
    }
    self.catalogs = catalogMap
    self.config = config
  }

  /// Creates a validator for a single catalog.
  public convenience init(
    catalog: any CatalogProtocol,
    config: ValidationConfig = .strict
  ) {
    self.init(catalogs: [catalog], config: config)
  }

  /// Validates a raw JSON payload containing one or more A2UI protocol messages.
  ///
  /// - Parameter payload: The JSONValue representing the message or message array.
  /// - Throws: `A2UIValidationError`, `A2UIIntegrityError`, `A2UIRecursionError`,
  ///   or `A2UICatalogError`.
  public func validate(payload: JSONValue) throws {
    let messagesArray: [JSONValue]
    switch payload {
    case .array(let messageElements):
      messagesArray = messageElements
    case .object:
      messagesArray = [payload]
    default:
      throw A2UIValidationError(
        "Payload must be a JSON object or array of objects",
        details: [
          A2UIErrorDetail(
            path: "messages", code: "type_mismatch", message: "Expected object or array")
        ]
      )
    }

    var details: [A2UIErrorDetail] = []
    var allComponentsToValidate: [[String: JSONValue]] = []
    var defaultCatalogID: String?

    for (index, messageValue) in messagesArray.enumerated() {
      guard let messageDictionary = messageValue.objectValue else {
        details.append(
          A2UIErrorDetail(
            path: "messages.\(index)",
            code: "type_mismatch",
            message: "Message must be an object"
          )
        )
        continue
      }

      if let createSurface = messageDictionary["createSurface"]?.objectValue {
        if let catID = createSurface["catalogId"]?.stringValue {
          defaultCatalogID = catID
        }
      }

      validateMessageEnvelope(messageDictionary, index: index, details: &details)
      collectComponents(from: messageDictionary, into: &allComponentsToValidate)
      try validatePathsAndRecursion(messageValue)
    }

    if !details.isEmpty {
      let summary = details.map { "\($0.path): \($0.message)" }.joined(separator: "\n")
      throw A2UIValidationError(summary, details: details)
    }

    // Component schema validation against registered catalogs
    try validateComponentSchemas(allComponentsToValidate, defaultCatalogID: defaultCatalogID)

    // Component graph topology and completeness validation
    if !allComponentsToValidate.isEmpty {
      try GraphTopologyValidator.validate(
        components: allComponentsToValidate,
        rootID: "root",
        config: config,
        catalogs: catalogs,
        defaultCatalogID: defaultCatalogID
      )
    }
  }

  private func validateMessageEnvelope(
    _ message: OrderedDictionary<String, JSONValue>,
    index: Int,
    details: inout [A2UIErrorDetail]
  ) {
    validateMessageVersion(in: message, index: index, details: &details)
    validateMessageAction(in: message, index: index, details: &details)
  }

  private func validateMessageVersion(
    in message: OrderedDictionary<String, JSONValue>,
    index: Int,
    details: inout [A2UIErrorDetail]
  ) {
    guard let versionValue = message["version"] else {
      details.append(
        A2UIErrorDetail(
          path: "messages.\(index).version",
          code: "missing_field",
          message: "'version' is a required property"
        )
      )
      return
    }

    guard let versionString = versionValue.stringValue else {
      details.append(
        A2UIErrorDetail(
          path: "messages.\(index).version",
          code: "type_mismatch",
          message: "Version must be a string"
        )
      )
      return
    }

    if A2UIProtocolVersion(rawValue: versionString) == nil {
      details.append(
        A2UIErrorDetail(
          path: "messages.\(index).version",
          code: "invalid_value",
          message: "Unsupported protocol version '\(versionString)'"
        )
      )
    }
  }

  private func validateMessageAction(
    in message: OrderedDictionary<String, JSONValue>,
    index: Int,
    details: inout [A2UIErrorDetail]
  ) {
    let actionKeys = message.keys.filter { $0 != "version" }
    if actionKeys.isEmpty {
      details.append(
        A2UIErrorDetail(
          path: "messages.\(index)",
          code: "missing_field",
          message: "Message must contain an action key"
        )
      )
      return
    }
    if actionKeys.count > 1 {
      details.append(
        A2UIErrorDetail(
          path: "messages.\(index)",
          code: "invalid_value",
          message: "Message must contain exactly one action key"
        )
      )
      return
    }

    let actionKey = actionKeys[0]
    guard let actionObject = message[actionKey]?.objectValue else {
      details.append(
        A2UIErrorDetail(
          path: "messages.\(index).\(actionKey)",
          code: "type_mismatch",
          message: "Action payload must be an object"
        )
      )
      return
    }

    validateActionPayload(
      actionKey: actionKey,
      payload: actionObject,
      index: index,
      message: message,
      details: &details
    )
  }

  private func validateActionPayload(
    actionKey: String,
    payload: OrderedDictionary<String, JSONValue>,
    index: Int,
    message: OrderedDictionary<String, JSONValue>,
    details: inout [A2UIErrorDetail]
  ) {
    switch actionKey {
    case "createSurface":
      validateRequiredString(
        in: payload,
        key: "surfaceId",
        path: "messages.\(index).createSurface.surfaceId",
        details: &details
      )
      if let catalogIdVal = payload["catalogId"] {
        if catalogIdVal.stringValue == nil {
          details.append(
            A2UIErrorDetail(
              path: "messages.\(index).createSurface.catalogId",
              code: "type_mismatch",
              message: "Field 'catalogId' must be a string"
            )
          )
        }
      } else {
        let version =
          message["version"]?.stringValue.flatMap { A2UIProtocolVersion(rawValue: $0) }
          ?? config.protocolVersion
        if version != .v10 {
          details.append(
            A2UIErrorDetail(
              path: "messages.\(index).createSurface.catalogId",
              code: "missing_field",
              message: "Field 'catalogId' is required"
            )
          )
        }
      }

      if let themeValue = payload["theme"],
        let catalogId = payload["catalogId"]?.stringValue,
        let catalog = findCatalog(catalogId),
        let themeSchema = catalog.themeSchema
      {
        let validationResult = themeSchema.validate(themeValue, at: .init())
        if !validationResult.isValid {
          details.append(
            A2UIErrorDetail(
              path: "messages.\(index).createSurface.theme",
              code: "invalid_value",
              message: "Surface theme failed catalog theme schema validation"
            )
          )
        }
      }

      if let componentsValue = payload["components"] {
        if let componentsArray = componentsValue.arrayValue {
          if componentsArray.isEmpty {
            details.append(
              A2UIErrorDetail(
                path: "messages.\(index).createSurface.components",
                code: "invalid_value",
                message: "Components array must contain at least 1 item"
              )
            )
          }
          for (componentIndex, componentValue) in componentsArray.enumerated() {
            if let componentDictionary = componentValue.objectValue {
              validateRequiredString(
                in: componentDictionary,
                key: "id",
                path: "messages.\(index).createSurface.components.\(componentIndex).id",
                details: &details
              )
              validateRequiredString(
                in: componentDictionary,
                key: "component",
                path: "messages.\(index).createSurface.components.\(componentIndex).component",
                details: &details
              )
            } else {
              details.append(
                A2UIErrorDetail(
                  path: "messages.\(index).createSurface.components.\(componentIndex)",
                  code: "type_mismatch",
                  message: "Component definition must be an object"
                )
              )
            }
          }
        } else {
          details.append(
            A2UIErrorDetail(
              path: "messages.\(index).createSurface.components",
              code: "type_mismatch",
              message: "Components must be an array"
            )
          )
        }
      }

    case "updateComponents":
      validateRequiredString(
        in: payload,
        key: "surfaceId",
        path: "messages.\(index).updateComponents.surfaceId",
        details: &details
      )
      if let componentsValue = payload["components"] {
        if let componentsArray = componentsValue.arrayValue {
          if componentsArray.isEmpty {
            details.append(
              A2UIErrorDetail(
                path: "messages.\(index).updateComponents.components",
                code: "invalid_value",
                message: "Components array must contain at least 1 item"
              )
            )
          }
          for (componentIndex, componentValue) in componentsArray.enumerated() {
            if let componentDictionary = componentValue.objectValue {
              validateRequiredString(
                in: componentDictionary,
                key: "id",
                path: "messages.\(index).updateComponents.components.\(componentIndex).id",
                details: &details
              )
              validateRequiredString(
                in: componentDictionary,
                key: "component",
                path: "messages.\(index).updateComponents.components.\(componentIndex).component",
                details: &details
              )
            } else {
              details.append(
                A2UIErrorDetail(
                  path: "messages.\(index).updateComponents.components.\(componentIndex)",
                  code: "type_mismatch",
                  message: "Component definition must be an object"
                )
              )
            }
          }
        } else {
          details.append(
            A2UIErrorDetail(
              path: "messages.\(index).updateComponents.components",
              code: "type_mismatch",
              message: "Components must be an array"
            )
          )
        }
      } else {
        details.append(
          A2UIErrorDetail(
            path: "messages.\(index).updateComponents.components",
            code: "missing_field",
            message: "Missing required property 'components'"
          )
        )
      }

    case "updateDataModel":
      validateRequiredString(
        in: payload,
        key: "surfaceId",
        path: "messages.\(index).updateDataModel.surfaceId",
        details: &details
      )
      if let pathValue = payload["path"] {
        if let pathString = pathValue.stringValue {
          if !pathString.isEmpty && !pathString.hasPrefix("/") {
            details.append(
              A2UIErrorDetail(
                path: "messages.\(index).updateDataModel.path",
                code: "invalid_value",
                message: "Field 'path' must be a valid JSON Pointer starting with '/'"
              )
            )
          }
        } else {
          details.append(
            A2UIErrorDetail(
              path: "messages.\(index).updateDataModel.path",
              code: "type_mismatch",
              message: "Field 'path' must be a string"
            )
          )
        }
      }
      let version =
        message["version"]?.stringValue.flatMap { A2UIProtocolVersion(rawValue: $0) }
        ?? config.protocolVersion
      if version == .v10 && payload["value"] == nil {
        details.append(
          A2UIErrorDetail(
            path: "messages.\(index).updateDataModel.value",
            code: "missing_field",
            message: "Missing required property 'value'"
          )
        )
      }

    case "deleteSurface":
      validateRequiredString(
        in: payload,
        key: "surfaceId",
        path: "messages.\(index).deleteSurface.surfaceId",
        details: &details
      )

    case "callRendererFunction":
      let version =
        message["version"]?.stringValue.flatMap { A2UIProtocolVersion(rawValue: $0) }
        ?? config.protocolVersion
      if version != .v10 {
        details.append(
          A2UIErrorDetail(
            path: "messages.\(index)",
            code: "invalid_value",
            message: "Action 'callRendererFunction' is only supported in protocol version v1.0"
          )
        )
        return
      }
      validateRequiredString(
        in: payload,
        key: "functionCallId",
        path: "messages.\(index).callRendererFunction.functionCallId",
        details: &details
      )
      guard let callFunction = payload["callFunction"]?.objectValue else {
        details.append(
          A2UIErrorDetail(
            path: "messages.\(index).callRendererFunction.callFunction",
            code: payload["callFunction"] == nil ? "missing_field" : "type_mismatch",
            message: payload["callFunction"] == nil
              ? "Missing required property 'callFunction'"
              : "Field 'callFunction' must be an object"
          )
        )
        return
      }
      validateRequiredString(
        in: callFunction,
        key: "call",
        path: "messages.\(index).callRendererFunction.callFunction.call",
        details: &details
      )
      validateRequiredString(
        in: callFunction,
        key: "catalogId",
        path: "messages.\(index).callRendererFunction.callFunction.catalogId",
        details: &details
      )

    case "agentFunctionResponse":
      let version =
        message["version"]?.stringValue.flatMap { A2UIProtocolVersion(rawValue: $0) }
        ?? config.protocolVersion
      if version != .v10 {
        details.append(
          A2UIErrorDetail(
            path: "messages.\(index)",
            code: "invalid_value",
            message: "Action 'agentFunctionResponse' is only supported in protocol version v1.0"
          )
        )
        return
      }
      validateRequiredString(
        in: payload,
        key: "functionCallId",
        path: "messages.\(index).agentFunctionResponse.functionCallId",
        details: &details
      )
      let hasValue = payload["value"] != nil
      let hasError = payload["error"] != nil
      if !hasValue && !hasError {
        details.append(
          A2UIErrorDetail(
            path: "messages.\(index).agentFunctionResponse",
            code: "missing_field",
            message: "FunctionResponse must contain either 'value' or 'error'"
          )
        )
      } else if hasValue && hasError {
        details.append(
          A2UIErrorDetail(
            path: "messages.\(index).agentFunctionResponse",
            code: "invalid_value",
            message: "FunctionResponse cannot contain both 'value' and 'error'"
          )
        )
      }
      if let errorVal = payload["error"] {
        guard let errorObj = errorVal.objectValue else {
          details.append(
            A2UIErrorDetail(
              path: "messages.\(index).agentFunctionResponse.error",
              code: "type_mismatch",
              message: "Field 'error' must be an object"
            )
          )
          return
        }
        validateRequiredString(
          in: errorObj,
          key: "code",
          path: "messages.\(index).agentFunctionResponse.error.code",
          details: &details
        )
        validateRequiredString(
          in: errorObj,
          key: "message",
          path: "messages.\(index).agentFunctionResponse.error.message",
          details: &details
        )
      }

    default:
      details.append(
        A2UIErrorDetail(
          path: "messages.\(index)",
          code: "invalid_value",
          message: "Unrecognized message action '\(actionKey)'"
        )
      )
    }
  }

  private func validateRequiredString(
    in dictionary: OrderedDictionary<String, JSONValue>,
    key: String,
    path: String,
    details: inout [A2UIErrorDetail]
  ) {
    if let value = dictionary[key] {
      if value.stringValue == nil {
        details.append(
          A2UIErrorDetail(
            path: path,
            code: "type_mismatch",
            message: "Field '\(key)' must be a string"
          )
        )
      }
    } else {
      details.append(
        A2UIErrorDetail(
          path: path,
          code: "missing_field",
          message: "Field '\(key)' is required"
        )
      )
    }
  }

  private func collectComponents(
    from message: OrderedDictionary<String, JSONValue>,
    into components: inout [[String: JSONValue]]
  ) {
    if let updateComponentsAction = message["updateComponents"]?.objectValue,
      let componentsArray = updateComponentsAction["components"]?.arrayValue
    {
      for componentValue in componentsArray {
        if let componentObject = componentValue.objectValue {
          components.append(
            Dictionary(uniqueKeysWithValues: componentObject.map { ($0.key, $0.value) })
          )
        }
      }
    }
    if let createSurfaceAction = message["createSurface"]?.objectValue,
      let componentsArray = createSurfaceAction["components"]?.arrayValue
    {
      for componentValue in componentsArray {
        if let componentObject = componentValue.objectValue {
          components.append(
            Dictionary(uniqueKeysWithValues: componentObject.map { ($0.key, $0.value) })
          )
        }
      }
    }
  }

  private func findCatalog(_ catalogID: String?) -> AnyCatalog? {
    guard let catalogID else { return catalogs.values.first }
    if let cat = catalogs[catalogID] { return cat }
    if let cat = catalogs.values.first(where: {
      $0.id.hasSuffix("/\(catalogID)/catalog.json")
        && $0.isAtLeastV10
    }) {
      return cat
    }
    return catalogs.values.first {
      $0.id.hasSuffix("/\(catalogID)/catalog.json")
    }
  }

  private func validateComponentSchemas(
    _ components: [[String: JSONValue]],
    defaultCatalogID: String? = nil
  ) throws {
    guard !catalogs.isEmpty else { return }

    for component in components {
      if config.protocolVersion == .v10,
        let id = component["id"]?.stringValue,
        !UnicodeIdentifierValidator.isValidIdentifier(id)
      {
        let msg = "Component id '\(id)' must be a valid Unicode identifier (UAX #31)"
        throw A2UIValidationError(
          msg,
          details: [
            A2UIErrorDetail(
              path: "/\(id)/id",
              code: "invalid_identifier",
              message: msg
            )
          ]
        )
      }
      guard let type = component["component"]?.stringValue else { continue }
      guard UnicodeIdentifierValidator.isValidIdentifier(type) else {
        throw A2UIValidationError(
          "Invalid component identifier: '\(type)'",
          details: [
            A2UIErrorDetail(
              path: "/\(type)",
              code: "invalid_identifier",
              message: "Invalid component identifier: '\(type)'"
            )
          ]
        )
      }

      let targetCatalogID = component["catalogId"]?.stringValue ?? defaultCatalogID
      let catalog: AnyCatalog
      if let targetCatalogID {
        if let found = findCatalog(targetCatalogID) {
          catalog = found
        } else if catalogs.count == 1, let sole = catalogs.values.first {
          catalog = sole
        } else {
          throw A2UICatalogError("Unknown catalog '\(targetCatalogID)'")
        }
      } else if catalogs.count == 1, let sole = catalogs.values.first {
        catalog = sole
      } else if let basic = findCatalog("basic") {
        catalog = basic
      } else {
        throw A2UICatalogError("Could not resolve catalog for component '\(type)'")
      }

      guard
        let componentAPI = catalog.components[type] ?? findCatalog("basic")?.components[type]
      else {
        let msg = "Unknown component type '\(type)' in catalog '\(catalog.id)'"
        throw A2UIValidationError(
          msg,
          details: [
            A2UIErrorDetail(
              path: "/\(type)",
              code: "unknown_component",
              message: msg
            ),
            A2UIErrorDetail(
              path: "component",
              code: "invalid_value",
              message: msg
            ),
          ]
        )
      }

      let instance: JSONValue = .object(OrderedDictionary(uniqueKeysWithValues: component))
      let validationResult = componentAPI.schema.validate(instance)
      if !validationResult.isValid {
        var leafErrors: [JSONSchema.ValidationError] = []
        if let schemaErrors = validationResult.errors {
          for schemaError in schemaErrors {
            leafErrors.append(contentsOf: extractLeafErrors(from: schemaError))
          }
        }
        let leafMessages = leafErrors.map(\.message)
        let errorMessage =
          leafMessages.isEmpty
          ? (validationResult.errors?.first?.message ?? "Component validation failed")
          : leafMessages.joined(separator: "; ")
        var errorDetails: [A2UIErrorDetail] = []
        for leaf in leafErrors {
          let pointer = leaf.instanceLocation.jsonPointerString
          let trimmedPath = pointer.hasPrefix("/") ? String(pointer.dropFirst()) : pointer
          if leaf.keyword == "required",
            let quoteStart = leaf.message.firstIndex(of: "'"),
            let quoteEnd = leaf.message[leaf.message.index(after: quoteStart)...].firstIndex(
              of: "'")
          {
            let missingProp = String(leaf.message[leaf.message.index(after: quoteStart)..<quoteEnd])
            let fieldPath = trimmedPath.isEmpty ? missingProp : "\(trimmedPath).\(missingProp)"
            errorDetails.append(
              A2UIErrorDetail(path: fieldPath, code: "missing_field", message: leaf.message)
            )
          } else {
            errorDetails.append(
              A2UIErrorDetail(
                path: trimmedPath.isEmpty ? "/\(type)" : trimmedPath,
                code: "invalid_value",
                message: leaf.message
              )
            )
          }
        }
        if errorDetails.isEmpty {
          errorDetails.append(
            A2UIErrorDetail(path: "/\(type)", code: "invalid_value", message: errorMessage)
          )
        }
        throw A2UIValidationError(
          errorMessage,
          details: errorDetails
        )
      }
    }
  }

  private func extractLeafErrors(from error: JSONSchema.ValidationError) -> [JSONSchema
    .ValidationError]
  {
    if let nested = error.errors, !nested.isEmpty {
      return nested.flatMap { extractLeafErrors(from: $0) }
    }
    return [error]
  }

  private static let maxGlobalDepth = 50

  private func validatePathsAndRecursion(
    _ value: JSONValue,
    globalDepth: Int = 0,
    functionDepth: Int = 0
  ) throws {
    if globalDepth > Self.maxGlobalDepth {
      throw A2UIRecursionError(
        "Global recursion limit exceeded: Depth > \(Self.maxGlobalDepth)"
      )
    }
    if functionDepth > Self.maxFunctionDepth {
      throw A2UIRecursionError(
        "Recursion limit exceeded: functionCall depth > \(Self.maxFunctionDepth)"
      )
    }

    switch value {
    case .object(let dictionary):
      if let path = dictionary["path"]?.stringValue {
        let range = NSRange(path.startIndex..<path.endIndex, in: path)
        if Self.validPathRegex.firstMatch(in: path, range: range) == nil {
          throw A2UIValidationError(
            "Invalid path syntax: '\(path)'",
            details: [
              A2UIErrorDetail(
                path: path,
                code: "invalid_path_syntax",
                message: "Invalid path syntax"
              )
            ]
          )
        }
      }

      if let callName = dictionary["call"]?.stringValue,
        !UnicodeIdentifierValidator.isValidFunctionIdentifier(callName)
      {
        throw A2UIValidationError(
          "Invalid function identifier: '\(callName)'",
          details: [
            A2UIErrorDetail(
              path: callName,
              code: "invalid_identifier",
              message: "Invalid function identifier: '\(callName)'"
            )
          ]
        )
      }

      let isFunctionCall = dictionary["call"] != nil || dictionary["function"] != nil
      let nextDepth = isFunctionCall ? functionDepth + 1 : functionDepth

      for propertyValue in dictionary.values {
        try validatePathsAndRecursion(
          propertyValue,
          globalDepth: globalDepth + 1,
          functionDepth: nextDepth
        )
      }

    case .array(let array):
      for item in array {
        try validatePathsAndRecursion(
          item,
          globalDepth: globalDepth + 1,
          functionDepth: functionDepth
        )
      }

    default:
      break
    }
  }
}
