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
import OrderedCollections
import OrderedJSON

/// Encodes and decodes A2UI Catalog Documents (`formatVersion: "1.0"`).
///
/// Enforces the structural and semantic invariants of `catalog_schema.json`, including format
/// version discrimination, UAX #31 identifiers, the `"Surface"` component name ban, the `"@"`
/// function prefix ban, caller/user-activation policy, unique names, and catalog-local `ref`
/// resolution.
public enum CatalogDocumentCodec {
  /// The Catalog Document format version supported by this codec.
  public static let supportedFormatVersion = "1.0"

  private static let rootAllowedKeys: Set<String> = [
    "$schema",
    "formatVersion",
    "catalogId",
    "protocolVersion",
    "title",
    "description",
    "instructions",
    "metadata",
    "types",
    "surfaceProperties",
    "components",
    "functions",
  ]

  private static let componentAllowedKeys: Set<String> = [
    "name",
    "description",
    "checkable",
    "parameters",
    "atLeastOneOf",
    "allowedParents",
    "allowedChildren",
    "metadata",
    "deprecated",
    "deprecatedReason",
  ]

  private static let functionAllowedKeys: Set<String> = [
    "name",
    "description",
    "returnType",
    "allowedCallers",
    "requiresUserActivation",
    "parameters",
    "atLeastOneOf",
    "additionalParameters",
    "deprecated",
    "deprecatedReason",
  ]

  private static let surfacePropertiesAllowedKeys: Set<String> = [
    "description",
    "properties",
    "additionalProperties",
  ]

  private static let reservedComponentEnvelopeKeys: Set<String> = [
    "id",
    "component",
    "@catalogId",
    "@accessibility",
    "@metadata",
    "@checks",
  ]

  private static let baseTypeKeys: Set<String> = [
    "type",
    "description",
    "deprecated",
    "deprecatedReason",
  ]

  private static let parameterIdentityKeys: Set<String> = [
    "name",
    "required",
  ]

  private static let semverRegex: NSRegularExpression = try! NSRegularExpression(
    pattern:
      "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:\\.(0|[1-9][0-9]*))?"
      + "(?:-((?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)"
      + "(?:\\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
      + "(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$"
  )

  // MARK: - Format Detection

  /// Returns `true` if `value` is a JSON object declaring a string `formatVersion`.
  public static func isCatalogDocument(_ value: JSONValue) -> Bool {
    guard let object = value.objectValue else { return false }
    return object["formatVersion"]?.stringValue != nil
  }

  // MARK: - Decoding

  /// Decodes and validates a Catalog Document `JSONValue` into a canonical ``CatalogModel``.
  ///
  /// - Parameter value: Raw JSON object conforming to `catalog_schema.json`.
  /// - Returns: Validated ``CatalogModel``.
  /// - Throws: ``A2UICatalogError`` when the document violates any schema or semantic invariant.
  public static func decode(_ value: JSONValue) throws -> CatalogModel {
    guard let root = value.objectValue else {
      throw A2UICatalogError("Catalog Document must be a JSON object.")
    }
    try assertAllowedKeys(root, allowed: rootAllowedKeys, context: "Catalog Document root")

    guard let formatVersion = root["formatVersion"]?.stringValue else {
      throw A2UICatalogError(
        "Catalog Document is missing required string field 'formatVersion'."
      )
    }
    guard formatVersion == supportedFormatVersion else {
      throw A2UICatalogError(
        "Unsupported Catalog Document formatVersion '\(formatVersion)'; "
          + "expected '\(supportedFormatVersion)'."
      )
    }

    guard let catalogID = root["catalogId"]?.stringValue, !catalogID.isEmpty else {
      throw A2UICatalogError("Catalog Document 'catalogId' must be a non-empty string.")
    }

    let protocolVersion = try decodeOptionalSemVer(root["protocolVersion"]) ?? "1.0"
    let schemaURI = try decodeOptionalString(root["$schema"], field: "$schema")
    let title = try decodeOptionalString(root["title"], field: "title")
    let description = try decodeOptionalString(root["description"], field: "description")
    let instructions = try decodeOptionalString(root["instructions"], field: "instructions")
    let metadata = try decodeOptionalMetadata(root["metadata"], pathPrefix: "metadata")
    let types = try decodeTypes(root["types"])
    let surfaceProperties = try decodeSurfaceProperties(root["surfaceProperties"])
    let components = try decodeComponents(root["components"])
    let functions = try decodeFunctions(root["functions"])

    let model = CatalogModel(
      schemaURI: schemaURI,
      formatVersion: formatVersion,
      catalogID: catalogID,
      protocolVersion: protocolVersion,
      title: title,
      description: description,
      instructions: instructions,
      metadata: metadata,
      types: types,
      surfaceProperties: surfaceProperties,
      components: components,
      functions: functions
    )
    try validateModelRefs(model)
    return model
  }

  // MARK: - Encoding

  /// Encodes a canonical ``CatalogModel`` into a Catalog Document `JSONValue`.
  ///
  /// - Parameter model: The in-memory catalog model to serialize.
  /// - Returns: A `formatVersion: "1.0"` Catalog Document `JSONValue`.
  /// - Throws: ``A2UICatalogError`` if `model` violates Catalog Document invariants or contains an
  ///   untranslatable ``TypeDefinition/rawJSONSchema(_:)`` fragment.
  public static func encode(_ model: CatalogModel) throws -> JSONValue {
    guard model.formatVersion == supportedFormatVersion else {
      throw A2UICatalogError(
        "Unsupported Catalog Document formatVersion '\(model.formatVersion)'; "
          + "expected '\(supportedFormatVersion)'."
      )
    }
    guard !model.catalogID.isEmpty else {
      throw A2UICatalogError("Catalog Document 'catalogId' must be a non-empty string.")
    }
    try validateModelForEncoding(model)

    var root: OrderedDictionary<String, JSONValue> = [:]
    if let schemaURI = model.schemaURI {
      root["$schema"] = .string(schemaURI)
    }
    root["formatVersion"] = .string(model.formatVersion)
    root["catalogId"] = .string(model.catalogID)
    if let protocolVersion = model.protocolVersion {
      let normalized = normalizeProtocolVersion(protocolVersion)
      guard isValidSemVer(normalized) else {
        throw A2UICatalogError(
          "Catalog Document 'protocolVersion' must be a SemVer string, got '\(protocolVersion)'."
        )
      }
      root["protocolVersion"] = .string(normalized)
    }
    if let title = model.title {
      root["title"] = .string(title)
    }
    if let description = model.description {
      root["description"] = .string(description)
    }
    if let instructions = model.instructions {
      root["instructions"] = .string(instructions)
    }
    if let metadata = model.metadata, !metadata.isEmpty {
      root["metadata"] = try encodeMetadata(metadata, pathPrefix: "metadata")
    }
    if !model.types.isEmpty {
      var typesObj: OrderedDictionary<String, JSONValue> = [:]
      for name in model.types.keys.sorted() {
        guard let typeDef = model.types[name] else { continue }
        typesObj[name] = try encodeType(typeDef, allowComponentTypes: false, path: "types.\(name)")
      }
      root["types"] = .object(typesObj)
    }
    if let surfaceProperties = model.surfaceProperties {
      root["surfaceProperties"] = try encodeSurfaceProperties(surfaceProperties)
    }
    if !model.components.isEmpty {
      root["components"] = .array(try model.components.map { try encodeComponent($0) })
    }
    if !model.functions.isEmpty {
      root["functions"] = .array(try model.functions.map { try encodeFunction($0) })
    }
    return .object(root)
  }

  // MARK: - Decode Helpers

  private static func decodeTypes(
    _ raw: JSONValue?
  ) throws -> [String: TypeDefinition] {
    guard let raw else { return [:] }
    guard let object = raw.objectValue else {
      throw A2UICatalogError("Field 'types' must be an object.")
    }
    var result: [String: TypeDefinition] = [:]
    for (name, typeValue) in object {
      try assertIdentifier(name, context: "types key")
      result[name] = try decodeType(
        typeValue,
        allowComponentTypes: false,
        path: "types.\(name)"
      )
    }
    return result
  }

  private static func decodeSurfaceProperties(
    _ raw: JSONValue?
  ) throws -> SurfacePropertiesDefinition? {
    guard let raw else { return nil }
    guard let object = raw.objectValue else {
      throw A2UICatalogError("Field 'surfaceProperties' must be an object.")
    }
    try assertAllowedKeys(
      object,
      allowed: surfacePropertiesAllowedKeys,
      context: "surfaceProperties"
    )
    let description = try decodeOptionalString(
      object["description"],
      field: "surfaceProperties.description"
    )
    let properties = try decodeParameterList(
      object["properties"],
      allowComponentTypes: false,
      forbidEnvelopeKeys: false,
      path: "surfaceProperties.properties"
    )
    let additional = try decodeAdditionalProperties(
      object["additionalProperties"],
      allowComponentTypes: false,
      path: "surfaceProperties.additionalProperties"
    )
    return SurfacePropertiesDefinition(
      description: description,
      properties: properties,
      additionalProperties: additional
    )
  }

  private static func decodeComponents(_ raw: JSONValue?) throws -> [ComponentDefinition] {
    guard let raw else { return [] }
    guard let array = raw.arrayValue else {
      throw A2UICatalogError("Field 'components' must be an array.")
    }
    var seen: Set<String> = []
    var result: [ComponentDefinition] = []
    result.reserveCapacity(array.count)
    for (index, item) in array.enumerated() {
      let component = try decodeComponent(item, path: "components[\(index)]")
      guard seen.insert(component.name).inserted else {
        throw A2UICatalogError("Duplicate component name '\(component.name)'.")
      }
      result.append(component)
    }
    return result
  }

  private static func decodeComponent(
    _ raw: JSONValue,
    path: String
  ) throws -> ComponentDefinition {
    guard let object = raw.objectValue else {
      throw A2UICatalogError("\(path) must be an object.")
    }
    try assertAllowedKeys(object, allowed: componentAllowedKeys, context: path)

    guard let name = object["name"]?.stringValue else {
      throw A2UICatalogError("\(path) is missing required string field 'name'.")
    }
    try assertComponentName(name)

    let description = try decodeOptionalString(object["description"], field: "\(path).description")
    let isCheckable =
      try decodeOptionalBool(object["checkable"], field: "\(path).checkable")
      ?? false
    let parameters = try decodeParameterList(
      object["parameters"],
      allowComponentTypes: true,
      forbidEnvelopeKeys: true,
      path: "\(path).parameters"
    )
    let atLeastOneOf = try decodeAtLeastOneOf(
      object["atLeastOneOf"],
      declaredNames: Set(parameters.map(\.name)),
      path: "\(path).atLeastOneOf"
    )
    let allowedParents = try decodeOptionalIdentifierList(
      object["allowedParents"],
      field: "\(path).allowedParents"
    )
    let allowedChildren = try decodeOptionalIdentifierList(
      object["allowedChildren"],
      field: "\(path).allowedChildren"
    )
    let metadata = try decodeOptionalMetadata(
      object["metadata"],
      pathPrefix: "\(path).metadata"
    )
    let deprecated =
      try decodeOptionalBool(object["deprecated"], field: "\(path).deprecated")
      ?? false
    let deprecatedReason = try decodeOptionalString(
      object["deprecatedReason"],
      field: "\(path).deprecatedReason"
    )

    return ComponentDefinition(
      name: name,
      description: description,
      isCheckable: isCheckable,
      parameters: parameters,
      atLeastOneOf: atLeastOneOf,
      allowedParents: allowedParents,
      allowedChildren: allowedChildren,
      metadata: metadata,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  private static func decodeFunctions(_ raw: JSONValue?) throws -> [FunctionDefinition] {
    guard let raw else { return [] }
    guard let array = raw.arrayValue else {
      throw A2UICatalogError("Field 'functions' must be an array.")
    }
    var seen: Set<String> = []
    var result: [FunctionDefinition] = []
    result.reserveCapacity(array.count)
    for (index, item) in array.enumerated() {
      let function = try decodeFunction(item, path: "functions[\(index)]")
      guard seen.insert(function.name).inserted else {
        throw A2UICatalogError("Duplicate function name '\(function.name)'.")
      }
      result.append(function)
    }
    return result
  }

  private static func decodeFunction(
    _ raw: JSONValue,
    path: String
  ) throws -> FunctionDefinition {
    guard let object = raw.objectValue else {
      throw A2UICatalogError("\(path) must be an object.")
    }
    try assertAllowedKeys(object, allowed: functionAllowedKeys, context: path)

    guard let name = object["name"]?.stringValue else {
      throw A2UICatalogError("\(path) is missing required string field 'name'.")
    }
    try assertFunctionName(name)

    guard let rawReturnType = object["returnType"] else {
      throw A2UICatalogError("\(path) ('\(name)') is missing required field 'returnType'.")
    }
    let returnType = try decodeReturnType(rawReturnType, path: "\(path).returnType")

    let description = try decodeOptionalString(object["description"], field: "\(path).description")
    let allowedCallers: AllowedCallers
    if let rawCallers = object["allowedCallers"] {
      guard let callersStr = rawCallers.stringValue,
        let parsed = AllowedCallers(rawValue: callersStr)
      else {
        throw A2UICatalogError(
          "\(path).allowedCallers must be 'rendererOnly', 'agentOnly', or 'rendererOrAgent'."
        )
      }
      allowedCallers = parsed
    } else {
      allowedCallers = .rendererOnly
    }

    let requiresUserActivation =
      try decodeOptionalBool(
        object["requiresUserActivation"],
        field: "\(path).requiresUserActivation"
      ) ?? false
    let parameters = try decodeParameterList(
      object["parameters"],
      allowComponentTypes: false,
      forbidEnvelopeKeys: false,
      path: "\(path).parameters"
    )
    let atLeastOneOf = try decodeAtLeastOneOf(
      object["atLeastOneOf"],
      declaredNames: Set(parameters.map(\.name)),
      path: "\(path).atLeastOneOf"
    )
    let additionalParameters = try decodeAdditionalProperties(
      object["additionalParameters"],
      allowComponentTypes: false,
      path: "\(path).additionalParameters"
    )
    let deprecated =
      try decodeOptionalBool(object["deprecated"], field: "\(path).deprecated")
      ?? false
    let deprecatedReason = try decodeOptionalString(
      object["deprecatedReason"],
      field: "\(path).deprecatedReason"
    )

    let definition = FunctionDefinition(
      name: name,
      description: description,
      returnType: returnType,
      allowedCallers: allowedCallers,
      requiresUserActivation: requiresUserActivation,
      parameters: parameters,
      atLeastOneOf: atLeastOneOf,
      additionalParameters: additionalParameters,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
    try definition.validateCallerConstraints()
    return definition
  }

  private static func decodeReturnType(
    _ raw: JSONValue,
    path: String
  ) throws -> FunctionReturnDefinition {
    if let shorthand = raw.stringValue {
      switch shorthand {
      case "string": return .string
      case "number": return .number
      case "integer": return .integer
      case "boolean": return .boolean
      case "array": return .array
      case "object": return .object
      case "validationResult": return .validationResult
      case "any": return .any
      case "void": return .void
      default:
        throw A2UICatalogError("Invalid shorthand returnType '\(shorthand)' at \(path).")
      }
    }
    guard let object = raw.objectValue, let kind = object["type"]?.stringValue else {
      throw A2UICatalogError("\(path) must be a returnType string or type object.")
    }
    if kind == "void" || kind == "validationResult" {
      try assertAllowedKeys(object, allowed: ["type", "description"], context: path)
      let desc = try decodeOptionalString(object["description"], field: "\(path).description")
      return FunctionReturnDefinition(
        kind: kind == "void" ? .void : .validationResult,
        description: desc
      )
    }
    let dataType = try decodeType(raw, allowComponentTypes: false, path: path)
    return .data(dataType)
  }

  private static func decodeParameterList(
    _ raw: JSONValue?,
    allowComponentTypes: Bool,
    forbidEnvelopeKeys: Bool,
    path: String
  ) throws -> [ParameterDefinition] {
    guard let raw else { return [] }
    guard let array = raw.arrayValue else {
      throw A2UICatalogError("\(path) must be an array.")
    }
    var seen: Set<String> = []
    var result: [ParameterDefinition] = []
    result.reserveCapacity(array.count)
    for (index, item) in array.enumerated() {
      let itemPath = "\(path)[\(index)]"
      guard let object = item.objectValue else {
        throw A2UICatalogError("\(itemPath) must be an object.")
      }
      guard let name = object["name"]?.stringValue else {
        throw A2UICatalogError("\(itemPath) is missing required string field 'name'.")
      }
      try assertIdentifier(name, context: "\(itemPath).name")
      if forbidEnvelopeKeys && reservedComponentEnvelopeKeys.contains(name) {
        throw A2UICatalogError(
          "\(itemPath).name '\(name)' is a reserved protocol envelope key and must not be "
            + "declared in component parameters."
        )
      }
      guard seen.insert(name).inserted else {
        throw A2UICatalogError("Duplicate parameter name '\(name)' in \(path).")
      }
      let required =
        try decodeOptionalBool(object["required"], field: "\(itemPath).required")
        ?? false
      let description = try decodeOptionalString(
        object["description"],
        field: "\(itemPath).description"
      )
      let deprecated =
        try decodeOptionalBool(object["deprecated"], field: "\(itemPath).deprecated") ?? false
      let deprecatedReason = try decodeOptionalString(
        object["deprecatedReason"],
        field: "\(itemPath).deprecatedReason"
      )
      let type = try decodeTypeObject(
        object,
        allowComponentTypes: allowComponentTypes,
        allowParameterKeys: true,
        path: itemPath
      )
      result.append(
        ParameterDefinition(
          name: name,
          type: type.strippingParameterMetadata(),
          required: required,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason
        )
      )
    }
    return result
  }

  private static func decodeAdditionalProperties(
    _ raw: JSONValue?,
    allowComponentTypes: Bool,
    path: String
  ) throws -> AdditionalProperties {
    guard let raw else { return .disallowed }
    if let flag = raw.boolValue {
      return flag ? .allowed : .disallowed
    }
    return .typed(try decodeType(raw, allowComponentTypes: allowComponentTypes, path: path))
  }

  private static func decodeType(
    _ raw: JSONValue,
    allowComponentTypes: Bool,
    path: String
  ) throws -> TypeDefinition {
    guard let object = raw.objectValue else {
      throw A2UICatalogError("\(path) must be a type definition object.")
    }
    return try decodeTypeObject(
      object,
      allowComponentTypes: allowComponentTypes,
      allowParameterKeys: false,
      path: path
    )
  }

  private static func decodeTypeObject(
    _ object: OrderedDictionary<String, JSONValue>,
    allowComponentTypes: Bool,
    allowParameterKeys: Bool,
    path: String
  ) throws -> TypeDefinition {
    guard let kind = object["type"]?.stringValue else {
      throw A2UICatalogError("\(path) is missing required string field 'type'.")
    }
    let description = try decodeOptionalString(object["description"], field: "\(path).description")
    let deprecated =
      try decodeOptionalBool(object["deprecated"], field: "\(path).deprecated")
      ?? false
    let deprecatedReason = try decodeOptionalString(
      object["deprecatedReason"],
      field: "\(path).deprecatedReason"
    )
    let extraKeys = allowParameterKeys ? parameterIdentityKeys : []

    switch kind {
    case "string":
      return try decodeStringType(
        object,
        extraKeys: extraKeys,
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
        path: path
      )
    case "number":
      return try decodeNumberType(
        object,
        extraKeys: extraKeys,
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
        path: path
      )
    case "integer":
      return try decodeIntegerType(
        object,
        extraKeys: extraKeys,
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
        path: path
      )
    case "boolean":
      try assertAllowedKeys(
        object,
        allowed: baseTypeKeys.union(extraKeys).union(["dynamic", "default"]),
        context: path
      )
      let dynamic = try decodeOptionalBool(object["dynamic"], field: "\(path).dynamic") ?? false
      let defaultValue = try decodeOptionalBool(object["default"], field: "\(path).default")
      return .boolean(
        dynamic: dynamic,
        defaultValue: defaultValue,
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason
      )
    case "enum":
      return try decodeEnumType(
        object,
        extraKeys: extraKeys,
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
        path: path
      )
    case "const":
      try assertAllowedKeys(
        object,
        allowed: baseTypeKeys.union(extraKeys).union(["value"]),
        context: path
      )
      guard let value = object["value"], isValidConstValue(value) else {
        throw A2UICatalogError(
          "\(path).value must be a string, number, boolean, or null."
        )
      }
      return .const(
        value: value,
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason
      )
    case "any":
      try assertAllowedKeys(
        object,
        allowed: baseTypeKeys.union(extraKeys).union(["dynamic", "nullable", "default"]),
        context: path
      )
      let dynamic = try decodeOptionalBool(object["dynamic"], field: "\(path).dynamic") ?? false
      let nullable = try decodeOptionalBool(object["nullable"], field: "\(path).nullable") ?? false
      return .any(
        dynamic: dynamic,
        nullable: nullable,
        defaultValue: object["default"],
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason
      )
    case "object":
      return try decodeObjectType(
        object,
        extraKeys: extraKeys,
        allowComponentTypes: allowComponentTypes,
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
        path: path
      )
    case "array":
      return try decodeArrayType(
        object,
        extraKeys: extraKeys,
        allowComponentTypes: allowComponentTypes,
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
        path: path
      )
    case "union":
      return try decodeUnionType(
        object,
        extraKeys: extraKeys,
        allowComponentTypes: allowComponentTypes,
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
        path: path
      )
    case "dataBinding":
      try assertAllowedKeys(object, allowed: baseTypeKeys.union(extraKeys), context: path)
      return .dataBinding(
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason
      )
    case "functionCall":
      try assertAllowedKeys(object, allowed: baseTypeKeys.union(extraKeys), context: path)
      return .functionCall(
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason
      )
    case "ref":
      try assertAllowedKeys(
        object,
        allowed: baseTypeKeys.union(extraKeys).union(["ref", "default"]),
        context: path
      )
      guard let refName = object["ref"]?.stringValue else {
        throw A2UICatalogError("\(path) is missing required string field 'ref'.")
      }
      try assertIdentifier(refName, context: "\(path).ref")
      return .ref(
        refName,
        defaultValue: object["default"],
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason
      )
    case "child", "childList", "action", "checkRule", "accessibility":
      guard allowComponentTypes else {
        throw A2UICatalogError(
          "Component-only type '\(kind)' is not allowed in data-only scope at \(path)."
        )
      }
      try assertAllowedKeys(object, allowed: baseTypeKeys.union(extraKeys), context: path)
      switch kind {
      case "child":
        return .child(
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason
        )
      case "childList":
        return .childList(
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason
        )
      case "action":
        return .action(
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason
        )
      case "checkRule":
        return .checkRule(
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason
        )
      default:
        return .accessibility(
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason
        )
      }
    default:
      throw A2UICatalogError("Unknown type variant '\(kind)' at \(path).")
    }
  }

  private static func decodeStringType(
    _ object: OrderedDictionary<String, JSONValue>,
    extraKeys: Set<String>,
    description: String?,
    deprecated: Bool,
    deprecatedReason: String?,
    path: String
  ) throws -> TypeDefinition {
    try assertAllowedKeys(
      object,
      allowed: baseTypeKeys.union(extraKeys).union([
        "dynamic", "format", "pattern", "minLength", "maxLength", "default",
      ]),
      context: path
    )
    let dynamic = try decodeOptionalBool(object["dynamic"], field: "\(path).dynamic") ?? false
    let formats = try decodeOptionalFormats(object["format"], path: "\(path).format")
    let pattern = try decodeOptionalString(object["pattern"], field: "\(path).pattern")
    let minLength = try decodeOptionalNonNegativeInt(
      object["minLength"],
      field: "\(path).minLength"
    )
    let maxLength = try decodeOptionalNonNegativeInt(
      object["maxLength"],
      field: "\(path).maxLength"
    )
    let defaultValue = try decodeOptionalString(object["default"], field: "\(path).default")
    return .string(
      dynamic: dynamic,
      formats: formats,
      pattern: pattern,
      minLength: minLength,
      maxLength: maxLength,
      defaultValue: defaultValue,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  private static func decodeNumberType(
    _ object: OrderedDictionary<String, JSONValue>,
    extraKeys: Set<String>,
    description: String?,
    deprecated: Bool,
    deprecatedReason: String?,
    path: String
  ) throws -> TypeDefinition {
    try assertAllowedKeys(
      object,
      allowed: baseTypeKeys.union(extraKeys).union(["dynamic", "min", "max", "default"]),
      context: path
    )
    let dynamic = try decodeOptionalBool(object["dynamic"], field: "\(path).dynamic") ?? false
    let min = try decodeOptionalDouble(object["min"], field: "\(path).min")
    let max = try decodeOptionalDouble(object["max"], field: "\(path).max")
    let defaultValue = try decodeOptionalDouble(object["default"], field: "\(path).default")
    return .number(
      dynamic: dynamic,
      min: min,
      max: max,
      defaultValue: defaultValue,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  private static func decodeIntegerType(
    _ object: OrderedDictionary<String, JSONValue>,
    extraKeys: Set<String>,
    description: String?,
    deprecated: Bool,
    deprecatedReason: String?,
    path: String
  ) throws -> TypeDefinition {
    try assertAllowedKeys(
      object,
      allowed: baseTypeKeys.union(extraKeys).union(["dynamic", "min", "max", "default"]),
      context: path
    )
    let dynamic = try decodeOptionalBool(object["dynamic"], field: "\(path).dynamic") ?? false
    let min = try decodeOptionalInt(object["min"], field: "\(path).min")
    let max = try decodeOptionalInt(object["max"], field: "\(path).max")
    let defaultValue = try decodeOptionalInt(object["default"], field: "\(path).default")
    return .integer(
      dynamic: dynamic,
      min: min,
      max: max,
      defaultValue: defaultValue,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  private static func decodeEnumType(
    _ object: OrderedDictionary<String, JSONValue>,
    extraKeys: Set<String>,
    description: String?,
    deprecated: Bool,
    deprecatedReason: String?,
    path: String
  ) throws -> TypeDefinition {
    try assertAllowedKeys(
      object,
      allowed: baseTypeKeys.union(extraKeys).union([
        "dynamic", "valueType", "values", "default",
      ]),
      context: path
    )
    let dynamic = try decodeOptionalBool(object["dynamic"], field: "\(path).dynamic") ?? false
    let valueType: EnumValueType
    if let rawValueType = object["valueType"] {
      guard let str = rawValueType.stringValue, let parsed = EnumValueType(rawValue: str) else {
        throw A2UICatalogError(
          "\(path).valueType must be 'string', 'number', or 'boolean'."
        )
      }
      valueType = parsed
    } else {
      valueType = .string
    }
    guard let values = object["values"]?.arrayValue, !values.isEmpty else {
      throw A2UICatalogError("\(path).values must be a non-empty array.")
    }
    try validateEnumValues(values, valueType: valueType, path: "\(path).values")
    if let defaultValue = object["default"], !matchesEnumValueType(defaultValue, valueType) {
      throw A2UICatalogError(
        "\(path).default does not match valueType '\(valueType.rawValue)'."
      )
    }
    return .enum(
      values: values,
      valueType: valueType,
      dynamic: dynamic,
      defaultValue: object["default"],
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  private static func decodeObjectType(
    _ object: OrderedDictionary<String, JSONValue>,
    extraKeys: Set<String>,
    allowComponentTypes: Bool,
    description: String?,
    deprecated: Bool,
    deprecatedReason: String?,
    path: String
  ) throws -> TypeDefinition {
    try assertAllowedKeys(
      object,
      allowed: baseTypeKeys.union(extraKeys).union([
        "dynamic", "properties", "additionalProperties", "atLeastOneOf", "default",
      ]),
      context: path
    )
    let dynamic = try decodeOptionalBool(object["dynamic"], field: "\(path).dynamic") ?? false
    let properties = try decodeParameterList(
      object["properties"],
      allowComponentTypes: allowComponentTypes,
      forbidEnvelopeKeys: false,
      path: "\(path).properties"
    )
    let additional = try decodeAdditionalProperties(
      object["additionalProperties"],
      allowComponentTypes: allowComponentTypes,
      path: "\(path).additionalProperties"
    )
    let atLeastOneOf = try decodeAtLeastOneOf(
      object["atLeastOneOf"],
      declaredNames: Set(properties.map(\.name)),
      path: "\(path).atLeastOneOf"
    )
    let defaultValue: [String: JSONValue]?
    if let rawDefault = object["default"] {
      guard let dict = rawDefault.dictionaryValue else {
        throw A2UICatalogError("\(path).default must be an object.")
      }
      defaultValue = dict
    } else {
      defaultValue = nil
    }
    return .object(
      dynamic: dynamic,
      properties: properties,
      additionalProperties: additional,
      atLeastOneOf: atLeastOneOf,
      defaultValue: defaultValue,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  private static func decodeArrayType(
    _ object: OrderedDictionary<String, JSONValue>,
    extraKeys: Set<String>,
    allowComponentTypes: Bool,
    description: String?,
    deprecated: Bool,
    deprecatedReason: String?,
    path: String
  ) throws -> TypeDefinition {
    try assertAllowedKeys(
      object,
      allowed: baseTypeKeys.union(extraKeys).union([
        "dynamic", "items", "minItems", "maxItems", "uniqueItems", "default",
      ]),
      context: path
    )
    let dynamic = try decodeOptionalBool(object["dynamic"], field: "\(path).dynamic") ?? false
    let items = try object["items"].map {
      try decodeType($0, allowComponentTypes: allowComponentTypes, path: "\(path).items")
    }
    let minItems = try decodeOptionalNonNegativeInt(object["minItems"], field: "\(path).minItems")
    let maxItems = try decodeOptionalNonNegativeInt(object["maxItems"], field: "\(path).maxItems")
    let uniqueItems =
      try decodeOptionalBool(object["uniqueItems"], field: "\(path).uniqueItems") ?? false
    let defaultValue: [JSONValue]?
    if let rawDefault = object["default"] {
      guard let array = rawDefault.arrayValue else {
        throw A2UICatalogError("\(path).default must be an array.")
      }
      defaultValue = array
    } else {
      defaultValue = nil
    }
    return .array(
      dynamic: dynamic,
      items: items,
      minItems: minItems,
      maxItems: maxItems,
      uniqueItems: uniqueItems,
      defaultValue: defaultValue,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  private static func decodeUnionType(
    _ object: OrderedDictionary<String, JSONValue>,
    extraKeys: Set<String>,
    allowComponentTypes: Bool,
    description: String?,
    deprecated: Bool,
    deprecatedReason: String?,
    path: String
  ) throws -> TypeDefinition {
    try assertAllowedKeys(
      object,
      allowed: baseTypeKeys.union(extraKeys).union([
        "dynamic", "exclusive", "variants", "default",
      ]),
      context: path
    )
    let dynamic = try decodeOptionalBool(object["dynamic"], field: "\(path).dynamic") ?? false
    let exclusive = try decodeOptionalBool(object["exclusive"], field: "\(path).exclusive") ?? true
    guard let rawVariants = object["variants"]?.arrayValue, rawVariants.count >= 2 else {
      throw A2UICatalogError("\(path).variants must be an array with at least 2 variants.")
    }
    let variants = try rawVariants.enumerated().map { index, item in
      try decodeType(
        item,
        allowComponentTypes: allowComponentTypes,
        path: "\(path).variants[\(index)]"
      )
    }
    return .union(
      variants: variants,
      exclusive: exclusive,
      dynamic: dynamic,
      defaultValue: object["default"],
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  // MARK: - Encode Helpers

  private static func encodeSurfaceProperties(
    _ def: SurfacePropertiesDefinition
  ) throws -> JSONValue {
    guard def.rawJSONSchema == nil else {
      throw A2UICatalogError(
        "Cannot encode untranslatable raw JSON Schema in surfaceProperties to a Catalog Document."
      )
    }
    var obj: OrderedDictionary<String, JSONValue> = [:]
    if let description = def.description {
      obj["description"] = .string(description)
    }
    if !def.properties.isEmpty {
      obj["properties"] = .array(
        try def.properties.map {
          try encodeParameter($0, allowComponentTypes: false, path: "surfaceProperties.\($0.name)")
        }
      )
    }
    if def.additionalProperties != .disallowed {
      obj["additionalProperties"] = try encodeAdditionalProperties(
        def.additionalProperties,
        allowComponentTypes: false,
        path: "surfaceProperties.additionalProperties"
      )
    }
    return .object(obj)
  }

  private static func encodeComponent(_ def: ComponentDefinition) throws -> JSONValue {
    guard def.rawJSONSchema == nil else {
      throw A2UICatalogError(
        "Cannot encode component '\(def.name)' containing untranslatable raw JSON Schema "
          + "into a Catalog Document."
      )
    }
    var obj: OrderedDictionary<String, JSONValue> = ["name": .string(def.name)]
    if let description = def.description {
      obj["description"] = .string(description)
    }
    if def.isCheckable {
      obj["checkable"] = .boolean(true)
    }
    if !def.parameters.isEmpty {
      obj["parameters"] = .array(
        try def.parameters.map {
          try encodeParameter(
            $0,
            allowComponentTypes: true,
            path: "components.\(def.name).\($0.name)"
          )
        }
      )
    }
    if !def.atLeastOneOf.isEmpty {
      obj["atLeastOneOf"] = encodeAtLeastOneOf(def.atLeastOneOf)
    }
    if let allowedParents = def.allowedParents {
      obj["allowedParents"] = .array(allowedParents.map { .string($0) })
    }
    if let allowedChildren = def.allowedChildren {
      obj["allowedChildren"] = .array(allowedChildren.map { .string($0) })
    }
    if let metadata = def.metadata, !metadata.isEmpty {
      obj["metadata"] = try encodeMetadata(metadata, pathPrefix: "components.\(def.name).metadata")
    }
    if def.deprecated {
      obj["deprecated"] = .boolean(true)
    }
    if let reason = def.deprecatedReason {
      obj["deprecatedReason"] = .string(reason)
    }
    return .object(obj)
  }

  private static func encodeFunction(_ def: FunctionDefinition) throws -> JSONValue {
    guard def.rawJSONSchema == nil else {
      throw A2UICatalogError(
        "Cannot encode function '\(def.name)' containing untranslatable raw JSON Schema "
          + "into a Catalog Document."
      )
    }
    var obj: OrderedDictionary<String, JSONValue> = ["name": .string(def.name)]
    if let description = def.description {
      obj["description"] = .string(description)
    }
    obj["returnType"] = try encodeReturnType(
      def.returnType,
      path: "functions.\(def.name).returnType"
    )
    if def.allowedCallers != .rendererOnly {
      obj["allowedCallers"] = .string(def.allowedCallers.rawValue)
    }
    if def.requiresUserActivation {
      obj["requiresUserActivation"] = .boolean(true)
    }
    if !def.parameters.isEmpty {
      obj["parameters"] = .array(
        try def.parameters.map {
          try encodeParameter(
            $0,
            allowComponentTypes: false,
            path: "functions.\(def.name).\($0.name)"
          )
        }
      )
    }
    if !def.atLeastOneOf.isEmpty {
      obj["atLeastOneOf"] = encodeAtLeastOneOf(def.atLeastOneOf)
    }
    if def.additionalParameters != .disallowed {
      obj["additionalParameters"] = try encodeAdditionalProperties(
        def.additionalParameters,
        allowComponentTypes: false,
        path: "functions.\(def.name).additionalParameters"
      )
    }
    if def.deprecated {
      obj["deprecated"] = .boolean(true)
    }
    if let reason = def.deprecatedReason {
      obj["deprecatedReason"] = .string(reason)
    }
    return .object(obj)
  }

  private static func encodeReturnType(
    _ def: FunctionReturnDefinition,
    path: String
  ) throws -> JSONValue {
    if let shorthand = def.shorthandName {
      return .string(shorthand)
    }
    switch def.kind {
    case .void:
      var obj: OrderedDictionary<String, JSONValue> = ["type": .string("void")]
      if let description = def.description {
        obj["description"] = .string(description)
      }
      return .object(obj)
    case .validationResult:
      var obj: OrderedDictionary<String, JSONValue> = ["type": .string("validationResult")]
      if let description = def.description {
        obj["description"] = .string(description)
      }
      return .object(obj)
    case .data(let type):
      return try encodeType(type, allowComponentTypes: false, path: path)
    }
  }

  private static func encodeParameter(
    _ param: ParameterDefinition,
    allowComponentTypes: Bool,
    path: String
  ) throws -> JSONValue {
    var obj: OrderedDictionary<String, JSONValue> = ["name": .string(param.name)]
    let typeVal = try encodeType(
      param.type.strippingParameterMetadata(),
      allowComponentTypes: allowComponentTypes,
      path: path
    )
    guard let typeObj = typeVal.objectValue else {
      throw A2UICatalogError("Encoded type at \(path) must be an object.")
    }
    for (k, v) in typeObj {
      obj[k] = v
    }
    if param.required {
      obj["required"] = .boolean(true)
    }
    if let description = param.effectiveDescription {
      obj["description"] = .string(description)
    }
    if param.isEffectivelyDeprecated {
      obj["deprecated"] = .boolean(true)
    }
    if let reason = param.effectiveDeprecatedReason {
      obj["deprecatedReason"] = .string(reason)
    }
    return .object(obj)
  }

  private static func encodeAdditionalProperties(
    _ additional: AdditionalProperties,
    allowComponentTypes: Bool,
    path: String
  ) throws -> JSONValue {
    switch additional {
    case .disallowed:
      return .boolean(false)
    case .allowed:
      return .boolean(true)
    case .typed(let type):
      return try encodeType(type, allowComponentTypes: allowComponentTypes, path: path)
    }
  }

  private static func encodeType(
    _ type: TypeDefinition,
    allowComponentTypes: Bool,
    path: String
  ) throws -> JSONValue {
    var obj: OrderedDictionary<String, JSONValue> = [:]
    switch type {
    case .string(
      let dynamic, let formats, let pattern, let minLength, let maxLength,
      let defaultValue, let description, let deprecated, let deprecatedReason):
      obj["type"] = .string("string")
      if dynamic { obj["dynamic"] = .boolean(true) }
      if let formats, !formats.isEmpty {
        obj["format"] =
          formats.count == 1 ? .string(formats[0]) : .array(formats.map { .string($0) })
      }
      if let pattern { obj["pattern"] = .string(pattern) }
      if let minLength { obj["minLength"] = .integer(minLength) }
      if let maxLength { obj["maxLength"] = .integer(maxLength) }
      if let defaultValue { obj["default"] = .string(defaultValue) }
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .number(
      let dynamic, let min, let max, let defaultValue, let description, let deprecated,
      let deprecatedReason):
      obj["type"] = .string("number")
      if dynamic { obj["dynamic"] = .boolean(true) }
      if let min { obj["min"] = encodeNumber(min) }
      if let max { obj["max"] = encodeNumber(max) }
      if let defaultValue { obj["default"] = encodeNumber(defaultValue) }
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .integer(
      let dynamic, let min, let max, let defaultValue, let description, let deprecated,
      let deprecatedReason):
      obj["type"] = .string("integer")
      if dynamic { obj["dynamic"] = .boolean(true) }
      if let min { obj["min"] = .integer(min) }
      if let max { obj["max"] = .integer(max) }
      if let defaultValue { obj["default"] = .integer(defaultValue) }
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .boolean(
      let dynamic, let defaultValue, let description, let deprecated,
      let deprecatedReason):
      obj["type"] = .string("boolean")
      if dynamic { obj["dynamic"] = .boolean(true) }
      if let defaultValue { obj["default"] = .boolean(defaultValue) }
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .enum(
      let values, let valueType, let dynamic, let defaultValue, let description,
      let deprecated, let deprecatedReason):
      obj["type"] = .string("enum")
      if dynamic { obj["dynamic"] = .boolean(true) }
      if valueType != .string { obj["valueType"] = .string(valueType.rawValue) }
      obj["values"] = .array(values)
      if let defaultValue { obj["default"] = defaultValue }
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .const(let value, let description, let deprecated, let deprecatedReason):
      obj["type"] = .string("const")
      obj["value"] = value
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .any(
      let dynamic, let nullable, let defaultValue, let description, let deprecated,
      let deprecatedReason):
      obj["type"] = .string("any")
      if dynamic { obj["dynamic"] = .boolean(true) }
      if nullable { obj["nullable"] = .boolean(true) }
      if let defaultValue { obj["default"] = defaultValue }
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .object(
      let dynamic, let properties, let additionalProperties, let atLeastOneOf,
      let defaultValue, let description, let deprecated, let deprecatedReason):
      obj["type"] = .string("object")
      if dynamic { obj["dynamic"] = .boolean(true) }
      if !properties.isEmpty {
        obj["properties"] = .array(
          try properties.map {
            try encodeParameter(
              $0,
              allowComponentTypes: allowComponentTypes,
              path: "\(path).\($0.name)"
            )
          }
        )
      }
      if additionalProperties != .disallowed {
        obj["additionalProperties"] = try encodeAdditionalProperties(
          additionalProperties,
          allowComponentTypes: allowComponentTypes,
          path: "\(path).additionalProperties"
        )
      }
      if !atLeastOneOf.isEmpty {
        obj["atLeastOneOf"] = encodeAtLeastOneOf(atLeastOneOf)
      }
      if let defaultValue {
        var ordered: OrderedDictionary<String, JSONValue> = [:]
        for key in defaultValue.keys.sorted() {
          ordered[key] = defaultValue[key]
        }
        obj["default"] = .object(ordered)
      }
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .array(
      let dynamic, let items, let minItems, let maxItems, let uniqueItems,
      let defaultValue, let description, let deprecated, let deprecatedReason):
      obj["type"] = .string("array")
      if dynamic { obj["dynamic"] = .boolean(true) }
      if let items {
        obj["items"] = try encodeType(
          items,
          allowComponentTypes: allowComponentTypes,
          path: "\(path).items"
        )
      }
      if let minItems { obj["minItems"] = .integer(minItems) }
      if let maxItems { obj["maxItems"] = .integer(maxItems) }
      if uniqueItems { obj["uniqueItems"] = .boolean(true) }
      if let defaultValue { obj["default"] = .array(defaultValue) }
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .union(
      let variants, let exclusive, let dynamic, let defaultValue, let description,
      let deprecated, let deprecatedReason):
      guard variants.count >= 2 else {
        throw A2UICatalogError("\(path).variants must contain at least 2 variants.")
      }
      obj["type"] = .string("union")
      if dynamic { obj["dynamic"] = .boolean(true) }
      if !exclusive { obj["exclusive"] = .boolean(false) }
      obj["variants"] = .array(
        try variants.enumerated().map { index, variant in
          try encodeType(
            variant,
            allowComponentTypes: allowComponentTypes,
            path: "\(path).variants[\(index)]"
          )
        }
      )
      if let defaultValue { obj["default"] = defaultValue }
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .dataBinding(let description, let deprecated, let deprecatedReason):
      obj["type"] = .string("dataBinding")
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .functionCall(let description, let deprecated, let deprecatedReason):
      obj["type"] = .string("functionCall")
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .ref(
      let refName, let defaultValue, let description, let deprecated,
      let deprecatedReason):
      obj["type"] = .string("ref")
      obj["ref"] = .string(refName)
      if let defaultValue { obj["default"] = defaultValue }
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .child(let description, let deprecated, let deprecatedReason):
      try assertComponentTypeAllowed("child", allowComponentTypes: allowComponentTypes, path: path)
      obj["type"] = .string("child")
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .childList(let description, let deprecated, let deprecatedReason):
      try assertComponentTypeAllowed(
        "childList",
        allowComponentTypes: allowComponentTypes,
        path: path
      )
      obj["type"] = .string("childList")
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .action(let description, let deprecated, let deprecatedReason):
      try assertComponentTypeAllowed("action", allowComponentTypes: allowComponentTypes, path: path)
      obj["type"] = .string("action")
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .checkRule(let description, let deprecated, let deprecatedReason):
      try assertComponentTypeAllowed(
        "checkRule",
        allowComponentTypes: allowComponentTypes,
        path: path
      )
      obj["type"] = .string("checkRule")
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .accessibility(let description, let deprecated, let deprecatedReason):
      try assertComponentTypeAllowed(
        "accessibility",
        allowComponentTypes: allowComponentTypes,
        path: path
      )
      obj["type"] = .string("accessibility")
      appendBaseTypeFields(
        &obj, description: description, deprecated: deprecated, reason: deprecatedReason)

    case .rawJSONSchema:
      throw A2UICatalogError(
        "Cannot encode untranslatable raw JSON Schema fragment at \(path) into a Catalog Document."
      )
    }
    return .object(obj)
  }

  private static func appendBaseTypeFields(
    _ obj: inout OrderedDictionary<String, JSONValue>,
    description: String?,
    deprecated: Bool,
    reason: String?
  ) {
    if let description { obj["description"] = .string(description) }
    if deprecated { obj["deprecated"] = .boolean(true) }
    if let reason { obj["deprecatedReason"] = .string(reason) }
  }

  private static func encodeAtLeastOneOf(_ groups: [[String]]) -> JSONValue {
    .array(groups.map { group in .array(group.map { .string($0) }) })
  }

  private static func encodeNumber(_ value: Double) -> JSONValue {
    if let exact = Int(exactly: value) {
      return .integer(exact)
    }
    return .number(value)
  }

  private static func encodeMetadata(
    _ metadata: [String: JSONValue],
    pathPrefix: String
  ) throws -> JSONValue {
    do {
      guard let validated = try MetadataValidator.validate(metadata, pathPrefix: pathPrefix) else {
        return .object([:])
      }
      var ordered: OrderedDictionary<String, JSONValue> = [:]
      for key in validated.keys.sorted() {
        ordered[key] = validated[key]
      }
      return .object(ordered)
    } catch let error as A2UIValidationError {
      throw A2UICatalogError(error.message, details: error.details)
    }
  }

  // MARK: - Validation Helpers

  private static func validateModelForEncoding(_ model: CatalogModel) throws {
    for (typeName, typeDef) in model.types {
      try assertIdentifier(typeName, context: "types key")
      guard typeDef.isDataType else {
        throw A2UICatalogError(
          "Type '\(typeName)' in 'types' may only contain data types."
        )
      }
    }
    var seenComponents: Set<String> = []
    for component in model.components {
      try assertComponentName(component.name)
      guard seenComponents.insert(component.name).inserted else {
        throw A2UICatalogError("Duplicate component name '\(component.name)'.")
      }
      try validateParameterNames(
        component.parameters,
        forbidEnvelopeKeys: true,
        context: "components.\(component.name).parameters"
      )
      try validateAtLeastOneOf(
        component.atLeastOneOf,
        declaredNames: Set(component.parameters.map(\.name)),
        path: "components.\(component.name).atLeastOneOf"
      )
    }
    var seenFunctions: Set<String> = []
    for function in model.functions {
      try assertFunctionName(function.name)
      guard seenFunctions.insert(function.name).inserted else {
        throw A2UICatalogError("Duplicate function name '\(function.name)'.")
      }
      try function.validateCallerConstraints()
      try validateParameterNames(
        function.parameters,
        forbidEnvelopeKeys: false,
        context: "functions.\(function.name).parameters"
      )
      try validateAtLeastOneOf(
        function.atLeastOneOf,
        declaredNames: Set(function.parameters.map(\.name)),
        path: "functions.\(function.name).atLeastOneOf"
      )
    }
    if let surfaceProps = model.surfaceProperties {
      try validateParameterNames(
        surfaceProps.properties,
        forbidEnvelopeKeys: false,
        context: "surfaceProperties.properties"
      )
    }
    try validateModelRefs(model)
  }

  private static func validateParameterNames(
    _ params: [ParameterDefinition],
    forbidEnvelopeKeys: Bool,
    context: String
  ) throws {
    var seen: Set<String> = []
    for param in params {
      try assertIdentifier(param.name, context: context)
      if forbidEnvelopeKeys && reservedComponentEnvelopeKeys.contains(param.name) {
        throw A2UICatalogError(
          "Parameter '\(param.name)' in \(context) is a reserved protocol envelope key."
        )
      }
      guard seen.insert(param.name).inserted else {
        throw A2UICatalogError("Duplicate parameter name '\(param.name)' in \(context).")
      }
    }
  }

  private static func validateModelRefs(_ model: CatalogModel) throws {
    let definedTypes = Set(model.types.keys)
    for (name, typeDef) in model.types {
      try validateTypeRefs(typeDef, definedTypes: definedTypes, path: "types.\(name)")
    }
    var visiting: Set<String> = []
    var visited: Set<String> = []
    for name in model.types.keys.sorted() {
      try detectRefCycles(
        typeName: name,
        types: model.types,
        visiting: &visiting,
        visited: &visited
      )
    }
    if let surfaceProps = model.surfaceProperties {
      for prop in surfaceProps.properties {
        try validateTypeRefs(
          prop.type,
          definedTypes: definedTypes,
          path: "surfaceProperties.\(prop.name)"
        )
      }
      if case .typed(let extra) = surfaceProps.additionalProperties {
        try validateTypeRefs(
          extra,
          definedTypes: definedTypes,
          path: "surfaceProperties.additionalProperties"
        )
      }
    }
    for component in model.components {
      for param in component.parameters {
        try validateTypeRefs(
          param.type,
          definedTypes: definedTypes,
          path: "components.\(component.name).\(param.name)"
        )
      }
    }
    for function in model.functions {
      if case .data(let returnType) = function.returnType.kind {
        try validateTypeRefs(
          returnType,
          definedTypes: definedTypes,
          path: "functions.\(function.name).returnType"
        )
      }
      for param in function.parameters {
        try validateTypeRefs(
          param.type,
          definedTypes: definedTypes,
          path: "functions.\(function.name).\(param.name)"
        )
      }
      if case .typed(let extra) = function.additionalParameters {
        try validateTypeRefs(
          extra,
          definedTypes: definedTypes,
          path: "functions.\(function.name).additionalParameters"
        )
      }
    }
  }

  private static func validateTypeRefs(
    _ type: TypeDefinition,
    definedTypes: Set<String>,
    path: String
  ) throws {
    switch type {
    case .ref(let refName, _, _, _, _):
      guard definedTypes.contains(refName) else {
        throw A2UICatalogError("Unresolved local type ref '\(refName)' at \(path).")
      }
    case .object(_, let properties, let additional, _, _, _, _, _):
      for prop in properties {
        try validateTypeRefs(prop.type, definedTypes: definedTypes, path: "\(path).\(prop.name)")
      }
      if case .typed(let extra) = additional {
        try validateTypeRefs(
          extra,
          definedTypes: definedTypes,
          path: "\(path).additionalProperties"
        )
      }
    case .array(_, let items, _, _, _, _, _, _, _):
      if let items {
        try validateTypeRefs(items, definedTypes: definedTypes, path: "\(path).items")
      }
    case .union(let variants, _, _, _, _, _, _):
      for (index, variant) in variants.enumerated() {
        try validateTypeRefs(
          variant,
          definedTypes: definedTypes,
          path: "\(path).variants[\(index)]"
        )
      }
    case .string, .number, .integer, .boolean, .enum, .const, .any, .dataBinding, .functionCall,
      .child, .childList, .action, .checkRule, .accessibility, .rawJSONSchema:
      break
    }
  }

  private static func detectRefCycles(
    typeName: String,
    types: [String: TypeDefinition],
    visiting: inout Set<String>,
    visited: inout Set<String>
  ) throws {
    guard !visited.contains(typeName) else { return }
    guard visiting.insert(typeName).inserted else {
      throw A2UICatalogError("Cyclic local type reference detected involving '\(typeName)'.")
    }
    if let typeDef = types[typeName] {
      for referenced in collectDirectRefs(in: typeDef) {
        try detectRefCycles(
          typeName: referenced,
          types: types,
          visiting: &visiting,
          visited: &visited
        )
      }
    }
    visiting.remove(typeName)
    visited.insert(typeName)
  }

  private static func collectDirectRefs(in type: TypeDefinition) -> [String] {
    switch type {
    case .ref(let name, _, _, _, _):
      return [name]
    case .object(_, let properties, let additional, _, _, _, _, _):
      var refs = properties.flatMap { collectDirectRefs(in: $0.type) }
      if case .typed(let extra) = additional {
        refs.append(contentsOf: collectDirectRefs(in: extra))
      }
      return refs
    case .array(_, let items, _, _, _, _, _, _, _):
      return items.map { collectDirectRefs(in: $0) } ?? []
    case .union(let variants, _, _, _, _, _, _):
      return variants.flatMap { collectDirectRefs(in: $0) }
    default:
      return []
    }
  }

  private static func assertComponentTypeAllowed(
    _ kind: String,
    allowComponentTypes: Bool,
    path: String
  ) throws {
    guard allowComponentTypes else {
      throw A2UICatalogError(
        "Component-only type '\(kind)' is not allowed in data-only scope at \(path)."
      )
    }
  }

  private static func assertAllowedKeys(
    _ object: OrderedDictionary<String, JSONValue>,
    allowed: Set<String>,
    context: String
  ) throws {
    for key in object.keys where !allowed.contains(key) {
      throw A2UICatalogError("Unrecognized property '\(key)' in \(context).")
    }
  }

  private static func assertIdentifier(_ name: String, context: String) throws {
    guard UnicodeIdentifierValidator.isValidIdentifier(name) else {
      throw A2UICatalogError(
        "Invalid UAX #31 identifier '\(name)' in \(context)."
      )
    }
  }

  private static func assertComponentName(_ name: String) throws {
    guard name != "Surface" else {
      throw A2UICatalogError("Component name 'Surface' is reserved and forbidden.")
    }
    try assertIdentifier(name, context: "component name")
  }

  private static func assertFunctionName(_ name: String) throws {
    guard !name.hasPrefix("@") else {
      throw A2UICatalogError(
        "Function name '\(name)' cannot start with reserved prefix '@'."
      )
    }
    try assertIdentifier(name, context: "function name")
  }

  private static func decodeOptionalString(_ raw: JSONValue?, field: String) throws -> String? {
    guard let raw else { return nil }
    guard let str = raw.stringValue else {
      throw A2UICatalogError("Field '\(field)' must be a string.")
    }
    return str
  }

  private static func decodeOptionalBool(_ raw: JSONValue?, field: String) throws -> Bool? {
    guard let raw else { return nil }
    guard let val = raw.boolValue else {
      throw A2UICatalogError("Field '\(field)' must be a boolean.")
    }
    return val
  }

  private static func decodeOptionalInt(_ raw: JSONValue?, field: String) throws -> Int? {
    guard let raw else { return nil }
    guard let val = raw.intValue else {
      throw A2UICatalogError("Field '\(field)' must be an integer.")
    }
    return val
  }

  private static func decodeOptionalNonNegativeInt(
    _ raw: JSONValue?,
    field: String
  ) throws -> Int? {
    guard let val = try decodeOptionalInt(raw, field: field) else { return nil }
    guard val >= 0 else {
      throw A2UICatalogError("Field '\(field)' must be a non-negative integer.")
    }
    return val
  }

  private static func decodeOptionalDouble(_ raw: JSONValue?, field: String) throws -> Double? {
    guard let raw else { return nil }
    guard let val = raw.doubleValue else {
      throw A2UICatalogError("Field '\(field)' must be a number.")
    }
    return val
  }

  private static func decodeOptionalSemVer(_ raw: JSONValue?) throws -> String? {
    guard let version = try decodeOptionalString(raw, field: "protocolVersion") else {
      return nil
    }
    guard isValidSemVer(version) else {
      throw A2UICatalogError(
        "Field 'protocolVersion' must be a SemVer string, got '\(version)'."
      )
    }
    return version
  }

  private static func isValidSemVer(_ value: String) -> Bool {
    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    return semverRegex.firstMatch(in: value, options: [], range: range) != nil
  }

  private static func normalizeProtocolVersion(_ version: String) -> String {
    if version.hasPrefix("v") || version.hasPrefix("V") {
      return String(version.dropFirst())
    }
    return version
  }

  private static func decodeOptionalMetadata(
    _ raw: JSONValue?,
    pathPrefix: String
  ) throws -> [String: JSONValue]? {
    guard let raw else { return nil }
    do {
      return try MetadataValidator.validate(raw, pathPrefix: pathPrefix)
    } catch let error as A2UIValidationError {
      throw A2UICatalogError(error.message, details: error.details)
    }
  }

  private static func decodeOptionalFormats(
    _ raw: JSONValue?,
    path: String
  ) throws -> [String]? {
    guard let raw else { return nil }
    if let single = raw.stringValue {
      guard !single.isEmpty else {
        throw A2UICatalogError("\(path) must not be an empty string.")
      }
      return [single]
    }
    guard let array = raw.arrayValue, !array.isEmpty else {
      throw A2UICatalogError("\(path) must be a non-empty string or non-empty string array.")
    }
    var seen: Set<String> = []
    var result: [String] = []
    for item in array {
      guard let str = item.stringValue, !str.isEmpty else {
        throw A2UICatalogError("\(path) entries must be non-empty strings.")
      }
      guard seen.insert(str).inserted else {
        throw A2UICatalogError("\(path) contains duplicate format '\(str)'.")
      }
      result.append(str)
    }
    return result
  }

  private static func decodeOptionalIdentifierList(
    _ raw: JSONValue?,
    field: String
  ) throws -> [String]? {
    guard let raw else { return nil }
    guard let array = raw.arrayValue else {
      throw A2UICatalogError("Field '\(field)' must be an array of identifiers.")
    }
    var seen: Set<String> = []
    var result: [String] = []
    for item in array {
      guard let str = item.stringValue else {
        throw A2UICatalogError("Field '\(field)' entries must be strings.")
      }
      try assertIdentifier(str, context: field)
      guard seen.insert(str).inserted else {
        throw A2UICatalogError("Field '\(field)' contains duplicate identifier '\(str)'.")
      }
      result.append(str)
    }
    return result
  }

  private static func decodeAtLeastOneOf(
    _ raw: JSONValue?,
    declaredNames: Set<String>,
    path: String
  ) throws -> [[String]] {
    guard let raw else { return [] }
    guard let outer = raw.arrayValue, !outer.isEmpty else {
      throw A2UICatalogError("\(path) must be a non-empty array of identifier arrays.")
    }
    var groups: [[String]] = []
    for (index, item) in outer.enumerated() {
      guard let inner = item.arrayValue, !inner.isEmpty else {
        throw A2UICatalogError("\(path)[\(index)] must be a non-empty array of identifiers.")
      }
      var seen: Set<String> = []
      var group: [String] = []
      for entry in inner {
        guard let name = entry.stringValue else {
          throw A2UICatalogError("\(path)[\(index)] entries must be strings.")
        }
        try assertIdentifier(name, context: "\(path)[\(index)]")
        guard seen.insert(name).inserted else {
          throw A2UICatalogError("\(path)[\(index)] contains duplicate identifier '\(name)'.")
        }
        group.append(name)
      }
      groups.append(group)
    }
    try validateAtLeastOneOf(groups, declaredNames: declaredNames, path: path)
    return groups
  }

  private static func validateAtLeastOneOf(
    _ groups: [[String]],
    declaredNames: Set<String>,
    path: String
  ) throws {
    for (index, group) in groups.enumerated() {
      guard !group.isEmpty else {
        throw A2UICatalogError("\(path)[\(index)] must not be empty.")
      }
      for name in group where !declaredNames.contains(name) {
        throw A2UICatalogError(
          "\(path)[\(index)] references undeclared parameter '\(name)'."
        )
      }
    }
  }

  private static func validateEnumValues(
    _ values: [JSONValue],
    valueType: EnumValueType,
    path: String
  ) throws {
    for (index, val) in values.enumerated() {
      guard matchesEnumValueType(val, valueType) else {
        throw A2UICatalogError(
          "\(path)[\(index)] does not match enum valueType '\(valueType.rawValue)'."
        )
      }
      for prev in values[..<index] where MetadataValidator.jsonEquals(prev, val) {
        throw A2UICatalogError("\(path) contains duplicate enum value.")
      }
    }
  }

  private static func matchesEnumValueType(_ value: JSONValue, _ valueType: EnumValueType) -> Bool {
    switch valueType {
    case .string:
      return value.stringValue != nil
    case .number:
      return value.doubleValue != nil
    case .boolean:
      return value.boolValue != nil
    }
  }

  private static func isValidConstValue(_ value: JSONValue) -> Bool {
    switch value {
    case .string, .number, .integer, .boolean, .null:
      return true
    case .array, .object:
      return false
    }
  }
}
