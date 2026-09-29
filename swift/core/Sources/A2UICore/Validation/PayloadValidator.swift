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

/// Validates A2UI component payloads, function calls, and surface themes against a single
/// catalog's JSON schemas.
///
/// Mirrors the single-catalog `PayloadValidator` in the TypeScript and Python Core SDKs.
public final class PayloadValidator: Sendable {
  /// The maximum number of arguments permitted in a single function call in v1.0+.
  public static let maxFunctionCallArgs = 1_000

  /// The catalog whose schemas define valid components, functions, and themes.
  public let catalog: AnyCatalog

  /// The validation configuration controlling strictness and protocol version behavior.
  public let config: ValidationConfig

  private let fallbackCatalog: AnyCatalog?

  private var enforceIdentifiers: Bool {
    config.protocolVersion.isAtLeastV10 || catalog.isAtLeastV10
  }

  /// Creates a payload validator scoped to a single catalog.
  ///
  /// - Parameters:
  ///   - catalog: The catalog to validate against.
  ///   - config: Validation configuration options (defaults to `.strict`).
  ///   - fallbackCatalog: Optional fallback catalog for component and function lookup.
  public init(
    catalog: any CatalogProtocol,
    config: ValidationConfig = .strict,
    fallbackCatalog: (any CatalogProtocol)? = nil
  ) {
    self.catalog = catalog.eraseToAnyCatalog()
    self.config = config
    self.fallbackCatalog = fallbackCatalog?.eraseToAnyCatalog()
  }

  // MARK: - Component Validation

  /// Validates a single component JSON value against the catalog schema.
  ///
  /// - Parameter component: A `JSONValue` representing a component definition object.
  /// - Throws: `A2UIValidationError` if the component fails schema or identifier validation.
  public func validateComponent(_ component: JSONValue) throws {
    guard let dict = component.dictionaryValue else {
      throw A2UIValidationError(
        "Component definition must be an object",
        details: [
          A2UIErrorDetail(
            path: "components",
            code: "type_mismatch",
            message: "Component definition must be an object"
          )
        ]
      )
    }
    try validateComponent(dict)
  }

  /// Validates a single component dictionary payload against the catalog schema,
  /// including any nested function calls within its properties.
  ///
  /// - Parameter component: The component property dictionary, including `id` and `component`.
  /// - Throws: `A2UIValidationError` if the component identifier, type, schema, or any nested
  ///   function call fails validation.
  public func validateComponent(_ component: [String: JSONValue]) throws {
    guard let id = component["id"]?.stringValue, !id.isEmpty else {
      throw A2UIValidationError(
        "Field 'id' is required",
        details: [
          A2UIErrorDetail(
            path: "id",
            code: component["id"] == nil ? "missing_field" : "type_mismatch",
            message: component["id"] == nil
              ? "Field 'id' is required"
              : "Field 'id' must be a string"
          )
        ]
      )
    }

    if enforceIdentifiers, !UnicodeIdentifierValidator.isValidIdentifier(id) {
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

    guard let type = component["component"]?.stringValue, !type.isEmpty else {
      throw A2UIValidationError(
        "Field 'component' is required",
        details: [
          A2UIErrorDetail(
            path: "component",
            code: component["component"] == nil ? "missing_field" : "type_mismatch",
            message: component["component"] == nil
              ? "Field 'component' is required"
              : "Field 'component' must be a string"
          )
        ]
      )
    }

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

    guard
      let componentAPI = catalog.components[type] ?? fallbackCatalog?.components[type]
    else {
      guard !config.allowUnknownElements else { return }
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
          let quoteEnd = leaf.message[leaf.message.index(after: quoteStart)...].firstIndex(of: "'")
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

    try validateNestedFunctions(in: .object(OrderedDictionary(uniqueKeysWithValues: component)))
  }

  // MARK: - Function Validation

  /// Validates a function call JSON value against the catalog.
  ///
  /// - Parameter functionCall: A `JSONValue` representing a function call object containing
  ///   `call` (or `function`) and optional `args`.
  /// - Throws: `A2UIValidationError` if the function call fails validation.
  public func validateFunction(_ functionCall: JSONValue) throws {
    guard let dict = functionCall.dictionaryValue else {
      throw A2UIValidationError(
        "Function call must be an object",
        details: [
          A2UIErrorDetail(
            path: "functions",
            code: "type_mismatch",
            message: "Function call must be an object"
          )
        ]
      )
    }
    try validateFunction(dict)
  }

  /// Validates a function call dictionary against the catalog.
  ///
  /// - Parameter functionCall: Dictionary containing `call` (or `function`) and optional `args`.
  /// - Throws: `A2UIValidationError` if the function call fails validation.
  public func validateFunction(_ functionCall: [String: JSONValue]) throws {
    guard
      let name = (functionCall["call"] ?? functionCall["function"])?.stringValue,
      !name.isEmpty
    else {
      throw A2UIValidationError(
        "Function call is missing required 'call' property",
        details: [
          A2UIErrorDetail(
            path: "call",
            code: "missing_field",
            message: "Function call is missing required 'call' property"
          )
        ]
      )
    }
    let argsValue = functionCall["args"]
    if let argsValue, argsValue != .null, argsValue.objectValue == nil {
      throw A2UIValidationError(
        "Function arguments for '\(name)' must be an object",
        details: [
          A2UIErrorDetail(
            path: "functions.\(name).args",
            code: "type_mismatch",
            message: "Function arguments for '\(name)' must be an object"
          )
        ]
      )
    }
    try validateFunction(name: name, args: argsValue?.dictionaryValue)
  }

  /// Validates a function call's name and arguments against the catalog definition.
  ///
  /// - Parameters:
  ///   - name: The name of the function being called.
  ///   - args: Optional dictionary of arguments supplied to the function.
  /// - Throws: `A2UIValidationError` if the function name, argument keys, argument count,
  ///   or argument values fail validation.
  public func validateFunction(
    name: String,
    args: [String: JSONValue]? = nil
  ) throws {
    try validateFunctionInternal(name: name, args: args, allowDynamicArgValues: false)
  }

  private func validateFunctionInternal(
    name: String,
    args: [String: JSONValue]?,
    allowDynamicArgValues: Bool
  ) throws {
    try assertFunctionIdentifiers(name: name, args: args)

    let fn: (any FunctionImplementation)? =
      catalog.functions[name]
      ?? fallbackCatalog?.functions[name]
      ?? (enforceIdentifiers && name == "@index" ? IndexFunction() : nil)

    guard let fn else {
      guard !config.allowUnknownElements else { return }
      let msg = "Unrecognized function '\(name)'"
      throw A2UIValidationError(
        msg,
        details: [
          A2UIErrorDetail(
            path: "functions.\(name)",
            code: "unknown_function",
            message: msg
          )
        ]
      )
    }

    let normalizedArgs = args ?? [:]
    let argsInstance: JSONValue = .object(OrderedDictionary(uniqueKeysWithValues: normalizedArgs))

    if allowDynamicArgValues && containsDynamicExpression(in: normalizedArgs) {
      let schemaJSON = fn.api.schema.jsonValue
      if let requiredKeys = schemaJSON["required"]?.arrayValue?.compactMap(\.stringValue) {
        for reqKey in requiredKeys where normalizedArgs[reqKey] == nil {
          let msg = "Missing required argument '\(reqKey)' for function '\(name)'"
          throw A2UIValidationError(
            msg,
            details: [
              A2UIErrorDetail(
                path: "functions.\(name).\(reqKey)",
                code: "missing_field",
                message: msg
              )
            ]
          )
        }
      }
      return
    }

    let result = fn.api.schema.validate(argsInstance)
    if !result.isValid {
      var leafErrors: [JSONSchema.ValidationError] = []
      if let schemaErrors = result.errors {
        for schemaError in schemaErrors {
          leafErrors.append(contentsOf: extractLeafErrors(from: schemaError))
        }
      }
      let leafMessages = leafErrors.map(\.message)
      let errorMessage =
        leafMessages.isEmpty
        ? (result.errors?.first?.message ?? "Validation failed for function '\(name)'")
        : leafMessages.joined(separator: "; ")
      var details: [A2UIErrorDetail] = []
      for leaf in leafErrors {
        let pointer = leaf.instanceLocation.jsonPointerString
        let trimmed = pointer.hasPrefix("/") ? String(pointer.dropFirst()) : pointer
        let path = trimmed.isEmpty ? "functions.\(name)" : "functions.\(name).\(trimmed)"
        let code = leaf.keyword == "required" ? "missing_field" : "invalid_value"
        details.append(A2UIErrorDetail(path: path, code: code, message: leaf.message))
      }
      if details.isEmpty {
        details.append(
          A2UIErrorDetail(
            path: "functions.\(name)",
            code: "invalid_value",
            message: errorMessage
          )
        )
      }
      throw A2UIValidationError(errorMessage, details: details)
    }
  }

  private func assertFunctionIdentifiers(
    name: String,
    args: [String: JSONValue]?
  ) throws {
    guard UnicodeIdentifierValidator.isValidFunctionIdentifier(name) else {
      let msg = "Invalid function identifier: '\(name)'"
      throw A2UIValidationError(
        msg,
        details: [
          A2UIErrorDetail(
            path: "functions.\(name)",
            code: "invalid_identifier",
            message: msg
          )
        ]
      )
    }

    guard let args else { return }

    if args.count > Self.maxFunctionCallArgs {
      let msg =
        "Function call '\(name)' exceeds maximum allowed arguments count "
        + "(\(Self.maxFunctionCallArgs))"
      throw A2UIValidationError(
        msg,
        details: [
          A2UIErrorDetail(
            path: "functions.\(name)",
            code: "too_many_arguments",
            message: msg
          )
        ]
      )
    }

    if enforceIdentifiers {
      for argName in args.keys where !UnicodeIdentifierValidator.isValidIdentifier(argName) {
        let msg =
          "Function argument '\(argName)' in function '\(name)' must be a valid UAX #31 identifier"
        throw A2UIValidationError(
          msg,
          details: [
            A2UIErrorDetail(
              path: "functions.\(name).\(argName)",
              code: "invalid_identifier",
              message: msg
            )
          ]
        )
      }
    }
  }

  private func validateNestedFunctions(in value: JSONValue) throws {
    switch value {
    case .array(let items):
      for item in items {
        try validateNestedFunctions(in: item)
      }

    case .object(let dict):
      if let rawName = (dict["call"] ?? dict["function"])?.stringValue, !rawName.isEmpty {
        let rawArgs = dict["args"]?.dictionaryValue
        let callCatalogID = dict["catalogId"]?.stringValue
        let targetsThisCatalog =
          callCatalogID == nil
          || callCatalogID?.isEmpty == true
          || callCatalogID == catalog.id
          || (callCatalogID.map { catalog.id.hasSuffix("/\($0)/catalog.json") } ?? false)

        if !targetsThisCatalog {
          try assertFunctionIdentifiers(name: rawName, args: rawArgs)
        } else if !catalog.functions.isEmpty || fallbackCatalog?.functions.isEmpty == false {
          try validateFunctionInternal(
            name: rawName,
            args: rawArgs,
            allowDynamicArgValues: true
          )
        } else {
          try assertFunctionIdentifiers(name: rawName, args: rawArgs)
        }
      }

      for (key, propValue) in dict where key != "id" && key != "component" {
        try validateNestedFunctions(in: propValue)
      }

    default:
      break
    }
  }

  private func containsDynamicExpression(in args: [String: JSONValue]) -> Bool {
    args.values.contains(where: { isDynamicExpression($0) })
  }

  private func isDynamicExpression(_ value: JSONValue) -> Bool {
    switch value {
    case .object(let dict):
      if dict["path"] != nil || dict["call"] != nil || dict["function"] != nil {
        return true
      }
      return dict.values.contains(where: { isDynamicExpression($0) })
    case .array(let items):
      return items.contains(where: { isDynamicExpression($0) })
    default:
      return false
    }
  }

  // MARK: - Theme Validation

  /// Validates a surface theme dictionary against the catalog's theme schema.
  ///
  /// If the catalog declares no `themeSchema`, any theme is accepted.
  ///
  /// - Parameter theme: The theme dictionary supplied on `createSurface`.
  /// - Throws: `A2UIValidationError` if the theme fails schema validation.
  public func validateTheme(_ theme: [String: JSONValue]?) throws {
    guard let theme else { return }
    let instance: JSONValue = .object(OrderedDictionary(uniqueKeysWithValues: theme))
    try validateTheme(instance)
  }

  /// Validates a surface theme `JSONValue` against the catalog's theme schema.
  ///
  /// If the catalog declares no `themeSchema`, any theme object is accepted.
  ///
  /// - Parameter theme: The theme `JSONValue` supplied on `createSurface`.
  /// - Throws: `A2UIValidationError` if the theme is not an object or fails schema validation.
  public func validateTheme(_ theme: JSONValue) throws {
    guard theme != .null else { return }
    guard theme.objectValue != nil else {
      throw A2UIValidationError(
        "Theme payload must be an object",
        details: [
          A2UIErrorDetail(
            path: "theme",
            code: "type_mismatch",
            message: "Theme payload must be an object"
          )
        ]
      )
    }

    guard let themeSchema = catalog.themeSchema else { return }
    let validationResult = themeSchema.validate(theme, at: .init())
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
        ? (validationResult.errors?.first?.message
          ?? "Surface theme failed catalog theme schema validation")
        : leafMessages.joined(separator: "; ")
      var details: [A2UIErrorDetail] = []
      for leaf in leafErrors {
        let pointer = leaf.instanceLocation.jsonPointerString
        let trimmed = pointer.hasPrefix("/") ? String(pointer.dropFirst()) : pointer
        let path = trimmed.isEmpty ? "theme" : "theme.\(trimmed)"
        let code = leaf.keyword == "required" ? "missing_field" : "invalid_value"
        details.append(A2UIErrorDetail(path: path, code: code, message: leaf.message))
      }
      if details.isEmpty {
        details.append(
          A2UIErrorDetail(
            path: "theme",
            code: "invalid_value",
            message: errorMessage
          )
        )
      }
      throw A2UIValidationError(errorMessage, details: details)
    }
  }

  // MARK: - Helpers

  private func extractLeafErrors(
    from error: JSONSchema.ValidationError
  ) -> [JSONSchema.ValidationError] {
    if let nested = error.errors, !nested.isEmpty {
      return nested.flatMap { extractLeafErrors(from: $0) }
    }
    return [error]
  }
}
