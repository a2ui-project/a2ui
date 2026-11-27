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

import 'package:meta/meta.dart';

import 'json_utils.dart';

/// Sentinel distinguishing an omitted default value from an explicit `null`
/// default on types that allow `null` (such as [AnyType], [UnionType], and
/// [RefType]).
@internal
const Object noDefaultValue = Object();

/// Value type discriminator for an [EnumType].
enum EnumValueType {
  string('string'),
  number('number'),
  boolean('boolean');

  const EnumValueType(this.jsonValue);

  /// Wire value used in Catalog Documents (`"string"`, `"number"`,
  /// `"boolean"`).
  final String jsonValue;

  /// Parses a Catalog Document `valueType` string.
  static EnumValueType fromJson(String value) => switch (value) {
    'string' => EnumValueType.string,
    'number' => EnumValueType.number,
    'boolean' => EnumValueType.boolean,
    _ => throw FormatException(
      "Invalid enum valueType '$value'; expected 'string', 'number', or "
      "'boolean'.",
    ),
  };
}

/// Canonical, JSON-Schema-free AST node representing an A2UI parameter,
/// property, or catalog-local data type.
///
/// Closed over the 18 public Catalog Document types plus [RawJsonSchemaType]
/// for legacy JSON Schema features that have no canonical equivalent.
@immutable
sealed class TypeDefinition {
  const TypeDefinition({
    this.description,
    this.deprecated = false,
    this.deprecatedReason,
  });

  /// Human-readable description shown in prompts and generated docs.
  final String? description;

  /// Whether this type or parameter is deprecated.
  final bool deprecated;

  /// Optional migration guidance when [deprecated] is `true`.
  final String? deprecatedReason;

  /// Whether this type accepts dynamic runtime values (data bindings or
  /// function calls) in addition to static literals.
  bool get isDynamic => false;

  /// Whether this type declares a default value (including an explicit `null`
  /// default on nullable types).
  bool get hasDefault => false;

  /// The declared default value, or `null` when [hasDefault] is `false` or the
  /// explicit default is `null`.
  Object? get defaultValue => null;

  /// Whether this type or any nested child uses a component-only protocol type
  /// (`child`, `childList`, `action`, `checkRule`, `accessibility`).
  bool get containsComponentOnlyType => false;

  /// Whether this type or any nested child wraps a [RawJsonSchemaType]
  /// fallback.
  bool get containsRawJsonSchema => false;

  @protected
  bool baseEquals(TypeDefinition other) =>
      description == other.description &&
      deprecated == other.deprecated &&
      deprecatedReason == other.deprecatedReason;

  @protected
  int get baseHashCode =>
      Object.hash(runtimeType, description, deprecated, deprecatedReason);
}

/// Shared base for the 7 zero-field protocol marker types.
@immutable
sealed class _MarkerTypeDefinition extends TypeDefinition {
  const _MarkerTypeDefinition({
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other.runtimeType == runtimeType &&
          other is _MarkerTypeDefinition &&
          baseEquals(other));

  @override
  int get hashCode => baseHashCode;
}

/// A string value (optionally dynamic, formatted, pattern- or length-bounded).
@immutable
final class StringType extends TypeDefinition {
  const StringType({
    this.dynamic = false,
    this.format,
    this.formats,
    this.pattern,
    this.minLength,
    this.maxLength,
    this.defaultValue,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  }) : assert(
         format == null || formats == null,
         'Specify either format or formats, not both.',
       );

  final bool dynamic;

  /// Single string format (e.g. `'uri'`, `'date'`, `'date-time'`, `'email'`).
  final String? format;

  /// Multiple alternative string formats (e.g. `['date', 'time',
  /// 'date-time']`).
  final List<String>? formats;

  /// Regular expression pattern constraint.
  final String? pattern;

  /// Minimum string length in Unicode code points (inclusive, `>= 0`).
  final int? minLength;

  /// Maximum string length in Unicode code points (inclusive, `>= 0`).
  final int? maxLength;

  @override
  final String? defaultValue;

  /// All accepted string formats, normalized from [format] or [formats].
  List<String> get allFormats =>
      formats ?? (format != null ? <String>[format!] : const <String>[]);

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => defaultValue != null;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is StringType &&
          baseEquals(other) &&
          dynamic == other.dynamic &&
          format == other.format &&
          deepJsonEquals(formats, other.formats) &&
          pattern == other.pattern &&
          minLength == other.minLength &&
          maxLength == other.maxLength &&
          defaultValue == other.defaultValue;

  @override
  int get hashCode => Object.hash(
    baseHashCode,
    dynamic,
    format,
    deepJsonHash(formats),
    pattern,
    minLength,
    maxLength,
    defaultValue,
  );
}

/// A floating-point or arbitrary JSON number (optionally dynamic and bounded).
@immutable
final class NumberType extends TypeDefinition {
  const NumberType({
    this.dynamic = false,
    this.min,
    this.max,
    this.defaultValue,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  final bool dynamic;
  final num? min;
  final num? max;

  @override
  final num? defaultValue;

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => defaultValue != null;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is NumberType &&
          baseEquals(other) &&
          dynamic == other.dynamic &&
          min == other.min &&
          max == other.max &&
          defaultValue == other.defaultValue;

  @override
  int get hashCode =>
      Object.hash(baseHashCode, dynamic, min, max, defaultValue);
}

/// An integer value (optionally dynamic and bounded).
@immutable
final class IntegerType extends TypeDefinition {
  const IntegerType({
    this.dynamic = false,
    this.min,
    this.max,
    this.defaultValue,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  final bool dynamic;
  final int? min;
  final int? max;

  @override
  final int? defaultValue;

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => defaultValue != null;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is IntegerType &&
          baseEquals(other) &&
          dynamic == other.dynamic &&
          min == other.min &&
          max == other.max &&
          defaultValue == other.defaultValue;

  @override
  int get hashCode =>
      Object.hash(baseHashCode, dynamic, min, max, defaultValue);
}

/// A boolean value (optionally dynamic).
@immutable
final class BooleanType extends TypeDefinition {
  const BooleanType({
    this.dynamic = false,
    this.defaultValue,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  final bool dynamic;

  @override
  final bool? defaultValue;

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => defaultValue != null;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is BooleanType &&
          baseEquals(other) &&
          dynamic == other.dynamic &&
          defaultValue == other.defaultValue;

  @override
  int get hashCode => Object.hash(baseHashCode, dynamic, defaultValue);
}

/// A closed enumeration of string, number, or boolean literals.
@immutable
final class EnumType extends TypeDefinition {
  const EnumType({
    required this.values,
    EnumValueType? valueType,
    this.dynamic = false,
    this.defaultValue,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  }) : declaredValueType = valueType;

  /// Permitted literal values (must be non-empty).
  final List<Object> values;

  /// Explicitly declared `valueType`, or `null` when defaulted to `string`.
  final EnumValueType? declaredValueType;

  /// Effective value type (defaults to [EnumValueType.string]).
  EnumValueType get valueType => declaredValueType ?? EnumValueType.string;

  final bool dynamic;

  @override
  final Object? defaultValue;

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => defaultValue != null;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is EnumType &&
          baseEquals(other) &&
          deepJsonEquals(values, other.values) &&
          valueType == other.valueType &&
          dynamic == other.dynamic &&
          defaultValue == other.defaultValue;

  @override
  int get hashCode => Object.hash(
    baseHashCode,
    deepJsonHash(values),
    valueType,
    dynamic,
    defaultValue,
  );
}

/// A single constant JSON scalar value (`string`, `num`, `bool`, or `null`).
@immutable
final class ConstType extends TypeDefinition {
  const ConstType({
    required this.value,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  final Object? value;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ConstType && baseEquals(other) && value == other.value;

  @override
  int get hashCode => Object.hash(baseHashCode, value);
}

/// An unconstrained JSON value (optionally dynamic and/or nullable).
@immutable
final class AnyType extends TypeDefinition {
  const AnyType({
    this.dynamic = false,
    this.nullable = false,
    this._defaultValue = noDefaultValue,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  final bool dynamic;
  final bool nullable;
  final Object? _defaultValue;

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => !identical(_defaultValue, noDefaultValue);

  @override
  Object? get defaultValue => hasDefault ? _defaultValue : null;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AnyType &&
          baseEquals(other) &&
          dynamic == other.dynamic &&
          nullable == other.nullable &&
          hasDefault == other.hasDefault &&
          deepJsonEquals(defaultValue, other.defaultValue);

  @override
  int get hashCode => Object.hash(
    baseHashCode,
    dynamic,
    nullable,
    hasDefault,
    deepJsonHash(defaultValue),
  );
}

/// A structured JSON object with typed properties and closure rules.
@immutable
final class ObjectType extends TypeDefinition {
  const ObjectType({
    this.dynamic = false,
    this.properties = const [],
    this.additionalProperties = false,
    this.additionalPropertiesType,
    this.atLeastOneOf,
    this.defaultValue,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  final bool dynamic;
  final List<ParameterDefinition> properties;

  /// Whether undeclared keys are allowed when [additionalPropertiesType] is
  /// `null`.
  final bool additionalProperties;

  /// Optional schema for undeclared keys (`additionalProperties: <Type>`).
  final TypeDefinition? additionalPropertiesType;

  /// Groups of property names of which at least one must be present.
  final List<List<String>>? atLeastOneOf;

  @override
  final Map<String, Object?>? defaultValue;

  /// Looks up a declared property by [name], or returns `null`.
  ParameterDefinition? property(String name) {
    for (final ParameterDefinition p in properties) {
      if (p.name == name) return p;
    }
    return null;
  }

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => defaultValue != null;

  @override
  bool get containsComponentOnlyType =>
      properties.any((p) => p.type.containsComponentOnlyType) ||
      (additionalPropertiesType?.containsComponentOnlyType ?? false);

  @override
  bool get containsRawJsonSchema =>
      properties.any((p) => p.type.containsRawJsonSchema) ||
      (additionalPropertiesType?.containsRawJsonSchema ?? false);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ObjectType &&
          baseEquals(other) &&
          dynamic == other.dynamic &&
          deepJsonEquals(properties, other.properties) &&
          additionalProperties == other.additionalProperties &&
          additionalPropertiesType == other.additionalPropertiesType &&
          deepJsonEquals(atLeastOneOf, other.atLeastOneOf) &&
          deepJsonEquals(defaultValue, other.defaultValue);

  @override
  int get hashCode => Object.hash(
    baseHashCode,
    dynamic,
    deepJsonHash(properties),
    additionalProperties,
    additionalPropertiesType,
    deepJsonHash(atLeastOneOf),
    deepJsonHash(defaultValue),
  );
}

/// A JSON array with optional element type and cardinality constraints.
@immutable
final class ArrayType extends TypeDefinition {
  const ArrayType({
    this.dynamic = false,
    this.items,
    this.minItems,
    this.maxItems,
    this.uniqueItems = false,
    this.defaultValue,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  final bool dynamic;
  final TypeDefinition? items;
  final int? minItems;
  final int? maxItems;
  final bool uniqueItems;

  @override
  final List<Object?>? defaultValue;

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => defaultValue != null;

  @override
  bool get containsComponentOnlyType =>
      items?.containsComponentOnlyType ?? false;

  @override
  bool get containsRawJsonSchema => items?.containsRawJsonSchema ?? false;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ArrayType &&
          baseEquals(other) &&
          dynamic == other.dynamic &&
          items == other.items &&
          minItems == other.minItems &&
          maxItems == other.maxItems &&
          uniqueItems == other.uniqueItems &&
          deepJsonEquals(defaultValue, other.defaultValue);

  @override
  int get hashCode => Object.hash(
    baseHashCode,
    dynamic,
    items,
    minItems,
    maxItems,
    uniqueItems,
    deepJsonHash(defaultValue),
  );
}

/// A union of two or more alternative [TypeDefinition] variants.
@immutable
final class UnionType extends TypeDefinition {
  const UnionType({
    required this.variants,
    this.exclusive = false,
    this.dynamic = false,
    this._defaultValue = noDefaultValue,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  final List<TypeDefinition> variants;

  /// When `true`, exactly one variant must match (`oneOf`); when `false`, at
  /// least one variant must match (`anyOf`).
  final bool exclusive;

  final bool dynamic;
  final Object? _defaultValue;

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => !identical(_defaultValue, noDefaultValue);

  @override
  Object? get defaultValue => hasDefault ? _defaultValue : null;

  @override
  bool get containsComponentOnlyType =>
      variants.any((v) => v.containsComponentOnlyType);

  @override
  bool get containsRawJsonSchema =>
      variants.any((v) => v.containsRawJsonSchema);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is UnionType &&
          baseEquals(other) &&
          deepJsonEquals(variants, other.variants) &&
          exclusive == other.exclusive &&
          dynamic == other.dynamic &&
          hasDefault == other.hasDefault &&
          deepJsonEquals(defaultValue, other.defaultValue);

  @override
  int get hashCode => Object.hash(
    baseHashCode,
    deepJsonHash(variants),
    exclusive,
    dynamic,
    hasDefault,
    deepJsonHash(defaultValue),
  );
}

/// An explicit protocol `DataBinding` object (`{"@path": ...}` / `{"path": ...}`).
@immutable
final class DataBindingType extends _MarkerTypeDefinition {
  const DataBindingType({
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });
}

/// An explicit protocol `FunctionCall` object (`{"@call": ...}` / `{"call": ...}`).
@immutable
final class FunctionCallType extends _MarkerTypeDefinition {
  const FunctionCallType({
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });
}

/// A reference to a catalog-local named type declared under
/// `CatalogModel.types`.
@immutable
final class RefType extends TypeDefinition {
  const RefType({
    required this.ref,
    this._defaultValue = noDefaultValue,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  /// Name of a type declared in `CatalogModel.types`.
  final String ref;

  final Object? _defaultValue;

  @override
  bool get hasDefault => !identical(_defaultValue, noDefaultValue);

  @override
  Object? get defaultValue => hasDefault ? _defaultValue : null;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is RefType &&
          baseEquals(other) &&
          ref == other.ref &&
          hasDefault == other.hasDefault &&
          deepJsonEquals(defaultValue, other.defaultValue);

  @override
  int get hashCode =>
      Object.hash(baseHashCode, ref, hasDefault, deepJsonHash(defaultValue));
}

/// A single child component ID reference (component-only).
@immutable
final class ChildType extends _MarkerTypeDefinition {
  const ChildType({
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get containsComponentOnlyType => true;
}

/// A list of child component IDs or dynamic template binding (component-only).
@immutable
final class ChildListType extends _MarkerTypeDefinition {
  const ChildListType({
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get containsComponentOnlyType => true;
}

/// A user-triggered interaction action (`event` or `functionCall`,
/// component-only).
@immutable
final class ActionType extends _MarkerTypeDefinition {
  const ActionType({
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get containsComponentOnlyType => true;
}

/// A client-side validation check rule (`condition` + optional `message`,
/// component-only).
@immutable
final class CheckRuleType extends _MarkerTypeDefinition {
  const CheckRuleType({
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get containsComponentOnlyType => true;
}

/// Standard protocol accessibility attributes (`label`, `description`,
/// component-only).
@immutable
final class AccessibilityType extends _MarkerTypeDefinition {
  const AccessibilityType({
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get containsComponentOnlyType => true;
}

/// Read-only legacy JSON Schema compatibility fallback for Draft 2020-12
/// keywords (such as `patternProperties`, `not`, `if`/`then`/`else`, or
/// unresolvable/cyclic `$ref`s) that have no canonical Catalog Document
/// representation.
///
/// Never emitted in Catalog Documents; `serializeCatalogDocument` throws
/// `A2uiCatalogError` if a model contains this variant.
@immutable
final class RawJsonSchemaType extends TypeDefinition {
  const RawJsonSchemaType(
    this.schema, {
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  final Map<String, Object?> schema;

  @override
  bool get containsRawJsonSchema => true;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is RawJsonSchemaType &&
          baseEquals(other) &&
          deepJsonEquals(schema, other.schema);

  @override
  int get hashCode => Object.hash(baseHashCode, deepJsonHash(schema));
}

/// A named parameter on a component, function, object type, or surface
/// properties definition.
///
/// Provides named convenience constructors for all 18 canonical types so
/// catalog authors never need `json_schema_builder` or `hide ValidationResult`.
/// For compile-time constants, use the default `const ParameterDefinition(...)`
/// constructor with a `const` [TypeDefinition].
@immutable
final class ParameterDefinition {
  const ParameterDefinition({
    required this.name,
    required this.type,
    this.required = false,
  });

  /// Declares a string parameter.
  ParameterDefinition.string(
    this.name, {
    this.required = false,
    bool dynamic = false,
    String? format,
    List<String>? formats,
    String? pattern,
    int? minLength,
    int? maxLength,
    String? defaultValue,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = StringType(
         dynamic: dynamic,
         format: format,
         formats: formats,
         pattern: pattern,
         minLength: minLength,
         maxLength: maxLength,
         defaultValue: defaultValue,
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares a numeric parameter.
  ParameterDefinition.number(
    this.name, {
    this.required = false,
    bool dynamic = false,
    num? min,
    num? max,
    num? defaultValue,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = NumberType(
         dynamic: dynamic,
         min: min,
         max: max,
         defaultValue: defaultValue,
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares an integer parameter.
  ParameterDefinition.integer(
    this.name, {
    this.required = false,
    bool dynamic = false,
    int? min,
    int? max,
    int? defaultValue,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = IntegerType(
         dynamic: dynamic,
         min: min,
         max: max,
         defaultValue: defaultValue,
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares a boolean parameter.
  ParameterDefinition.boolean(
    this.name, {
    this.required = false,
    bool dynamic = false,
    bool? defaultValue,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = BooleanType(
         dynamic: dynamic,
         defaultValue: defaultValue,
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares a closed enumeration parameter.
  ParameterDefinition.enumeration(
    this.name, {
    required List<Object> values,
    EnumValueType? valueType,
    this.required = false,
    bool dynamic = false,
    Object? defaultValue,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = EnumType(
         values: values,
         valueType: valueType,
         dynamic: dynamic,
         defaultValue: defaultValue,
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares a single constant scalar parameter.
  ParameterDefinition.constant(
    this.name, {
    required Object? value,
    this.required = false,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = ConstType(
         value: value,
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares an unconstrained JSON value parameter.
  ParameterDefinition.any(
    this.name, {
    this.required = false,
    bool dynamic = false,
    bool nullable = false,
    Object? defaultValue = noDefaultValue,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = AnyType(
         dynamic: dynamic,
         nullable: nullable,
         defaultValue: defaultValue,
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares a structured object parameter.
  ParameterDefinition.object(
    this.name, {
    this.required = false,
    bool dynamic = false,
    List<ParameterDefinition> properties = const [],
    bool additionalProperties = false,
    TypeDefinition? additionalPropertiesType,
    List<List<String>>? atLeastOneOf,
    Map<String, Object?>? defaultValue,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = ObjectType(
         dynamic: dynamic,
         properties: properties,
         additionalProperties: additionalProperties,
         additionalPropertiesType: additionalPropertiesType,
         atLeastOneOf: atLeastOneOf,
         defaultValue: defaultValue,
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares an array parameter.
  ParameterDefinition.array(
    this.name, {
    this.required = false,
    bool dynamic = false,
    TypeDefinition? items,
    int? minItems,
    int? maxItems,
    bool uniqueItems = false,
    List<Object?>? defaultValue,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = ArrayType(
         dynamic: dynamic,
         items: items,
         minItems: minItems,
         maxItems: maxItems,
         uniqueItems: uniqueItems,
         defaultValue: defaultValue,
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares a union parameter.
  ParameterDefinition.union(
    this.name, {
    required List<TypeDefinition> variants,
    this.required = false,
    bool exclusive = false,
    bool dynamic = false,
    Object? defaultValue = noDefaultValue,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = UnionType(
         variants: variants,
         exclusive: exclusive,
         dynamic: dynamic,
         defaultValue: defaultValue,
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares an explicit `DataBinding` parameter.
  ParameterDefinition.dataBinding(
    this.name, {
    this.required = false,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = DataBindingType(
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares an explicit `FunctionCall` parameter.
  ParameterDefinition.functionCall(
    this.name, {
    this.required = false,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = FunctionCallType(
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares a parameter referencing a catalog-local type in `Catalog.types`.
  ParameterDefinition.ref(
    this.name, {
    required String ref,
    this.required = false,
    Object? defaultValue = noDefaultValue,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = RefType(
         ref: ref,
         defaultValue: defaultValue,
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares a single child component ID parameter (component-only).
  ParameterDefinition.child(
    this.name, {
    this.required = false,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = ChildType(
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares a child component list or template parameter (component-only).
  ParameterDefinition.childList(
    this.name, {
    this.required = false,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = ChildListType(
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares an interaction action parameter (component-only).
  ParameterDefinition.action(
    this.name, {
    this.required = false,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = ActionType(
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares a validation check rule parameter (component-only).
  ParameterDefinition.checkRule(
    this.name, {
    this.required = false,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = CheckRuleType(
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Declares an accessibility attributes parameter (component-only).
  ParameterDefinition.accessibility(
    this.name, {
    this.required = false,
    String? description,
    bool deprecated = false,
    String? deprecatedReason,
  }) : type = AccessibilityType(
         description: description,
         deprecated: deprecated,
         deprecatedReason: deprecatedReason,
       );

  /// Parameter name (UAX #31 identifier in Catalog Documents).
  final String name;

  /// Canonical type definition of this parameter.
  final TypeDefinition type;

  /// Whether this parameter is required.
  final bool required;

  /// Convenience forwarding to [TypeDefinition.description].
  String? get description => type.description;

  /// Convenience forwarding to [TypeDefinition.hasDefault].
  bool get hasDefault => type.hasDefault;

  /// Convenience forwarding to [TypeDefinition.defaultValue].
  Object? get defaultValue => type.defaultValue;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ParameterDefinition &&
          name == other.name &&
          type == other.type &&
          required == other.required;

  @override
  int get hashCode => Object.hash(name, type, required);
}
