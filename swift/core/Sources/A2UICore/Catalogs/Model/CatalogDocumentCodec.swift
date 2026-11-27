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
/// function prefix ban, caller/user-activation policy, unique names, type constraints, and
/// catalog-local `ref` resolution.
public enum CatalogDocumentCodec {
  /// The Catalog Document format version supported by this codec.
  public static let supportedFormatVersion = "1.0"

  private static let rootAllowedKeys: Set<String> = [
    "$schema", "formatVersion", "catalogId", "protocolVersion", "title", "description",
    "instructions", "metadata", "types", "surfaceProperties", "components", "functions",
  ]
  private static let componentAllowedKeys: Set<String> = [
    "name", "description", "checkable", "parameters", "atLeastOneOf", "allowedParents",
    "allowedChildren", "metadata", "deprecated", "deprecatedReason",
  ]
  private static let functionAllowedKeys: Set<String> = [
    "name", "description", "returnType", "allowedCallers", "requiresUserActivation", "parameters",
    "atLeastOneOf", "additionalParameters", "deprecated", "deprecatedReason",
  ]
  private static let surfacePropertiesAllowedKeys: Set<String> = [
    "description", "properties", "additionalProperties",
  ]
  private static let reservedComponentEnvelopeKeys: Set<String> = [
    "id", "component", "catalogId", "accessibility", "checks", "metadata",
  ]
  private static let baseTypeKeys: Set<String> = [
    "type", "description", "deprecated", "deprecatedReason",
  ]
  private static let parameterOnlyKeys: Set<String> = ["name", "required"]
  private static let validStringFormats: Set<String> = [
    "date", "time", "date-time", "uri", "email",
  ]

  // MARK: - Format Detection

  /// Returns `true` when `json` is an object declaring a string `formatVersion` field.
  ///
  /// Any object with a string `formatVersion` is treated as a Catalog Document so unsupported
  /// future versions fail explicitly rather than falling back to legacy JSON Schema parsing.
  public static func isCatalogDocument(_ json: JSONValue) -> Bool {
    json.objectValue?["formatVersion"]?.stringValue != nil
  }

  // MARK: - Decoding

  /// Decodes and validates a Catalog Document `JSONValue` into a canonical ``CatalogModel``.
  public static func decode(_ document: JSONValue) throws -> CatalogModel {
    guard let root = document.objectValue else {
      throw A2UICatalogError("Catalog Document must be a JSON object.")
    }
    let reader = ObjectReader(object: root, path: "catalog")
    try reader.assertAllowedKeys(rootAllowedKeys)

    let formatVersion = try reader.requiredString("formatVersion")
    guard formatVersion == supportedFormatVersion else {
      throw A2UICatalogError(
        "Unsupported Catalog Document formatVersion '\(formatVersion)'; "
          + "expected '\(supportedFormatVersion)'."
      )
    }

    let catalogID = try reader.requiredString("catalogId")
    let protocolVersion = try reader.optionalString("protocolVersion")
    if let protocolVersion, !isValidSemVer(protocolVersion) {
      throw A2UICatalogError(
        "Field 'protocolVersion' must be a valid SemVer string, got '\(protocolVersion)'."
      )
    }

    let types = try decodeTypes(root["types"])
    let surfaceProperties = try decodeSurfaceProperties(root["surfaceProperties"])
    let components = try decodeNamedList(
      root["components"],
      section: "components",
      decodeItem: decodeComponent
    )
    let functions = try decodeNamedList(
      root["functions"],
      section: "functions",
      decodeItem: decodeFunction
    )

    let model = CatalogModel(
      formatVersion: formatVersion,
      catalogID: catalogID,
      protocolVersion: protocolVersion,
      title: try reader.optionalString("title"),
      description: try reader.optionalString("description"),
      instructions: try reader.optionalString("instructions"),
      metadata: try decodeOptionalMetadata(root["metadata"], pathPrefix: "metadata"),
      types: types,
      surfaceProperties: surfaceProperties,
      components: components,
      functions: functions,
      schemaURI: try reader.optionalString("$schema")
    )
    try validateModelRefsAndCycles(model)
    return model
  }

  // MARK: - Encoding

  /// Encodes a canonical ``CatalogModel`` into a Catalog Document `JSONValue`.
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
    try validateModel(model)

    var root: OrderedDictionary<String, JSONValue> = [:]
    if let schemaURI = model.schemaURI { root["$schema"] = .string(schemaURI) }
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
    if let title = model.title { root["title"] = .string(title) }
    if let description = model.description { root["description"] = .string(description) }
    if let instructions = model.instructions { root["instructions"] = .string(instructions) }
    if let metadata = model.metadata, !metadata.isEmpty {
      root["metadata"] = try encodeMetadata(metadata, pathPrefix: "metadata")
    }
    if !model.types.isEmpty {
      var typesObj: OrderedDictionary<String, JSONValue> = [:]
      for name in model.types.keys.sorted() {
        if let typeDef = model.types[name] {
          typesObj[name] = try encodeType(
            typeDef, allowComponentTypes: false, path: "types.\(name)")
        }
      }
      root["types"] = .object(typesObj)
    }
    if let surfaceProperties = model.surfaceProperties {
      root["surfaceProperties"] = try encodeSurfaceProperties(surfaceProperties)
    }
    if !model.components.isEmpty {
      root["components"] = .array(try model.components.map(encodeComponent))
    }
    if !model.functions.isEmpty {
      root["functions"] = .array(try model.functions.map(encodeFunction))
    }
    return .object(root)
  }

  // MARK: - Decode Helpers

  private struct ObjectReader {
    let object: OrderedDictionary<String, JSONValue>
    let path: String

    func assertAllowedKeys(_ allowed: Set<String>) throws {
      for key in object.keys where !allowed.contains(key) {
        throw A2UICatalogError("Unrecognized property '\(key)' in \(path).")
      }
    }

    func requiredString(_ key: String) throws -> String {
      guard let value = object[key]?.stringValue, !value.isEmpty else {
        throw A2UICatalogError("Field '\(path).\(key)' must be a non-empty string.")
      }
      return value
    }

    func optionalString(_ key: String) throws -> String? {
      guard let raw = object[key] else { return nil }
      guard let value = raw.stringValue else {
        throw A2UICatalogError("Field '\(path).\(key)' must be a string.")
      }
      return value
    }

    func optionalBool(_ key: String) throws -> Bool? {
      guard let raw = object[key] else { return nil }
      guard let value = raw.boolValue else {
        throw A2UICatalogError("Field '\(path).\(key)' must be a boolean.")
      }
      return value
    }

    func optionalInt(_ key: String) throws -> Int? {
      guard let raw = object[key] else { return nil }
      guard let value = raw.intValue else {
        throw A2UICatalogError("Field '\(path).\(key)' must be an integer.")
      }
      return value
    }

    func optionalNonNegativeInt(_ key: String) throws -> Int? {
      guard let value = try optionalInt(key) else { return nil }
      guard value >= 0 else {
        throw A2UICatalogError("Field '\(path).\(key)' must be a non-negative integer.")
      }
      return value
    }

    func optionalDouble(_ key: String) throws -> Double? {
      guard let raw = object[key] else { return nil }
      guard let value = raw.doubleValue, value.isFinite else {
        throw A2UICatalogError("Field '\(path).\(key)' must be a finite number.")
      }
      return value
    }

    func optionalStringArray(_ key: String) throws -> [String]? {
      guard let raw = object[key] else { return nil }
      guard let array = raw.arrayValue else {
        throw A2UICatalogError("Field '\(path).\(key)' must be an array of strings.")
      }
      return try array.enumerated().map { idx, elem in
        guard let str = elem.stringValue else {
          throw A2UICatalogError("Field '\(path).\(key)[\(idx)]' must be a string.")
        }
        return str
      }
    }
  }

  private static func decodeNamedList<T>(
    _ raw: JSONValue?,
    section: String,
    decodeItem: (OrderedDictionary<String, JSONValue>, String) throws -> (String, T)
  ) throws -> [T] {
    guard let raw else { return [] }
    guard let array = raw.arrayValue else {
      throw A2UICatalogError("Field '\(section)' must be an array.")
    }
    var seen: Set<String> = []
    return try array.enumerated().map { index, item in
      let itemPath = "\(section)[\(index)]"
      guard let object = item.objectValue else {
        throw A2UICatalogError("\(itemPath) must be an object.")
      }
      let (name, value) = try decodeItem(object, itemPath)
      guard seen.insert(name).inserted else {
        throw A2UICatalogError("Duplicate entry '\(name)' in \(section).")
      }
      return value
    }
  }

  private static func decodeTypes(_ raw: JSONValue?) throws -> [String: TypeDefinition] {
    guard let raw else { return [:] }
    guard let object = raw.objectValue else {
      throw A2UICatalogError("Field 'types' must be an object.")
    }
    var result: [String: TypeDefinition] = [:]
    for (name, typeValue) in object {
      try assertIdentifier(name, context: "types key")
      result[name] = try decodeType(typeValue, allowComponentTypes: false, path: "types.\(name)")
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
    let reader = ObjectReader(object: object, path: "surfaceProperties")
    try reader.assertAllowedKeys(surfacePropertiesAllowedKeys)
    return SurfacePropertiesDefinition(
      description: try reader.optionalString("description"),
      properties: try decodeParameterList(
        object["properties"],
        allowComponentTypes: false,
        forbidEnvelopeKeys: false,
        path: "surfaceProperties.properties"
      ),
      additionalProperties: try decodeAdditionalProperties(
        object["additionalProperties"],
        allowComponentTypes: false,
        path: "surfaceProperties.additionalProperties"
      )
    )
  }

  private static func decodeComponent(
    _ object: OrderedDictionary<String, JSONValue>,
    path: String
  ) throws -> (String, ComponentDefinition) {
    let reader = ObjectReader(object: object, path: path)
    try reader.assertAllowedKeys(componentAllowedKeys)
    let name = try reader.requiredString("name")
    try assertComponentName(name)
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
    let def = ComponentDefinition(
      name: name,
      description: try reader.optionalString("description"),
      isCheckable: try reader.optionalBool("checkable") ?? false,
      parameters: parameters,
      atLeastOneOf: atLeastOneOf,
      allowedParents: try reader.optionalStringArray("allowedParents"),
      allowedChildren: try reader.optionalStringArray("allowedChildren"),
      metadata: try decodeOptionalMetadata(
        object["metadata"],
        pathPrefix: "components.\(name).metadata"
      ),
      deprecated: try reader.optionalBool("deprecated") ?? false,
      deprecatedReason: try reader.optionalString("deprecatedReason")
    )
    return (name, def)
  }

  private static func decodeFunction(
    _ object: OrderedDictionary<String, JSONValue>,
    path: String
  ) throws -> (String, FunctionDefinition) {
    let reader = ObjectReader(object: object, path: path)
    try reader.assertAllowedKeys(functionAllowedKeys)
    let name = try reader.requiredString("name")
    try assertFunctionName(name)
    let returnType = try decodeReturnType(object["returnType"], path: "\(path).returnType")
    let callersRaw = try reader.optionalString("allowedCallers")
    let allowedCallers: AllowedCallers
    if let callersRaw {
      guard let parsed = AllowedCallers(rawValue: callersRaw) else {
        throw A2UICatalogError("Invalid allowedCallers '\(callersRaw)' at \(path).")
      }
      allowedCallers = parsed
    } else {
      allowedCallers = .rendererOnly
    }
    let requiresUserActivation = try reader.optionalBool("requiresUserActivation") ?? false
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
    let def = FunctionDefinition(
      name: name,
      description: try reader.optionalString("description"),
      returnType: returnType,
      allowedCallers: allowedCallers,
      requiresUserActivation: requiresUserActivation,
      parameters: parameters,
      atLeastOneOf: atLeastOneOf,
      additionalParameters: try decodeAdditionalProperties(
        object["additionalParameters"],
        allowComponentTypes: false,
        path: "\(path).additionalParameters"
      ),
      deprecated: try reader.optionalBool("deprecated") ?? false,
      deprecatedReason: try reader.optionalString("deprecatedReason")
    )
    try def.validateCallerConstraints()
    return (name, def)
  }

  private static func decodeReturnType(
    _ raw: JSONValue?,
    path: String
  ) throws -> FunctionReturnDefinition {
    guard let raw else {
      throw A2UICatalogError("Missing required field '\(path)'.")
    }
    if let shorthand = raw.stringValue {
      guard let parsed = parseReturnShorthand(shorthand) else {
        throw A2UICatalogError("Invalid shorthand returnType '\(shorthand)' at \(path).")
      }
      return parsed
    }
    guard let object = raw.objectValue, let kind = object["type"]?.stringValue else {
      throw A2UICatalogError("\(path) must be a returnType string or type object.")
    }
    if kind == "void" || kind == "validationResult" {
      let reader = ObjectReader(object: object, path: path)
      try reader.assertAllowedKeys(["type", "description"])
      return FunctionReturnDefinition(
        kind: kind == "void" ? .void : .validationResult,
        description: try reader.optionalString("description")
      )
    }
    return .data(try decodeType(raw, allowComponentTypes: false, path: path))
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
    return try array.enumerated().map { index, item in
      let itemPath = "\(path)[\(index)]"
      guard let object = item.objectValue else {
        throw A2UICatalogError("\(itemPath) must be an object.")
      }
      let reader = ObjectReader(object: object, path: itemPath)
      let name = try reader.requiredString("name")
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
      let type = try decodeTypeObject(
        object,
        allowComponentTypes: allowComponentTypes,
        allowParameterKeys: true,
        path: itemPath
      )
      return ParameterDefinition(
        name: name,
        type: type.strippingParameterMetadata(),
        required: try reader.optionalBool("required") ?? false,
        description: type.description,
        deprecated: type.deprecated,
        deprecatedReason: type.deprecatedReason
      )
    }
  }

  private static func decodeAdditionalProperties(
    _ raw: JSONValue?,
    allowComponentTypes: Bool,
    path: String
  ) throws -> AdditionalProperties {
    guard let raw else { return .disallowed }
    if let boolVal = raw.boolValue {
      return boolVal ? .allowed : .disallowed
    }
    guard raw.objectValue != nil else {
      throw A2UICatalogError("\(path) must be a boolean or a type definition object.")
    }
    return .typed(try decodeType(raw, allowComponentTypes: allowComponentTypes, path: path))
  }

  private static func decodeAtLeastOneOf(
    _ raw: JSONValue?,
    declaredNames: Set<String>,
    path: String
  ) throws -> [[String]] {
    guard let raw else { return [] }
    guard let groups = raw.arrayValue, !groups.isEmpty else {
      throw A2UICatalogError("\(path) must be a non-empty array of parameter name groups.")
    }
    let result: [[String]] = try groups.enumerated().map { idx, groupVal in
      guard let arr = groupVal.arrayValue else {
        throw A2UICatalogError("\(path)[\(idx)] must be an array of parameter names.")
      }
      return try arr.enumerated().map { j, item in
        guard let name = item.stringValue else {
          throw A2UICatalogError("\(path)[\(idx)][\(j)] must be a parameter name string.")
        }
        return name
      }
    }
    try validateAtLeastOneOf(result, declaredNames: declaredNames, path: path)
    return result
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
    let reader = ObjectReader(object: object, path: path)
    let kindName = try reader.requiredString("type")
    let description = try reader.optionalString("description")
    let deprecated = try reader.optionalBool("deprecated") ?? false
    let deprecatedReason = try reader.optionalString("deprecatedReason")
    let extra = allowParameterKeys ? parameterOnlyKeys : []

    let kind: TypeDefinition.Kind
    switch kindName {
    case "string":
      try reader.assertAllowedKeys(
        baseTypeKeys.union(extra).union([
          "dynamic", "format", "formats", "pattern", "minLength", "maxLength", "default",
        ]))
      if object["format"] != nil && object["formats"] != nil {
        throw A2UICatalogError("\(path) cannot specify both 'format' and 'formats'.")
      }
      let formats: [String]?
      if let single = try reader.optionalString("format") {
        formats = [single]
      } else if let many = try reader.optionalStringArray("formats") {
        formats = many
      } else {
        formats = nil
      }
      kind = .string(
        dynamic: try reader.optionalBool("dynamic") ?? false,
        formats: formats,
        pattern: try reader.optionalString("pattern"),
        minLength: try reader.optionalNonNegativeInt("minLength"),
        maxLength: try reader.optionalNonNegativeInt("maxLength"),
        defaultValue: try reader.optionalString("default")
      )

    case "number":
      try reader.assertAllowedKeys(
        baseTypeKeys.union(extra).union(["dynamic", "min", "max", "default"]))
      kind = .number(
        dynamic: try reader.optionalBool("dynamic") ?? false,
        min: try reader.optionalDouble("min"),
        max: try reader.optionalDouble("max"),
        defaultValue: try reader.optionalDouble("default")
      )

    case "integer":
      try reader.assertAllowedKeys(
        baseTypeKeys.union(extra).union(["dynamic", "min", "max", "default"]))
      kind = .integer(
        dynamic: try reader.optionalBool("dynamic") ?? false,
        min: try reader.optionalInt("min"),
        max: try reader.optionalInt("max"),
        defaultValue: try reader.optionalInt("default")
      )

    case "boolean":
      try reader.assertAllowedKeys(baseTypeKeys.union(extra).union(["dynamic", "default"]))
      kind = .boolean(
        dynamic: try reader.optionalBool("dynamic") ?? false,
        defaultValue: try reader.optionalBool("default")
      )

    case "enum":
      try reader.assertAllowedKeys(
        baseTypeKeys.union(extra).union(["values", "valueType", "dynamic", "default"]))
      guard let values = object["values"]?.arrayValue, !values.isEmpty else {
        throw A2UICatalogError("\(path).values must be a non-empty array.")
      }
      let rawValueType = try reader.optionalString("valueType") ?? "string"
      guard let valueType = EnumValueType(rawValue: rawValueType) else {
        throw A2UICatalogError("Invalid valueType '\(rawValueType)' at \(path).")
      }
      kind = .enum(
        values: values,
        valueType: valueType,
        dynamic: try reader.optionalBool("dynamic") ?? false,
        defaultValue: object["default"]
      )

    case "const":
      try reader.assertAllowedKeys(baseTypeKeys.union(extra).union(["value"]))
      guard let value = object["value"] else {
        throw A2UICatalogError("\(path) of type 'const' is missing required field 'value'.")
      }
      kind = .const(value: value)

    case "any":
      try reader.assertAllowedKeys(
        baseTypeKeys.union(extra).union(["dynamic", "nullable", "default"]))
      kind = .any(
        dynamic: try reader.optionalBool("dynamic") ?? false,
        nullable: try reader.optionalBool("nullable") ?? false,
        defaultValue: object["default"]
      )

    case "object":
      try reader.assertAllowedKeys(
        baseTypeKeys.union(extra).union([
          "dynamic", "properties", "additionalProperties", "atLeastOneOf", "default",
        ]))
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
      kind = .object(
        dynamic: try reader.optionalBool("dynamic") ?? false,
        properties: properties,
        additionalProperties: additional,
        atLeastOneOf: atLeastOneOf,
        defaultValue: defaultValue
      )

    case "array":
      try reader.assertAllowedKeys(
        baseTypeKeys.union(extra).union([
          "dynamic", "items", "minItems", "maxItems", "uniqueItems", "default",
        ]))
      let items = try object["items"].map {
        try decodeType($0, allowComponentTypes: allowComponentTypes, path: "\(path).items")
      }
      let defaultValue: [JSONValue]?
      if let rawDefault = object["default"] {
        guard let array = rawDefault.arrayValue else {
          throw A2UICatalogError("\(path).default must be an array.")
        }
        defaultValue = array
      } else {
        defaultValue = nil
      }
      kind = .array(
        dynamic: try reader.optionalBool("dynamic") ?? false,
        items: items,
        minItems: try reader.optionalNonNegativeInt("minItems"),
        maxItems: try reader.optionalNonNegativeInt("maxItems"),
        uniqueItems: try reader.optionalBool("uniqueItems") ?? false,
        defaultValue: defaultValue
      )

    case "union":
      try reader.assertAllowedKeys(
        baseTypeKeys.union(extra).union(["variants", "exclusive", "dynamic", "default"]))
      guard let rawVariants = object["variants"]?.arrayValue, rawVariants.count >= 2 else {
        throw A2UICatalogError("\(path).variants must be an array with at least 2 variants.")
      }
      let variants = try rawVariants.enumerated().map { idx, variantVal in
        try decodeType(
          variantVal,
          allowComponentTypes: allowComponentTypes,
          path: "\(path).variants[\(idx)]"
        )
      }
      kind = .union(
        variants: variants,
        exclusive: try reader.optionalBool("exclusive") ?? false,
        dynamic: try reader.optionalBool("dynamic") ?? false,
        defaultValue: object["default"]
      )

    case "dataBinding":
      try reader.assertAllowedKeys(baseTypeKeys.union(extra))
      kind = .dataBinding

    case "functionCall":
      try reader.assertAllowedKeys(baseTypeKeys.union(extra))
      kind = .functionCall

    case "ref":
      try reader.assertAllowedKeys(baseTypeKeys.union(extra).union(["ref", "default"]))
      let target = try reader.requiredString("ref")
      try assertIdentifier(target, context: "\(path).ref")
      kind = .ref(target, defaultValue: object["default"])

    case "child", "childList", "action", "checkRule", "accessibility":
      try assertComponentTypeAllowed(kindName, allowComponentTypes: allowComponentTypes, path: path)
      try reader.assertAllowedKeys(baseTypeKeys.union(extra))
      switch kindName {
      case "child": kind = .child
      case "childList": kind = .childList
      case "action": kind = .action
      case "checkRule": kind = .checkRule
      default: kind = .accessibility
      }

    default:
      throw A2UICatalogError("Unknown type '\(kindName)' at \(path).")
    }

    let typeDef = TypeDefinition(
      kind: kind,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
    try validateTypeSemantics(
      typeDef,
      allowComponentTypes: allowComponentTypes,
      path: path
    )
    return typeDef
  }

  // MARK: - Encode Helpers

  private static func encodeSurfaceProperties(_ def: SurfacePropertiesDefinition) throws
    -> JSONValue
  {
    guard def.rawJSONSchema == nil else {
      throw A2UICatalogError(
        "Cannot encode untranslatable raw JSON Schema in surfaceProperties to a Catalog Document."
      )
    }
    var obj: OrderedDictionary<String, JSONValue> = [:]
    if let description = def.description { obj["description"] = .string(description) }
    if !def.properties.isEmpty {
      obj["properties"] = .array(
        try def.properties.map {
          try encodeParameter($0, allowComponentTypes: false, path: "surfaceProperties.\($0.name)")
        })
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
    if let description = def.description { obj["description"] = .string(description) }
    if def.isCheckable { obj["checkable"] = .boolean(true) }
    if !def.parameters.isEmpty {
      obj["parameters"] = .array(
        try def.parameters.map {
          try encodeParameter(
            $0, allowComponentTypes: true, path: "components.\(def.name).\($0.name)")
        })
    }
    if !def.atLeastOneOf.isEmpty { obj["atLeastOneOf"] = encodeAtLeastOneOf(def.atLeastOneOf) }
    if let parents = def.allowedParents {
      obj["allowedParents"] = .array(parents.map(JSONValue.string))
    }
    if let children = def.allowedChildren {
      obj["allowedChildren"] = .array(children.map(JSONValue.string))
    }
    if let metadata = def.metadata, !metadata.isEmpty {
      obj["metadata"] = try encodeMetadata(metadata, pathPrefix: "components.\(def.name).metadata")
    }
    if def.deprecated { obj["deprecated"] = .boolean(true) }
    if let reason = def.deprecatedReason { obj["deprecatedReason"] = .string(reason) }
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
    if let description = def.description { obj["description"] = .string(description) }
    obj["returnType"] = try encodeReturnType(
      def.returnType,
      path: "functions.\(def.name).returnType"
    )
    if def.allowedCallers != .rendererOnly {
      obj["allowedCallers"] = .string(def.allowedCallers.rawValue)
    }
    if def.requiresUserActivation { obj["requiresUserActivation"] = .boolean(true) }
    if !def.parameters.isEmpty {
      obj["parameters"] = .array(
        try def.parameters.map {
          try encodeParameter(
            $0, allowComponentTypes: false, path: "functions.\(def.name).\($0.name)")
        })
    }
    if !def.atLeastOneOf.isEmpty { obj["atLeastOneOf"] = encodeAtLeastOneOf(def.atLeastOneOf) }
    if def.additionalParameters != .disallowed {
      obj["additionalParameters"] = try encodeAdditionalProperties(
        def.additionalParameters,
        allowComponentTypes: false,
        path: "functions.\(def.name).additionalParameters"
      )
    }
    if def.deprecated { obj["deprecated"] = .boolean(true) }
    if let reason = def.deprecatedReason { obj["deprecatedReason"] = .string(reason) }
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
    case .void, .validationResult:
      var obj: OrderedDictionary<String, JSONValue> = [
        "type": .string(def.kind == .void ? "void" : "validationResult")
      ]
      if let description = def.description { obj["description"] = .string(description) }
      return .object(obj)
    case .data:
      guard let dataType = def.effectiveDataType else { return .string("any") }
      return try encodeType(dataType, allowComponentTypes: false, path: path)
    }
  }

  private static func encodeParameter(
    _ param: ParameterDefinition,
    allowComponentTypes: Bool,
    path: String
  ) throws -> JSONValue {
    let encodedType = try encodeType(
      param.type,
      allowComponentTypes: allowComponentTypes,
      path: path
    )
    guard let typeObj = encodedType.objectValue else { return encodedType }
    var obj: OrderedDictionary<String, JSONValue> = ["name": .string(param.name)]
    for (k, v) in typeObj where k != "description" && k != "deprecated" && k != "deprecatedReason" {
      obj[k] = v
    }
    if param.required { obj["required"] = .boolean(true) }
    if let description = param.description ?? param.type.description {
      obj["description"] = .string(description)
    }
    if param.deprecated || param.type.deprecated { obj["deprecated"] = .boolean(true) }
    if let reason = param.deprecatedReason ?? param.type.deprecatedReason {
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
    case .disallowed: return .boolean(false)
    case .allowed: return .boolean(true)
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
    switch type.kind {
    case .string(let dynamic, let formats, let pattern, let minL, let maxL, let defVal):
      obj["type"] = .string("string")
      if dynamic { obj["dynamic"] = .boolean(true) }
      if let formats, !formats.isEmpty {
        if formats.count == 1 {
          obj["format"] = .string(formats[0])
        } else {
          obj["formats"] = .array(formats.map(JSONValue.string))
        }
      }
      if let pattern { obj["pattern"] = .string(pattern) }
      if let minL { obj["minLength"] = .integer(minL) }
      if let maxL { obj["maxLength"] = .integer(maxL) }
      if let defVal { obj["default"] = .string(defVal) }

    case .number(let dynamic, let minV, let maxV, let defVal):
      obj["type"] = .string("number")
      if dynamic { obj["dynamic"] = .boolean(true) }
      if let minV { obj["min"] = encodeNumber(minV) }
      if let maxV { obj["max"] = encodeNumber(maxV) }
      if let defVal { obj["default"] = encodeNumber(defVal) }

    case .integer(let dynamic, let minV, let maxV, let defVal):
      obj["type"] = .string("integer")
      if dynamic { obj["dynamic"] = .boolean(true) }
      if let minV { obj["min"] = .integer(minV) }
      if let maxV { obj["max"] = .integer(maxV) }
      if let defVal { obj["default"] = .integer(defVal) }

    case .boolean(let dynamic, let defVal):
      obj["type"] = .string("boolean")
      if dynamic { obj["dynamic"] = .boolean(true) }
      if let defVal { obj["default"] = .boolean(defVal) }

    case .enum(let values, let valueType, let dynamic, let defVal):
      obj["type"] = .string("enum")
      obj["values"] = .array(values)
      if valueType != .string { obj["valueType"] = .string(valueType.rawValue) }
      if dynamic { obj["dynamic"] = .boolean(true) }
      if let defVal { obj["default"] = defVal }

    case .const(let value):
      obj["type"] = .string("const")
      obj["value"] = value

    case .any(let dynamic, let nullable, let defVal):
      obj["type"] = .string("any")
      if dynamic { obj["dynamic"] = .boolean(true) }
      if nullable { obj["nullable"] = .boolean(true) }
      if let defVal { obj["default"] = defVal }

    case .object(let dynamic, let properties, let additional, let atLeastOneOf, let defVal):
      obj["type"] = .string("object")
      if dynamic { obj["dynamic"] = .boolean(true) }
      if !properties.isEmpty {
        obj["properties"] = .array(
          try properties.map {
            try encodeParameter(
              $0, allowComponentTypes: allowComponentTypes, path: "\(path).\($0.name)")
          })
      }
      if additional != .disallowed {
        obj["additionalProperties"] = try encodeAdditionalProperties(
          additional,
          allowComponentTypes: allowComponentTypes,
          path: "\(path).additionalProperties"
        )
      }
      if !atLeastOneOf.isEmpty { obj["atLeastOneOf"] = encodeAtLeastOneOf(atLeastOneOf) }
      if let defVal {
        var ordered: OrderedDictionary<String, JSONValue> = [:]
        for key in defVal.keys.sorted() { ordered[key] = defVal[key] }
        obj["default"] = .object(ordered)
      }

    case .array(let dynamic, let items, let minI, let maxI, let unique, let defVal):
      obj["type"] = .string("array")
      if dynamic { obj["dynamic"] = .boolean(true) }
      if let items {
        obj["items"] = try encodeType(
          items, allowComponentTypes: allowComponentTypes, path: "\(path).items")
      }
      if let minI { obj["minItems"] = .integer(minI) }
      if let maxI { obj["maxItems"] = .integer(maxI) }
      if unique { obj["uniqueItems"] = .boolean(true) }
      if let defVal { obj["default"] = .array(defVal) }

    case .union(let variants, let exclusive, let dynamic, let defVal):
      obj["type"] = .string("union")
      obj["variants"] = .array(
        try variants.enumerated().map { idx, variant in
          try encodeType(
            variant, allowComponentTypes: allowComponentTypes, path: "\(path).variants[\(idx)]")
        })
      if exclusive { obj["exclusive"] = .boolean(true) }
      if dynamic { obj["dynamic"] = .boolean(true) }
      if let defVal { obj["default"] = defVal }

    case .ref(let target, let defVal):
      obj["type"] = .string("ref")
      obj["ref"] = .string(target)
      if let defVal { obj["default"] = defVal }

    case .dataBinding:
      obj["type"] = .string("dataBinding")
    case .functionCall:
      obj["type"] = .string("functionCall")

    case .child, .childList, .action, .checkRule, .accessibility:
      let name: String
      switch type.kind {
      case .child: name = "child"
      case .childList: name = "childList"
      case .action: name = "action"
      case .checkRule: name = "checkRule"
      default: name = "accessibility"
      }
      try assertComponentTypeAllowed(name, allowComponentTypes: allowComponentTypes, path: path)
      obj["type"] = .string(name)

    case .rawJSONSchema:
      throw A2UICatalogError(
        "Cannot encode untranslatable raw JSON Schema fragment at \(path) into a Catalog Document."
      )
    }

    if let description = type.description { obj["description"] = .string(description) }
    if type.deprecated { obj["deprecated"] = .boolean(true) }
    if let reason = type.deprecatedReason { obj["deprecatedReason"] = .string(reason) }
    return .object(obj)
  }

  private static func encodeAtLeastOneOf(_ groups: [[String]]) -> JSONValue {
    .array(groups.map { .array($0.map(JSONValue.string)) })
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
      for key in validated.keys.sorted() { ordered[key] = validated[key] }
      return .object(ordered)
    } catch let error as A2UIValidationError {
      throw A2UICatalogError(error.message, details: error.details)
    }
  }

  // MARK: - Unified Model & Semantic Validation

  private static func validateModel(_ model: CatalogModel) throws {
    for (typeName, typeDef) in model.types {
      try assertIdentifier(typeName, context: "types key")
      try validateTypeSemantics(typeDef, allowComponentTypes: false, path: "types.\(typeName)")
    }
    var seenComponents: Set<String> = []
    for component in model.components {
      try assertComponentName(component.name)
      guard seenComponents.insert(component.name).inserted else {
        throw A2UICatalogError("Duplicate component name '\(component.name)'.")
      }
      try validateParameters(
        component.parameters,
        allowComponentTypes: true,
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
      if let retType = function.returnType.effectiveDataType {
        try validateTypeSemantics(
          retType,
          allowComponentTypes: false,
          path: "functions.\(function.name).returnType"
        )
      }
      try validateParameters(
        function.parameters,
        allowComponentTypes: false,
        forbidEnvelopeKeys: false,
        context: "functions.\(function.name).parameters"
      )
      try validateAtLeastOneOf(
        function.atLeastOneOf,
        declaredNames: Set(function.parameters.map(\.name)),
        path: "functions.\(function.name).atLeastOneOf"
      )
      if let extra = function.additionalParameters.typedSchema {
        try validateTypeSemantics(
          extra,
          allowComponentTypes: false,
          path: "functions.\(function.name).additionalParameters"
        )
      }
    }
    if let surfaceProps = model.surfaceProperties {
      try validateParameters(
        surfaceProps.properties,
        allowComponentTypes: false,
        forbidEnvelopeKeys: false,
        context: "surfaceProperties.properties"
      )
      if let extra = surfaceProps.additionalProperties.typedSchema {
        try validateTypeSemantics(
          extra,
          allowComponentTypes: false,
          path: "surfaceProperties.additionalProperties"
        )
      }
    }
    try validateModelRefsAndCycles(model)
  }

  private static func validateParameters(
    _ params: [ParameterDefinition],
    allowComponentTypes: Bool,
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
      try validateTypeSemantics(
        param.type,
        allowComponentTypes: allowComponentTypes,
        path: "\(context).\(param.name)"
      )
    }
  }

  private static func validateTypeSemantics(
    _ type: TypeDefinition,
    allowComponentTypes: Bool,
    path: String
  ) throws {
    switch type.kind {
    case .string(_, let formats, let pattern, let minL, let maxL, _):
      if let formats {
        guard !formats.isEmpty else {
          throw A2UICatalogError("\(path).formats must be non-empty.")
        }
        var seenFormats: Set<String> = []
        for fmt in formats {
          guard validStringFormats.contains(fmt) else {
            throw A2UICatalogError("Invalid string format '\(fmt)' at \(path).")
          }
          guard seenFormats.insert(fmt).inserted else {
            throw A2UICatalogError("Duplicate string format '\(fmt)' at \(path).")
          }
        }
      }
      if let pattern {
        do {
          _ = try NSRegularExpression(pattern: pattern)
        } catch {
          throw A2UICatalogError("Invalid regex pattern '\(pattern)' at \(path): \(error).")
        }
      }
      if let minL, minL < 0 {
        throw A2UICatalogError("\(path).minLength must be non-negative.")
      }
      if let maxL, maxL < 0 {
        throw A2UICatalogError("\(path).maxLength must be non-negative.")
      }
      if let minL, let maxL, minL > maxL {
        throw A2UICatalogError("\(path).minLength (\(minL)) cannot exceed maxLength (\(maxL)).")
      }

    case .number(_, let minV, let maxV, let defVal):
      if let minV, !minV.isFinite {
        throw A2UICatalogError("\(path).min must be a finite number.")
      }
      if let maxV, !maxV.isFinite {
        throw A2UICatalogError("\(path).max must be a finite number.")
      }
      if let defVal, !defVal.isFinite {
        throw A2UICatalogError("\(path).default must be a finite number.")
      }
      if let minV, let maxV, minV > maxV {
        throw A2UICatalogError("\(path).min (\(minV)) cannot exceed max (\(maxV)).")
      }

    case .integer(_, let minV, let maxV, _):
      if let minV, let maxV, minV > maxV {
        throw A2UICatalogError("\(path).min (\(minV)) cannot exceed max (\(maxV)).")
      }

    case .enum(let values, let valueType, _, let defVal):
      guard !values.isEmpty else {
        throw A2UICatalogError("\(path).values must be a non-empty array.")
      }
      var unique: [JSONValue] = []
      for (idx, val) in values.enumerated() {
        guard matchesEnumValueType(val, valueType) else {
          throw A2UICatalogError(
            "\(path).values[\(idx)] does not match valueType '\(valueType.rawValue)'."
          )
        }
        guard !unique.contains(where: { jsonScalarEquals($0, val) }) else {
          throw A2UICatalogError("Duplicate enum value at \(path).values[\(idx)].")
        }
        unique.append(val)
      }
      if let defVal {
        guard matchesEnumValueType(defVal, valueType) else {
          throw A2UICatalogError(
            "\(path).default does not match valueType '\(valueType.rawValue)'."
          )
        }
        guard unique.contains(where: { jsonScalarEquals($0, defVal) }) else {
          throw A2UICatalogError("\(path).default must be one of the declared enum values.")
        }
      }

    case .const(let value):
      guard isScalar(value) else {
        throw A2UICatalogError(
          "\(path).value must be a JSON scalar (string, number, boolean, null).")
      }

    case .any(_, let nullable, let defVal):
      if !nullable, defVal == .null {
        throw A2UICatalogError("\(path).default cannot be null when 'nullable' is false.")
      }

    case .object(_, let properties, let additional, let atLeastOneOf, _):
      try validateParameters(
        properties,
        allowComponentTypes: allowComponentTypes,
        forbidEnvelopeKeys: false,
        context: "\(path).properties"
      )
      if let extra = additional.typedSchema {
        try validateTypeSemantics(
          extra,
          allowComponentTypes: allowComponentTypes,
          path: "\(path).additionalProperties"
        )
      }
      try validateAtLeastOneOf(
        atLeastOneOf,
        declaredNames: Set(properties.map(\.name)),
        path: "\(path).atLeastOneOf"
      )

    case .array(_, let items, let minI, let maxI, _, _):
      if let minI, minI < 0 {
        throw A2UICatalogError("\(path).minItems must be non-negative.")
      }
      if let maxI, maxI < 0 {
        throw A2UICatalogError("\(path).maxItems must be non-negative.")
      }
      if let minI, let maxI, minI > maxI {
        throw A2UICatalogError("\(path).minItems (\(minI)) cannot exceed maxItems (\(maxI)).")
      }
      if let items {
        try validateTypeSemantics(
          items,
          allowComponentTypes: allowComponentTypes,
          path: "\(path).items"
        )
      }

    case .union(let variants, _, _, _):
      guard variants.count >= 2 else {
        throw A2UICatalogError("\(path).variants must contain at least 2 variants.")
      }
      for (idx, variant) in variants.enumerated() {
        try validateTypeSemantics(
          variant,
          allowComponentTypes: allowComponentTypes,
          path: "\(path).variants[\(idx)]"
        )
      }

    case .ref(let target, _):
      try assertIdentifier(target, context: "\(path).ref")

    case .child, .childList, .action, .checkRule, .accessibility:
      guard allowComponentTypes else {
        throw A2UICatalogError("Component-only type is not allowed in data-only scope at \(path).")
      }

    case .boolean, .dataBinding, .functionCall, .rawJSONSchema:
      break
    }
  }

  private static func validateModelRefsAndCycles(_ model: CatalogModel) throws {
    let definedTypes = Set(model.types.keys)
    for (name, typeDef) in model.types {
      try validateTypeRefs(typeDef, definedTypes: definedTypes, path: "types.\(name)")
    }
    // Reject only unguarded direct alias cycles (`A -> Ref(B) -> Ref(A)`).
    // Structural recursion guarded by `.object`, `.array`, or `.union` is permitted.
    for name in model.types.keys.sorted() {
      var visited: Set<String> = [name]
      var current = model.types[name]
      while case .ref(let target, _) = current?.kind {
        guard visited.insert(target).inserted else {
          throw A2UICatalogError("Cyclic local type alias detected involving '\(name)'.")
        }
        current = model.types[target]
      }
    }
    if let surfaceProps = model.surfaceProperties {
      for prop in surfaceProps.properties {
        try validateTypeRefs(
          prop.type, definedTypes: definedTypes, path: "surfaceProperties.\(prop.name)")
      }
      if let extra = surfaceProps.additionalProperties.typedSchema {
        try validateTypeRefs(
          extra, definedTypes: definedTypes, path: "surfaceProperties.additionalProperties")
      }
    }
    for component in model.components {
      for param in component.parameters {
        try validateTypeRefs(
          param.type, definedTypes: definedTypes, path: "components.\(component.name).\(param.name)"
        )
      }
    }
    for function in model.functions {
      if let retType = function.returnType.effectiveDataType {
        try validateTypeRefs(
          retType, definedTypes: definedTypes, path: "functions.\(function.name).returnType")
      }
      for param in function.parameters {
        try validateTypeRefs(
          param.type, definedTypes: definedTypes, path: "functions.\(function.name).\(param.name)")
      }
      if let extra = function.additionalParameters.typedSchema {
        try validateTypeRefs(
          extra, definedTypes: definedTypes, path: "functions.\(function.name).additionalParameters"
        )
      }
    }
  }

  private static func validateTypeRefs(
    _ type: TypeDefinition,
    definedTypes: Set<String>,
    path: String
  ) throws {
    switch type.kind {
    case .ref(let refName, _):
      guard definedTypes.contains(refName) else {
        throw A2UICatalogError("Unresolved local type ref '\(refName)' at \(path).")
      }
    case .object(_, let properties, let additional, _, _):
      for prop in properties {
        try validateTypeRefs(prop.type, definedTypes: definedTypes, path: "\(path).\(prop.name)")
      }
      if let extra = additional.typedSchema {
        try validateTypeRefs(
          extra, definedTypes: definedTypes, path: "\(path).additionalProperties")
      }
    case .array(_, let items, _, _, _, _):
      if let items {
        try validateTypeRefs(items, definedTypes: definedTypes, path: "\(path).items")
      }
    case .union(let variants, _, _, _):
      for (idx, variant) in variants.enumerated() {
        try validateTypeRefs(variant, definedTypes: definedTypes, path: "\(path).variants[\(idx)]")
      }
    default:
      break
    }
  }

  private static func validateAtLeastOneOf(
    _ groups: [[String]],
    declaredNames: Set<String>,
    path: String
  ) throws {
    for (idx, group) in groups.enumerated() {
      guard group.count >= 2 else {
        throw A2UICatalogError("\(path)[\(idx)] must contain at least 2 parameter names.")
      }
      var seen: Set<String> = []
      for name in group {
        guard seen.insert(name).inserted else {
          throw A2UICatalogError("Duplicate parameter '\(name)' in \(path)[\(idx)].")
        }
        guard declaredNames.contains(name) else {
          throw A2UICatalogError(
            "Parameter '\(name)' in \(path)[\(idx)] is not declared in properties/parameters."
          )
        }
      }
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

  private static func assertIdentifier(_ name: String, context: String) throws {
    guard UnicodeIdentifierValidator.isValidIdentifier(name) else {
      throw A2UICatalogError("Invalid UAX #31 identifier '\(name)' in \(context).")
    }
  }

  private static func assertComponentName(_ name: String) throws {
    guard name != "Surface" else {
      throw A2UICatalogError("Component name 'Surface' is reserved and cannot be declared.")
    }
    try assertIdentifier(name, context: "component name")
  }

  private static func assertFunctionName(_ name: String) throws {
    guard !name.hasPrefix("@") else {
      throw A2UICatalogError(
        "Function name '\(name)' cannot start with '@' (reserved for system functions)."
      )
    }
    try assertIdentifier(name, context: "function name")
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

  private static func matchesEnumValueType(_ value: JSONValue, _ valueType: EnumValueType) -> Bool {
    switch valueType {
    case .string: return value.stringValue != nil
    case .number: return value.doubleValue.map(\.isFinite) ?? false
    case .boolean: return value.boolValue != nil
    }
  }

  private static func isScalar(_ value: JSONValue) -> Bool {
    switch value {
    case .string, .integer, .boolean, .null: return true
    case .number(let n): return n.isFinite
    case .array, .object: return false
    }
  }

  // MARK: - Shared Internal Utilities

  internal static func isValidSemVer(_ value: String) -> Bool {
    guard !value.isEmpty else { return false }
    let buildSplit = value.split(separator: "+", maxSplits: 1, omittingEmptySubsequences: false)
    if buildSplit.count == 2 {
      let buildParts = buildSplit[1].split(separator: ".", omittingEmptySubsequences: false)
      guard
        !buildParts.isEmpty,
        buildParts.allSatisfy({ part in
          !part.isEmpty
            && part.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
        })
      else {
        return false
      }
    }
    let preSplit = buildSplit[0].split(
      separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
    if preSplit.count == 2 {
      let preParts = preSplit[1].split(separator: ".", omittingEmptySubsequences: false)
      guard
        !preParts.isEmpty,
        preParts.allSatisfy({ part in
          guard !part.isEmpty else { return false }
          guard part.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }) else {
            return false
          }
          if part.allSatisfy(\.isNumber) {
            return part.count == 1 || !part.hasPrefix("0")
          }
          return true
        })
      else {
        return false
      }
    }
    let coreParts = preSplit[0].split(separator: ".", omittingEmptySubsequences: false)
    guard coreParts.count == 2 || coreParts.count == 3 else { return false }
    return coreParts.allSatisfy { part in
      !part.isEmpty && part.allSatisfy({ $0.isASCII && $0.isNumber })
        && (part.count == 1 || !part.hasPrefix("0"))
    }
  }

  internal static func normalizeProtocolVersion(_ version: String) -> String {
    if version.hasPrefix("v") || version.hasPrefix("V") {
      return String(version.dropFirst())
    }
    return version
  }

  internal static func encodeNumber(_ value: Double) -> JSONValue {
    if let exact = Int(exactly: value) {
      return .integer(exact)
    }
    return .number(value)
  }

  internal static func parseReturnShorthand(_ raw: String) -> FunctionReturnDefinition? {
    switch raw {
    case "string": return .string
    case "number": return .number
    case "integer": return .integer
    case "boolean": return .boolean
    case "array": return .array
    case "object": return .object
    case "validationResult": return .validationResult
    case "any": return .any
    case "void": return .void
    default: return nil
    }
  }

  internal static func jsonScalarEquals(_ lhs: JSONValue, _ rhs: JSONValue) -> Bool {
    if let l = lhs.doubleValue, let r = rhs.doubleValue { return l == r }
    return lhs == rhs
  }
}
