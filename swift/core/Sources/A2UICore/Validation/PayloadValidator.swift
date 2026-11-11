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

  /// The structural keys that a v1.0 component schema may not declare. They are left out of the
  /// instance checked by a schema that doesn't declare them.
  private static let envelopeKeys = ["id", "component"]

  /// The keys that the shared `ComponentCommon` definition declares.
  private static let componentCommonKeys: Set<String> = [
    "id", "catalogId", "accessibility", "metadata",
  ]

  /// The envelope keys each component schema declares, by component name. Computed once from
  /// v1.0, where undeclared envelope keys are left out of the instance checked by the schema.
  private let declaredEnvelopeKeys: [String: Set<String>]

  private var enforceIdentifiers: Bool {
    Self.enforcesIdentifiers(catalog: catalog, config: config)
  }

  private static func enforcesIdentifiers(catalog: AnyCatalog, config: ValidationConfig) -> Bool {
    if let version = config.protocolVersion {
      return version.isAtLeastV10
    }
    return catalog.isAtLeastV10
  }

  /// `AccessibilityAttributes` from the v0.9.1 and v1.0 common types. Both reference a bundled
  /// common type, so building them can only fail on a developer error.
  private static let v09AccessibilitySchema = try! Schema(
    rawSchema: .object(["$ref": .string(A2UICommonSchema.uri(for: "AccessibilityAttributes"))]),
    context: A2UISchemaRegistry.makeContext()
  )
  private static let v10AccessibilitySchema = try! Schema(
    rawSchema: .object(["$ref": .string(A2UICommonSchema.v10URI(for: "AccessibilityAttributes"))]),
    context: A2UISchemaRegistry.makeContext()
  )

  /// Creates a payload validator scoped to a single catalog.
  ///
  /// - Parameters:
  ///   - catalog: The catalog to validate against.
  ///   - config: Validation configuration options (defaults to `.strict`).
  public init(
    catalog: any CatalogProtocol,
    config: ValidationConfig = .strict
  ) {
    let anyCatalog = catalog.eraseToAnyCatalog()
    self.catalog = anyCatalog
    self.config = config
    if Self.enforcesIdentifiers(catalog: anyCatalog, config: config) {
      self.declaredEnvelopeKeys = anyCatalog.components.mapValues {
        Self.envelopeKeysDeclared(in: $0.schema.jsonValue)
      }
    } else {
      self.declaredEnvelopeKeys = [:]
    }
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
    // Called directly, the validator takes a component that names no catalogId to be in the
    // surface default catalog, and one that names a catalogId to possibly be in another.
    try validateComponent(component, componentNamesCatalog: componentNamesCatalog(component))
  }

  func validateComponent(
    _ component: [String: JSONValue],
    componentNamesCatalog: Bool
  ) throws {
    let (id, type) = try extractAndValidateComponentEnvelope(component)
    let componentAPI = catalog.components[type]
    // Before v1.0 a component has no mixins: bare `catalogId` and `metadata` are properties.
    let envelope =
      enforceIdentifiers
      ? try ComponentEnvelope(
        component: component,
        schema: componentAPI?.schema.jsonValue,
        componentID: id
      )
      : nil

    guard let componentAPI else {
      if config.allowUnknownElements {
        try validateComponentNestedFunctions(
          in: component,
          envelope: envelope,
          type: type,
          componentSchema: nil,
          componentNamesCatalog: componentNamesCatalog
        )
        return
      }
      let msg = "Unknown component type '\(type)' in catalog '\(catalog.id)'"
      throw A2UIValidationError(
        msg,
        details: [
          A2UIErrorDetail(
            path: "component",
            code: "invalid_value",
            message: msg
          ),
          A2UIErrorDetail(
            path: "/\(type)",
            code: "unknown_component",
            message: msg
          ),
        ]
      )
    }

    try validateComponentNestedFunctions(
      in: component,
      envelope: envelope,
      type: type,
      componentSchema: componentAPI.schema.jsonValue,
      componentNamesCatalog: componentNamesCatalog
    )
    try validateComponentSchema(
      component,
      type: type,
      componentAPI: componentAPI,
      envelope: envelope
    )
  }

  /// Returns whether a component names a catalog: in v1.0 its `@catalogId`, or its legacy bare
  /// `catalogId` when its schema doesn't declare a `catalogId` property of its own.
  private func componentNamesCatalog(_ component: [String: JSONValue]) -> Bool {
    guard enforceIdentifiers else { return false }
    let schema = component["component"]?.stringValue.flatMap {
      catalog.components[$0]?.schema.jsonValue
    }
    return ComponentEnvelope.catalogIDEntry(in: component, defaultCatalogSchema: schema) != nil
  }

  private func extractAndValidateComponentEnvelope(
    _ component: [String: JSONValue]
  ) throws -> (id: String, type: String) {
    guard let id = component["id"]?.stringValue, !id.isEmpty else {
      let isMissing = component["id"] == nil
      let msg = isMissing ? "Field 'id' is required" : "Field 'id' must be a string"
      throw A2UIValidationError(
        "Field 'id' is required",
        details: [
          A2UIErrorDetail(
            path: "id",
            code: isMissing ? "missing_field" : "type_mismatch",
            message: msg
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
      let isMissing = component["component"] == nil
      let msg = isMissing ? "Field 'component' is required" : "Field 'component' must be a string"
      throw A2UIValidationError(
        "Field 'component' is required",
        details: [
          A2UIErrorDetail(
            path: "component",
            code: isMissing ? "missing_field" : "type_mismatch",
            message: msg
          )
        ]
      )
    }

    guard !enforceIdentifiers || UnicodeIdentifierValidator.isValidIdentifier(type) else {
      let msg = "Invalid component identifier: '\(type)'"
      throw A2UIValidationError(
        msg,
        details: [
          A2UIErrorDetail(
            path: "/\(type)",
            code: "invalid_identifier",
            message: msg
          )
        ]
      )
    }

    if enforceIdentifiers {
      try validateComponentCatalogID(component, type: type)
    }

    return (id, type)
  }

  /// Checks the catalog a v1.0 component names, under `@catalogId` or legacy `catalogId`.
  ///
  /// - Throws: `A2UIValidationError` when the catalog id is not a non-empty string.
  private func validateComponentCatalogID(_ component: [String: JSONValue], type: String) throws {
    guard
      let entry = ComponentEnvelope.catalogIDEntry(
        in: component,
        defaultCatalogSchema: catalog.components[type]?.schema.jsonValue
      )
    else {
      return
    }
    let path = entry.key == "catalogId" ? CatalogResolutionErrors.componentCatalogIDPath : entry.key
    guard let catalogID = entry.value.stringValue else {
      throw CatalogResolutionErrors.nonStringCatalogID(path: path)
    }
    guard !catalogID.isEmpty else {
      let msg = "Field '\(entry.key)' must be a non-empty string"
      throw A2UIValidationError(
        msg,
        details: [A2UIErrorDetail(path: path, code: "invalid_value", message: msg)]
      )
    }
  }

  private func validateComponentSchema(
    _ component: [String: JSONValue],
    type: String,
    componentAPI: any ComponentAPI,
    envelope: ComponentEnvelope?
  ) throws {
    let schemaJSON = componentAPI.schema.jsonValue
    var schemaTargetDict: [String: JSONValue]
    if let envelope {
      schemaTargetDict = try schemaInstance(
        for: component,
        envelope: envelope,
        type: type,
        schema: schemaJSON
      )
    } else {
      // `accessibility` comes from `ComponentCommon`, so a component schema need not declare
      // it. When it doesn't, check it against `AccessibilityAttributes` and leave it out of the
      // component schema check, so a closed schema doesn't reject it.
      schemaTargetDict = component
      if !Self.schemaDeclaresProperty(
        "accessibility",
        in: schemaJSON,
        root: schemaJSON,
        visitedRefs: []
      ), let accessibility = schemaTargetDict.removeValue(forKey: "accessibility") {
        try validateAccessibility(accessibility)
      }
    }

    let instance: JSONValue = .object(OrderedDictionary(uniqueKeysWithValues: schemaTargetDict))
    let validationResult = componentAPI.schema.validate(instance)
    let leafErrors = collectComponentLeafErrors(
      from: validationResult.errors ?? [],
      componentSchema: componentAPI.schema.jsonValue
    )
    let onlyUnknownProperties =
      config.allowUnknownElements && !(validationResult.errors ?? []).isEmpty && leafErrors.isEmpty
    guard !validationResult.isValid, !onlyUnknownProperties else { return }

    let errorDetails = buildComponentErrorDetails(
      from: leafErrors,
      type: type,
      fallbackMessage: validationResult.errors?.first?.message
    )
    let errorMessage = errorDetails.map(\.message).joined(separator: "; ")
    throw A2UIValidationError(errorMessage, details: errorDetails)
  }

  /// Builds the instance that a v1.0 component schema checks, after checking the component's
  /// mixins on their own.
  ///
  /// The instance holds the component's own properties, and `id` and `component` when the schema
  /// declares them. Checks stay in it, under the name the component schema gives them (the shared
  /// v1.0 `Checkable` definition calls them `@checks`), so the schema checks their rules.
  ///
  /// - Throws: `A2UIValidationError` when a mixin is invalid, or when a component that is not
  ///   checkable carries checks.
  private func schemaInstance(
    for component: [String: JSONValue],
    envelope: ComponentEnvelope,
    type: String,
    schema: JSONValue
  ) throws -> [String: JSONValue] {
    var instance = envelope.properties
    let declaredKeys = declaredEnvelopeKeys[type] ?? Self.envelopeKeysDeclared(in: schema)
    for key in Self.envelopeKeys where declaredKeys.contains(key) {
      instance[key] = component[key]
    }
    if let metadata = envelope[.metadata] {
      let key = envelope.key(of: .metadata) ?? ComponentEnvelope.Mixin.metadata.prefixedKey
      _ = try MetadataValidator.validate(metadata, pathPrefix: key)
    }
    if let accessibility = envelope[.accessibility] {
      let key =
        envelope.key(of: .accessibility) ?? ComponentEnvelope.Mixin.accessibility.prefixedKey
      try validateAccessibility(accessibility, key: key)
    }
    if let checks = envelope[.checks] {
      let key = envelope.key(of: .checks) ?? ComponentEnvelope.Mixin.checks.prefixedKey
      guard ComponentEnvelope.isCheckable(schema) else {
        let msg =
          "Validation failed for component '\(type)': '\(key)' is not allowed on a "
          + "component that is not checkable"
        throw A2UIValidationError(
          msg,
          details: [A2UIErrorDetail(path: key, code: "invalid_value", message: msg)]
        )
      }
      // The shared v1.0 `Checkable` definition names the mixin `@checks`, so the checks go
      // under `@checks` unless the component schema itself declares a bare `checks` list of
      // check rules as the mixin. A custom bare `checks` property is never overwritten.
      let declaresBare = Self.schemaDeclaresProperty(
        ComponentEnvelope.Mixin.checks.bareKey,
        in: schema,
        root: schema,
        visitedRefs: []
      )
      let declaresPrefixed = Self.schemaDeclaresProperty(
        ComponentEnvelope.Mixin.checks.prefixedKey,
        in: schema,
        root: schema,
        visitedRefs: []
      )
      let bareIsChecksMixin =
        declaresBare && !ComponentEnvelope.declaresOwnProperty(.checks, in: schema)
      instance[declaresPrefixed || !bareIsChecksMixin ? "@checks" : "checks"] = checks
    }
    // TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
    for key in Array(instance.keys) where key != "@checks" && key != "checks" {
      if let value = instance[key],
        let propSchema = ComponentEnvelope.resolvedSubschema(
          forProperty: key,
          in: schema,
          root: schema
        )
      {
        instance[key] = Self.normalizeV10ValueForSchema(
          value,
          schema: propSchema,
          rootSchema: schema
        )
      }
    }
    return instance
  }

  /// Rejects v1.0 `@`-prefixed component directives (`@child`, `@action`, `@functionCall`, and
  /// mixins) on a component before v1.0, unless declared by the component schema.
  private func rejectUndeclaredPrefixedMixins(
    in component: [String: JSONValue],
    type: String,
    schema: JSONValue?
  ) throws {
    let effectiveSchema = schema ?? .object([:])
    for key in ComponentEnvelope.prefixedKeys.sorted() where component[key] != nil {
      guard !Self.schemaDeclaresProperty(
        key,
        in: effectiveSchema,
        root: effectiveSchema,
        visitedRefs: []
      ) else {
        continue
      }
      let msg =
        "Validation failed for component '\(type)': '\(key)' is a v1.0 component key "
        + "and is not allowed before v1.0"
      throw A2UIValidationError(
        msg,
        details: [A2UIErrorDetail(path: key, code: "invalid_value", message: msg)]
      )
    }
  }

  private func collectComponentLeafErrors(
    from schemaErrors: [JSONSchema.ValidationError],
    componentSchema: JSONValue
  ) -> [JSONSchema.ValidationError] {
    var leafErrors: [JSONSchema.ValidationError] = []
    for schemaError in schemaErrors {
      if config.allowUnknownElements {
        leafErrors.append(
          contentsOf: Self.leafErrorsIgnoringUnknownProperties(
            from: schemaError,
            componentSchema: componentSchema
          )
        )
      } else {
        leafErrors.append(contentsOf: extractLeafErrors(from: schemaError))
      }
    }
    return leafErrors
  }

  private func buildComponentErrorDetails(
    from leafErrors: [JSONSchema.ValidationError],
    type: String,
    fallbackMessage: String?
  ) -> [A2UIErrorDetail] {
    var errorDetails: [A2UIErrorDetail] = []
    for leaf in leafErrors {
      errorDetails.append(makeComponentErrorDetail(from: leaf, type: type))
    }
    if errorDetails.isEmpty {
      let fallback = fallbackMessage ?? "Component validation failed"
      let msg = "Validation failed for component '\(type)': \(fallback)"
      errorDetails.append(A2UIErrorDetail(path: "/\(type)", code: "invalid_value", message: msg))
    }
    return errorDetails
  }

  private func makeComponentErrorDetail(
    from leaf: JSONSchema.ValidationError,
    type: String
  ) -> A2UIErrorDetail {
    let pointer = leaf.instanceLocation.jsonPointerString
    let trimmedPath = pointer.hasPrefix("/") ? String(pointer.dropFirst()) : pointer
    if leaf.keyword == "required",
      let missingProp = Self.extractSingleQuotedToken(from: leaf.message)
    {
      let fieldPath = trimmedPath.isEmpty ? missingProp : "\(trimmedPath).\(missingProp)"
      let msg = "Validation failed for component '\(type)' at '\(fieldPath)': \(leaf.message)"
      return A2UIErrorDetail(path: fieldPath, code: "missing_field", message: msg)
    }
    let path = trimmedPath.isEmpty ? "/\(type)" : trimmedPath
    let msg =
      trimmedPath.isEmpty
      ? "Validation failed for component '\(type)': \(leaf.message)"
      : "Validation failed for component '\(type)' at '\(trimmedPath)': \(leaf.message)"
    return A2UIErrorDetail(path: path, code: "invalid_value", message: msg)
  }

  private static func extractSingleQuotedToken(from text: String) -> String? {
    guard let quoteStart = text.firstIndex(of: "'"),
      let quoteEnd = text[text.index(after: quoteStart)...].firstIndex(of: "'")
    else {
      return nil
    }
    return String(text[text.index(after: quoteStart)..<quoteEnd])
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
      let name = (functionCall["@call"] ?? functionCall["call"] ?? functionCall["function"])?
        .stringValue,
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

  func validateFunctionInternal(
    name: String,
    args: [String: JSONValue]?,
    allowDynamicArgValues: Bool
  ) throws {
    try assertFunctionIdentifiers(name: name, args: args)

    guard let function = resolveCatalogOrSystemFunction(name: name) else {
      let isSystemName = enforceIdentifiers && name.hasPrefix("@")
      guard isSystemName || !config.allowUnknownElements else { return }
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
    if allowDynamicArgValues && containsDynamicExpression(in: normalizedArgs) {
      try validateRequiredKeysOnly(
        name: name,
        args: normalizedArgs,
        schemaJSON: function.api.schema.jsonValue
      )
      return
    }

    let argsInstance: JSONValue = .object(OrderedDictionary(uniqueKeysWithValues: normalizedArgs))
    let result = function.api.schema.validate(argsInstance)
    guard !result.isValid else { return }
    throw buildFunctionSchemaValidationError(name: name, result: result)
  }

  /// Throws if the renderer may not call `name`, a function of this catalog.
  ///
  /// A call held in a component (a property binding, a check or an action) is made by the
  /// renderer. In v1.0 a function whose `allowedCallers` is `agentOnly` runs only for an agent's
  /// `callRendererFunction`, so it can't be bound into a component; `DataContext` refuses such
  /// a call when it is evaluated. `allowedCallers` is a v1.0 feature, so v0.9 calls are not
  /// restricted.
  ///
  /// - Parameter name: The called function.
  /// - Throws: `A2UIValidationError` if the catalog declares the function `agentOnly`. Its
  ///   detail is at `functions.<name>`, which `remapNestedFunctionError` moves to the call's
  ///   location.
  func assertRendererMayCall(_ name: String) throws {
    guard enforceIdentifiers, catalog.functions[name]?.api.allowedCallers == .agentOnly else {
      return
    }
    let msg = "Function '\(name)' cannot be called by renderer (allowedCallers is agentOnly)."
    throw A2UIValidationError(
      msg,
      details: [
        A2UIErrorDetail(
          path: "functions.\(name)",
          code: "invalid_function_call",
          message: msg
        )
      ]
    )
  }

  private func resolveCatalogOrSystemFunction(name: String) -> (any FunctionImplementation)? {
    if enforceIdentifiers, name.hasPrefix("@") {
      return name == "@index" ? IndexFunction() : nil
    }
    return catalog.functions[name]
  }

  private func validateRequiredKeysOnly(
    name: String,
    args: [String: JSONValue],
    schemaJSON: JSONValue
  ) throws {
    guard let requiredKeys = schemaJSON["required"]?.arrayValue?.compactMap(\.stringValue) else {
      return
    }
    for reqKey in requiredKeys where args[reqKey] == nil {
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

  private func buildFunctionSchemaValidationError(
    name: String,
    result: JSONSchema.ValidationResult
  ) -> A2UIValidationError {
    let leafErrors = (result.errors ?? []).flatMap { extractLeafErrors(from: $0) }
    var leafMessages: [String] = []
    var details: [A2UIErrorDetail] = []
    for leaf in leafErrors {
      let pointer = leaf.instanceLocation.jsonPointerString
      let trimmed = pointer.hasPrefix("/") ? String(pointer.dropFirst()) : pointer
      let path = trimmed.isEmpty ? "functions.\(name)" : "functions.\(name).\(trimmed)"
      let code = leaf.keyword == "required" ? "missing_field" : "invalid_value"
      let msg =
        trimmed.isEmpty || leaf.message.contains(trimmed)
        ? leaf.message
        : "\(trimmed): \(leaf.message)"
      leafMessages.append(msg)
      details.append(A2UIErrorDetail(path: path, code: code, message: msg))
    }
    let errorMessage =
      leafMessages.isEmpty
      ? (result.errors?.first?.message ?? "Validation failed for function '\(name)'")
      : leafMessages.joined(separator: "; ")
    if details.isEmpty {
      details.append(
        A2UIErrorDetail(
          path: "functions.\(name)",
          code: "invalid_value",
          message: errorMessage
        )
      )
    }
    return A2UIValidationError(errorMessage, details: details)
  }

  func assertFunctionIdentifiers(
    name: String,
    args: [String: JSONValue]?
  ) throws {
    if enforceIdentifiers {
      if name.hasPrefix("@") {
        guard name == "@index" else {
          let msg = "Unrecognized system function '\(name)'"
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
      } else {
        guard UnicodeIdentifierValidator.isValidIdentifier(name) else {
          let msg = "Function name '\(name)' must be a valid UAX #31 identifier"
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
      }
    } else {
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

  private static let v10OnlyDirectives = ["@child", "@action", "@functionCall"]
  private static let v10ActionKeys: Set<String> = ["name", "userMessage", "context"]
  private static let v10FunctionCallKeys: Set<String> = ["@call", "args", "catalogId"]

  private struct NestedValidationFrame {
    let value: JSONValue
    let path: String
    let schema: JSONValue?
    let rootSchema: JSONValue
    let inDynamicValue: Bool
  }

  private func validateComponentNestedFunctions(
    in component: [String: JSONValue],
    envelope: ComponentEnvelope?,
    type: String,
    componentSchema: JSONValue?,
    componentNamesCatalog: Bool
  ) throws {
    if !enforceIdentifiers {
      try rejectUndeclaredPrefixedMixins(in: component, type: type, schema: componentSchema)
    }
    var skippedKeys: Set<String> = ["id", "component"]
    if let envelope {
      // The `@`-prefixed mixins are allowed at the root of a v1.0 component only; nested in a
      // property value they remain unrecognized reserved directives.
      try DataContext.validateDirectives(
        component.keys.filter { !ComponentEnvelope.prefixedKeys.contains($0) },
        allowed: DataContext.reservedDataDirectives,
        pathPrefix: ""
      )
      // The catalog id and metadata hold no function calls.
      skippedKeys.formUnion([
        ComponentEnvelope.Mixin.catalogID.prefixedKey,
        ComponentEnvelope.Mixin.metadata.prefixedKey,
      ])
      for mixin in [ComponentEnvelope.Mixin.catalogID, .metadata] {
        if let key = envelope.key(of: mixin) {
          skippedKeys.insert(key)
        }
      }
    }
    let rootSchema = componentSchema ?? .object([:])
    for (key, propValue) in component where !skippedKeys.contains(key) {
      if !enforceIdentifiers, Self.v10OnlyDirectives.contains(key),
        !Self.schemaDeclaresProperty(key, in: rootSchema, root: rootSchema, visitedRefs: [])
      {
        let msg =
          "Validation failed for component '\(type)': '\(key)' is a v1.0 directive "
          + "and is not allowed before v1.0"
        throw A2UIValidationError(
          msg,
          details: [A2UIErrorDetail(path: key, code: "invalid_value", message: msg)]
        )
      }
      let isAccessibility =
        key == ComponentEnvelope.Mixin.accessibility.prefixedKey
        || (envelope != nil && key == envelope?.key(of: .accessibility))
      let isChecks =
        key == ComponentEnvelope.Mixin.checks.prefixedKey
        || (envelope != nil && key == envelope?.key(of: .checks))
      let propSchema: JSONValue?
      let inDynamicValue: Bool
      if isAccessibility || isChecks {
        propSchema = nil
        inDynamicValue = true
      } else {
        propSchema = componentSchema.flatMap {
          ComponentEnvelope.resolvedSubschema(forProperty: key, in: $0, root: rootSchema)
        }
        inDynamicValue =
          enforceIdentifiers
          && (propSchema.map {
            ComponentEnvelope.isPureDynamicSchema($0, root: rootSchema)
          } ?? false)
      }
      try validateNestedFunctions(
        in: propValue,
        propertyPath: key,
        type: type,
        schema: propSchema,
        rootSchema: rootSchema,
        inDynamicValue: inDynamicValue,
        componentNamesCatalog: componentNamesCatalog
      )
    }
  }

  private func validateNestedFunctions(
    in value: JSONValue,
    propertyPath: String = "",
    type: String = "",
    schema: JSONValue? = nil,
    rootSchema: JSONValue = .object([:]),
    inDynamicValue: Bool = false,
    componentNamesCatalog: Bool = false
  ) throws {
    var stack: [NestedValidationFrame] = [
      NestedValidationFrame(
        value: value,
        path: propertyPath,
        schema: schema,
        rootSchema: rootSchema,
        inDynamicValue: inDynamicValue
      )
    ]
    while let frame = stack.popLast() {
      switch frame.value {
      case .array(let items):
        let itemSchema = frame.schema.flatMap {
          ComponentEnvelope.resolvedArrayItemsSchema(in: $0, root: frame.rootSchema)
        }
        let itemDynamic =
          frame.inDynamicValue
          || (enforceIdentifiers
            && (itemSchema.map {
              ComponentEnvelope.isPureDynamicSchema($0, root: frame.rootSchema)
            } ?? false))
        for (index, item) in items.enumerated().reversed() {
          let itemPath = frame.path.isEmpty ? "\(index)" : "\(frame.path)/\(index)"
          stack.append(
            NestedValidationFrame(
              value: item,
              path: itemPath,
              schema: itemSchema,
              rootSchema: frame.rootSchema,
              inDynamicValue: itemDynamic
            )
          )
        }
      case .object(let dict):
        if enforceIdentifiers {
          try validateV10NestedObject(
            dict,
            frame: frame,
            componentNamesCatalog: componentNamesCatalog,
            pushFramesTo: &stack
          )
        } else {
          try validatePreV10NestedObject(
            dict,
            frame: frame,
            type: type,
            componentNamesCatalog: componentNamesCatalog,
            pushFramesTo: &stack
          )
        }
      default:
        break
      }
    }
  }

  private func validatePreV10NestedObject(
    _ dict: OrderedDictionary<String, JSONValue>,
    frame: NestedValidationFrame,
    type: String,
    componentNamesCatalog: Bool,
    pushFramesTo stack: inout [NestedValidationFrame]
  ) throws {
    for directive in Self.v10OnlyDirectives where dict[directive] != nil {
      let declared =
        frame.schema.map {
          Self.schemaDeclaresProperty(directive, in: $0, root: frame.rootSchema, visitedRefs: [])
        } ?? false
      if !declared {
        let errorPath = frame.path.isEmpty ? directive : "\(frame.path)/\(directive)"
        let msg =
          "Validation failed for component '\(type)': '\(directive)' is a v1.0 directive "
          + "and is not allowed before v1.0"
        throw A2UIValidationError(
          msg,
          details: [A2UIErrorDetail(path: errorPath, code: "invalid_value", message: msg)]
        )
      }
    }
    let callValue = dict["call"] ?? dict["function"]
    if let rawName = callValue?.stringValue, !rawName.isEmpty {
      try validateSingleNestedCall(
        dict: dict,
        rawName: rawName,
        propertyPath: frame.path,
        componentNamesCatalog: componentNamesCatalog
      )
    }
    for (subKey, propValue) in dict.reversed() {
      let nextPath = frame.path.isEmpty ? subKey : "\(frame.path)/\(subKey)"
      let subSchema = frame.schema.flatMap {
        ComponentEnvelope.resolvedSubschema(
          forProperty: subKey,
          in: $0,
          root: frame.rootSchema
        )
      }
      stack.append(
        NestedValidationFrame(
          value: propValue,
          path: nextPath,
          schema: subSchema,
          rootSchema: frame.rootSchema,
          inDynamicValue: false
        )
      )
    }
  }

  private func validateV10NestedObject(
    _ dict: OrderedDictionary<String, JSONValue>,
    frame: NestedValidationFrame,
    componentNamesCatalog: Bool,
    pushFramesTo stack: inout [NestedValidationFrame]
  ) throws {
    let allowed =
      frame.inDynamicValue
      ? DataContext.reservedDataDirectives
      : DataContext.reservedPropertyDirectives
    try DataContext.validateDirectives(dict.keys, allowed: allowed, pathPrefix: frame.path)

    if frame.inDynamicValue {
      if dict["@path"] != nil {
        try validateAtPathDirective(dict, at: frame.path)
        return
      }
      if dict["@call"]?.stringValue != nil {
        try validateAtCallDirective(
          dict,
          at: frame.path,
          componentNamesCatalog: componentNamesCatalog,
          rootSchema: frame.rootSchema,
          pushArgsTo: &stack
        )
        return
      }
      pushPlainObjectChildren(
        dict,
        frame: frame,
        forceDynamic: true,
        to: &stack
      )
      return
    }

    if dict["@child"] != nil {
      try validateAtChildDirective(dict, at: frame.path)
      return
    }
    if dict["@action"] != nil {
      try validateAtActionDirective(
        dict,
        at: frame.path,
        componentNamesCatalog: componentNamesCatalog,
        rootSchema: frame.rootSchema,
        pushFramesTo: &stack
      )
      return
    }
    if dict["@functionCall"] != nil {
      try validateAtFunctionCallDirective(
        dict,
        at: frame.path,
        componentNamesCatalog: componentNamesCatalog,
        rootSchema: frame.rootSchema,
        pushFramesTo: &stack
      )
      return
    }
    if dict["@path"] != nil {
      try validateAtPathDirective(dict, at: frame.path)
      return
    }
    if dict["@call"]?.stringValue != nil {
      try validateAtCallDirective(
        dict,
        at: frame.path,
        componentNamesCatalog: componentNamesCatalog,
        rootSchema: frame.rootSchema,
        pushArgsTo: &stack
      )
      return
    }

    // TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
    let isActionSlot =
      frame.schema.map { Self.isActionSlotSchema($0, root: frame.rootSchema) } ?? false
    if isActionSlot, (dict["event"]?.objectValue != nil || dict["functionCall"] != nil) {
      try validateLegacyActionEntries(dict, frame: frame, pushFramesTo: &stack)
      return
    }

    pushPlainObjectChildren(
      dict,
      frame: frame,
      forceDynamic: false,
      to: &stack
    )
  }

  private func pushPlainObjectChildren(
    _ dict: OrderedDictionary<String, JSONValue>,
    frame: NestedValidationFrame,
    forceDynamic: Bool,
    to stack: inout [NestedValidationFrame]
  ) {
    for (subKey, propValue) in dict.reversed() {
      let nextPath = frame.path.isEmpty ? subKey : "\(frame.path)/\(subKey)"
      let subSchema: JSONValue?
      let subDynamic: Bool
      if forceDynamic {
        subSchema = nil
        subDynamic = true
      } else {
        subSchema = frame.schema.flatMap {
          ComponentEnvelope.resolvedSubschema(
            forProperty: subKey,
            in: $0,
            root: frame.rootSchema
          )
        }
        subDynamic =
          subSchema.map { ComponentEnvelope.isPureDynamicSchema($0, root: frame.rootSchema) }
          ?? false
      }
      stack.append(
        NestedValidationFrame(
          value: propValue,
          path: nextPath,
          schema: subSchema,
          rootSchema: frame.rootSchema,
          inDynamicValue: subDynamic
        )
      )
    }
  }

  // TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
  private func validateLegacyActionEntries(
    _ dict: OrderedDictionary<String, JSONValue>,
    frame: NestedValidationFrame,
    pushFramesTo stack: inout [NestedValidationFrame]
  ) throws {
    let actionSchema = frame.schema
    let root = frame.rootSchema
    for (key, value) in dict.reversed() {
      let nextPath = frame.path.isEmpty ? key : "\(frame.path)/\(key)"
      if key == "event", let eventObj = value.objectValue {
        let eventSchema = actionSchema.flatMap {
          ComponentEnvelope.resolvedSubschema(forProperty: "event", in: $0, root: root)
        }
        try pushLegacyEventChildren(
          eventObj,
          at: nextPath,
          eventSchema: eventSchema,
          rootSchema: root,
          to: &stack
        )
      } else if key == "functionCall" {
        stack.append(
          NestedValidationFrame(
            value: value,
            path: nextPath,
            schema: nil,
            rootSchema: root,
            inDynamicValue: true
          )
        )
      } else {
        let subSchema = actionSchema.flatMap {
          ComponentEnvelope.resolvedSubschema(forProperty: key, in: $0, root: root)
        }
        let subDynamic =
          subSchema.map { ComponentEnvelope.isPureDynamicSchema($0, root: root) } ?? false
        stack.append(
          NestedValidationFrame(
            value: value,
            path: nextPath,
            schema: subSchema,
            rootSchema: root,
            inDynamicValue: subDynamic
          )
        )
      }
    }
  }

  private func pushLegacyEventChildren(
    _ eventObj: OrderedDictionary<String, JSONValue>,
    at eventPath: String,
    eventSchema: JSONValue?,
    rootSchema: JSONValue,
    to stack: inout [NestedValidationFrame]
  ) throws {
    if let ctxVal = eventObj["context"], let ctxObj = ctxVal.objectValue {
      try DataContext.validateDirectives(
        ctxObj.keys,
        allowed: DataContext.reservedDataDirectives,
        pathPrefix: "\(eventPath)/context"
      )
    }
    for (subKey, subVal) in eventObj.reversed() {
      let nextPath = "\(eventPath)/\(subKey)"
      if subKey == "context" {
        if let ctxObj = subVal.objectValue {
          for (ctxKey, ctxEntry) in ctxObj.reversed() {
            stack.append(
              NestedValidationFrame(
                value: ctxEntry,
                path: "\(nextPath)/\(ctxKey)",
                schema: nil,
                rootSchema: rootSchema,
                inDynamicValue: true
              )
            )
          }
        } else {
          stack.append(
            NestedValidationFrame(
              value: subVal,
              path: nextPath,
              schema: nil,
              rootSchema: rootSchema,
              inDynamicValue: true
            )
          )
        }
      } else if subKey == "userMessage" {
        stack.append(
          NestedValidationFrame(
            value: subVal,
            path: nextPath,
            schema: nil,
            rootSchema: rootSchema,
            inDynamicValue: true
          )
        )
      } else {
        let subSchema = eventSchema.flatMap {
          ComponentEnvelope.resolvedSubschema(forProperty: subKey, in: $0, root: rootSchema)
        }
        let subDynamic =
          subSchema.map { ComponentEnvelope.isPureDynamicSchema($0, root: rootSchema) } ?? false
        stack.append(
          NestedValidationFrame(
            value: subVal,
            path: nextPath,
            schema: subSchema,
            rootSchema: rootSchema,
            inDynamicValue: subDynamic
          )
        )
      }
    }
  }

  private func validateAtPathDirective(
    _ dict: OrderedDictionary<String, JSONValue>,
    at path: String
  ) throws {
    for extraKey in dict.keys where extraKey != "@path" {
      throw Self.directiveError(
        path: "\(path)/\(extraKey)",
        code: "invalid_value",
        message: "Unexpected key '\(extraKey)' in '@path' binding"
      )
    }
    guard dict["@path"]?.stringValue != nil else {
      throw Self.directiveError(
        path: "\(path)/@path",
        code: "invalid_value",
        message: "Field '@path' must be a string"
      )
    }
  }

  private func validateAtCallDirective(
    _ dict: OrderedDictionary<String, JSONValue>,
    at path: String,
    componentNamesCatalog: Bool,
    rootSchema: JSONValue,
    pushArgsTo stack: inout [NestedValidationFrame]
  ) throws {
    guard let rawName = dict["@call"]?.stringValue, !rawName.isEmpty else {
      let code = dict["@call"] == nil ? "missing_field" : "invalid_value"
      throw Self.directiveError(
        path: "\(path)/@call",
        code: code,
        message: "Field '@call' must be a non-empty string"
      )
    }
    for extraKey in dict.keys where !Self.v10FunctionCallKeys.contains(extraKey) {
      throw Self.directiveError(
        path: "\(path)/\(extraKey)",
        code: "invalid_value",
        message: "Unexpected key '\(extraKey)' in function call"
      )
    }
    if let argsVal = dict["args"] {
      try Self.validateDynamicReservedKeys(in: argsVal, pathPrefix: "\(path)/args")
    }
    try validateSingleNestedCall(
      dict: dict,
      rawName: rawName,
      propertyPath: path,
      componentNamesCatalog: componentNamesCatalog
    )
    if let argsObj = dict["args"]?.objectValue {
      let argsPath = "\(path)/args"
      for (argKey, argVal) in argsObj.reversed() {
        stack.append(
          NestedValidationFrame(
            value: argVal,
            path: "\(argsPath)/\(argKey)",
            schema: nil,
            rootSchema: rootSchema,
            inDynamicValue: true
          )
        )
      }
    }
  }

  private static func validateDynamicReservedKeys(
    in value: JSONValue,
    pathPrefix: String
  ) throws {
    var stack: [(value: JSONValue, path: String)] = [(value, pathPrefix)]
    while let current = stack.popLast() {
      switch current.value {
      case .array(let items):
        for (index, item) in items.enumerated().reversed() {
          stack.append((item, "\(current.path)/\(index)"))
        }
      case .object(let dict):
        try DataContext.validateDirectives(
          dict.keys,
          allowed: DataContext.reservedDataDirectives,
          pathPrefix: current.path
        )
        for (subKey, subVal) in dict.reversed() {
          stack.append((subVal, "\(current.path)/\(subKey)"))
        }
      default:
        break
      }
    }
  }

  private func validateAtChildDirective(
    _ dict: OrderedDictionary<String, JSONValue>,
    at path: String
  ) throws {
    for extraKey in dict.keys where extraKey != "@child" && extraKey != "@path" {
      throw Self.directiveError(
        path: "\(path)/\(extraKey)",
        code: "invalid_value",
        message: "Unexpected key '\(extraKey)' in '@child' directive"
      )
    }
    if dict["@path"] != nil {
      guard let templateID = dict["@child"]?.stringValue, !templateID.isEmpty else {
        throw Self.directiveError(
          path: "\(path)/@child",
          code: "invalid_value",
          message: "Field '@child' must be a non-empty string when '@path' is specified"
        )
      }
      guard let pathStr = dict["@path"]?.stringValue, !pathStr.isEmpty else {
        throw Self.directiveError(
          path: "\(path)/@path",
          code: "invalid_value",
          message: "Field '@path' in '@child' template must be a non-empty string"
        )
      }
      return
    }
    switch dict["@child"] {
    case .some(.string(let id)) where !id.isEmpty:
      return
    case .some(.array(let items)):
      for (index, item) in items.enumerated() {
        guard let id = item.stringValue, !id.isEmpty else {
          throw Self.directiveError(
            path: "\(path)/@child/\(index)",
            code: "invalid_value",
            message: "Each entry in '@child' list must be a non-empty component ID string"
          )
        }
      }
    default:
      throw Self.directiveError(
        path: "\(path)/@child",
        code: "invalid_value",
        message: "Field '@child' must be a non-empty component ID or array of component IDs"
      )
    }
  }

  private func validateAtActionDirective(
    _ dict: OrderedDictionary<String, JSONValue>,
    at path: String,
    componentNamesCatalog: Bool,
    rootSchema: JSONValue,
    pushFramesTo stack: inout [NestedValidationFrame]
  ) throws {
    for extraKey in dict.keys where extraKey != "@action" {
      throw Self.directiveError(
        path: "\(path)/\(extraKey)",
        code: "invalid_value",
        message: "Unexpected key '\(extraKey)' beside '@action'"
      )
    }
    guard let actionObj = dict["@action"]?.objectValue else {
      throw Self.directiveError(
        path: "\(path)/@action",
        code: "invalid_value",
        message: "Field '@action' must be an object"
      )
    }
    let actionPath = "\(path)/@action"
    for extraKey in actionObj.keys where !Self.v10ActionKeys.contains(extraKey) {
      throw Self.directiveError(
        path: "\(actionPath)/\(extraKey)",
        code: "invalid_value",
        message: "Unexpected key '\(extraKey)' in '@action' object"
      )
    }
    if actionObj["name"] == nil {
      throw Self.directiveError(
        path: "\(actionPath)/name",
        code: "missing_field",
        message: "Missing required field 'name' in '@action'"
      )
    }
    guard let name = actionObj["name"]?.stringValue, !name.isEmpty else {
      throw Self.directiveError(
        path: "\(actionPath)/name",
        code: "invalid_value",
        message: "Field 'name' in '@action' must be a non-empty string"
      )
    }
    if let rawContext = actionObj["context"] {
      let ctxPath = "\(actionPath)/context"
      guard let ctxObj = rawContext.objectValue else {
        throw Self.directiveError(
          path: ctxPath,
          code: "invalid_value",
          message: "Field 'context' in '@action' must be an object"
        )
      }
      try DataContext.validateDirectives(
        ctxObj.keys,
        allowed: DataContext.reservedDataDirectives,
        pathPrefix: ctxPath
      )
      for (ctxKey, ctxVal) in ctxObj.reversed() {
        stack.append(
          NestedValidationFrame(
            value: ctxVal,
            path: "\(ctxPath)/\(ctxKey)",
            schema: nil,
            rootSchema: rootSchema,
            inDynamicValue: true
          )
        )
      }
    }
    if let userMsg = actionObj["userMessage"] {
      let msgPath = "\(actionPath)/userMessage"
      switch userMsg {
      case .string:
        break
      case .object(let msgDict):
        try DataContext.validateDirectives(
          msgDict.keys,
          allowed: DataContext.reservedDataDirectives,
          pathPrefix: msgPath
        )
        if msgDict["@path"] != nil {
          try validateAtPathDirective(msgDict, at: msgPath)
        } else if msgDict["@call"] != nil {
          try validateAtCallDirective(
            msgDict,
            at: msgPath,
            componentNamesCatalog: componentNamesCatalog,
            rootSchema: rootSchema,
            pushArgsTo: &stack
          )
        } else {
          throw Self.directiveError(
            path: msgPath,
            code: "invalid_value",
            message: "Field 'userMessage' in '@action' must be a DynamicString"
          )
        }
      default:
        throw Self.directiveError(
          path: msgPath,
          code: "invalid_value",
          message: "Field 'userMessage' in '@action' must be a DynamicString"
        )
      }
    }
  }

  private func validateAtFunctionCallDirective(
    _ dict: OrderedDictionary<String, JSONValue>,
    at path: String,
    componentNamesCatalog: Bool,
    rootSchema: JSONValue,
    pushFramesTo stack: inout [NestedValidationFrame]
  ) throws {
    for extraKey in dict.keys where extraKey != "@functionCall" {
      throw Self.directiveError(
        path: "\(path)/\(extraKey)",
        code: "invalid_value",
        message: "Unexpected key '\(extraKey)' beside '@functionCall'"
      )
    }
    let fnPath = "\(path)/@functionCall"
    guard let fnObj = dict["@functionCall"]?.objectValue else {
      throw Self.directiveError(
        path: fnPath,
        code: "invalid_value",
        message: "Field '@functionCall' must be an object"
      )
    }
    try DataContext.validateDirectives(
      fnObj.keys,
      allowed: DataContext.reservedDataDirectives,
      pathPrefix: fnPath
    )
    try validateAtCallDirective(
      fnObj,
      at: fnPath,
      componentNamesCatalog: componentNamesCatalog,
      rootSchema: rootSchema,
      pushArgsTo: &stack
    )
  }

  private static func directiveError(
    path: String,
    code: String,
    message: String
  ) -> A2UIValidationError {
    A2UIValidationError(
      message,
      details: [A2UIErrorDetail(path: path, code: code, message: message)]
    )
  }

  private func validateSingleNestedCall(
    dict: OrderedDictionary<String, JSONValue>,
    rawName: String,
    propertyPath: String,
    componentNamesCatalog: Bool
  ) throws {
    if enforceIdentifiers {
      guard dict["catalogId"] == nil || dict["catalogId"]?.stringValue != nil else {
        throw CatalogResolutionErrors.nonStringCatalogID(
          path: CatalogResolutionErrors.callCatalogIDPath(functionName: rawName)
        )
      }
      if let rawArgs = dict["args"], rawArgs != .null {
        guard rawArgs.objectValue != nil else {
          throw CatalogResolutionErrors.nonObjectArguments(functionName: rawName)
        }
      }
    }
    let rawArgs = dict["args"]?.dictionaryValue

    do {
      if enforceIdentifiers, rawName.hasPrefix("@") {
        try validateNestedSystemCall(dict: dict, rawName: rawName, rawArgs: rawArgs)
      } else if nestedCallRunsInCatalog(
        callDict: dict,
        componentNamesCatalog: componentNamesCatalog
      ) {
        try assertRendererMayCall(rawName)
        try validateFunctionInternal(
          name: rawName,
          args: rawArgs,
          allowDynamicArgValues: true
        )
      } else {
        try assertFunctionIdentifiers(name: rawName, args: rawArgs)
      }
    } catch let error as A2UIValidationError {
      throw Self.remapNestedFunctionError(
        error,
        functionName: rawName,
        propertyPath: propertyPath
      )
    }
  }

  private func validateNestedSystemCall(
    dict: OrderedDictionary<String, JSONValue>,
    rawName: String,
    rawArgs: [String: JSONValue]?
  ) throws {
    try assertFunctionIdentifiers(name: rawName, args: rawArgs)
    if dict["catalogId"] != nil {
      let msg =
        "System function '\(rawName)' belongs to no catalog and must not specify a catalogId"
      throw A2UIValidationError(
        msg,
        details: [
          A2UIErrorDetail(
            path: CatalogResolutionErrors.callCatalogIDPath(functionName: rawName),
            code: "invalid_value",
            message: msg
          )
        ]
      )
    }
    try validateFunctionInternal(
      name: rawName,
      args: rawArgs,
      allowDynamicArgValues: true
    )
  }

  static func remapNestedFunctionError(
    _ error: A2UIValidationError,
    functionName: String,
    propertyPath: String
  ) -> A2UIValidationError {
    guard !propertyPath.isEmpty else { return error }
    let prefix = "functions.\(functionName)"
    let mappedDetails = error.details.map { detail -> A2UIErrorDetail in
      if detail.path == prefix {
        return A2UIErrorDetail(path: propertyPath, code: detail.code, message: detail.message)
      }
      if detail.path.hasPrefix(prefix + ".") {
        let argSubpath = String(detail.path.dropFirst(prefix.count + 1))
          .replacingOccurrences(of: ".", with: "/")
        return A2UIErrorDetail(
          path: "\(propertyPath)/args/\(argSubpath)",
          code: detail.code,
          message: detail.message
        )
      }
      return detail
    }
    return A2UIValidationError(error.message, details: mappedDetails)
  }

  private func nestedCallRunsInCatalog(
    callDict: OrderedDictionary<String, JSONValue>,
    componentNamesCatalog: Bool
  ) -> Bool {
    // Before v1.0 a call can't select a catalog: it always runs in the surface catalog.
    guard enforceIdentifiers else {
      return true
    }
    if let rawCallCatalogID = callDict["catalogId"] {
      return rawCallCatalogID.stringValue == catalog.id
    }
    return !componentNamesCatalog
  }

  /// Returns the structural keys (`id`, `component`) that a component schema declares or
  /// requires.
  ///
  /// A key is declared when the schema lists it under `properties`, directly, through a local
  /// `$ref` into the schema's own definitions, or through `allOf`, `anyOf`, or `oneOf`. A `$ref`
  /// to another document's `ComponentCommon` declares `id`. A key is required when the schema
  /// lists it under `required` the same ways.
  private static func envelopeKeysDeclared(in schema: JSONValue) -> Set<String> {
    Set(
      envelopeKeys.filter {
        schemaDeclaresProperty($0, in: schema, root: schema, visitedRefs: [])
          || schemaRequiresProperty($0, in: schema, root: schema, visitedRefs: [])
      }
    )
  }

  private static func schemaRequiresProperty(
    _ key: String,
    in schema: JSONValue,
    root: JSONValue,
    visitedRefs: Set<String>
  ) -> Bool {
    if schema["required"]?.arrayValue?.contains(.string(key)) == true {
      return true
    }
    var visitedRefs = visitedRefs
    if let ref = schema["$ref"]?.stringValue, ref.hasPrefix("#"),
      visitedRefs.insert(ref).inserted,
      let target = ComponentEnvelope.resolveLocalRef(ref, in: root),
      schemaRequiresProperty(key, in: target, root: root, visitedRefs: visitedRefs)
    {
      return true
    }
    for combiner in ["allOf", "anyOf", "oneOf"] {
      if let subSchemas = schema[combiner]?.arrayValue,
        subSchemas.contains(where: {
          schemaRequiresProperty(key, in: $0, root: root, visitedRefs: visitedRefs)
        })
      {
        return true
      }
    }
    return false
  }

  private static func schemaDeclaresProperty(
    _ key: String,
    in schema: JSONValue,
    root: JSONValue,
    visitedRefs: Set<String>
  ) -> Bool {
    guard schema["properties"]?.objectValue?[key] == nil else {
      return true
    }
    var visitedRefs = visitedRefs
    if let ref = schema["$ref"]?.stringValue {
      if ref.hasPrefix("#") {
        if visitedRefs.insert(ref).inserted,
          let target = ComponentEnvelope.resolveLocalRef(ref, in: root),
          schemaDeclaresProperty(key, in: target, root: root, visitedRefs: visitedRefs)
        {
          return true
        }
      } else if ref.hasSuffix("/ComponentCommon"), componentCommonKeys.contains(key) {
        return true
      }
    }
    for combiner in ["allOf", "anyOf", "oneOf"] {
      if let subSchemas = schema[combiner]?.arrayValue,
        subSchemas.contains(where: {
          schemaDeclaresProperty(key, in: $0, root: root, visitedRefs: visitedRefs)
        })
      {
        return true
      }
    }
    return false
  }

  private enum V10SlotKind {
    case singleChild(expectsAt: Bool)
    case childList(expectsAt: Bool)
    case componentIDArray
    case action(expectsAt: Bool)
  }

  private static func isActionSlotSchema(_ schema: JSONValue, root: JSONValue) -> Bool {
    if case .action = classifyV10Slot(schema, root: root) {
      return true
    }
    return false
  }

  // TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
  private static func normalizeV10ValueForSchema(
    _ value: JSONValue,
    schema: JSONValue,
    rootSchema: JSONValue
  ) -> JSONValue {
    guard value != .null else { return value }
    if let slotKind = classifyV10Slot(schema, root: rootSchema) {
      return normalizeSlotValue(value, for: slotKind)
    }
    switch value {
    case .array(let items):
      guard let itemSchema = ComponentEnvelope.resolvedArrayItemsSchema(
        in: schema,
        root: rootSchema
      ) else {
        return value
      }
      return .array(
        items.map { normalizeV10ValueForSchema($0, schema: itemSchema, rootSchema: rootSchema) }
      )
    case .object(let dict):
      var updated = dict
      for (key, propValue) in dict {
        if let subSchema = ComponentEnvelope.resolvedSubschema(
          forProperty: key,
          in: schema,
          root: rootSchema
        ) {
          updated[key] = normalizeV10ValueForSchema(
            propValue,
            schema: subSchema,
            rootSchema: rootSchema
          )
        }
      }
      return .object(updated)
    default:
      return value
    }
  }

  private static func normalizeSlotValue(
    _ value: JSONValue,
    for slotKind: V10SlotKind
  ) -> JSONValue {
    switch slotKind {
    case .singleChild(let expectsAt):
      if expectsAt {
        if let id = value.stringValue {
          return .object(["@child": .string(id)])
        }
      } else if let obj = value.objectValue, obj.count == 1, let id = obj["@child"]?.stringValue {
        return .string(id)
      }
      return value

    case .childList(let expectsAt):
      if expectsAt {
        switch value {
        case .array:
          return .object(["@child": value])
        case .object(let obj)
        where obj.count == 2 && obj["componentId"] != nil && obj["path"] != nil:
          if let cid = obj["componentId"], let path = obj["path"] {
            return .object(["@child": cid, "@path": path])
          }
          return value
        default:
          return value
        }
      } else {
        guard let obj = value.objectValue else { return value }
        if obj.count == 1, let arr = obj["@child"]?.arrayValue {
          return .array(arr)
        }
        if obj.count == 2, let tpl = obj["@child"], tpl.stringValue != nil, let p = obj["@path"] {
          return .object(["componentId": tpl, "path": p])
        }
        return value
      }

    case .componentIDArray:
      if let obj = value.objectValue, obj.count == 1, let arr = obj["@child"]?.arrayValue {
        return .array(arr)
      }
      return value

    case .action(let expectsAt):
      guard let obj = value.objectValue, obj.count == 1 else { return value }
      if expectsAt {
        if let ev = obj["event"] {
          return .object(["@action": ev])
        }
        if let fc = obj["functionCall"] {
          return .object(["@functionCall": fc])
        }
      } else {
        if let act = obj["@action"] {
          return .object(["event": act])
        }
        if let fc = obj["@functionCall"] {
          return .object(["functionCall": fc])
        }
      }
      return value
    }
  }

  private static func classifyV10Slot(
    _ schema: JSONValue,
    root: JSONValue,
    visitedRefs: Set<String> = []
  ) -> V10SlotKind? {
    if let refName = ComponentEnvelope.schemaRefName(schema) {
      let resolvedTarget =
        schema["$ref"]?.stringValue.flatMap { ComponentEnvelope.resolveSchemaRef($0, root: root) }
      let targetSchema = resolvedTarget?.schema ?? schema
      let targetRoot = resolvedTarget?.root ?? root
      let expectsAtChild = ComponentEnvelope.schemaContainsPropertyKey(
        "@child",
        in: targetSchema,
        root: targetRoot
      )
      switch refName {
      case "Action":
        let expectsAt =
          ComponentEnvelope.schemaContainsPropertyKey(
            "@action",
            in: targetSchema,
            root: targetRoot
          )
          || ComponentEnvelope.schemaContainsPropertyKey(
            "@functionCall",
            in: targetSchema,
            root: targetRoot
          )
        return .action(expectsAt: expectsAt)
      case "ChildList":
        if schema["type"]?.stringValue == "array" {
          return .componentIDArray
        }
        return .childList(expectsAt: expectsAtChild)
      case "Child", "ComponentId":
        if schema["type"]?.stringValue == "array" {
          return .componentIDArray
        }
        return .singleChild(expectsAt: expectsAtChild)
      default:
        break
      }
    }

    if schema["type"]?.stringValue == "array", let items = schema["items"],
      case .singleChild = classifyV10Slot(items, root: root, visitedRefs: visitedRefs)
    {
      return .componentIDArray
    }

    if let props = schema["properties"]?.objectValue {
      if props["@action"] != nil || props["@functionCall"] != nil {
        return .action(expectsAt: true)
      }
      if props["event"] != nil || props["functionCall"] != nil {
        if props["event"] != nil,
          schema["required"]?.arrayValue?.contains(.string("event")) == true
        {
          return .action(expectsAt: false)
        }
        if props["functionCall"] != nil,
          schema["required"]?.arrayValue?.contains(.string("functionCall")) == true
        {
          return .action(expectsAt: false)
        }
      }
      if props["@child"] != nil {
        if props["@path"] != nil || props["@child"]?["type"]?.stringValue == "array" {
          return .childList(expectsAt: true)
        }
        return .singleChild(expectsAt: true)
      }
      if props["componentId"] != nil && props["path"] != nil {
        return .childList(expectsAt: false)
      }
    }

    var visitedRefs = visitedRefs
    if let ref = schema["$ref"]?.stringValue, visitedRefs.insert(ref).inserted,
      let resolved = ComponentEnvelope.resolveSchemaRef(ref, root: root),
      let kind = classifyV10Slot(resolved.schema, root: resolved.root, visitedRefs: visitedRefs)
    {
      return kind
    }

    for combiner in ["oneOf", "anyOf"] {
      if let branches = schema[combiner]?.arrayValue {
        let nonNull = branches.filter { $0["type"]?.stringValue != "null" }
        let kinds = nonNull.compactMap {
          classifyV10Slot($0, root: root, visitedRefs: visitedRefs)
        }
        if kinds.count == nonNull.count, let first = kinds.first {
          return first
        }
      }
    }
    if let allOf = schema["allOf"]?.arrayValue {
      for branch in allOf {
        if let kind = classifyV10Slot(branch, root: root, visitedRefs: visitedRefs) {
          return kind
        }
      }
    }
    return nil
  }

  /// Returns the leaf errors of a schema error, leaving out the errors that name unknown
  /// component properties.
  private static func leafErrorsIgnoringUnknownProperties(
    from error: JSONSchema.ValidationError,
    componentSchema: JSONValue
  ) -> [JSONSchema.ValidationError] {
    guard !isUnknownPropertyError(error, componentSchema: componentSchema) else {
      return []
    }
    if let nested = error.errors, !nested.isEmpty {
      return nested.flatMap {
        leafErrorsIgnoringUnknownProperties(from: $0, componentSchema: componentSchema)
      }
    }
    return [error]
  }

  /// Returns whether a schema error reports a property that the schema doesn't declare.
  ///
  /// That is an `additionalProperties` or `unevaluatedProperties` failure whose subschema is
  /// `false`: a non-boolean subschema reports a bad value instead. A key rejected by a schema
  /// that also has `patternProperties` breaks a key format (for example a v1.0 `Extensions` key
  /// that is not a UAX #31 identifier), so it is not an unknown property. When the schema that
  /// holds the keyword can't be found, the error is not treated as an unknown property.
  private static func isUnknownPropertyError(
    _ error: JSONSchema.ValidationError,
    componentSchema: JSONValue
  ) -> Bool {
    guard error.keyword == "additionalProperties" || error.keyword == "unevaluatedProperties"
    else {
      return false
    }
    // swift-json-schema reports a failing `false` subschema with the `boolean` keyword.
    guard let nested = error.errors, !nested.isEmpty,
      nested.allSatisfy({ $0.keyword == "boolean" }),
      let owner = schemaHoldingKeyword(of: error, componentSchema: componentSchema)
    else {
      return false
    }
    return owner["patternProperties"] == nil
  }

  /// Finds the schema object that holds the failing keyword of a schema error, from the
  /// error's absolute keyword location.
  ///
  /// The location's document is one of the shared A2UI schema documents, or else the component
  /// schema itself.
  private static func schemaHoldingKeyword(
    of error: JSONSchema.ValidationError,
    componentSchema: JSONValue
  ) -> JSONValue? {
    guard let location = error.absoluteKeywordLocation,
      var components = URLComponents(url: location, resolvingAgainstBaseURL: false),
      let pointer = components.fragment
    else {
      return nil
    }
    components.fragment = nil
    let documentURI = components.url?.absoluteString ?? ""
    let document = A2UICommonSchema.allSchemas[documentURI] ?? componentSchema
    var tokens = pointer.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    guard tokens.last == error.keyword else {
      return nil
    }
    tokens.removeLast()
    return ComponentEnvelope.resolveLocalRef("#" + tokens.joined(separator: "/"), in: document)
  }

  private func containsDynamicExpression(in args: [String: JSONValue]) -> Bool {
    args.values.contains(where: { isDynamicExpression($0) })
  }

  private func isDynamicExpression(_ value: JSONValue) -> Bool {
    switch value {
    case .object(let dict):
      if dict["path"] != nil
        || dict["@path"] != nil
        || dict["call"] != nil
        || dict["@call"] != nil
        || dict["function"] != nil
      {
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
    guard !validationResult.isValid else { return }
    throw buildThemeSchemaValidationError(validationResult)
  }

  private func buildThemeSchemaValidationError(
    _ validationResult: JSONSchema.ValidationResult
  ) -> A2UIValidationError {
    let leafErrors = (validationResult.errors ?? []).flatMap { extractLeafErrors(from: $0) }
    var details: [A2UIErrorDetail] = []
    var messages: [String] = []
    for leaf in leafErrors {
      let pointer = leaf.instanceLocation.jsonPointerString
      let trimmed = pointer.hasPrefix("/") ? String(pointer.dropFirst()) : pointer
      let path = trimmed.isEmpty ? "theme" : "theme.\(trimmed)"
      let code = leaf.keyword == "required" ? "missing_field" : "invalid_value"
      let msg = trimmed.isEmpty ? leaf.message : "\(trimmed): \(leaf.message)"
      messages.append(msg)
      details.append(A2UIErrorDetail(path: path, code: code, message: msg))
    }
    let errorMessage =
      messages.isEmpty
      ? (validationResult.errors?.first?.message
        ?? "Surface theme failed catalog theme schema validation")
      : messages.joined(separator: "; ")
    if details.isEmpty {
      details.append(A2UIErrorDetail(path: "theme", code: "invalid_value", message: errorMessage))
    }
    return A2UIValidationError(errorMessage, details: details)
  }

  // MARK: - Helpers

  /// Checks a component's accessibility attributes against `AccessibilityAttributes`.
  ///
  /// - Parameters:
  ///   - accessibility: The accessibility attributes.
  ///   - key: The component key that holds them: `@accessibility`, or legacy `accessibility`.
  /// - Throws: `A2UIValidationError` with a detail per failure, at a path under `key`.
  private func validateAccessibility(
    _ accessibility: JSONValue,
    key: String = "accessibility"
  ) throws {
    let version =
      config.protocolVersion
      ?? catalog.a2uiProtocolVersion
      ?? (catalog.isAtLeastV10 ? .v10 : .v091)
    let schema: Schema
    switch version {
    case .v09, .v091:
      schema = Self.v09AccessibilitySchema
    case .v10:
      schema = Self.v10AccessibilitySchema
    }
    let result = schema.validate(accessibility)
    guard !result.isValid else { return }

    let message = "Field '\(key)' must match AccessibilityAttributes"
    let details = (result.errors ?? []).flatMap { extractLeafErrors(from: $0) }.map { leaf in
      A2UIErrorDetail(
        path: "\(key)\(leaf.instanceLocation.jsonPointerString)",
        code: "invalid_value",
        message: leaf.message.isEmpty ? message : leaf.message
      )
    }
    throw A2UIValidationError(message, details: details)
  }

  private func extractLeafErrors(
    from error: JSONSchema.ValidationError
  ) -> [JSONSchema.ValidationError] {
    if let nested = error.errors, !nested.isEmpty {
      return nested.flatMap { extractLeafErrors(from: $0) }
    }
    return [error]
  }
}
