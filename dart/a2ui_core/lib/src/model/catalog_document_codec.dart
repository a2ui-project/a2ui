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

import '../primitives/errors.dart';
import '../primitives/protocol_version.dart';
import '../primitives/uax31.dart';
import 'catalog_model.dart';
import 'type_definition.dart';

/// Returns `true` when [json] carries a string `formatVersion` discriminator,
/// identifying it as an A2UI Catalog Document rather than a legacy JSON Schema
/// catalog file.
bool isCatalogDocument(Map<String, Object?> json) =>
    json['formatVersion'] is String;

/// Parses a serialized A2UI Catalog Document (`formatVersion: "1.0"`) into a
/// canonical [CatalogModel].
///
/// Throws [A2uiCatalogError] on unsupported `formatVersion`, malformed
/// structure, unknown keys, invalid UAX #31 identifiers, reserved names
/// (`'Surface'` or `'@*'`), duplicate names, unresolved local type `ref`s,
/// component-only types in data-only contexts, or invalid caller permissions.
CatalogModel parseCatalogDocument(
  Map<String, Object?> json, {
  String? expectedCatalogId,
  A2uiProtocolVersion? protocolVersion,
  String? catalogId,
}) => CatalogDocumentCodec.parseCatalogDocument(
  json,
  expectedCatalogId: expectedCatalogId,
  protocolVersion: protocolVersion,
  catalogId: catalogId,
);

/// Serializes a canonical [CatalogModel] into an A2UI Catalog Document JSON
/// map (`formatVersion: "1.0"`).
///
/// Throws [A2uiCatalogError] if [model] contains an untranslatable legacy
/// raw JSON Schema fragment.
Map<String, Object?> serializeCatalogDocument(CatalogModel model) =>
    CatalogDocumentCodec.serializeCatalogDocument(model);

/// Codec for parsing and serializing the A2UI Catalog Document format
/// (`formatVersion: "1.0"`).
abstract final class CatalogDocumentCodec {
  static const Set<String> _rootKeys = {
    r'$schema',
    'formatVersion',
    'catalogId',
    'protocolVersion',
    'title',
    'description',
    'instructions',
    'metadata',
    'types',
    'surfaceProperties',
    'components',
    'functions',
  };

  static const Set<String> _componentKeys = {
    'name',
    'description',
    'checkable',
    'parameters',
    'atLeastOneOf',
    'allowedParents',
    'allowedChildren',
    'metadata',
    'deprecated',
    'deprecatedReason',
  };

  static const Set<String> _functionKeys = {
    'name',
    'description',
    'returnType',
    'allowedCallers',
    'requiresUserActivation',
    'parameters',
    'atLeastOneOf',
    'additionalParameters',
    'deprecated',
    'deprecatedReason',
  };

  static const Set<String> _surfacePropertyKeys = {
    'description',
    'properties',
    'additionalProperties',
  };

  static const Set<String> _baseTypeKeys = {
    'type',
    'description',
    'deprecated',
    'deprecatedReason',
  };

  static const Set<String> _parameterIdentityKeys = {'name', 'required'};

  static const Set<String> _shorthandReturnTypes = {
    'string',
    'number',
    'integer',
    'boolean',
    'array',
    'object',
    'validationResult',
    'any',
    'void',
  };

  /// Returns `true` when [json] is a Catalog Document (has a string
  /// `formatVersion` field).
  static bool isCatalogDocument(Map<String, Object?> json) =>
      json['formatVersion'] is String;

  /// Parses [json] into a [CatalogModel].
  static CatalogModel parseCatalogDocument(
    Map<String, Object?> json, {
    String? expectedCatalogId,
    A2uiProtocolVersion? protocolVersion,
    String? catalogId,
  }) {
    final Object? rawFormat = json['formatVersion'];
    if (rawFormat is! String) {
      throw A2uiCatalogError(
        "Catalog document must declare string 'formatVersion': "
        "'$catalogDocumentFormatVersion'.",
      );
    }
    if (rawFormat != catalogDocumentFormatVersion) {
      throw A2uiCatalogError(
        "Unsupported catalog document formatVersion '$rawFormat'; "
        "expected '$catalogDocumentFormatVersion'.",
      );
    }

    final Object? rawId = catalogId ?? json['catalogId'];
    if (rawId is! String || rawId.isEmpty) {
      throw A2uiCatalogError(
        "Catalog document must declare a non-empty string 'catalogId'.",
      );
    }
    if (expectedCatalogId != null && expectedCatalogId != rawId) {
      throw A2uiCatalogError(
        "Catalog id mismatch: expected '$expectedCatalogId' but the document "
        "declares '$rawId'.",
        catalogId: rawId,
      );
    }

    _rejectUnknownKeys(json, _rootKeys, 'Catalog document', rawId);

    final String? schemaUri = _optionalString(json, r'$schema', 'root', rawId);
    final String? title = _optionalString(json, 'title', 'root', rawId);
    final String? description = _optionalString(
      json,
      'description',
      'root',
      rawId,
    );
    final String? instructions = _optionalString(
      json,
      'instructions',
      'root',
      rawId,
    );

    final Object? rawVersion = json['protocolVersion'];
    final String? declaredVersion;
    final A2uiProtocolVersion effectiveVersion;
    if (rawVersion == null) {
      declaredVersion = null;
      effectiveVersion = protocolVersion ?? A2uiProtocolVersion.v1_0;
    } else {
      if (rawVersion is! String) {
        throw A2uiCatalogError(
          "Catalog 'protocolVersion' must be a string.",
          catalogId: rawId,
        );
      }
      final A2uiProtocolVersion? parsed = A2uiProtocolVersion.tryParseSemVer(
        rawVersion,
      );
      if (parsed == null) {
        throw A2uiCatalogError(
          "Unsupported catalog 'protocolVersion' '$rawVersion'; supported "
          'versions are ${A2uiProtocolVersion.supportedVersions}.',
          catalogId: rawId,
        );
      }
      declaredVersion = rawVersion;
      effectiveVersion = parsed;
    }

    final Map<String, Object?>? metadata = _parseMetadata(
      json['metadata'],
      'root.metadata',
      rawId,
    );

    final types = <String, TypeDefinition>{};
    final Object? rawTypes = json['types'];
    if (rawTypes != null) {
      final Map<String, Object?> typesMap = _expectMap(
        rawTypes,
        'types',
        rawId,
      );
      for (final MapEntry<String, Object?> entry in typesMap.entries) {
        _assertIdentifier(entry.key, "type name '${entry.key}'", rawId);
        final Map<String, Object?> typeObj = _expectMap(
          entry.value,
          'types.${entry.key}',
          rawId,
        );
        types[entry.key] = _parseType(
          typeObj,
          allowComponentTypes: false,
          allowParameterIdentity: false,
          context: 'types.${entry.key}',
          catalogId: rawId,
        );
      }
    }

    final SurfacePropertiesDefinition? surfaceProperties =
        json['surfaceProperties'] == null
        ? null
        : _parseSurfaceProperties(
            _expectMap(json['surfaceProperties'], 'surfaceProperties', rawId),
            rawId,
          );

    final components = <ComponentDefinition>[];
    final componentNames = <String>{};
    final Object? rawComponents = json['components'];
    if (rawComponents != null) {
      final List<Object?> list = _expectList(
        rawComponents,
        'components',
        rawId,
      );
      for (var i = 0; i < list.length; i++) {
        final Map<String, Object?> compObj = _expectMap(
          list[i],
          'components[$i]',
          rawId,
        );
        final ComponentDefinition comp = _parseComponent(
          compObj,
          'components[$i]',
          rawId,
        );
        if (!componentNames.add(comp.name)) {
          throw A2uiCatalogError(
            "Catalog '$rawId' declares more than one component named "
            "'${comp.name}'.",
            catalogId: rawId,
          );
        }
        components.add(comp);
      }
    }

    final functions = <FunctionDefinition>[];
    final functionNames = <String>{};
    final Object? rawFunctions = json['functions'];
    if (rawFunctions != null) {
      final List<Object?> list = _expectList(rawFunctions, 'functions', rawId);
      for (var i = 0; i < list.length; i++) {
        final Map<String, Object?> fnObj = _expectMap(
          list[i],
          'functions[$i]',
          rawId,
        );
        final FunctionDefinition fn = _parseFunction(
          fnObj,
          'functions[$i]',
          rawId,
          effectiveVersion,
        );
        if (!functionNames.add(fn.name)) {
          throw A2uiCatalogError(
            "Catalog '$rawId' declares more than one function named "
            "'${fn.name}'.",
            catalogId: rawId,
          );
        }
        functions.add(fn);
      }
    }

    final model = CatalogModel(
      formatVersion: rawFormat,
      schemaUri: schemaUri,
      catalogId: rawId,
      protocolVersion: effectiveVersion,
      declaredProtocolVersion: declaredVersion,
      title: title,
      description: description,
      instructions: instructions,
      metadata: metadata,
      types: Map.unmodifiable(types),
      surfaceProperties: surfaceProperties,
      components: List.unmodifiable(components),
      functions: List.unmodifiable(functions),
    );

    _validateRefs(model);
    return model;
  }

  /// Serializes [model] into a Catalog Document JSON map.
  static Map<String, Object?> serializeCatalogDocument(CatalogModel model) {
    final doc = <String, Object?>{
      if (model.schemaUri != null) r'$schema': model.schemaUri,
      'formatVersion': model.formatVersion,
      'catalogId': model.catalogId,
      if (model.declaredProtocolVersion != null)
        'protocolVersion': model.declaredProtocolVersion
      else if (model.protocolVersion != null)
        'protocolVersion': model.protocolVersion!.semverValue,
      if (model.title != null) 'title': model.title,
      if (model.description != null) 'description': model.description,
      if (model.instructions != null) 'instructions': model.instructions,
      if (model.metadata != null) 'metadata': _deepCopy(model.metadata),
      if (model.types.isNotEmpty)
        'types': <String, Object?>{
          for (final MapEntry<String, TypeDefinition> entry
              in model.types.entries)
            entry.key: _serializeType(
              entry.value,
              catalogId: model.catalogId,
              context: 'types.${entry.key}',
            ),
        },
      if (model.surfaceProperties != null)
        'surfaceProperties': _serializeSurfaceProperties(
          model.surfaceProperties!,
          model.catalogId,
        ),
      if (model.components.isNotEmpty)
        'components': [
          for (final ComponentDefinition comp in model.components)
            _serializeComponent(comp, model.catalogId),
        ],
      if (model.functions.isNotEmpty)
        'functions': [
          for (final FunctionDefinition fn in model.functions)
            _serializeFunction(fn, model.catalogId),
        ],
    };
    return doc;
  }

  // ---------------------------------------------------------------------------
  // Parsing helpers
  // ---------------------------------------------------------------------------

  static Map<String, Object?>? _parseMetadata(
    Object? raw,
    String context,
    String catalogId,
  ) {
    if (raw == null) return null;
    final Map<String, Object?> map = _expectMap(raw, context, catalogId);
    _rejectUnknownKeys(map, const {'extensions'}, context, catalogId);
    final Object? rawExt = map['extensions'];
    if (rawExt == null) return const <String, Object?>{};
    final Map<String, Object?> extMap = _expectMap(
      rawExt,
      '$context.extensions',
      catalogId,
    );
    for (final String key in extMap.keys) {
      _assertIdentifier(key, "extension key '$key' in $context", catalogId);
    }
    return Map<String, Object?>.unmodifiable(<String, Object?>{
      'extensions': _deepCopy(extMap),
    });
  }

  static SurfacePropertiesDefinition _parseSurfaceProperties(
    Map<String, Object?> map,
    String catalogId,
  ) {
    _rejectUnknownKeys(
      map,
      _surfacePropertyKeys,
      'surfaceProperties',
      catalogId,
    );
    final String? description = _optionalString(
      map,
      'description',
      'surfaceProperties',
      catalogId,
    );
    final List<ParameterDefinition> properties = _parseParameters(
      map['properties'],
      allowComponentTypes: false,
      context: 'surfaceProperties.properties',
      catalogId: catalogId,
    );
    final (:bool flag, :TypeDefinition? type) = _parseAdditionalSchema(
      map['additionalProperties'],
      allowComponentTypes: false,
      context: 'surfaceProperties.additionalProperties',
      catalogId: catalogId,
    );
    return SurfacePropertiesDefinition(
      description: description,
      properties: List.unmodifiable(properties),
      additionalProperties: flag,
      additionalPropertiesType: type,
    );
  }

  static ComponentDefinition _parseComponent(
    Map<String, Object?> map,
    String context,
    String catalogId,
  ) {
    _rejectUnknownKeys(map, _componentKeys, context, catalogId);
    final String name = _requiredString(map, 'name', context, catalogId);
    if (name == 'Surface') {
      throw A2uiCatalogError(
        "Catalog '$catalogId' declares a component named 'Surface', which is "
        'reserved.',
        catalogId: catalogId,
      );
    }
    _assertIdentifier(name, "component identifier '$name'", catalogId);

    final String? description = _optionalString(
      map,
      'description',
      "component '$name'",
      catalogId,
    );
    final bool checkable =
        _optionalBool(map, 'checkable', "component '$name'", catalogId) ??
        false;
    final List<ParameterDefinition> parameters = _parseParameters(
      map['parameters'],
      allowComponentTypes: true,
      context: "component '$name'.parameters",
      catalogId: catalogId,
    );
    final Set<String> paramNames = {
      for (final ParameterDefinition p in parameters) p.name,
    };
    final List<List<String>>? atLeastOneOf = _parseAtLeastOneOf(
      map['atLeastOneOf'],
      paramNames,
      "component '$name'.atLeastOneOf",
      catalogId,
    );
    final List<String>? allowedParents = _parseIdentifierList(
      map['allowedParents'],
      "component '$name'.allowedParents",
      catalogId,
    );
    final List<String>? allowedChildren = _parseIdentifierList(
      map['allowedChildren'],
      "component '$name'.allowedChildren",
      catalogId,
    );
    final Map<String, Object?>? metadata = _parseMetadata(
      map['metadata'],
      "component '$name'.metadata",
      catalogId,
    );
    final bool deprecated =
        _optionalBool(map, 'deprecated', "component '$name'", catalogId) ??
        false;
    final String? deprecatedReason = _optionalString(
      map,
      'deprecatedReason',
      "component '$name'",
      catalogId,
    );

    return ComponentDefinition(
      name: name,
      description: description,
      checkable: checkable,
      parameters: List.unmodifiable(parameters),
      atLeastOneOf: atLeastOneOf,
      allowedParents: allowedParents,
      allowedChildren: allowedChildren,
      metadata: metadata,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
    );
  }

  static FunctionDefinition _parseFunction(
    Map<String, Object?> map,
    String context,
    String catalogId,
    A2uiProtocolVersion effectiveVersion,
  ) {
    _rejectUnknownKeys(map, _functionKeys, context, catalogId);
    final String name = _requiredString(map, 'name', context, catalogId);
    if (name.startsWith('@')) {
      throw A2uiCatalogError(
        "Catalog '$catalogId' declares a function named '$name'; names "
        "starting with '@' are reserved.",
        catalogId: catalogId,
      );
    }
    _assertIdentifier(name, "function identifier '$name'", catalogId);

    if (!map.containsKey('returnType') || map['returnType'] == null) {
      throw A2uiCatalogError(
        "Function '$name' must declare 'returnType'.",
        catalogId: catalogId,
      );
    }
    final FunctionReturnDefinition returnType = _parseReturnType(
      map['returnType'],
      "function '$name'.returnType",
      catalogId,
    );
    if (!effectiveVersion.isAtLeast(A2uiProtocolVersion.v1_0) &&
        returnType.returnType == A2uiReturnType.validationResult) {
      throw A2uiCatalogError(
        "Function '$name' declares returnType 'validationResult', which "
        'protocol ${effectiveVersion.semverValue} does not define; declare '
        'protocolVersion 1.0 or later.',
        catalogId: catalogId,
      );
    }

    final String? description = _optionalString(
      map,
      'description',
      "function '$name'",
      catalogId,
    );
    final AllowedCallers? declaredAllowedCallers =
        switch (map['allowedCallers']) {
          null => null,
          final String s => AllowedCallers.fromJson(s),
          final Object other => throw A2uiCatalogError(
            "Function '$name' allowedCallers must be a string, got "
            '${other.runtimeType}.',
            catalogId: catalogId,
          ),
        };
    final bool? declaredRequiresUserActivation = _optionalBool(
      map,
      'requiresUserActivation',
      "function '$name'",
      catalogId,
    );
    final AllowedCallers effectiveCallers =
        declaredAllowedCallers ?? AllowedCallers.rendererOnly;
    if ((declaredRequiresUserActivation ?? false) &&
        effectiveCallers != AllowedCallers.rendererOnly) {
      throw A2uiCatalogError(
        "Function '$name' declares requiresUserActivation with "
        "allowedCallers '${effectiveCallers.jsonValue}'; a function that "
        "requires user activation must be 'rendererOnly'.",
        catalogId: catalogId,
      );
    }

    final List<ParameterDefinition> parameters = _parseParameters(
      map['parameters'],
      allowComponentTypes: false,
      context: "function '$name'.parameters",
      catalogId: catalogId,
    );
    final Set<String> paramNames = {
      for (final ParameterDefinition p in parameters) p.name,
    };
    final List<List<String>>? atLeastOneOf = _parseAtLeastOneOf(
      map['atLeastOneOf'],
      paramNames,
      "function '$name'.atLeastOneOf",
      catalogId,
    );
    final (:bool flag, :TypeDefinition? type) = _parseAdditionalSchema(
      map['additionalParameters'],
      allowComponentTypes: false,
      context: "function '$name'.additionalParameters",
      catalogId: catalogId,
    );
    final bool deprecated =
        _optionalBool(map, 'deprecated', "function '$name'", catalogId) ??
        false;
    final String? deprecatedReason = _optionalString(
      map,
      'deprecatedReason',
      "function '$name'",
      catalogId,
    );

    return FunctionDefinition(
      name: name,
      description: description,
      returnType: returnType,
      allowedCallers: declaredAllowedCallers,
      requiresUserActivation: declaredRequiresUserActivation,
      parameters: List.unmodifiable(parameters),
      atLeastOneOf: atLeastOneOf,
      additionalParameters: flag,
      additionalParametersType: type,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
    );
  }

  static FunctionReturnDefinition _parseReturnType(
    Object? raw,
    String context,
    String catalogId,
  ) {
    if (raw is String) {
      if (!_shorthandReturnTypes.contains(raw)) {
        throw A2uiCatalogError(
          "Unknown $context '$raw'; expected one of "
          '${_shorthandReturnTypes.join(', ')}.',
          catalogId: catalogId,
        );
      }
      if (raw == 'integer') return const FunctionReturnDefinition.integer();
      return FunctionReturnDefinition.shorthand(A2uiReturnType.fromJson(raw));
    }
    final Map<String, Object?> map = _expectMap(raw, context, catalogId);
    final Object? kind = map['type'];
    if (kind == 'void') {
      _rejectUnknownKeys(
        map,
        const {'type', 'description'},
        context,
        catalogId,
      );
      return FunctionReturnDefinition.void_(
        description: _optionalString(map, 'description', context, catalogId),
      );
    }
    if (kind == 'validationResult') {
      _rejectUnknownKeys(
        map,
        const {'type', 'description'},
        context,
        catalogId,
      );
      return FunctionReturnDefinition.validationResult(
        description: _optionalString(map, 'description', context, catalogId),
      );
    }
    final TypeDefinition dataType = _parseType(
      map,
      allowComponentTypes: false,
      allowParameterIdentity: false,
      context: context,
      catalogId: catalogId,
    );
    return FunctionReturnDefinition.typed(dataType);
  }

  static List<ParameterDefinition> _parseParameters(
    Object? raw, {
    required bool allowComponentTypes,
    required String context,
    required String catalogId,
  }) {
    if (raw == null) return const [];
    final List<Object?> list = _expectList(raw, context, catalogId);
    final result = <ParameterDefinition>[];
    final seen = <String>{};
    for (var i = 0; i < list.length; i++) {
      final Map<String, Object?> paramMap = _expectMap(
        list[i],
        '$context[$i]',
        catalogId,
      );
      final String name = _requiredString(
        paramMap,
        'name',
        '$context[$i]',
        catalogId,
      );
      _assertIdentifier(name, "parameter identifier '$name'", catalogId);
      if (!seen.add(name)) {
        throw A2uiCatalogError(
          "Duplicate parameter name '$name' in $context.",
          catalogId: catalogId,
        );
      }
      final bool required =
          _optionalBool(paramMap, 'required', "$context.'$name'", catalogId) ??
          false;
      final TypeDefinition type = _parseType(
        paramMap,
        allowComponentTypes: allowComponentTypes,
        allowParameterIdentity: true,
        context: "$context.'$name'",
        catalogId: catalogId,
      );
      result.add(
        ParameterDefinition(name: name, type: type, required: required),
      );
    }
    return result;
  }

  static TypeDefinition _parseType(
    Map<String, Object?> map, {
    required bool allowComponentTypes,
    required bool allowParameterIdentity,
    required String context,
    required String catalogId,
  }) {
    if (!allowParameterIdentity) {
      if (map.containsKey('name')) {
        throw A2uiCatalogError(
          "Unexpected 'name' key on unnamed type at $context.",
          catalogId: catalogId,
        );
      }
      if (map.containsKey('required')) {
        throw A2uiCatalogError(
          "Unexpected 'required' key on unnamed type at $context.",
          catalogId: catalogId,
        );
      }
    }

    final String kind = _requiredString(map, 'type', context, catalogId);
    final String? description = _optionalString(
      map,
      'description',
      context,
      catalogId,
    );
    final bool deprecated =
        _optionalBool(map, 'deprecated', context, catalogId) ?? false;
    final String? deprecatedReason = _optionalString(
      map,
      'deprecatedReason',
      context,
      catalogId,
    );

    Set<String> allowed(Set<String> extra) => {
      ..._baseTypeKeys,
      if (allowParameterIdentity) ..._parameterIdentityKeys,
      ...extra,
    };

    switch (kind) {
      case 'string':
        _rejectUnknownKeys(
          map,
          allowed(const {
            'dynamic',
            'format',
            'pattern',
            'minLength',
            'maxLength',
            'default',
          }),
          context,
          catalogId,
        );
        final bool isDynamic =
            _optionalBool(map, 'dynamic', context, catalogId) ?? false;
        final (:String? singleFormat, :List<String>? multiFormats) =
            _parseFormats(map['format'], context, catalogId);
        final String? pattern = _optionalString(
          map,
          'pattern',
          context,
          catalogId,
        );
        final int? minLength = _optionalNonNegativeInt(
          map,
          'minLength',
          context,
          catalogId,
        );
        final int? maxLength = _optionalNonNegativeInt(
          map,
          'maxLength',
          context,
          catalogId,
        );
        final String? defaultValue = _optionalString(
          map,
          'default',
          context,
          catalogId,
        );
        return StringType(
          dynamic: isDynamic,
          format: singleFormat,
          formats: multiFormats,
          pattern: pattern,
          minLength: minLength,
          maxLength: maxLength,
          defaultValue: defaultValue,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      case 'number':
        _rejectUnknownKeys(
          map,
          allowed(const {'dynamic', 'min', 'max', 'default'}),
          context,
          catalogId,
        );
        return NumberType(
          dynamic: _optionalBool(map, 'dynamic', context, catalogId) ?? false,
          min: _optionalNum(map, 'min', context, catalogId),
          max: _optionalNum(map, 'max', context, catalogId),
          defaultValue: _optionalNum(map, 'default', context, catalogId),
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      case 'integer':
        _rejectUnknownKeys(
          map,
          allowed(const {'dynamic', 'min', 'max', 'default'}),
          context,
          catalogId,
        );
        return IntegerType(
          dynamic: _optionalBool(map, 'dynamic', context, catalogId) ?? false,
          min: _optionalInt(map, 'min', context, catalogId),
          max: _optionalInt(map, 'max', context, catalogId),
          defaultValue: _optionalInt(map, 'default', context, catalogId),
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      case 'boolean':
        _rejectUnknownKeys(
          map,
          allowed(const {'dynamic', 'default'}),
          context,
          catalogId,
        );
        return BooleanType(
          dynamic: _optionalBool(map, 'dynamic', context, catalogId) ?? false,
          defaultValue: _optionalBool(map, 'default', context, catalogId),
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      case 'enum':
        _rejectUnknownKeys(
          map,
          allowed(const {'dynamic', 'valueType', 'values', 'default'}),
          context,
          catalogId,
        );
        final EnumValueType? valueType = switch (map['valueType']) {
          null => null,
          final String s => EnumValueType.fromJson(s),
          final Object other => throw A2uiCatalogError(
            "$context 'valueType' must be a string, got ${other.runtimeType}.",
            catalogId: catalogId,
          ),
        };
        final List<Object?> rawValues = _expectList(
          map['values'],
          '$context.values',
          catalogId,
        );
        if (rawValues.isEmpty) {
          throw A2uiCatalogError(
            "$context 'values' must contain at least one element.",
            catalogId: catalogId,
          );
        }
        final values = <Object>[];
        final seen = <Object>{};
        for (final item in rawValues) {
          if (item == null ||
              (item is! String && item is! num && item is! bool)) {
            throw A2uiCatalogError(
              "$context 'values' entries must be string, number, or boolean.",
              catalogId: catalogId,
            );
          }
          if (valueType != null && !_matchesEnumValueType(item, valueType)) {
            throw A2uiCatalogError(
              "$context enum value '$item' does not match valueType "
              "'${valueType.jsonValue}'.",
              catalogId: catalogId,
            );
          }
          if (!seen.add(item)) {
            throw A2uiCatalogError(
              "$context 'values' contains duplicate value '$item'.",
              catalogId: catalogId,
            );
          }
          values.add(item);
        }
        final Object? defaultVal = map['default'];
        if (defaultVal != null &&
            defaultVal is! String &&
            defaultVal is! num &&
            defaultVal is! bool) {
          throw A2uiCatalogError(
            "$context 'default' must be a string, number, or boolean.",
            catalogId: catalogId,
          );
        }
        return EnumType(
          values: List.unmodifiable(values),
          valueType: valueType,
          dynamic: _optionalBool(map, 'dynamic', context, catalogId) ?? false,
          defaultValue: defaultVal,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      case 'const':
        _rejectUnknownKeys(map, allowed(const {'value'}), context, catalogId);
        if (!map.containsKey('value')) {
          throw A2uiCatalogError(
            "$context of type 'const' must declare 'value'.",
            catalogId: catalogId,
          );
        }
        final Object? constVal = map['value'];
        if (constVal != null &&
            constVal is! String &&
            constVal is! num &&
            constVal is! bool) {
          throw A2uiCatalogError(
            "$context 'value' must be string, number, boolean, or null.",
            catalogId: catalogId,
          );
        }
        return ConstType(
          value: constVal,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      case 'any':
        _rejectUnknownKeys(
          map,
          allowed(const {'dynamic', 'nullable', 'default'}),
          context,
          catalogId,
        );
        final bool isDynamic =
            _optionalBool(map, 'dynamic', context, catalogId) ?? false;
        final bool nullable =
            _optionalBool(map, 'nullable', context, catalogId) ?? false;
        return map.containsKey('default')
            ? AnyType(
                dynamic: isDynamic,
                nullable: nullable,
                defaultValue: _deepCopy(map['default']),
                description: description,
                deprecated: deprecated,
                deprecatedReason: deprecatedReason,
              )
            : AnyType(
                dynamic: isDynamic,
                nullable: nullable,
                description: description,
                deprecated: deprecated,
                deprecatedReason: deprecatedReason,
              );

      case 'object':
        _rejectUnknownKeys(
          map,
          allowed(const {
            'dynamic',
            'properties',
            'additionalProperties',
            'atLeastOneOf',
            'default',
          }),
          context,
          catalogId,
        );
        final List<ParameterDefinition> props = _parseParameters(
          map['properties'],
          allowComponentTypes: allowComponentTypes,
          context: '$context.properties',
          catalogId: catalogId,
        );
        final Set<String> propNames = {
          for (final ParameterDefinition p in props) p.name,
        };
        final List<List<String>>? atLeastOneOf = _parseAtLeastOneOf(
          map['atLeastOneOf'],
          propNames,
          '$context.atLeastOneOf',
          catalogId,
        );
        final (:bool flag, :TypeDefinition? type) = _parseAdditionalSchema(
          map['additionalProperties'],
          allowComponentTypes: allowComponentTypes,
          context: '$context.additionalProperties',
          catalogId: catalogId,
        );
        final Map<String, Object?>? defaultVal = map['default'] == null
            ? null
            : _deepCopy(
                    _expectMap(map['default'], '$context.default', catalogId),
                  )!
                  as Map<String, Object?>;
        return ObjectType(
          dynamic: _optionalBool(map, 'dynamic', context, catalogId) ?? false,
          properties: List.unmodifiable(props),
          additionalProperties: flag,
          additionalPropertiesType: type,
          atLeastOneOf: atLeastOneOf,
          defaultValue: defaultVal,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      case 'array':
        _rejectUnknownKeys(
          map,
          allowed(const {
            'dynamic',
            'items',
            'minItems',
            'maxItems',
            'uniqueItems',
            'default',
          }),
          context,
          catalogId,
        );
        final TypeDefinition? items = map['items'] == null
            ? null
            : _parseType(
                _expectMap(map['items'], '$context.items', catalogId),
                allowComponentTypes: allowComponentTypes,
                allowParameterIdentity: false,
                context: '$context.items',
                catalogId: catalogId,
              );
        final List<Object?>? defaultVal = map['default'] == null
            ? null
            : _deepCopy(
                    _expectList(map['default'], '$context.default', catalogId),
                  )!
                  as List<Object?>;
        return ArrayType(
          dynamic: _optionalBool(map, 'dynamic', context, catalogId) ?? false,
          items: items,
          minItems: _optionalNonNegativeInt(
            map,
            'minItems',
            context,
            catalogId,
          ),
          maxItems: _optionalNonNegativeInt(
            map,
            'maxItems',
            context,
            catalogId,
          ),
          uniqueItems:
              _optionalBool(map, 'uniqueItems', context, catalogId) ?? false,
          defaultValue: defaultVal,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      case 'union':
        _rejectUnknownKeys(
          map,
          allowed(const {'dynamic', 'exclusive', 'variants', 'default'}),
          context,
          catalogId,
        );
        final List<Object?> rawVariants = _expectList(
          map['variants'],
          '$context.variants',
          catalogId,
        );
        if (rawVariants.length < 2) {
          throw A2uiCatalogError(
            "$context 'variants' must contain at least 2 variants.",
            catalogId: catalogId,
          );
        }
        final variants = <TypeDefinition>[
          for (var i = 0; i < rawVariants.length; i++)
            _parseType(
              _expectMap(rawVariants[i], '$context.variants[$i]', catalogId),
              allowComponentTypes: allowComponentTypes,
              allowParameterIdentity: false,
              context: '$context.variants[$i]',
              catalogId: catalogId,
            ),
        ];
        final bool isDynamic =
            _optionalBool(map, 'dynamic', context, catalogId) ?? false;
        final bool exclusive =
            _optionalBool(map, 'exclusive', context, catalogId) ?? true;
        return map.containsKey('default')
            ? UnionType(
                variants: List.unmodifiable(variants),
                exclusive: exclusive,
                dynamic: isDynamic,
                defaultValue: _deepCopy(map['default']),
                description: description,
                deprecated: deprecated,
                deprecatedReason: deprecatedReason,
              )
            : UnionType(
                variants: List.unmodifiable(variants),
                exclusive: exclusive,
                dynamic: isDynamic,
                description: description,
                deprecated: deprecated,
                deprecatedReason: deprecatedReason,
              );

      case 'dataBinding':
        _rejectUnknownKeys(map, allowed(const {}), context, catalogId);
        return DataBindingType(
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      case 'functionCall':
        _rejectUnknownKeys(map, allowed(const {}), context, catalogId);
        return FunctionCallType(
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      case 'ref':
        _rejectUnknownKeys(
          map,
          allowed(const {'ref', 'default'}),
          context,
          catalogId,
        );
        final String ref = _requiredString(map, 'ref', context, catalogId);
        _assertIdentifier(ref, "type ref '$ref' at $context", catalogId);
        return map.containsKey('default')
            ? RefType(
                ref: ref,
                defaultValue: _deepCopy(map['default']),
                description: description,
                deprecated: deprecated,
                deprecatedReason: deprecatedReason,
              )
            : RefType(
                ref: ref,
                description: description,
                deprecated: deprecated,
                deprecatedReason: deprecatedReason,
              );

      case 'child':
      case 'childList':
      case 'action':
      case 'checkRule':
      case 'accessibility':
        if (!allowComponentTypes) {
          throw A2uiCatalogError(
            "Component-only type '$kind' is not allowed at $context.",
            catalogId: catalogId,
          );
        }
        _rejectUnknownKeys(map, allowed(const {}), context, catalogId);
        return switch (kind) {
          'child' => ChildType(
            description: description,
            deprecated: deprecated,
            deprecatedReason: deprecatedReason,
          ),
          'childList' => ChildListType(
            description: description,
            deprecated: deprecated,
            deprecatedReason: deprecatedReason,
          ),
          'action' => ActionType(
            description: description,
            deprecated: deprecated,
            deprecatedReason: deprecatedReason,
          ),
          'checkRule' => CheckRuleType(
            description: description,
            deprecated: deprecated,
            deprecatedReason: deprecatedReason,
          ),
          _ => AccessibilityType(
            description: description,
            deprecated: deprecated,
            deprecatedReason: deprecatedReason,
          ),
        };

      default:
        throw A2uiCatalogError(
          "Unknown type '$kind' at $context.",
          catalogId: catalogId,
        );
    }
  }

  static ({bool flag, TypeDefinition? type}) _parseAdditionalSchema(
    Object? raw, {
    required bool allowComponentTypes,
    required String context,
    required String catalogId,
  }) {
    if (raw == null) return (flag: false, type: null);
    if (raw is bool) return (flag: raw, type: null);
    final Map<String, Object?> map = _expectMap(raw, context, catalogId);
    final TypeDefinition parsed = _parseType(
      map,
      allowComponentTypes: allowComponentTypes,
      allowParameterIdentity: false,
      context: context,
      catalogId: catalogId,
    );
    return (flag: false, type: parsed);
  }

  static ({String? singleFormat, List<String>? multiFormats}) _parseFormats(
    Object? raw,
    String context,
    String catalogId,
  ) {
    if (raw == null) return (singleFormat: null, multiFormats: null);
    if (raw is String) {
      if (raw.isEmpty) {
        throw A2uiCatalogError(
          "$context 'format' must not be empty.",
          catalogId: catalogId,
        );
      }
      return (singleFormat: raw, multiFormats: null);
    }
    if (raw is List) {
      if (raw.isEmpty) {
        throw A2uiCatalogError(
          "$context 'format' array must contain at least one format.",
          catalogId: catalogId,
        );
      }
      final formats = <String>[];
      final seen = <String>{};
      for (final Object? item in raw) {
        if (item is! String || item.isEmpty) {
          throw A2uiCatalogError(
            "$context 'format' entries must be non-empty strings.",
            catalogId: catalogId,
          );
        }
        if (!seen.add(item)) {
          throw A2uiCatalogError(
            "$context 'format' contains duplicate entry '$item'.",
            catalogId: catalogId,
          );
        }
        formats.add(item);
      }
      if (formats.length == 1) {
        return (singleFormat: formats.first, multiFormats: null);
      }
      return (singleFormat: null, multiFormats: List.unmodifiable(formats));
    }
    throw A2uiCatalogError(
      "$context 'format' must be a string or array of strings.",
      catalogId: catalogId,
    );
  }

  static List<List<String>>? _parseAtLeastOneOf(
    Object? raw,
    Set<String> declaredNames,
    String context,
    String catalogId,
  ) {
    if (raw == null) return null;
    final List<Object?> outer = _expectList(raw, context, catalogId);
    if (outer.isEmpty) {
      throw A2uiCatalogError(
        '$context must contain at least one group.',
        catalogId: catalogId,
      );
    }
    final groups = <List<String>>[];
    for (var i = 0; i < outer.length; i++) {
      final List<Object?> inner = _expectList(
        outer[i],
        '$context[$i]',
        catalogId,
      );
      if (inner.isEmpty) {
        throw A2uiCatalogError(
          '$context[$i] must contain at least one parameter name.',
          catalogId: catalogId,
        );
      }
      final group = <String>[];
      final seen = <String>{};
      for (final entry in inner) {
        if (entry is! String) {
          throw A2uiCatalogError(
            '$context[$i] entries must be strings.',
            catalogId: catalogId,
          );
        }
        _assertIdentifier(
          entry,
          "identifier '$entry' in $context[$i]",
          catalogId,
        );
        if (!seen.add(entry)) {
          throw A2uiCatalogError(
            "$context[$i] contains duplicate parameter '$entry'.",
            catalogId: catalogId,
          );
        }
        if (!declaredNames.contains(entry)) {
          throw A2uiCatalogError(
            "$context[$i] references undeclared parameter '$entry'.",
            catalogId: catalogId,
          );
        }
        group.add(entry);
      }
      groups.add(List.unmodifiable(group));
    }
    return List.unmodifiable(groups);
  }

  static List<String>? _parseIdentifierList(
    Object? raw,
    String context,
    String catalogId,
  ) {
    if (raw == null) return null;
    final List<Object?> list = _expectList(raw, context, catalogId);
    final result = <String>[];
    final seen = <String>{};
    for (final entry in list) {
      if (entry is! String) {
        throw A2uiCatalogError(
          '$context entries must be strings.',
          catalogId: catalogId,
        );
      }
      _assertIdentifier(entry, "identifier '$entry' in $context", catalogId);
      if (!seen.add(entry)) {
        throw A2uiCatalogError(
          "$context contains duplicate entry '$entry'.",
          catalogId: catalogId,
        );
      }
      result.add(entry);
    }
    return List.unmodifiable(result);
  }

  static void _validateRefs(CatalogModel model) {
    final Set<String> definedTypes = model.types.keys.toSet();

    void walk(TypeDefinition type, String context) {
      switch (type) {
        case RefType(:final String ref):
          if (!definedTypes.contains(ref)) {
            throw A2uiCatalogError(
              "$context references undefined local type '$ref'.",
              catalogId: model.catalogId,
            );
          }
        case ObjectType(:final properties, :final additionalPropertiesType):
          for (final p in properties) {
            walk(p.type, '$context.${p.name}');
          }
          if (additionalPropertiesType != null) {
            walk(additionalPropertiesType, '$context.additionalProperties');
          }
        case ArrayType(:final items):
          if (items != null) walk(items, '$context.items');
        case UnionType(:final variants):
          for (var i = 0; i < variants.length; i++) {
            walk(variants[i], '$context.variants[$i]');
          }
        default:
          break;
      }
    }

    for (final MapEntry<String, TypeDefinition> entry in model.types.entries) {
      walk(entry.value, 'types.${entry.key}');
      // Detect direct RefType alias cycles (e.g. A -> B -> A).
      final visited = <String>{entry.key};
      TypeDefinition current = entry.value;
      while (current is RefType) {
        if (!visited.add(current.ref)) {
          throw A2uiCatalogError(
            "Cyclic local type reference involving '${entry.key}' in "
            "catalog '${model.catalogId}'.",
            catalogId: model.catalogId,
          );
        }
        current = model.types[current.ref]!;
      }
    }

    if (model.surfaceProperties case final SurfacePropertiesDefinition sp) {
      for (final ParameterDefinition p in sp.properties) {
        walk(p.type, 'surfaceProperties.${p.name}');
      }
      if (sp.additionalPropertiesType != null) {
        walk(
          sp.additionalPropertiesType!,
          'surfaceProperties.additionalProperties',
        );
      }
    }

    for (final ComponentDefinition comp in model.components) {
      for (final ParameterDefinition p in comp.parameters) {
        walk(p.type, 'components.${comp.name}.${p.name}');
      }
    }

    for (final FunctionDefinition fn in model.functions) {
      if (fn.returnType.type != null) {
        walk(fn.returnType.type!, 'functions.${fn.name}.returnType');
      }
      for (final ParameterDefinition p in fn.parameters) {
        walk(p.type, 'functions.${fn.name}.${p.name}');
      }
      if (fn.additionalParametersType != null) {
        walk(
          fn.additionalParametersType!,
          'functions.${fn.name}.additionalParameters',
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Serialization helpers
  // ---------------------------------------------------------------------------

  static Map<String, Object?> _serializeSurfaceProperties(
    SurfacePropertiesDefinition sp,
    String catalogId,
  ) {
    if (sp.rawSchema != null) {
      throw A2uiCatalogError(
        'Cannot serialize untranslatable legacy raw JSON Schema in '
        'surfaceProperties to a Catalog Document.',
        catalogId: catalogId,
      );
    }
    return <String, Object?>{
      if (sp.description != null) 'description': sp.description,
      if (sp.properties.isNotEmpty)
        'properties': [
          for (final ParameterDefinition p in sp.properties)
            _serializeParameter(
              p,
              catalogId: catalogId,
              context: 'surfaceProperties.${p.name}',
            ),
        ],
      if (sp.additionalPropertiesType != null)
        'additionalProperties': _serializeType(
          sp.additionalPropertiesType!,
          catalogId: catalogId,
          context: 'surfaceProperties.additionalProperties',
        )
      else if (sp.additionalProperties)
        'additionalProperties': true,
    };
  }

  static Map<String, Object?> _serializeComponent(
    ComponentDefinition comp,
    String catalogId,
  ) {
    if (comp.rawSchema != null) {
      throw A2uiCatalogError(
        "Cannot serialize component '${comp.name}' with untranslatable "
        'legacy raw JSON Schema to a Catalog Document.',
        catalogId: catalogId,
      );
    }
    return <String, Object?>{
      'name': comp.name,
      if (comp.description != null) 'description': comp.description,
      if (comp.checkable) 'checkable': true,
      if (comp.parameters.isNotEmpty)
        'parameters': [
          for (final ParameterDefinition p in comp.parameters)
            _serializeParameter(
              p,
              catalogId: catalogId,
              context: 'components.${comp.name}.${p.name}',
            ),
        ],
      if (comp.atLeastOneOf != null && comp.atLeastOneOf!.isNotEmpty)
        'atLeastOneOf': [
          for (final List<String> group in comp.atLeastOneOf!)
            List<String>.of(group),
        ],
      if (comp.allowedParents != null)
        'allowedParents': List<String>.of(comp.allowedParents!),
      if (comp.allowedChildren != null)
        'allowedChildren': List<String>.of(comp.allowedChildren!),
      if (comp.metadata != null) 'metadata': _deepCopy(comp.metadata),
      if (comp.deprecated) 'deprecated': true,
      if (comp.deprecatedReason != null)
        'deprecatedReason': comp.deprecatedReason,
    };
  }

  static Map<String, Object?> _serializeFunction(
    FunctionDefinition fn,
    String catalogId,
  ) {
    if (fn.rawArgumentSchema != null) {
      throw A2uiCatalogError(
        "Cannot serialize function '${fn.name}' with untranslatable legacy "
        'raw JSON Schema to a Catalog Document.',
        catalogId: catalogId,
      );
    }
    final AllowedCallers? callers = fn.declaredAllowedCallers;
    final bool emitCallers =
        callers != null && callers != AllowedCallers.rendererOnly;
    return <String, Object?>{
      'name': fn.name,
      if (fn.description != null) 'description': fn.description,
      'returnType': _serializeReturnType(
        fn.returnType,
        catalogId: catalogId,
        context: 'functions.${fn.name}.returnType',
      ),
      if (emitCallers) 'allowedCallers': callers.jsonValue,
      if (fn.requiresUserActivation) 'requiresUserActivation': true,
      if (fn.parameters.isNotEmpty)
        'parameters': [
          for (final ParameterDefinition p in fn.parameters)
            _serializeParameter(
              p,
              catalogId: catalogId,
              context: 'functions.${fn.name}.${p.name}',
            ),
        ],
      if (fn.atLeastOneOf != null && fn.atLeastOneOf!.isNotEmpty)
        'atLeastOneOf': [
          for (final List<String> group in fn.atLeastOneOf!)
            List<String>.of(group),
        ],
      if (fn.additionalParametersType != null)
        'additionalParameters': _serializeType(
          fn.additionalParametersType!,
          catalogId: catalogId,
          context: 'functions.${fn.name}.additionalParameters',
        )
      else if (fn.additionalParameters)
        'additionalParameters': true,
      if (fn.deprecated) 'deprecated': true,
      if (fn.deprecatedReason != null) 'deprecatedReason': fn.deprecatedReason,
    };
  }

  static Object _serializeReturnType(
    FunctionReturnDefinition ret, {
    required String catalogId,
    required String context,
  }) {
    if (ret.type != null) {
      return _serializeType(ret.type!, catalogId: catalogId, context: context);
    }
    if (ret.shorthandName case final String name) {
      return name;
    }
    return <String, Object?>{
      'type': ret.isIntegerShorthand ? 'integer' : ret.returnType.jsonValue,
      if (ret.description != null) 'description': ret.description,
    };
  }

  static Map<String, Object?> _serializeParameter(
    ParameterDefinition param, {
    required String catalogId,
    required String context,
  }) {
    final Map<String, Object?> body = _serializeType(
      param.type,
      catalogId: catalogId,
      context: context,
    );
    return <String, Object?>{
      'name': param.name,
      ...body,
      if (param.required) 'required': true,
    };
  }

  static Map<String, Object?> _serializeType(
    TypeDefinition type, {
    required String catalogId,
    required String context,
  }) {
    final base = <String, Object?>{
      if (type.description != null) 'description': type.description,
      if (type.deprecated) 'deprecated': true,
      if (type.deprecatedReason != null)
        'deprecatedReason': type.deprecatedReason,
    };

    return switch (type) {
      StringType(
        :final dynamic,
        :final format,
        :final formats,
        :final pattern,
        :final minLength,
        :final maxLength,
        :final defaultValue,
      ) =>
        <String, Object?>{
          'type': 'string',
          if (dynamic) 'dynamic': true,
          if (format != null)
            'format': format
          else if (formats != null && formats.isNotEmpty)
            'format': List<String>.of(formats),
          'pattern': ?pattern,
          'minLength': ?minLength,
          'maxLength': ?maxLength,
          'default': ?defaultValue,
          ...base,
        },
      NumberType(:final dynamic, :final min, :final max, :final defaultValue) =>
        <String, Object?>{
          'type': 'number',
          if (dynamic) 'dynamic': true,
          'min': ?min,
          'max': ?max,
          'default': ?defaultValue,
          ...base,
        },
      IntegerType(
        :final dynamic,
        :final min,
        :final max,
        :final defaultValue,
      ) =>
        <String, Object?>{
          'type': 'integer',
          if (dynamic) 'dynamic': true,
          'min': ?min,
          'max': ?max,
          'default': ?defaultValue,
          ...base,
        },
      BooleanType(:final dynamic, :final defaultValue) => <String, Object?>{
        'type': 'boolean',
        if (dynamic) 'dynamic': true,
        'default': ?defaultValue,
        ...base,
      },
      EnumType(
        :final values,
        :final valueType,
        :final dynamic,
        :final defaultValue,
      ) =>
        <String, Object?>{
          'type': 'enum',
          if (dynamic) 'dynamic': true,
          if (valueType != EnumValueType.string)
            'valueType': valueType.jsonValue,
          'values': List<Object>.of(values),
          'default': ?defaultValue,
          ...base,
        },
      ConstType(:final value) => <String, Object?>{
        'type': 'const',
        'value': value,
        ...base,
      },
      AnyType(
        :final dynamic,
        :final nullable,
        :final hasDefault,
        :final defaultValue,
      ) =>
        <String, Object?>{
          'type': 'any',
          if (dynamic) 'dynamic': true,
          if (nullable) 'nullable': true,
          if (hasDefault) 'default': _deepCopy(defaultValue),
          ...base,
        },
      ObjectType(
        :final dynamic,
        :final properties,
        :final additionalProperties,
        :final additionalPropertiesType,
        :final atLeastOneOf,
        :final defaultValue,
      ) =>
        <String, Object?>{
          'type': 'object',
          if (dynamic) 'dynamic': true,
          if (properties.isNotEmpty)
            'properties': [
              for (final ParameterDefinition p in properties)
                _serializeParameter(
                  p,
                  catalogId: catalogId,
                  context: '$context.${p.name}',
                ),
            ],
          if (additionalPropertiesType != null)
            'additionalProperties': _serializeType(
              additionalPropertiesType,
              catalogId: catalogId,
              context: '$context.additionalProperties',
            )
          else if (additionalProperties)
            'additionalProperties': true,
          if (atLeastOneOf != null && atLeastOneOf.isNotEmpty)
            'atLeastOneOf': [
              for (final List<String> group in atLeastOneOf)
                List<String>.of(group),
            ],
          if (defaultValue != null) 'default': _deepCopy(defaultValue),
          ...base,
        },
      ArrayType(
        :final dynamic,
        :final items,
        :final minItems,
        :final maxItems,
        :final uniqueItems,
        :final defaultValue,
      ) =>
        <String, Object?>{
          'type': 'array',
          if (dynamic) 'dynamic': true,
          if (items != null)
            'items': _serializeType(
              items,
              catalogId: catalogId,
              context: '$context.items',
            ),
          'minItems': ?minItems,
          'maxItems': ?maxItems,
          if (uniqueItems) 'uniqueItems': true,
          if (defaultValue != null) 'default': _deepCopy(defaultValue),
          ...base,
        },
      UnionType(
        :final variants,
        :final exclusive,
        :final dynamic,
        :final hasDefault,
        :final defaultValue,
      ) =>
        <String, Object?>{
          'type': 'union',
          if (dynamic) 'dynamic': true,
          if (!exclusive) 'exclusive': false,
          'variants': [
            for (var i = 0; i < variants.length; i++)
              _serializeType(
                variants[i],
                catalogId: catalogId,
                context: '$context.variants[$i]',
              ),
          ],
          if (hasDefault) 'default': _deepCopy(defaultValue),
          ...base,
        },
      DataBindingType() => <String, Object?>{'type': 'dataBinding', ...base},
      FunctionCallType() => <String, Object?>{'type': 'functionCall', ...base},
      RefType(:final ref, :final hasDefault, :final defaultValue) =>
        <String, Object?>{
          'type': 'ref',
          'ref': ref,
          if (hasDefault) 'default': _deepCopy(defaultValue),
          ...base,
        },
      ChildType() => <String, Object?>{'type': 'child', ...base},
      ChildListType() => <String, Object?>{'type': 'childList', ...base},
      ActionType() => <String, Object?>{'type': 'action', ...base},
      CheckRuleType() => <String, Object?>{'type': 'checkRule', ...base},
      AccessibilityType() => <String, Object?>{
        'type': 'accessibility',
        ...base,
      },
      RawJsonSchemaType() => throw A2uiCatalogError(
        'Cannot serialize untranslatable legacy raw JSON Schema at $context '
        'to a Catalog Document.',
        catalogId: catalogId,
      ),
    };
  }

  // ---------------------------------------------------------------------------
  // Validation utilities
  // ---------------------------------------------------------------------------

  static void _assertIdentifier(
    String value,
    String context,
    String catalogId,
  ) {
    if (!isValidUax31Identifier(value)) {
      throw A2uiCatalogError('Invalid UAX #31 $context.', catalogId: catalogId);
    }
  }

  static void _rejectUnknownKeys(
    Map<String, Object?> map,
    Set<String> allowed,
    String context,
    String catalogId,
  ) {
    for (final String key in map.keys) {
      if (!allowed.contains(key)) {
        throw A2uiCatalogError(
          "Unknown property '$key' in $context.",
          catalogId: catalogId,
        );
      }
    }
  }

  static Map<String, Object?> _expectMap(
    Object? value,
    String context,
    String catalogId,
  ) {
    if (value is Map<String, Object?>) return value;
    if (value is Map) {
      final result = <String, Object?>{};
      for (final MapEntry<Object?, Object?> entry in value.entries) {
        if (entry.key is! String) {
          throw A2uiCatalogError(
            '$context keys must be strings.',
            catalogId: catalogId,
          );
        }
        result[entry.key! as String] = entry.value;
      }
      return result;
    }
    throw A2uiCatalogError(
      '$context must be a JSON object, got ${value.runtimeType}.',
      catalogId: catalogId,
    );
  }

  static List<Object?> _expectList(
    Object? value,
    String context,
    String catalogId,
  ) {
    if (value is List<Object?>) return value;
    if (value is List) return List<Object?>.of(value);
    throw A2uiCatalogError(
      '$context must be a JSON array, got ${value.runtimeType}.',
      catalogId: catalogId,
    );
  }

  static String _requiredString(
    Map<String, Object?> map,
    String key,
    String context,
    String catalogId,
  ) {
    final Object? value = map[key];
    if (value is String && value.isNotEmpty) return value;
    throw A2uiCatalogError(
      "$context must declare a non-empty string '$key'.",
      catalogId: catalogId,
    );
  }

  static String? _optionalString(
    Map<String, Object?> map,
    String key,
    String context,
    String catalogId,
  ) {
    final Object? value = map[key];
    if (value == null) return null;
    if (value is String) return value;
    throw A2uiCatalogError(
      "$context '$key' must be a string, got ${value.runtimeType}.",
      catalogId: catalogId,
    );
  }

  static bool? _optionalBool(
    Map<String, Object?> map,
    String key,
    String context,
    String catalogId,
  ) {
    final Object? value = map[key];
    if (value == null) return null;
    if (value is bool) return value;
    throw A2uiCatalogError(
      "$context '$key' must be a boolean, got ${value.runtimeType}.",
      catalogId: catalogId,
    );
  }

  static num? _optionalNum(
    Map<String, Object?> map,
    String key,
    String context,
    String catalogId,
  ) {
    final Object? value = map[key];
    if (value == null) return null;
    if (value is num) return value;
    throw A2uiCatalogError(
      "$context '$key' must be a number, got ${value.runtimeType}.",
      catalogId: catalogId,
    );
  }

  static int? _optionalInt(
    Map<String, Object?> map,
    String key,
    String context,
    String catalogId,
  ) {
    final Object? value = map[key];
    if (value == null) return null;
    if (value is int) return value;
    throw A2uiCatalogError(
      "$context '$key' must be an integer, got ${value.runtimeType}.",
      catalogId: catalogId,
    );
  }

  static int? _optionalNonNegativeInt(
    Map<String, Object?> map,
    String key,
    String context,
    String catalogId,
  ) {
    final int? value = _optionalInt(map, key, context, catalogId);
    if (value != null && value < 0) {
      throw A2uiCatalogError(
        "$context '$key' must be >= 0, got $value.",
        catalogId: catalogId,
      );
    }
    return value;
  }

  static bool _matchesEnumValueType(Object item, EnumValueType type) =>
      switch (type) {
        EnumValueType.string => item is String,
        EnumValueType.number => item is num,
        EnumValueType.boolean => item is bool,
      };

  static Object? _deepCopy(Object? value) {
    if (value is Map) {
      return Map<String, Object?>.unmodifiable(<String, Object?>{
        for (final MapEntry<Object?, Object?> entry in value.entries)
          '${entry.key}': _deepCopy(entry.value),
      });
    }
    if (value is List) {
      return List<Object?>.unmodifiable(<Object?>[
        for (final Object? item in value) _deepCopy(item),
      ]);
    }
    return value;
  }
}
