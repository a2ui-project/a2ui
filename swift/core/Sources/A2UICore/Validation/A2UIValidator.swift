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
    self.catalogs = Dictionary(
      anyCatalogs.map { ($0.id, $0) },
      uniquingKeysWith: { _, last in last }
    )
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

      validateMessageEnvelope(messageDictionary, index: index, details: &details)
      collectComponents(from: messageDictionary, into: &allComponentsToValidate)
      try validatePathsAndRecursion(messageValue)
    }

    if !details.isEmpty {
      let summary = details.map { "\($0.path): \($0.message)" }.joined(separator: "\n")
      throw A2UIValidationError(summary, details: details)
    }

    // Component schema validation against registered catalogs
    try validateComponentSchemas(allComponentsToValidate)

    // Component graph topology and completeness validation
    if !allComponentsToValidate.isEmpty {
      try GraphTopologyValidator.validate(
        components: allComponentsToValidate,
        rootID: "root",
        config: config
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

    if versionString != "v0.9"
      && versionString != "v0.9.1"
      && versionString != "0.9"
      && versionString != "0.9.1"
    {
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
      details: &details
    )
  }

  private func validateActionPayload(
    actionKey: String,
    payload: OrderedDictionary<String, JSONValue>,
    index: Int,
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
      validateRequiredString(
        in: payload,
        key: "catalogId",
        path: "messages.\(index).createSurface.catalogId",
        details: &details
      )

    case "updateComponents":
      validateRequiredString(
        in: payload,
        key: "surfaceId",
        path: "messages.\(index).updateComponents.surfaceId",
        details: &details
      )
      if let componentsValue = payload["components"] {
        if let componentsArray = componentsValue.arrayValue {
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

    case "deleteSurface":
      validateRequiredString(
        in: payload,
        key: "surfaceId",
        path: "messages.\(index).deleteSurface.surfaceId",
        details: &details
      )

    default:
      break
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
  }

  private func validateComponentSchemas(_ components: [[String: JSONValue]]) throws {
    guard !catalogs.isEmpty else { return }

    for component in components {
      guard let type = component["component"]?.stringValue else { continue }
      let catalog =
        component["catalogId"]?.stringValue.flatMap { catalogs[$0] }
        ?? (catalogs.count == 1
          ? catalogs.values.first
          : catalogs[catalogs.keys.sorted().first ?? ""])
      guard let catalog else { continue }

      if let componentAPI = catalog.components[type] {
        let instance: JSONValue = .object(OrderedDictionary(uniqueKeysWithValues: component))
        let validationResult = componentAPI.schema.validate(instance)
        if !validationResult.isValid {
          var leafMessages: [String] = []
          if let schemaErrors = validationResult.errors {
            for schemaError in schemaErrors {
              leafMessages.append(contentsOf: extractLeafMessages(from: schemaError))
            }
          }
          let errorMessage =
            leafMessages.isEmpty
            ? (validationResult.errors?.first?.message ?? "Component validation failed")
            : leafMessages.joined(separator: "; ")
          let path =
            validationResult.errors?.first?.instanceLocation.jsonPointerString ?? "/\(type)"
          throw A2UIValidationError(
            errorMessage,
            details: [A2UIErrorDetail(path: path, code: "invalid_value", message: errorMessage)]
          )
        }
      }
    }
  }

  private func extractLeafMessages(from error: JSONSchema.ValidationError) -> [String] {
    if let nested = error.errors, !nested.isEmpty {
      return nested.flatMap { extractLeafMessages(from: $0) }
    }
    return [error.message]
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
