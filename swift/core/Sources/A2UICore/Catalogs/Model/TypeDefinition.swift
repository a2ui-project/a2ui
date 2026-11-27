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

import OrderedCollections
import OrderedJSON

/// Canonical in-memory type representation for A2UI catalog parameters, reusable local types, and
/// function return types.
///
/// Covers all 18 closed Catalog Document variants (13 data types and 5 component-only types), plus
/// an in-memory ``rawJSONSchema(_:)`` escape hatch for legacy JSON Schema fragments that cannot be
/// translated losslessly.
public indirect enum TypeDefinition: Sendable, Equatable {
  // MARK: - Data Types (13)

  case string(
    dynamic: Bool = false,
    formats: [String]? = nil,
    pattern: String? = nil,
    minLength: Int? = nil,
    maxLength: Int? = nil,
    defaultValue: String? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  case number(
    dynamic: Bool = false,
    min: Double? = nil,
    max: Double? = nil,
    defaultValue: Double? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  case integer(
    dynamic: Bool = false,
    min: Int? = nil,
    max: Int? = nil,
    defaultValue: Int? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  case boolean(
    dynamic: Bool = false,
    defaultValue: Bool? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  case `enum`(
    values: [JSONValue],
    valueType: EnumValueType = .string,
    dynamic: Bool = false,
    defaultValue: JSONValue? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  case const(
    value: JSONValue,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  case any(
    dynamic: Bool = false,
    nullable: Bool = false,
    defaultValue: JSONValue? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  case object(
    dynamic: Bool = false,
    properties: [ParameterDefinition] = [],
    additionalProperties: AdditionalProperties = .disallowed,
    atLeastOneOf: [[String]] = [],
    defaultValue: [String: JSONValue]? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  case array(
    dynamic: Bool = false,
    items: TypeDefinition? = nil,
    minItems: Int? = nil,
    maxItems: Int? = nil,
    uniqueItems: Bool = false,
    defaultValue: [JSONValue]? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  case union(
    variants: [TypeDefinition],
    exclusive: Bool = true,
    dynamic: Bool = false,
    defaultValue: JSONValue? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  case dataBinding(
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  case functionCall(
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  case ref(
    _ name: String,
    defaultValue: JSONValue? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  // MARK: - Component-Only Types (5)

  case child(
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  case childList(
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  case action(
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  case checkRule(
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  case accessibility(
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  )

  // MARK: - Legacy Escape Hatch (In-Memory Only)

  /// Holds an untranslatable legacy JSON Schema fragment. Never emitted in Catalog Documents.
  case rawJSONSchema(JSONValue)

  // MARK: - Inspection Helpers

  /// Human- and LLM-readable description attached to this type, if any.
  public var description: String? {
    switch self {
    case .string(_, _, _, _, _, _, let desc, _, _),
      .number(_, _, _, _, let desc, _, _),
      .integer(_, _, _, _, let desc, _, _),
      .boolean(_, _, let desc, _, _),
      .enum(_, _, _, _, let desc, _, _),
      .const(_, let desc, _, _),
      .any(_, _, _, let desc, _, _),
      .object(_, _, _, _, _, let desc, _, _),
      .array(_, _, _, _, _, _, let desc, _, _),
      .union(_, _, _, _, let desc, _, _),
      .dataBinding(let desc, _, _),
      .functionCall(let desc, _, _),
      .ref(_, _, let desc, _, _),
      .child(let desc, _, _),
      .childList(let desc, _, _),
      .action(let desc, _, _),
      .checkRule(let desc, _, _),
      .accessibility(let desc, _, _):
      return desc
    case .rawJSONSchema(let raw):
      return raw["description"]?.stringValue
    }
  }

  /// Whether this type is marked deprecated.
  public var isDeprecated: Bool {
    switch self {
    case .string(_, _, _, _, _, _, _, let deprecated, _),
      .number(_, _, _, _, _, let deprecated, _),
      .integer(_, _, _, _, _, let deprecated, _),
      .boolean(_, _, _, let deprecated, _),
      .enum(_, _, _, _, _, let deprecated, _),
      .const(_, _, let deprecated, _),
      .any(_, _, _, _, let deprecated, _),
      .object(_, _, _, _, _, _, let deprecated, _),
      .array(_, _, _, _, _, _, _, let deprecated, _),
      .union(_, _, _, _, _, let deprecated, _),
      .dataBinding(_, let deprecated, _),
      .functionCall(_, let deprecated, _),
      .ref(_, _, _, let deprecated, _),
      .child(_, let deprecated, _),
      .childList(_, let deprecated, _),
      .action(_, let deprecated, _),
      .checkRule(_, let deprecated, _),
      .accessibility(_, let deprecated, _):
      return deprecated
    case .rawJSONSchema(let raw):
      return raw["deprecated"]?.boolValue ?? false
    }
  }

  /// Optional deprecation explanation and migration hint.
  public var deprecatedReason: String? {
    switch self {
    case .string(_, _, _, _, _, _, _, _, let reason),
      .number(_, _, _, _, _, _, let reason),
      .integer(_, _, _, _, _, _, let reason),
      .boolean(_, _, _, _, let reason),
      .enum(_, _, _, _, _, _, let reason),
      .const(_, _, _, let reason),
      .any(_, _, _, _, _, let reason),
      .object(_, _, _, _, _, _, _, let reason),
      .array(_, _, _, _, _, _, _, _, let reason),
      .union(_, _, _, _, _, _, let reason),
      .dataBinding(_, _, let reason),
      .functionCall(_, _, let reason),
      .ref(_, _, _, _, let reason),
      .child(_, _, let reason),
      .childList(_, _, let reason),
      .action(_, _, let reason),
      .checkRule(_, _, let reason),
      .accessibility(_, _, let reason):
      return reason
    case .rawJSONSchema:
      return nil
    }
  }

  /// Default JSON value declared on this type, if any.
  public var defaultJSONValue: JSONValue? {
    switch self {
    case .string(_, _, _, _, _, let val, _, _, _):
      return val.map { .string($0) }
    case .number(_, _, _, let val, _, _, _):
      return val.map { .number($0) }
    case .integer(_, _, _, let val, _, _, _):
      return val.map { .integer($0) }
    case .boolean(_, let val, _, _, _):
      return val.map { .boolean($0) }
    case .enum(_, _, _, let val, _, _, _),
      .any(_, _, let val, _, _, _),
      .union(_, _, _, let val, _, _, _),
      .ref(_, let val, _, _, _):
      return val
    case .object(_, _, _, _, let val, _, _, _):
      guard let val else { return nil }
      var ordered: OrderedDictionary<String, JSONValue> = [:]
      for key in val.keys.sorted() {
        ordered[key] = val[key]
      }
      return .object(ordered)
    case .array(_, _, _, _, _, let val, _, _, _):
      return val.map { .array($0) }
    case .const, .dataBinding, .functionCall, .child, .childList, .action, .checkRule,
      .accessibility:
      return nil
    case .rawJSONSchema(let raw):
      return raw["default"]
    }
  }

  /// Whether this type accepts dynamic bindings and function calls.
  public var isDynamic: Bool {
    switch self {
    case .string(let dynamic, _, _, _, _, _, _, _, _),
      .number(let dynamic, _, _, _, _, _, _),
      .integer(let dynamic, _, _, _, _, _, _),
      .boolean(let dynamic, _, _, _, _),
      .enum(_, _, let dynamic, _, _, _, _),
      .any(let dynamic, _, _, _, _, _),
      .object(let dynamic, _, _, _, _, _, _, _),
      .array(let dynamic, _, _, _, _, _, _, _, _),
      .union(_, _, let dynamic, _, _, _, _):
      return dynamic
    case .dataBinding, .functionCall:
      return true
    case .const, .ref, .child, .childList, .action, .checkRule, .accessibility, .rawJSONSchema:
      return false
    }
  }

  /// Whether this type is a pure data type (contains no component-only variants).
  public var isDataType: Bool {
    switch self {
    case .child, .childList, .action, .checkRule, .accessibility:
      return false
    case .object(_, let properties, let additionalProperties, _, _, _, _, _):
      return properties.allSatisfy { $0.type.isDataType } && additionalProperties.isDataType
    case .array(_, let items, _, _, _, _, _, _, _):
      return items?.isDataType ?? true
    case .union(let variants, _, _, _, _, _, _):
      return variants.allSatisfy(\.isDataType)
    case .string, .number, .integer, .boolean, .enum, .const, .any, .dataBinding, .functionCall,
      .ref, .rawJSONSchema:
      return true
    }
  }

  /// Whether this type or any nested child type holds a ``rawJSONSchema(_:)`` fragment.
  public var containsRawJSONSchema: Bool {
    switch self {
    case .rawJSONSchema:
      return true
    case .object(_, let properties, let additionalProperties, _, _, _, _, _):
      return properties.contains { $0.type.containsRawJSONSchema }
        || !additionalProperties.isCanonical
    case .array(_, let items, _, _, _, _, _, _, _):
      return items?.containsRawJSONSchema ?? false
    case .union(let variants, _, _, _, _, _, _):
      return variants.contains(where: \.containsRawJSONSchema)
    case .string, .number, .integer, .boolean, .enum, .const, .any, .dataBinding, .functionCall,
      .ref, .child, .childList, .action, .checkRule, .accessibility:
      return false
    }
  }

  /// Returns a copy of this type with its `dynamic` flag updated, if the variant supports it.
  internal func withDynamic(_ dynamic: Bool) -> TypeDefinition {
    switch self {
    case .string(
      _, let formats, let pattern, let minLength, let maxLength, let def, let desc,
      let dep, let reason):
      return .string(
        dynamic: dynamic,
        formats: formats,
        pattern: pattern,
        minLength: minLength,
        maxLength: maxLength,
        defaultValue: def,
        description: desc,
        deprecated: dep,
        deprecatedReason: reason
      )
    case .number(_, let min, let max, let def, let desc, let dep, let reason):
      return .number(
        dynamic: dynamic,
        min: min,
        max: max,
        defaultValue: def,
        description: desc,
        deprecated: dep,
        deprecatedReason: reason
      )
    case .integer(_, let min, let max, let def, let desc, let dep, let reason):
      return .integer(
        dynamic: dynamic,
        min: min,
        max: max,
        defaultValue: def,
        description: desc,
        deprecated: dep,
        deprecatedReason: reason
      )
    case .boolean(_, let def, let desc, let dep, let reason):
      return .boolean(
        dynamic: dynamic,
        defaultValue: def,
        description: desc,
        deprecated: dep,
        deprecatedReason: reason
      )
    case .enum(let values, let valueType, _, let def, let desc, let dep, let reason):
      return .enum(
        values: values,
        valueType: valueType,
        dynamic: dynamic,
        defaultValue: def,
        description: desc,
        deprecated: dep,
        deprecatedReason: reason
      )
    case .any(_, let nullable, let def, let desc, let dep, let reason):
      return .any(
        dynamic: dynamic,
        nullable: nullable,
        defaultValue: def,
        description: desc,
        deprecated: dep,
        deprecatedReason: reason
      )
    case .object(
      _, let props, let additional, let atLeastOneOf, let def, let desc, let dep,
      let reason):
      return .object(
        dynamic: dynamic,
        properties: props,
        additionalProperties: additional,
        atLeastOneOf: atLeastOneOf,
        defaultValue: def,
        description: desc,
        deprecated: dep,
        deprecatedReason: reason
      )
    case .array(
      _, let items, let minItems, let maxItems, let unique, let def, let desc, let dep,
      let reason):
      return .array(
        dynamic: dynamic,
        items: items,
        minItems: minItems,
        maxItems: maxItems,
        uniqueItems: unique,
        defaultValue: def,
        description: desc,
        deprecated: dep,
        deprecatedReason: reason
      )
    case .union(let variants, let exclusive, _, let def, let desc, let dep, let reason):
      return .union(
        variants: variants,
        exclusive: exclusive,
        dynamic: dynamic,
        defaultValue: def,
        description: desc,
        deprecated: dep,
        deprecatedReason: reason
      )
    case .const, .dataBinding, .functionCall, .ref, .child, .childList, .action, .checkRule,
      .accessibility, .rawJSONSchema:
      return self
    }
  }

  /// Returns a copy of this type with metadata fields (`description`, `deprecated`,
  /// `deprecatedReason`) cleared, used when flattening onto ``ParameterDefinition``.
  internal func strippingParameterMetadata() -> TypeDefinition {
    switch self {
    case .string(
      let dynamic, let formats, let pattern, let minLength, let maxLength, let def, _,
      _, _):
      return .string(
        dynamic: dynamic,
        formats: formats,
        pattern: pattern,
        minLength: minLength,
        maxLength: maxLength,
        defaultValue: def
      )
    case .number(let dynamic, let min, let max, let def, _, _, _):
      return .number(dynamic: dynamic, min: min, max: max, defaultValue: def)
    case .integer(let dynamic, let min, let max, let def, _, _, _):
      return .integer(dynamic: dynamic, min: min, max: max, defaultValue: def)
    case .boolean(let dynamic, let def, _, _, _):
      return .boolean(dynamic: dynamic, defaultValue: def)
    case .enum(let values, let valueType, let dynamic, let def, _, _, _):
      return .enum(values: values, valueType: valueType, dynamic: dynamic, defaultValue: def)
    case .const(let value, _, _, _):
      return .const(value: value)
    case .any(let dynamic, let nullable, let def, _, _, _):
      return .any(dynamic: dynamic, nullable: nullable, defaultValue: def)
    case .object(let dynamic, let props, let additional, let atLeastOneOf, let def, _, _, _):
      return .object(
        dynamic: dynamic,
        properties: props,
        additionalProperties: additional,
        atLeastOneOf: atLeastOneOf,
        defaultValue: def
      )
    case .array(let dynamic, let items, let minItems, let maxItems, let unique, let def, _, _, _):
      return .array(
        dynamic: dynamic,
        items: items,
        minItems: minItems,
        maxItems: maxItems,
        uniqueItems: unique,
        defaultValue: def
      )
    case .union(let variants, let exclusive, let dynamic, let def, _, _, _):
      return .union(variants: variants, exclusive: exclusive, dynamic: dynamic, defaultValue: def)
    case .dataBinding:
      return .dataBinding()
    case .functionCall:
      return .functionCall()
    case .ref(let name, let def, _, _, _):
      return .ref(name, defaultValue: def)
    case .child:
      return .child()
    case .childList:
      return .childList()
    case .action:
      return .action()
    case .checkRule:
      return .checkRule()
    case .accessibility:
      return .accessibility()
    case .rawJSONSchema:
      return self
    }
  }
}
