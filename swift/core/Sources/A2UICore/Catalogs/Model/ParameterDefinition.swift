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

import OrderedJSON

/// A named parameter or property within a component, function, object, or surface properties
/// definition.
public struct ParameterDefinition: Sendable, Equatable {
  /// Unique parameter identifier within its enclosing definition.
  public var name: String

  /// The canonical type of this parameter.
  public var type: TypeDefinition

  /// Whether this parameter must be supplied on wire payloads.
  public var required: Bool

  /// Human- and LLM-readable description of this parameter.
  public var description: String?

  /// Whether this parameter is deprecated.
  public var deprecated: Bool

  /// Optional deprecation explanation and migration hint.
  public var deprecatedReason: String?

  public init(
    name: String,
    type: TypeDefinition,
    required: Bool = false,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) {
    self.name = name
    self.type = type
    self.required = required
    self.description = description
    self.deprecated = deprecated
    self.deprecatedReason = deprecatedReason
  }

  /// Effective description falling back to any description attached to ``type``.
  public var effectiveDescription: String? {
    description ?? type.description
  }

  /// Effective deprecation flag combining parameter- and type-level metadata.
  public var isEffectivelyDeprecated: Bool {
    deprecated || type.deprecated
  }

  /// Effective deprecation reason falling back to any reason attached to ``type``.
  public var effectiveDeprecatedReason: String? {
    deprecatedReason ?? type.deprecatedReason
  }

  // MARK: - Ergonomic Static Builders

  public static func string(
    _ name: String,
    dynamic: Bool = false,
    required: Bool = false,
    format: String? = nil,
    formats: [String]? = nil,
    pattern: String? = nil,
    minLength: Int? = nil,
    maxLength: Int? = nil,
    defaultValue: String? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    let resolvedFormats = formats ?? format.map { [$0] }
    return ParameterDefinition(
      name: name,
      type: .string(
        dynamic: dynamic,
        formats: resolvedFormats,
        pattern: pattern,
        minLength: minLength,
        maxLength: maxLength,
        defaultValue: defaultValue
      ),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func number(
    _ name: String,
    dynamic: Bool = false,
    required: Bool = false,
    min: Double? = nil,
    max: Double? = nil,
    defaultValue: Double? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .number(dynamic: dynamic, min: min, max: max, defaultValue: defaultValue),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func integer(
    _ name: String,
    dynamic: Bool = false,
    required: Bool = false,
    min: Int? = nil,
    max: Int? = nil,
    defaultValue: Int? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .integer(dynamic: dynamic, min: min, max: max, defaultValue: defaultValue),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func boolean(
    _ name: String,
    dynamic: Bool = false,
    required: Bool = false,
    defaultValue: Bool? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .boolean(dynamic: dynamic, defaultValue: defaultValue),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func `enum`(
    _ name: String,
    values: [JSONValue],
    valueType: EnumValueType = .string,
    dynamic: Bool = false,
    required: Bool = false,
    defaultValue: JSONValue? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .enum(
        values: values,
        valueType: valueType,
        dynamic: dynamic,
        defaultValue: defaultValue
      ),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func const(
    _ name: String,
    value: JSONValue,
    required: Bool = false,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .const(value: value),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func any(
    _ name: String,
    dynamic: Bool = false,
    nullable: Bool = false,
    required: Bool = false,
    defaultValue: JSONValue? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .any(dynamic: dynamic, nullable: nullable, defaultValue: defaultValue),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func object(
    _ name: String,
    properties: [ParameterDefinition] = [],
    additionalProperties: AdditionalProperties = .disallowed,
    atLeastOneOf: [[String]] = [],
    dynamic: Bool = false,
    required: Bool = false,
    defaultValue: [String: JSONValue]? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .object(
        dynamic: dynamic,
        properties: properties,
        additionalProperties: additionalProperties,
        atLeastOneOf: atLeastOneOf,
        defaultValue: defaultValue
      ),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func array(
    _ name: String,
    items: TypeDefinition? = nil,
    minItems: Int? = nil,
    maxItems: Int? = nil,
    uniqueItems: Bool = false,
    dynamic: Bool = false,
    required: Bool = false,
    defaultValue: [JSONValue]? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .array(
        dynamic: dynamic,
        items: items,
        minItems: minItems,
        maxItems: maxItems,
        uniqueItems: uniqueItems,
        defaultValue: defaultValue
      ),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func union(
    _ name: String,
    variants: [TypeDefinition],
    exclusive: Bool = true,
    dynamic: Bool = false,
    required: Bool = false,
    defaultValue: JSONValue? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .union(
        variants: variants,
        exclusive: exclusive,
        dynamic: dynamic,
        defaultValue: defaultValue
      ),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func dataBinding(
    _ name: String,
    required: Bool = false,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .dataBinding(),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func functionCall(
    _ name: String,
    required: Bool = false,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .functionCall(),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func ref(
    _ name: String,
    to refName: String,
    required: Bool = false,
    defaultValue: JSONValue? = nil,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .ref(refName, defaultValue: defaultValue),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func child(
    _ name: String,
    required: Bool = false,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .child(),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func childList(
    _ name: String,
    required: Bool = false,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .childList(),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func action(
    _ name: String,
    required: Bool = false,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .action(),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func checkRule(
    _ name: String,
    required: Bool = false,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .checkRule(),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  public static func accessibility(
    _ name: String,
    required: Bool = false,
    description: String? = nil,
    deprecated: Bool = false,
    deprecatedReason: String? = nil
  ) -> ParameterDefinition {
    ParameterDefinition(
      name: name,
      type: .accessibility(),
      required: required,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }
}
