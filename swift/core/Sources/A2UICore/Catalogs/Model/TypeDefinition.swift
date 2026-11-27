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

/// Canonical closed-set type definition for A2UI Catalog Documents and in-memory catalog models.
///
/// Covers all 18 protocol type kinds (13 data types + 5 component-only types) plus an internal
/// ``Kind/rawJSONSchema(_:)`` escape hatch for legacy JSON Schema fragments that cannot be
/// losslessly expressed in the closed type system.
public struct TypeDefinition: Sendable, Equatable {
  /// Discriminated union of the 18 protocol type kinds plus the legacy raw JSON Schema escape
  /// hatch.
  public indirect enum Kind: Sendable, Equatable {
    case string(
      dynamic: Bool,
      formats: [String]?,
      pattern: String?,
      minLength: Int?,
      maxLength: Int?,
      defaultValue: String?
    )
    case number(
      dynamic: Bool,
      min: Double?,
      max: Double?,
      defaultValue: Double?
    )
    case integer(
      dynamic: Bool,
      min: Int?,
      max: Int?,
      defaultValue: Int?
    )
    case boolean(
      dynamic: Bool,
      defaultValue: Bool?
    )
    case `enum`(
      values: [JSONValue],
      valueType: EnumValueType,
      dynamic: Bool,
      defaultValue: JSONValue?
    )
    case const(value: JSONValue)
    case any(
      dynamic: Bool,
      nullable: Bool,
      defaultValue: JSONValue?
    )
    case object(
      dynamic: Bool,
      properties: [ParameterDefinition],
      additionalProperties: AdditionalProperties,
      atLeastOneOf: [[String]],
      defaultValue: [String: JSONValue]?
    )
    case array(
      dynamic: Bool,
      items: TypeDefinition?,
      minItems: Int?,
      maxItems: Int?,
      uniqueItems: Bool,
      defaultValue: [JSONValue]?
    )
    case union(
      variants: [TypeDefinition],
      exclusive: Bool,
      dynamic: Bool,
      defaultValue: JSONValue?
    )
    case dataBinding
    case functionCall
    case ref(String, defaultValue: JSONValue?)
    case child
    case childList
    case action
    case checkRule
    case accessibility
    case rawJSONSchema(JSONValue)
  }

  /// The structural kind and type-specific constraints.
  public var kind: Kind

  /// Optional human- and LLM-readable description.
  public var description: String?

  /// Whether this type or parameter is deprecated.
  public var deprecated: Bool

  /// Optional deprecation explanation and migration hint.
  public var deprecatedReason: String?

  public init(
    kind: Kind,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) {
    self.kind = kind
    self.description = description
    self.deprecated = deprecated
    self.deprecatedReason = deprecatedReason
  }

  // MARK: - Static Factories

  public static func string(
    dynamic: Bool = false,
    formats: [String]? = nil,
    pattern: String? = nil,
    minLength: Int? = nil,
    maxLength: Int? = nil,
    defaultValue: String? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .string(
        dynamic: dynamic,
        formats: formats,
        pattern: pattern,
        minLength: minLength,
        maxLength: maxLength,
        defaultValue: defaultValue
      ),
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func number(
    dynamic: Bool = false,
    min: Double? = nil,
    max: Double? = nil,
    defaultValue: Double? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .number(dynamic: dynamic, min: min, max: max, defaultValue: defaultValue),
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func integer(
    dynamic: Bool = false,
    min: Int? = nil,
    max: Int? = nil,
    defaultValue: Int? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .integer(dynamic: dynamic, min: min, max: max, defaultValue: defaultValue),
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func boolean(
    dynamic: Bool = false,
    defaultValue: Bool? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .boolean(dynamic: dynamic, defaultValue: defaultValue),
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func `enum`(
    values: [JSONValue],
    valueType: EnumValueType = .string,
    dynamic: Bool = false,
    defaultValue: JSONValue? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .enum(
        values: values,
        valueType: valueType,
        dynamic: dynamic,
        defaultValue: defaultValue
      ),
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func const(
    value: JSONValue,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .const(value: value),
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func any(
    dynamic: Bool = false,
    nullable: Bool = false,
    defaultValue: JSONValue? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .any(dynamic: dynamic, nullable: nullable, defaultValue: defaultValue),
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func object(
    dynamic: Bool = false,
    properties: [ParameterDefinition] = [],
    additionalProperties: AdditionalProperties = .disallowed,
    atLeastOneOf: [[String]] = [],
    defaultValue: [String: JSONValue]? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .object(
        dynamic: dynamic,
        properties: properties,
        additionalProperties: additionalProperties,
        atLeastOneOf: atLeastOneOf,
        defaultValue: defaultValue
      ),
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func array(
    dynamic: Bool = false,
    items: TypeDefinition? = nil,
    minItems: Int? = nil,
    maxItems: Int? = nil,
    uniqueItems: Bool = false,
    defaultValue: [JSONValue]? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .array(
        dynamic: dynamic,
        items: items,
        minItems: minItems,
        maxItems: maxItems,
        uniqueItems: uniqueItems,
        defaultValue: defaultValue
      ),
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func union(
    variants: [TypeDefinition],
    exclusive: Bool = false,
    dynamic: Bool = false,
    defaultValue: JSONValue? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .union(
        variants: variants,
        exclusive: exclusive,
        dynamic: dynamic,
        defaultValue: defaultValue
      ),
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func dataBinding(
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .dataBinding,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func functionCall(
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .functionCall,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func ref(
    _ name: String,
    defaultValue: JSONValue? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .ref(name, defaultValue: defaultValue),
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func child(
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .child,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func childList(
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .childList,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func action(
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .action,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func checkRule(
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .checkRule,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func accessibility(
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> TypeDefinition {
    TypeDefinition(
      kind: .accessibility,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  internal static func rawJSONSchema(_ schema: JSONValue) -> TypeDefinition {
    TypeDefinition(
      kind: .rawJSONSchema(schema),
      description: schema["description"]?.stringValue,
      deprecated: schema["deprecated"]?.boolValue ?? false
    )
  }

  // MARK: - Introspection & Helpers

  /// The default value configured on this type, if any.
  public var defaultJSONValue: JSONValue? {
    switch kind {
    case .string(_, _, _, _, _, let v): return v.map(JSONValue.string)
    case .number(_, _, _, let v): return v.map(JSONValue.number)
    case .integer(_, _, _, let v): return v.map(JSONValue.integer)
    case .boolean(_, let v): return v.map(JSONValue.boolean)
    case .enum(_, _, _, let v), .any(_, _, let v), .union(_, _, _, let v), .ref(_, let v):
      return v
    case .object(_, _, _, _, let v):
      return v.map { dict in .object(OrderedDictionary(uniqueKeysWithValues: dict.map { $0 })) }
    case .array(_, _, _, _, _, let v):
      return v.map(JSONValue.array)
    case .rawJSONSchema(let raw):
      return raw["default"]
    case .const, .dataBinding, .functionCall, .child, .childList, .action, .checkRule,
      .accessibility:
      return nil
    }
  }

  /// Whether this type accepts dynamic bindings / function calls.
  public var isDynamic: Bool {
    switch kind {
    case .string(let d, _, _, _, _, _),
      .number(let d, _, _, _),
      .integer(let d, _, _, _),
      .boolean(let d, _),
      .enum(_, _, let d, _),
      .any(let d, _, _),
      .object(let d, _, _, _, _),
      .array(let d, _, _, _, _, _),
      .union(_, _, let d, _):
      return d
    case .dataBinding, .functionCall:
      return true
    case .const, .ref, .child, .childList, .action, .checkRule, .accessibility, .rawJSONSchema:
      return false
    }
  }

  /// Whether this type (and all nested types) is valid in data-only contexts (`types`,
  /// `surfaceProperties`, and `functions`), i.e. contains no component-only types.
  public var isDataType: Bool {
    switch kind {
    case .child, .childList, .action, .checkRule, .accessibility:
      return false
    case .object(_, let properties, let additional, _, _):
      return properties.allSatisfy(\.type.isDataType)
        && (additional.typedSchema?.isDataType ?? true)
    case .array(_, let items, _, _, _, _):
      return items?.isDataType ?? true
    case .union(let variants, _, _, _):
      return variants.allSatisfy(\.isDataType)
    case .string, .number, .integer, .boolean, .enum, .const, .any, .dataBinding, .functionCall,
      .ref, .rawJSONSchema:
      return true
    }
  }

  /// Whether this type or any nested child type holds a legacy raw JSON Schema fragment.
  public var containsRawJSONSchema: Bool {
    switch kind {
    case .rawJSONSchema:
      return true
    case .object(_, let properties, let additional, _, _):
      return properties.contains { $0.type.containsRawJSONSchema }
        || (additional.typedSchema?.containsRawJSONSchema ?? false)
    case .array(_, let items, _, _, _, _):
      return items?.containsRawJSONSchema ?? false
    case .union(let variants, _, _, _):
      return variants.contains { $0.containsRawJSONSchema }
    default:
      return false
    }
  }

  /// Returns a copy with `dynamic` updated on kinds that support dynamic bindings.
  internal func withDynamic(_ newDynamic: Bool) -> TypeDefinition {
    var copy = self
    switch kind {
    case .string(_, let f, let p, let minL, let maxL, let def):
      copy.kind = .string(
        dynamic: newDynamic, formats: f, pattern: p, minLength: minL, maxLength: maxL,
        defaultValue: def)
    case .number(_, let minV, let maxV, let def):
      copy.kind = .number(dynamic: newDynamic, min: minV, max: maxV, defaultValue: def)
    case .integer(_, let minV, let maxV, let def):
      copy.kind = .integer(dynamic: newDynamic, min: minV, max: maxV, defaultValue: def)
    case .boolean(_, let def):
      copy.kind = .boolean(dynamic: newDynamic, defaultValue: def)
    case .enum(let vals, let vt, _, let def):
      copy.kind = .enum(values: vals, valueType: vt, dynamic: newDynamic, defaultValue: def)
    case .any(_, let nullable, let def):
      copy.kind = .any(dynamic: newDynamic, nullable: nullable, defaultValue: def)
    case .object(_, let props, let add, let groups, let def):
      copy.kind = .object(
        dynamic: newDynamic, properties: props, additionalProperties: add, atLeastOneOf: groups,
        defaultValue: def)
    case .array(_, let items, let minI, let maxI, let unique, let def):
      copy.kind = .array(
        dynamic: newDynamic, items: items, minItems: minI, maxItems: maxI, uniqueItems: unique,
        defaultValue: def)
    case .union(let variants, let excl, _, let def):
      copy.kind = .union(
        variants: variants, exclusive: excl, dynamic: newDynamic, defaultValue: def)
    case .const, .dataBinding, .functionCall, .ref, .child, .childList, .action, .checkRule,
      .accessibility, .rawJSONSchema:
      break
    }
    return copy
  }

  /// Returns a copy with `defaultValue` updated when compatible with this kind.
  internal func withDefault(_ rawDefault: JSONValue?) -> TypeDefinition {
    guard let rawDefault else { return self }
    var copy = self
    switch kind {
    case .string(let d, let f, let p, let minL, let maxL, _):
      copy.kind = .string(
        dynamic: d, formats: f, pattern: p, minLength: minL, maxLength: maxL,
        defaultValue: rawDefault.stringValue)
    case .number(let d, let minV, let maxV, _):
      copy.kind = .number(dynamic: d, min: minV, max: maxV, defaultValue: rawDefault.doubleValue)
    case .integer(let d, let minV, let maxV, _):
      copy.kind = .integer(dynamic: d, min: minV, max: maxV, defaultValue: rawDefault.intValue)
    case .boolean(let d, _):
      copy.kind = .boolean(dynamic: d, defaultValue: rawDefault.boolValue)
    case .enum(let vals, let vt, let d, _):
      copy.kind = .enum(values: vals, valueType: vt, dynamic: d, defaultValue: rawDefault)
    case .any(let d, let nullable, _):
      copy.kind = .any(dynamic: d, nullable: nullable, defaultValue: rawDefault)
    case .object(let d, let props, let add, let groups, _):
      copy.kind = .object(
        dynamic: d, properties: props, additionalProperties: add, atLeastOneOf: groups,
        defaultValue: rawDefault.dictionaryValue)
    case .array(let d, let items, let minI, let maxI, let unique, _):
      copy.kind = .array(
        dynamic: d, items: items, minItems: minI, maxItems: maxI, uniqueItems: unique,
        defaultValue: rawDefault.arrayValue)
    case .union(let variants, let excl, let d, _):
      copy.kind = .union(variants: variants, exclusive: excl, dynamic: d, defaultValue: rawDefault)
    case .ref(let name, _):
      copy.kind = .ref(name, defaultValue: rawDefault)
    default:
      break
    }
    return copy
  }

  /// Strips parameter-level metadata (`description`, `deprecated`, `deprecatedReason`) so
  /// parameter and type metadata do not duplicate when nested inside ``ParameterDefinition``.
  internal func strippingParameterMetadata() -> TypeDefinition {
    TypeDefinition(kind: kind, description: nil, deprecated: false, deprecatedReason: nil)
  }
}

extension AdditionalProperties {
  /// Returns the inner value type when `.typed`, or `nil` otherwise.
  internal var typedSchema: TypeDefinition? {
    if case .typed(let type) = self { return type }
    return nil
  }
}
