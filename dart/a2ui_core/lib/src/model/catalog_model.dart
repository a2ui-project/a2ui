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
import '../primitives/protocol_version.dart';
import 'type_definition.dart';

const DeepCollectionEquality _deepEquals = DeepCollectionEquality();

/// The Catalog Document format version implemented by this SDK.
const String catalogDocumentFormatVersion = '1.0';

/// The type of value a function returns.
enum A2uiReturnType {
  string,
  number,
  boolean,
  array,
  object,

  /// A structured `ValidationResult` (`{valid, message?, code?, severity?}`).
  ///
  /// Defined by protocol 1.0 catalog definitions. The v0.9 wire schemas do not
  /// accept it, so a catalog whose effective protocol version is below 1.0
  /// must not declare it; a v0.9 renderer's validator rejects messages that
  /// carry it.
  validationResult,
  any,
  void_;

  /// The JSON value used in the A2UI protocol.
  String get jsonValue => this == void_ ? 'void' : name;

  /// Parses from the JSON string representation, falling back to [any] for
  /// unrecognized or extension return types (such as a name a future protocol
  /// version adds).
  static A2uiReturnType fromJson(String value) {
    for (final A2uiReturnType candidate in values) {
      if (candidate.jsonValue == value) return candidate;
    }
    return any;
  }
}

/// Which side of the protocol may invoke a function: the `allowedCallers`
/// of a catalog function definition.
enum AllowedCallers {
  /// Only the renderer, from its own dynamic values and actions. The default.
  rendererOnly('rendererOnly'),

  /// Only the agent, through `callRendererFunction`.
  agentOnly('agentOnly'),

  /// Either side.
  rendererOrAgent('rendererOrAgent');

  const AllowedCallers(this.jsonValue);

  /// The value as it appears in a catalog document.
  final String jsonValue;

  /// Parses a catalog document value.
  ///
  /// Throws [A2uiCatalogError] for a value the protocol does not define.
  static AllowedCallers fromJson(String value) {
    for (final AllowedCallers candidate in values) {
      if (candidate.jsonValue == value) return candidate;
    }
    throw A2uiCatalogError(
      "Unknown allowedCallers value '$value'; expected one of "
      '${values.map((v) => v.jsonValue).join(', ')}.',
    );
  }
}

/// Canonical return-type specification for a [FunctionDefinition].
///
/// Supports either a shorthand protocol return type (including `'integer'`,
/// `'void'`, and `'validationResult'`) or a full structured [TypeDefinition]
/// data schema.
@immutable
class FunctionReturnDefinition {
  /// Coarse protocol return type category (e.g. `string`, `number`, `void_`,
  /// `validationResult`).
  final A2uiReturnType returnType;

  /// Whether this return type was declared with the `'integer'` shorthand.
  final bool isIntegerShorthand;

  /// Optional structured data type describing the returned value.
  final TypeDefinition? type;

  /// Optional human-readable description when declared as an object form.
  final String? description;

  const FunctionReturnDefinition.shorthand(this.returnType, {this.description})
    : isIntegerShorthand = false,
      type = null;

  const FunctionReturnDefinition.integer({this.description})
    : returnType = A2uiReturnType.number,
      isIntegerShorthand = true,
      type = null;

  const FunctionReturnDefinition.void_({this.description})
    : returnType = A2uiReturnType.void_,
      isIntegerShorthand = false,
      type = null;

  const FunctionReturnDefinition.validationResult({this.description})
    : returnType = A2uiReturnType.validationResult,
      isIntegerShorthand = false,
      type = null;

  FunctionReturnDefinition.typed(TypeDefinition schema)
    : type = schema,
      description = schema.description,
      isIntegerShorthand = false,
      returnType = _categoryForType(schema);

  /// The coarse protocol [A2uiReturnType] category for a structured [type].
  static A2uiReturnType _categoryForType(TypeDefinition type) => switch (type) {
    StringType() => A2uiReturnType.string,
    NumberType() || IntegerType() => A2uiReturnType.number,
    BooleanType() => A2uiReturnType.boolean,
    ArrayType() => A2uiReturnType.array,
    ObjectType() => A2uiReturnType.object,
    EnumType(valueType: EnumValueType.string) => A2uiReturnType.string,
    EnumType(valueType: EnumValueType.number) => A2uiReturnType.number,
    EnumType(valueType: EnumValueType.boolean) => A2uiReturnType.boolean,
    ConstType(value: String()) => A2uiReturnType.string,
    ConstType(value: num()) => A2uiReturnType.number,
    ConstType(value: bool()) => A2uiReturnType.boolean,
    _ => A2uiReturnType.any,
  };

  /// The shorthand string name when serialized as a string, or `null` when
  /// serialized as an object.
  String? get shorthandName {
    if (type != null) return null;
    if (description != null) return null;
    if (isIntegerShorthand) return 'integer';
    return returnType.jsonValue;
  }

  /// Normalized structured type used so `shorthand(string, description: 'x')`
  /// compares equal to `typed(StringType(description: 'x'))` after round-trip.
  TypeDefinition? get _normalizedType {
    if (type != null) return type;
    if (description == null) return null;
    if (isIntegerShorthand) return IntegerType(description: description);
    return switch (returnType) {
      A2uiReturnType.string => StringType(description: description),
      A2uiReturnType.number => NumberType(description: description),
      A2uiReturnType.boolean => BooleanType(description: description),
      A2uiReturnType.array => ArrayType(description: description),
      A2uiReturnType.object => ObjectType(description: description),
      A2uiReturnType.any => AnyType(description: description),
      A2uiReturnType.void_ || A2uiReturnType.validationResult => null,
    };
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    if (other is! FunctionReturnDefinition) return false;
    final TypeDefinition? a = _normalizedType;
    final TypeDefinition? b = other._normalizedType;
    if (a != null || b != null) return a == b;
    return other.returnType == returnType &&
        other.isIntegerShorthand == isIntegerShorthand &&
        other.description == description;
  }

  @override
  int get hashCode {
    final TypeDefinition? norm = _normalizedType;
    if (norm != null) return Object.hash(FunctionReturnDefinition, norm);
    return Object.hash(
      FunctionReturnDefinition,
      returnType,
      isIntegerShorthand,
      description,
    );
  }
}

/// Schema for customizable surface-level data properties (maps to v0.9
/// `theme`).
@immutable
class SurfacePropertiesDefinition {
  final String? description;
  final List<ParameterDefinition> properties;
  final bool additionalProperties;
  final TypeDefinition? additionalPropertiesType;

  @internal
  final RawJsonSchemaType? rawSchema;

  const SurfacePropertiesDefinition({
    this.description,
    this.properties = const [],
    this.additionalProperties = false,
    this.additionalPropertiesType,
    this.rawSchema,
  }) : assert(
         !(additionalProperties && additionalPropertiesType != null),
         'Specify either additionalProperties: true or '
         'additionalPropertiesType, not both.',
       );

  bool get allowsAdditionalProperties =>
      additionalProperties || additionalPropertiesType != null;

  /// Whether this definition or any nested property wraps a
  /// [RawJsonSchemaType].
  bool get containsRawJsonSchema =>
      rawSchema != null ||
      properties.any((p) => p.type.containsRawJsonSchema) ||
      (additionalPropertiesType?.containsRawJsonSchema ?? false);

  @override
  bool operator ==(Object other) =>
      other is SurfacePropertiesDefinition &&
      other.description == description &&
      _deepEquals.equals(other.properties, properties) &&
      other.additionalProperties == additionalProperties &&
      other.additionalPropertiesType == additionalPropertiesType &&
      other.rawSchema == rawSchema;

  @override
  int get hashCode => Object.hash(
    SurfacePropertiesDefinition,
    description,
    _deepEquals.hash(properties),
    additionalProperties,
    additionalPropertiesType,
    rawSchema,
  );
}

/// Canonical definition of a UI component's contract, parameters, and
/// composition rules.
@immutable
class ComponentDefinition {
  /// Unique component name (must not be `'Surface'`).
  final String name;

  /// Human- and LLM-readable description of component usage and behavior.
  final String? description;

  /// Whether this component supports validation checks (`@checks` in v1.0,
  /// `checks` in v0.9).
  final bool checkable;

  /// Ordered list of declared component parameters (excluding protocol
  /// envelope keys `id`, `component`, `@catalogId`, `@accessibility`,
  /// `@metadata`, `@checks`).
  final List<ParameterDefinition> parameters;

  /// Cross-parameter requirement groups; at least one parameter from each
  /// group must be supplied.
  final List<List<String>>? atLeastOneOf;

  /// Allowed parent component names (including `'Surface'` for top-level
  /// root), or `null` when any parent is allowed.
  final List<String>? allowedParents;

  /// Allowed child component names, or `null` when any child is allowed.
  final List<String>? allowedChildren;

  /// Optional static component-level metadata (`{extensions: {...}}`).
  final Map<String, Object?>? metadata;

  /// Whether this component is deprecated.
  final bool deprecated;

  /// Optional deprecation explanation and migration hint.
  final String? deprecatedReason;

  /// In-memory-only legacy escape hatch when the entire component schema
  /// carries untranslatable root-level JSON Schema keywords.
  @internal
  final RawJsonSchemaType? rawSchema;

  const ComponentDefinition({
    required this.name,
    this.description,
    this.checkable = false,
    this.parameters = const [],
    this.atLeastOneOf,
    this.allowedParents,
    this.allowedChildren,
    this.metadata,
    this.deprecated = false,
    this.deprecatedReason,
    this.rawSchema,
  });

  /// Looks up a declared parameter by [name], or returns `null`.
  ParameterDefinition? parameter(String name) {
    for (final ParameterDefinition param in parameters) {
      if (param.name == name) return param;
    }
    return null;
  }

  /// Required parameter names in declaration order.
  List<String> get requiredParameters => [
    for (final ParameterDefinition param in parameters)
      if (param.required) param.name,
  ];

  /// Whether this component or any parameter wraps a [RawJsonSchemaType].
  bool get containsRawJsonSchema =>
      rawSchema != null || parameters.any((p) => p.type.containsRawJsonSchema);

  @override
  bool operator ==(Object other) =>
      other is ComponentDefinition &&
      other.name == name &&
      other.description == description &&
      other.checkable == checkable &&
      _deepEquals.equals(other.parameters, parameters) &&
      _deepEquals.equals(other.atLeastOneOf, atLeastOneOf) &&
      _deepEquals.equals(other.allowedParents, allowedParents) &&
      _deepEquals.equals(other.allowedChildren, allowedChildren) &&
      _deepEquals.equals(other.metadata, metadata) &&
      other.deprecated == deprecated &&
      other.deprecatedReason == deprecatedReason &&
      other.rawSchema == rawSchema;

  @override
  int get hashCode => Object.hash(
    ComponentDefinition,
    name,
    description,
    checkable,
    _deepEquals.hash(parameters),
    _deepEquals.hash(atLeastOneOf),
    _deepEquals.hash(allowedParents),
    _deepEquals.hash(allowedChildren),
    _deepEquals.hash(metadata),
    deprecated,
    deprecatedReason,
    rawSchema,
  );
}

/// Canonical definition of a catalog function's signature, return type, and
/// caller permissions.
@immutable
class FunctionDefinition {
  /// Unique function name (must not start with `'@'`).
  final String name;

  /// Human- and LLM-readable description of function behavior.
  final String? description;

  /// Return value specification.
  final FunctionReturnDefinition returnType;

  /// Explicitly declared `allowedCallers`, or `null` when omitted.
  final AllowedCallers? declaredAllowedCallers;

  /// Explicitly declared `requiresUserActivation`, or `null` when omitted.
  final bool? declaredRequiresUserActivation;

  /// Ordered list of data parameters accepted by this function.
  final List<ParameterDefinition> parameters;

  /// Cross-parameter requirement groups; at least one parameter from each
  /// group must be supplied.
  final List<List<String>>? atLeastOneOf;

  /// Whether arbitrary undeclared function arguments are accepted.
  final bool additionalParameters;

  /// Optional schema for undeclared function arguments.
  final TypeDefinition? additionalParametersType;

  /// Whether this function is deprecated.
  final bool deprecated;

  /// Optional deprecation explanation and migration hint.
  final String? deprecatedReason;

  /// In-memory-only legacy escape hatch when the function's argument schema
  /// carries untranslatable JSON Schema keywords.
  @internal
  final RawJsonSchemaType? rawArgumentSchema;

  const FunctionDefinition({
    required this.name,
    this.description,
    this.returnType = const FunctionReturnDefinition.shorthand(
      A2uiReturnType.any,
    ),
    AllowedCallers? allowedCallers,
    bool? requiresUserActivation,
    this.parameters = const [],
    this.atLeastOneOf,
    this.additionalParameters = false,
    this.additionalParametersType,
    this.deprecated = false,
    this.deprecatedReason,
    this.rawArgumentSchema,
  }) : assert(
         !(additionalParameters && additionalParametersType != null),
         'Specify either additionalParameters: true or '
         'additionalParametersType, not both.',
       ),
       declaredAllowedCallers = allowedCallers,
       declaredRequiresUserActivation = requiresUserActivation;

  /// Effective caller permissions (defaults to [AllowedCallers.rendererOnly]).
  AllowedCallers get allowedCallers =>
      declaredAllowedCallers ?? AllowedCallers.rendererOnly;

  /// Effective user-activation requirement (defaults to `false`).
  bool get requiresUserActivation => declaredRequiresUserActivation ?? false;

  /// Whether undeclared arguments are permitted (untyped or typed).
  bool get allowsAdditionalParameters =>
      additionalParameters || additionalParametersType != null;

  /// Looks up a declared parameter by [name], or returns `null`.
  ParameterDefinition? parameter(String name) {
    for (final ParameterDefinition param in parameters) {
      if (param.name == name) return param;
    }
    return null;
  }

  /// Required parameter names in declaration order.
  List<String> get requiredParameters => [
    for (final ParameterDefinition param in parameters)
      if (param.required) param.name,
  ];

  /// Whether this function or any parameter wraps a [RawJsonSchemaType].
  bool get containsRawJsonSchema =>
      rawArgumentSchema != null ||
      parameters.any((p) => p.type.containsRawJsonSchema) ||
      (additionalParametersType?.containsRawJsonSchema ?? false) ||
      (returnType.type?.containsRawJsonSchema ?? false);

  @override
  bool operator ==(Object other) =>
      other is FunctionDefinition &&
      other.name == name &&
      other.description == description &&
      other.returnType == returnType &&
      other.allowedCallers == allowedCallers &&
      other.requiresUserActivation == requiresUserActivation &&
      _deepEquals.equals(other.parameters, parameters) &&
      _deepEquals.equals(other.atLeastOneOf, atLeastOneOf) &&
      other.additionalParameters == additionalParameters &&
      other.additionalParametersType == additionalParametersType &&
      other.deprecated == deprecated &&
      other.deprecatedReason == deprecatedReason &&
      other.rawArgumentSchema == rawArgumentSchema;

  @override
  int get hashCode => Object.hash(
    FunctionDefinition,
    name,
    description,
    returnType,
    allowedCallers,
    requiresUserActivation,
    _deepEquals.hash(parameters),
    _deepEquals.hash(atLeastOneOf),
    additionalParameters,
    additionalParametersType,
    deprecated,
    deprecatedReason,
    rawArgumentSchema,
  );
}

/// Canonical, JSON-Schema-free in-memory model of an A2UI catalog.
///
/// Mirrors the A2UI Catalog Document format (`formatVersion: "1.0"`) 1:1.
@immutable
class CatalogModel {
  /// Catalog Document format version (`'1.0'`).
  final String formatVersion;

  /// Optional `$schema` URI for editor validation of serialized documents.
  final String? schemaUri;

  /// Unique opaque catalog identifier (`catalogId`).
  final String catalogId;

  /// Target A2UI protocol version, or `null` for unversioned pre-1.0 catalogs.
  final A2uiProtocolVersion? protocolVersion;

  /// The exact `protocolVersion` string declared in the document, if any.
  final String? declaredProtocolVersion;

  /// Optional human-readable title.
  final String? title;

  /// Optional human-readable description.
  final String? description;

  /// Optional Markdown design guidelines for LLM prompts.
  final String? instructions;

  /// Optional catalog-level metadata (`{extensions: {...}}`).
  final Map<String, Object?>? metadata;

  /// Catalog-local reusable leaf data types, keyed by UAX #31 identifier.
  final Map<String, TypeDefinition> types;

  /// Optional surface-level data properties schema (maps to v0.9 `theme`).
  final SurfacePropertiesDefinition? surfaceProperties;

  /// Ordered list of UI component definitions.
  final List<ComponentDefinition> components;

  /// Ordered list of function definitions.
  final List<FunctionDefinition> functions;

  const CatalogModel({
    this.formatVersion = catalogDocumentFormatVersion,
    this.schemaUri,
    required this.catalogId,
    this.protocolVersion = A2uiProtocolVersion.v1_0,
    this.declaredProtocolVersion,
    this.title,
    this.description,
    this.instructions,
    this.metadata,
    this.types = const {},
    this.surfaceProperties,
    this.components = const [],
    this.functions = const [],
  });

  /// Looks up a component definition by [name], or returns `null`.
  ComponentDefinition? component(String name) {
    for (final ComponentDefinition comp in components) {
      if (comp.name == name) return comp;
    }
    return null;
  }

  /// Looks up a function definition by [name], or returns `null`.
  FunctionDefinition? function(String name) {
    for (final FunctionDefinition fn in functions) {
      if (fn.name == name) return fn;
    }
    return null;
  }

  /// Resolves a [RefType] chain against [types], returning the underlying
  /// [TypeDefinition] or `null` if unresolved or cyclic.
  ///
  /// Non-[RefType] inputs are returned as-is.
  TypeDefinition? resolveType(TypeDefinition type) {
    var current = type;
    final visited = <String>{};
    while (current is RefType) {
      if (!visited.add(current.ref)) return null;
      final TypeDefinition? target = types[current.ref];
      if (target == null) return null;
      current = target;
    }
    return current;
  }

  /// Whether any type, surface property, component, or function in this model
  /// wraps a [RawJsonSchemaType].
  bool get containsRawJsonSchema =>
      types.values.any((t) => t.containsRawJsonSchema) ||
      (surfaceProperties?.containsRawJsonSchema ?? false) ||
      components.any((c) => c.containsRawJsonSchema) ||
      functions.any((f) => f.containsRawJsonSchema);

  @override
  bool operator ==(Object other) =>
      other is CatalogModel &&
      other.formatVersion == formatVersion &&
      other.schemaUri == schemaUri &&
      other.catalogId == catalogId &&
      other.protocolVersion == protocolVersion &&
      other.title == title &&
      other.description == description &&
      other.instructions == instructions &&
      _deepEquals.equals(other.metadata, metadata) &&
      _deepEquals.equals(other.types, types) &&
      other.surfaceProperties == surfaceProperties &&
      _deepEquals.equals(other.components, components) &&
      _deepEquals.equals(other.functions, functions);

  @override
  int get hashCode => Object.hash(
    CatalogModel,
    formatVersion,
    schemaUri,
    catalogId,
    protocolVersion,
    title,
    description,
    instructions,
    _deepEquals.hash(metadata),
    _deepEquals.hash(types),
    surfaceProperties,
    _deepEquals.hash(components),
    _deepEquals.hash(functions),
  );
}
