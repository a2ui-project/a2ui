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

import 'package:collection/collection.dart';
import 'package:meta/meta.dart';

import '../primitives/errors.dart';

const DeepCollectionEquality _deepEquals = DeepCollectionEquality();
const Object _noDefault = Object();

/// The underlying primitive type of an [EnumType]'s values.
enum EnumValueType {
  string('string'),
  number('number'),
  boolean('boolean');

  const EnumValueType(this.jsonValue);

  /// The value as written in a Catalog Document.
  final String jsonValue;

  /// Parses an [EnumValueType] from its Catalog Document string value.
  static EnumValueType fromJson(String value) {
    for (final EnumValueType candidate in values) {
      if (candidate.jsonValue == value) return candidate;
    }
    throw A2uiCatalogError(
      "Unknown enum valueType '$value'; expected one of "
      '${values.map((v) => v.jsonValue).join(', ')}.',
    );
  }
}

/// Canonical, JSON-Schema-free type AST for A2UI catalog parameters, reusable
/// leaf types, and function return types.
///
/// The public hierarchy is closed over 18 variants matching the A2UI Catalog
/// Document format (`formatVersion: "1.0"`): 13 data types and 5
/// component-only UI types ([ChildType], [ChildListType], [ActionType],
/// [CheckRuleType], [AccessibilityType]).
@immutable
sealed class TypeDefinition {
  /// Human- and LLM-readable description of this value or parameter.
  final String? description;

  /// Whether this type or parameter is deprecated.
  final bool deprecated;

  /// Optional explanation and migration hint when [deprecated] is `true`.
  final String? deprecatedReason;

  const TypeDefinition({
    this.description,
    this.deprecated = false,
    this.deprecatedReason,
  });

  /// Whether values of this type may be a data binding or function call.
  bool get isDynamic => false;

  /// Whether this type variant itself is restricted to component parameters.
  bool get isComponentOnly => false;

  /// Whether this type or any nested child type is restricted to components.
  bool get containsComponentOnlyType => isComponentOnly;

  /// Whether this type carries an explicit default value (including `null`).
  bool get hasDefault => false;

  /// The default value when [hasDefault] is `true`, or `null` otherwise.
  Object? get defaultValue => null;

  /// Whether this type or any nested child holds an untranslatable legacy
  /// JSON Schema fallback.
  @internal
  bool get containsRawJsonSchema => false;
}

/// A string value, optionally dynamic and/or constrained by format, pattern, or
/// length.
final class StringType extends TypeDefinition {
  /// Whether literal strings, data bindings, and function calls are accepted.
  final bool dynamic;

  final String? _format;
  final List<String>? _formats;

  /// Regular expression pattern literal values must match.
  final String? pattern;

  /// Minimum character length for literal string values.
  final int? minLength;

  /// Maximum character length for literal string values.
  final int? maxLength;

  @override
  final String? defaultValue;

  const StringType({
    this.dynamic = false,
    String? format,
    List<String>? formats,
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
       ),
       _format = format,
       _formats = formats;

  /// Single string format constraint when exactly one format is declared.
  String? get format =>
      _format ??
      (_formats != null && _formats.length == 1 ? _formats[0] : null);

  /// All allowed string formats (one or more), or `null` when unconstrained.
  List<String>? get formats =>
      _formats ?? (_format != null ? <String>[_format] : null);

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => defaultValue != null;

  @override
  bool operator ==(Object other) =>
      other is StringType &&
      other.dynamic == dynamic &&
      _deepEquals.equals(other.formats, formats) &&
      other.pattern == pattern &&
      other.minLength == minLength &&
      other.maxLength == maxLength &&
      other.defaultValue == defaultValue &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    StringType,
    dynamic,
    _deepEquals.hash(formats),
    pattern,
    minLength,
    maxLength,
    defaultValue,
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// A numeric (floating-point or integer) value, optionally dynamic and/or
/// bounded by [min] and [max].
final class NumberType extends TypeDefinition {
  final bool dynamic;
  final num? min;
  final num? max;

  @override
  final num? defaultValue;

  const NumberType({
    this.dynamic = false,
    this.min,
    this.max,
    this.defaultValue,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => defaultValue != null;

  @override
  bool operator ==(Object other) =>
      other is NumberType &&
      other.dynamic == dynamic &&
      other.min == min &&
      other.max == max &&
      other.defaultValue == defaultValue &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    NumberType,
    dynamic,
    min,
    max,
    defaultValue,
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// An integer value, optionally dynamic and/or bounded by [min] and [max].
final class IntegerType extends TypeDefinition {
  final bool dynamic;
  final int? min;
  final int? max;

  @override
  final int? defaultValue;

  const IntegerType({
    this.dynamic = false,
    this.min,
    this.max,
    this.defaultValue,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => defaultValue != null;

  @override
  bool operator ==(Object other) =>
      other is IntegerType &&
      other.dynamic == dynamic &&
      other.min == min &&
      other.max == max &&
      other.defaultValue == defaultValue &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    IntegerType,
    dynamic,
    min,
    max,
    defaultValue,
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// A boolean value, optionally dynamic.
///
/// In protocol v1.0+, a dynamic boolean also accepts function calls returning
/// `ValidationResult` and coerces `{valid: bool}` objects to their boolean
/// validity.
final class BooleanType extends TypeDefinition {
  final bool dynamic;

  @override
  final bool? defaultValue;

  const BooleanType({
    this.dynamic = false,
    this.defaultValue,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => defaultValue != null;

  @override
  bool operator ==(Object other) =>
      other is BooleanType &&
      other.dynamic == dynamic &&
      other.defaultValue == defaultValue &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    BooleanType,
    dynamic,
    defaultValue,
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// An enumerated set of allowed literal values (`String`, `num`, or `bool`).
final class EnumType extends TypeDefinition {
  /// Ordered list of allowed literal values.
  final List<Object> values;

  /// The explicitly declared [EnumValueType], or `null` to infer from [values].
  final EnumValueType? declaredValueType;

  final bool dynamic;

  @override
  final Object? defaultValue;

  const EnumType({
    required this.values,
    EnumValueType? valueType,
    this.dynamic = false,
    this.defaultValue,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  }) : declaredValueType = valueType;

  /// Effective primitive type of [values] (defaults to [EnumValueType.string]).
  EnumValueType get valueType {
    if (declaredValueType != null) return declaredValueType!;
    if (values.isNotEmpty) {
      final Object first = values.first;
      if (first is num) return EnumValueType.number;
      if (first is bool) return EnumValueType.boolean;
    }
    return EnumValueType.string;
  }

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => defaultValue != null;

  @override
  bool operator ==(Object other) =>
      other is EnumType &&
      _deepEquals.equals(other.values, values) &&
      other.valueType == valueType &&
      other.dynamic == dynamic &&
      other.defaultValue == defaultValue &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    EnumType,
    _deepEquals.hash(values),
    valueType,
    dynamic,
    defaultValue,
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// An exact required literal value (`String`, `num`, `bool`, or `null`).
final class ConstType extends TypeDefinition {
  final Object? value;

  const ConstType({
    required this.value,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool operator ==(Object other) =>
      other is ConstType &&
      other.value == value &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    ConstType,
    value,
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// An unconstrained JSON value.
///
/// - `dynamic: true, nullable: false` corresponds to v1.0 `DynamicValue`.
/// - `dynamic: true, nullable: true` corresponds to an unconstrained `{}`
///   schema (such as `required.args.value`).
final class AnyType extends TypeDefinition {
  final bool dynamic;
  final bool nullable;
  final Object? _defaultValue;

  const AnyType({
    this.dynamic = false,
    this.nullable = false,
    this._defaultValue = _noDefault,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => !identical(_defaultValue, _noDefault);

  @override
  Object? get defaultValue => hasDefault ? _defaultValue : null;

  @override
  bool operator ==(Object other) =>
      other is AnyType &&
      other.dynamic == dynamic &&
      other.nullable == nullable &&
      other.hasDefault == hasDefault &&
      _deepEquals.equals(other.defaultValue, defaultValue) &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    AnyType,
    dynamic,
    nullable,
    hasDefault,
    _deepEquals.hash(defaultValue),
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// A structured JSON object or typed dictionary.
///
/// By default, undeclared keys are rejected ([additionalProperties] is `false`
/// and [additionalPropertiesType] is `null`).
final class ObjectType extends TypeDefinition {
  final bool dynamic;

  /// Ordered declared properties of this object.
  final List<ParameterDefinition> properties;

  /// Whether arbitrary undeclared properties are permitted.
  final bool additionalProperties;

  /// Optional schema for undeclared properties (implies additional properties
  /// are permitted when non-null).
  final TypeDefinition? additionalPropertiesType;

  /// Cross-property requirement groups; at least one property from each group
  /// must be provided.
  final List<List<String>>? atLeastOneOf;

  @override
  final Map<String, Object?>? defaultValue;

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
  }) : assert(
         !(additionalProperties && additionalPropertiesType != null),
         'Specify either additionalProperties: true or '
         'additionalPropertiesType, not both.',
       );

  /// Whether undeclared properties are allowed (either untyped or typed).
  bool get allowsAdditionalProperties =>
      additionalProperties || additionalPropertiesType != null;

  /// Looks up a declared property by [name], or returns `null`.
  ParameterDefinition? property(String name) {
    for (final ParameterDefinition prop in properties) {
      if (prop.name == name) return prop;
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
  @internal
  bool get containsRawJsonSchema =>
      properties.any((p) => p.type.containsRawJsonSchema) ||
      (additionalPropertiesType?.containsRawJsonSchema ?? false);

  @override
  bool operator ==(Object other) =>
      other is ObjectType &&
      other.dynamic == dynamic &&
      _deepEquals.equals(other.properties, properties) &&
      other.additionalProperties == additionalProperties &&
      other.additionalPropertiesType == additionalPropertiesType &&
      _deepEquals.equals(other.atLeastOneOf, atLeastOneOf) &&
      _deepEquals.equals(other.defaultValue, defaultValue) &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    ObjectType,
    dynamic,
    _deepEquals.hash(properties),
    additionalProperties,
    additionalPropertiesType,
    _deepEquals.hash(atLeastOneOf),
    _deepEquals.hash(defaultValue),
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// A JSON array, optionally dynamic and/or constrained by [items], length
/// bounds, or uniqueness.
///
/// `ArrayType(items: StringType(), dynamic: true)` corresponds to v1.0
/// `DynamicStringList`.
final class ArrayType extends TypeDefinition {
  final bool dynamic;
  final TypeDefinition? items;
  final int? minItems;
  final int? maxItems;
  final bool uniqueItems;

  @override
  final List<Object?>? defaultValue;

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

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => defaultValue != null;

  @override
  bool get containsComponentOnlyType =>
      items?.containsComponentOnlyType ?? false;

  @override
  @internal
  bool get containsRawJsonSchema => items?.containsRawJsonSchema ?? false;

  @override
  bool operator ==(Object other) =>
      other is ArrayType &&
      other.dynamic == dynamic &&
      other.items == items &&
      other.minItems == minItems &&
      other.maxItems == maxItems &&
      other.uniqueItems == uniqueItems &&
      _deepEquals.equals(other.defaultValue, defaultValue) &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    ArrayType,
    dynamic,
    items,
    minItems,
    maxItems,
    uniqueItems,
    _deepEquals.hash(defaultValue),
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// A union of two or more [variants].
///
/// When [exclusive] is `true` (the default), exactly one variant must match
/// (JSON Schema `oneOf`); when `false`, at least one variant must match
/// (`anyOf`).
final class UnionType extends TypeDefinition {
  final List<TypeDefinition> variants;
  final bool exclusive;
  final bool dynamic;
  final Object? _defaultValue;

  const UnionType({
    required this.variants,
    this.exclusive = true,
    this.dynamic = false,
    this._defaultValue = _noDefault,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get isDynamic => dynamic;

  @override
  bool get hasDefault => !identical(_defaultValue, _noDefault);

  @override
  Object? get defaultValue => hasDefault ? _defaultValue : null;

  @override
  bool get containsComponentOnlyType =>
      variants.any((v) => v.containsComponentOnlyType);

  @override
  @internal
  bool get containsRawJsonSchema =>
      variants.any((v) => v.containsRawJsonSchema);

  @override
  bool operator ==(Object other) =>
      other is UnionType &&
      _deepEquals.equals(other.variants, variants) &&
      other.exclusive == exclusive &&
      other.dynamic == dynamic &&
      other.hasDefault == hasDefault &&
      _deepEquals.equals(other.defaultValue, defaultValue) &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    UnionType,
    _deepEquals.hash(variants),
    exclusive,
    dynamic,
    hasDefault,
    _deepEquals.hash(defaultValue),
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// A reactive data model binding (`{@path: "..."}` in v1.0, `{path: "..."}` in
/// v0.9).
final class DataBindingType extends TypeDefinition {
  const DataBindingType({
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get isDynamic => true;

  @override
  bool operator ==(Object other) =>
      other is DataBindingType &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    DataBindingType,
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// A reactive function call expression (`{@call: "...", args: {...}}` in v1.0,
/// `{call: "...", args: {...}}` in v0.9).
final class FunctionCallType extends TypeDefinition {
  const FunctionCallType({
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get isDynamic => true;

  @override
  bool operator ==(Object other) =>
      other is FunctionCallType &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    FunctionCallType,
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// A reference to a catalog-local reusable data type declared in
/// `CatalogModel.types`.
final class RefType extends TypeDefinition {
  final String ref;
  final Object? _defaultValue;

  const RefType({
    required this.ref,
    this._defaultValue = _noDefault,
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get hasDefault => !identical(_defaultValue, _noDefault);

  @override
  Object? get defaultValue => hasDefault ? _defaultValue : null;

  @override
  bool operator ==(Object other) =>
      other is RefType &&
      other.ref == ref &&
      other.hasDefault == hasDefault &&
      _deepEquals.equals(other.defaultValue, defaultValue) &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    RefType,
    ref,
    hasDefault,
    _deepEquals.hash(defaultValue),
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// A single child component ID reference (`Child` in v1.0, `ComponentId` in
/// v0.9). Restricted to component parameters.
final class ChildType extends TypeDefinition {
  const ChildType({
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get isComponentOnly => true;

  @override
  bool operator ==(Object other) =>
      other is ChildType &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode =>
      Object.hash(ChildType, description, this.deprecated, deprecatedReason);
}

/// A static child ID array or dynamic data-bound child template (`ChildList`).
/// Restricted to component parameters.
final class ChildListType extends TypeDefinition {
  const ChildListType({
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get isComponentOnly => true;

  @override
  bool operator ==(Object other) =>
      other is ChildListType &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    ChildListType,
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// An interaction handler triggering an agent event or function call
/// (`Action`). Restricted to component parameters.
final class ActionType extends TypeDefinition {
  const ActionType({
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get isComponentOnly => true;

  @override
  bool operator ==(Object other) =>
      other is ActionType &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode =>
      Object.hash(ActionType, description, this.deprecated, deprecatedReason);
}

/// A single validation check rule (`CheckRule`). Restricted to component
/// parameters.
final class CheckRuleType extends TypeDefinition {
  const CheckRuleType({
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get isComponentOnly => true;

  @override
  bool operator ==(Object other) =>
      other is CheckRuleType &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    CheckRuleType,
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// Accessibility attributes (`AccessibilityAttributes`). Restricted to
/// component parameters.
final class AccessibilityType extends TypeDefinition {
  const AccessibilityType({
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get isComponentOnly => true;

  @override
  bool operator ==(Object other) =>
      other is AccessibilityType &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    AccessibilityType,
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// In-memory-only legacy escape hatch preserving an untranslatable JSON Schema
/// fragment (for example `patternProperties` or arbitrary `not`).
///
/// Never emitted in Catalog Documents.
@internal
final class RawJsonSchemaType extends TypeDefinition {
  final Map<String, Object?> schema;

  const RawJsonSchemaType(
    this.schema, {
    super.description,
    super.deprecated,
    super.deprecatedReason,
  });

  @override
  bool get hasDefault => schema.containsKey('default');

  @override
  Object? get defaultValue => schema['default'];

  @override
  @internal
  bool get containsRawJsonSchema => true;

  @override
  bool operator ==(Object other) =>
      other is RawJsonSchemaType &&
      _deepEquals.equals(other.schema, schema) &&
      other.description == description &&
      other.deprecated == this.deprecated &&
      other.deprecatedReason == deprecatedReason;

  @override
  int get hashCode => Object.hash(
    RawJsonSchemaType,
    _deepEquals.hash(schema),
    description,
    this.deprecated,
    deprecatedReason,
  );
}

/// A named parameter of a component, function, object, or surface properties
/// definition.
@immutable
class ParameterDefinition {
  /// Unique identifier within the enclosing component, function, or object.
  final String name;

  /// The parameter's canonical type and constraints.
  final TypeDefinition type;

  /// Whether wire payloads must supply this parameter.
  final bool required;

  const ParameterDefinition({
    required this.name,
    required this.type,
    this.required = false,
  });

  /// Declares a [StringType] parameter.
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

  /// Declares a [NumberType] parameter.
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

  /// Declares an [IntegerType] parameter.
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

  /// Declares a [BooleanType] parameter.
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

  /// Declares an [EnumType] parameter.
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

  /// Declares a [ConstType] parameter.
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

  /// Declares an [AnyType] parameter.
  ParameterDefinition.any(
    this.name, {
    this.required = false,
    bool dynamic = false,
    bool nullable = false,
    Object? defaultValue = _noDefault,
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

  /// Declares an [ObjectType] parameter.
  ParameterDefinition.object(
    this.name, {
    List<ParameterDefinition> properties = const [],
    this.required = false,
    bool dynamic = false,
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

  /// Declares an [ArrayType] parameter.
  ParameterDefinition.array(
    this.name, {
    TypeDefinition? items,
    this.required = false,
    bool dynamic = false,
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

  /// Declares a [UnionType] parameter.
  ParameterDefinition.union(
    this.name, {
    required List<TypeDefinition> variants,
    bool exclusive = true,
    this.required = false,
    bool dynamic = false,
    Object? defaultValue = _noDefault,
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

  /// Declares a [DataBindingType] parameter.
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

  /// Declares a [FunctionCallType] parameter.
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

  /// Declares a [RefType] parameter referencing a catalog-local type.
  ParameterDefinition.ref(
    this.name, {
    required String ref,
    this.required = false,
    Object? defaultValue = _noDefault,
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

  /// Declares a [ChildType] component parameter.
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

  /// Declares a [ChildListType] component parameter.
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

  /// Declares an [ActionType] component parameter.
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

  /// Declares a [CheckRuleType] component parameter.
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

  /// Declares an [AccessibilityType] component parameter.
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

  String? get description => type.description;
  bool get isDynamic => type.isDynamic;
  bool get hasDefault => type.hasDefault;
  Object? get defaultValue => type.defaultValue;
  bool get deprecated => type.deprecated;
  String? get deprecatedReason => type.deprecatedReason;

  @override
  bool operator ==(Object other) =>
      other is ParameterDefinition &&
      other.name == name &&
      other.type == type &&
      other.required == required;

  @override
  int get hashCode => Object.hash(ParameterDefinition, name, type, required);
}
