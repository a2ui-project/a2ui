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
import '../validation/schema_resolution.dart' show followJsonPointer;
import 'catalog_model.dart';
import 'json_utils.dart';
import 'type_definition.dart';

/// Bidirectional codec translating between legacy A2UI JSON Schema catalogs
/// (v0.9, v0.9.1, and v1.0) and the canonical in-memory [CatalogModel].
abstract final class JsonSchemaCodec {
  static const String _jsonSchemaDialect =
      'https://json-schema.org/draft/2020-12/schema';

  static const Set<String> _reservedDefNames = {
    'anyComponent',
    'anyFunction',
    'theme',
    'CatalogComponentCommon',
  };

  static const Set<String> _commonTypeNames = {
    'AccessibilityAttributes',
    'Action',
    'CheckRule',
    'Checkable',
    'Child',
    'ChildList',
    'ComponentCommon',
    'ComponentId',
    'DataBinding',
    'DynamicBoolean',
    'DynamicNumber',
    'DynamicString',
    'DynamicStringList',
    'DynamicValue',
    'Extensions',
    'FunctionCall',
    'FunctionCommon',
  };

  static const Set<String> _unsupportedKeywords = {
    'patternProperties',
    'not',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'dependentRequired',
    'dependentSchemas',
    'prefixItems',
    'contains',
    'minContains',
    'maxContains',
    'propertyNames',
    'minProperties',
    'maxProperties',
    'if',
    'then',
    'else',
  };

  static const Set<String> _metadataOnlyKeywords = {
    'description',
    'title',
    'default',
    'deprecated',
    'x-deprecated-reason',
    r'$comment',
    'examples',
    r'$id',
    r'$schema',
    'readOnly',
    'writeOnly',
  };

  static const List<String> _allJsonTypes = [
    'string',
    'number',
    'boolean',
    'array',
    'object',
    'null',
  ];

  static final RegExp _refDescriptionPattern = RegExp(
    r'^REF:([^|]+)(?:\|(.*))?$',
    dotAll: true,
  );

  // ---------------------------------------------------------------------------
  // JSON Schema -> CatalogModel
  // ---------------------------------------------------------------------------

  /// Translates a legacy JSON Schema catalog document into a [CatalogModel].
  static CatalogModel fromJsonSchema(
    Map<String, Object?> json, {
    String? expectedCatalogId,
    A2uiProtocolVersion? protocolVersion,
    String? catalogId,
  }) {
    final Object? rawId = catalogId ?? json['catalogId'];
    if (rawId is! String || rawId.isEmpty) {
      throw A2uiCatalogError(
        "Catalog document must declare a non-empty string 'catalogId', or "
        'one must be passed as catalogId.',
      );
    }
    if (expectedCatalogId != null && expectedCatalogId != rawId) {
      throw A2uiCatalogError(
        "Catalog id mismatch: expected '$expectedCatalogId' but the document "
        "declares '$rawId'.",
        catalogId: rawId,
      );
    }

    final Object? rawVersion = json['protocolVersion'];
    final A2uiProtocolVersion? declaredVersion = rawVersion is String
        ? A2uiProtocolVersion.tryParseSemVer(rawVersion)
        : null;
    if (rawVersion != null && declaredVersion == null) {
      throw A2uiCatalogError(
        "Unsupported catalog 'protocolVersion' '$rawVersion'; supported "
        'versions are ${A2uiProtocolVersion.supportedVersions}.',
        catalogId: rawId,
      );
    }
    final A2uiProtocolVersion? effectiveVersion =
        declaredVersion ?? protocolVersion;
    final bool atLeastV1 =
        effectiveVersion?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false;

    final Map<String, Object?> defs = _asStringMap(json[r'$defs']) ?? const {};
    final Map<String, TypeDefinition> types = extractLeafTypes(
      defs,
      rootDoc: json,
      atLeastV1: atLeastV1,
    );

    final Map<String, Object?>? themeRaw =
        _asStringMap(json['theme']) ?? _asStringMap(defs['theme']);
    final SurfacePropertiesDefinition? surfaceProperties = themeRaw == null
        ? null
        : surfacePropertiesFromJsonSchema(
            themeRaw,
            definitions: defs,
            rootDoc: json,
            knownTypes: types,
            atLeastV1: atLeastV1,
          );

    final components = <ComponentDefinition>[];
    if (_asStringMap(json['components'])
        case final Map<String, Object?> rawComponents) {
      for (final MapEntry<String, Object?> entry in rawComponents.entries) {
        final Map<String, Object?>? compMap = _asStringMap(entry.value);
        if (compMap == null) continue;
        components.add(
          componentSchemaToDefinition(
            entry.key,
            compMap,
            definitions: defs,
            rootDoc: json,
            knownTypes: types,
            atLeastV1: atLeastV1,
            allowedParents: _stringList(compMap['allowedParents']),
            allowedChildren: _stringList(compMap['allowedChildren']),
            metadata: _asStringMap(compMap['metadata']),
          ),
        );
      }
    }

    final functions = <FunctionDefinition>[];
    final Object? rawFunctions = json['functions'];
    if (rawFunctions is Map) {
      for (final MapEntry<Object?, Object?> entry in rawFunctions.entries) {
        if (entry.key is! String) continue;
        final Map<String, Object?>? fnMap = _asStringMap(entry.value);
        if (fnMap == null) continue;
        functions.add(
          _functionDefFromMap(
            entry.key! as String,
            fnMap,
            definitions: defs,
            rootDoc: json,
            knownTypes: types,
            atLeastV1: atLeastV1,
          ),
        );
      }
    } else if (rawFunctions is List) {
      for (final Object? item in rawFunctions) {
        final Map<String, Object?>? fnMap = _asStringMap(item);
        if (fnMap == null) continue;
        final Object? fnName = fnMap['name'];
        if (fnName is! String || fnName.isEmpty) continue;
        functions.add(
          _functionDefFromMap(
            fnName,
            fnMap,
            definitions: defs,
            rootDoc: json,
            knownTypes: types,
            atLeastV1: atLeastV1,
          ),
        );
      }
    }

    return CatalogModel(
      catalogId: rawId,
      protocolVersion: effectiveVersion,
      declaredProtocolVersion: rawVersion is String ? rawVersion : null,
      title: _str(json['title']),
      description: _str(json['description']),
      instructions: _str(json['instructions']),
      metadata: _asStringMap(json['metadata']),
      types: Map<String, TypeDefinition>.unmodifiable(types),
      surfaceProperties: surfaceProperties,
      components: List<ComponentDefinition>.unmodifiable(components),
      functions: List<FunctionDefinition>.unmodifiable(functions),
    );
  }

  /// Extracts catalog-local leaf data types from a JSON Schema `$defs` map.
  static Map<String, TypeDefinition> extractLeafTypes(
    Map<String, Object?> definitions, {
    Map<String, Object?>? rootDoc,
    bool atLeastV1 = true,
  }) {
    final result = <String, TypeDefinition>{};
    final active = <String>{
      for (final MapEntry<String, Object?> e in definitions.entries)
        if (!_reservedDefNames.contains(e.key) &&
            !_commonTypeNames.contains(e.key) &&
            isValidUax31Identifier(e.key) &&
            e.value is Map)
          e.key,
    };

    // Translate with `allowComponentTypes: true` so local aliases to
    // component-only types (e.g. `Action`, `ComponentId`) are recognized and
    // excluded from catalog-local leaf `types`.
    while (true) {
      result.clear();
      final excluded = <String>{};
      for (final name in active) {
        final Map<String, Object?>? defMap = _asStringMap(definitions[name]);
        if (defMap == null || _isComponentMixinDef(defMap)) {
          excluded.add(name);
          continue;
        }
        final decoder = _SchemaDecoder(
          definitions: definitions,
          rootDoc: rootDoc,
          knownTypeNames: active.difference({name}),
          atLeastV1: atLeastV1,
          allowComponentTypes: true,
        );
        final TypeDefinition translated = decoder.decode(defMap);
        if (translated.containsComponentOnlyType) {
          excluded.add(name);
        } else {
          result[name] = translated;
        }
      }
      if (excluded.isEmpty) break;
      active.removeAll(excluded);
    }
    return result;
  }

  /// Translates a `theme` JSON Schema into a [SurfacePropertiesDefinition].
  static SurfacePropertiesDefinition surfacePropertiesFromJsonSchema(
    Map<String, Object?> schema, {
    Map<String, Object?> definitions = const {},
    Map<String, Object?>? rootDoc,
    Map<String, TypeDefinition> knownTypes = const {},
    bool atLeastV1 = true,
  }) {
    if (_hasUnsupportedKeyword(schema)) {
      return SurfacePropertiesDefinition(
        description: _str(schema['description']),
        rawSchema: RawJsonSchemaType(deepCopyJsonMap(schema)),
      );
    }
    final decoder = _SchemaDecoder(
      definitions: definitions,
      rootDoc: rootDoc,
      knownTypeNames: knownTypes.keys.toSet(),
      atLeastV1: atLeastV1,
      allowComponentTypes: false,
    );
    final _FlattenedObject flat = decoder.flattenObject(
      schema,
      defaultOpen: true,
      allowCommonMixins: false,
    );
    return SurfacePropertiesDefinition(
      description: flat.description,
      properties: List<ParameterDefinition>.unmodifiable(
        decoder.decodeProperties(flat.properties, flat.required),
      ),
      additionalProperties: flat.additionalFlag,
      additionalPropertiesType: flat.additionalType,
    );
  }

  /// Translates a component JSON Schema into a [ComponentDefinition].
  static ComponentDefinition componentSchemaToDefinition(
    String name,
    Map<String, Object?> schema, {
    Map<String, Object?> definitions = const {},
    Map<String, Object?>? rootDoc,
    Map<String, TypeDefinition> knownTypes = const {},
    bool atLeastV1 = true,
    List<String>? allowedParents,
    List<String>? allowedChildren,
    Map<String, Object?>? metadata,
    bool isCheckableHint = false,
  }) {
    final decoder = _SchemaDecoder(
      definitions: definitions,
      rootDoc: rootDoc,
      knownTypeNames: knownTypes.keys.toSet(),
      atLeastV1: atLeastV1,
      allowComponentTypes: true,
    );
    final _FlattenedObject flat = decoder.flattenObject(
      schema,
      defaultOpen: true,
      allowCommonMixins: true,
    );

    bool isCheckable = isCheckableHint || flat.hasCheckableMixin;
    if (flat.properties.containsKey('@checks')) isCheckable = true;
    if (!atLeastV1 && _isStandardChecksProp(flat.properties['checks'])) {
      isCheckable = true;
    }

    // Inline component properties precede referenced mixin properties
    // (preserving Express positional argument order). Protocol envelopes are
    // excluded from `parameters`; v0.9 `ComponentCommon.accessibility` is not
    // synthesized into `parameters`.
    final parameters = <ParameterDefinition>[];
    for (final MapEntry<String, Map<String, Object?>> entry
        in flat.properties.entries) {
      final String propName = entry.key;
      final Map<String, Object?> propMap = entry.value;
      if (propName == 'component' ||
          propName == 'id' ||
          propName == '@catalogId' ||
          propName == '@metadata' ||
          propName == '@accessibility' ||
          propName == '@checks') {
        continue;
      }
      if (!atLeastV1 &&
          propName == 'checks' &&
          _isStandardChecksProp(propMap)) {
        continue;
      }
      parameters.add(
        ParameterDefinition(
          name: propName,
          required: flat.required.contains(propName),
          type: decoder.decode(propMap),
        ),
      );
    }

    return ComponentDefinition(
      name: name,
      description: flat.description,
      checkable: isCheckable,
      parameters: List<ParameterDefinition>.unmodifiable(parameters),
      atLeastOneOf: flat.atLeastOneOf.isEmpty
          ? null
          : List<List<String>>.unmodifiable(flat.atLeastOneOf),
      allowedParents: allowedParents ?? _stringList(schema['allowedParents']),
      allowedChildren:
          allowedChildren ?? _stringList(schema['allowedChildren']),
      metadata: metadata ?? _asStringMap(schema['metadata']),
      deprecated: flat.deprecated,
      deprecatedReason: flat.deprecatedReason,
      rawSchema: flat.hasUnsupportedRoot
          ? RawJsonSchemaType(deepCopyJsonMap(schema))
          : null,
    );
  }

  /// Translates a function's argument JSON Schema into a [FunctionDefinition].
  static FunctionDefinition functionSchemaToDefinition({
    required String name,
    required Map<String, Object?> argumentSchema,
    required A2uiReturnType returnType,
    String? description,
    AllowedCallers? allowedCallers,
    bool? requiresUserActivation,
    Map<String, Object?> definitions = const {},
    Map<String, Object?>? rootDoc,
    Map<String, TypeDefinition> knownTypes = const {},
    bool atLeastV1 = true,
  }) {
    final localDefs = <String, Object?>{
      ...definitions,
      ...?_asStringMap(argumentSchema[r'$defs']),
    };
    final decoder = _SchemaDecoder(
      definitions: localDefs,
      rootDoc: rootDoc,
      knownTypeNames: knownTypes.keys.toSet(),
      atLeastV1: atLeastV1,
      allowComponentTypes: false,
    );
    // Mirrors PayloadValidator._closePreV1ArgumentSchema: pre-v1.0 argument
    // schemas default closed unless they explicitly opt into open properties.
    final _FlattenedObject flat = decoder.flattenObject(
      argumentSchema,
      defaultOpen: atLeastV1,
      allowCommonMixins: false,
    );

    return FunctionDefinition(
      name: name,
      description: description ?? flat.description,
      returnType: FunctionReturnDefinition.shorthand(returnType),
      allowedCallers: allowedCallers,
      requiresUserActivation: requiresUserActivation,
      parameters: List<ParameterDefinition>.unmodifiable(
        decoder.decodeProperties(flat.properties, flat.required),
      ),
      atLeastOneOf: flat.atLeastOneOf.isEmpty
          ? null
          : List<List<String>>.unmodifiable(flat.atLeastOneOf),
      additionalParameters: flat.additionalFlag,
      additionalParametersType: flat.additionalType,
      deprecated: flat.deprecated,
      deprecatedReason: flat.deprecatedReason,
      rawArgumentSchema: flat.hasUnsupportedRoot
          ? RawJsonSchemaType(deepCopyJsonMap(argumentSchema))
          : null,
    );
  }

  /// Translates a single JSON Schema property/type map into a [TypeDefinition].
  static TypeDefinition schemaToTypeDefinition(
    Map<String, Object?> schema, {
    Map<String, Object?> definitions = const {},
    Map<String, Object?>? rootDoc,
    Set<String> knownTypeNames = const {},
    bool atLeastV1 = true,
    bool allowComponentTypes = true,
  }) => _SchemaDecoder(
    definitions: definitions,
    rootDoc: rootDoc,
    knownTypeNames: knownTypeNames,
    atLeastV1: atLeastV1,
    allowComponentTypes: allowComponentTypes,
  ).decode(schema);

  static FunctionDefinition _functionDefFromMap(
    String name,
    Map<String, Object?> fnMap, {
    required Map<String, Object?> definitions,
    required Map<String, Object?> rootDoc,
    required Map<String, TypeDefinition> knownTypes,
    required bool atLeastV1,
  }) {
    final Map<String, Object?>? props = _asStringMap(fnMap['properties']);
    final Map<String, Object?> argsSchema =
        _asStringMap(props?['args']) ??
        _asStringMap(fnMap['parameters']) ??
        const <String, Object?>{'type': 'object'};
    final Object? rawReturn =
        fnMap['returnType'] ?? _asStringMap(props?['returnType'])?['const'];
    final A2uiReturnType returnType = rawReturn is String
        ? A2uiReturnType.fromJson(rawReturn)
        : A2uiReturnType.any;
    final AllowedCallers? allowedCallers = fnMap['allowedCallers'] is String
        ? AllowedCallers.fromJson(fnMap['allowedCallers']! as String)
        : null;
    final bool? requiresUserActivation = fnMap['requiresUserActivation'] is bool
        ? fnMap['requiresUserActivation']! as bool
        : null;
    return functionSchemaToDefinition(
      name: name,
      argumentSchema: argsSchema,
      returnType: returnType,
      description: _str(fnMap['description']),
      allowedCallers: allowedCallers,
      requiresUserActivation: requiresUserActivation,
      definitions: definitions,
      rootDoc: rootDoc,
      knownTypes: knownTypes,
      atLeastV1: atLeastV1,
    );
  }

  // ---------------------------------------------------------------------------
  // CatalogModel -> JSON Schema
  // ---------------------------------------------------------------------------

  /// Emits a spec-compliant JSON Schema catalog document from [model].
  static Map<String, Object?> toJsonSchema(
    CatalogModel model, {
    A2uiProtocolVersion? protocolVersion,
  }) {
    final A2uiProtocolVersion? effectiveVersion =
        protocolVersion ?? model.protocolVersion;
    final bool atLeastV1 =
        effectiveVersion?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false;

    final componentsMap = <String, Object?>{
      for (final c in model.components)
        c.name: componentDefinitionToJsonSchema(c, atLeastV1: atLeastV1),
    };
    final functionsMap = <String, Object?>{
      for (final f in model.functions)
        f.name: functionDefinitionToJsonSchema(f, atLeastV1: atLeastV1),
    };
    final defs = <String, Object?>{
      if (model.components.isNotEmpty)
        'anyComponent': <String, Object?>{
          'oneOf': [
            for (final c in model.components)
              <String, Object?>{r'$ref': '#/components/${c.name}'},
          ],
          'discriminator': <String, Object?>{'propertyName': 'component'},
        },
      if (model.functions.isNotEmpty)
        'anyFunction': <String, Object?>{
          'oneOf': [
            for (final f in model.functions)
              <String, Object?>{r'$ref': '#/functions/${f.name}'},
          ],
        }
      else if (atLeastV1)
        'anyFunction': <String, Object?>{'not': <String, Object?>{}},
      if (model.surfaceProperties != null)
        'theme': surfacePropertiesToJsonSchema(
          model.surfaceProperties!,
          atLeastV1: atLeastV1,
        ),
      for (final MapEntry<String, TypeDefinition> e in model.types.entries)
        e.key: typeDefinitionToJsonSchema(e.value, atLeastV1: atLeastV1),
    };

    return <String, Object?>{
      r'$schema': _jsonSchemaDialect,
      r'$id': model.catalogId,
      if (effectiveVersion != null)
        'protocolVersion': effectiveVersion.semverValue,
      'title': ?model.title,
      'description': ?model.description,
      'catalogId': model.catalogId,
      'instructions': ?model.instructions,
      if (model.metadata != null) 'metadata': deepCopyJson(model.metadata),
      'components': componentsMap,
      if (functionsMap.isNotEmpty) 'functions': functionsMap,
      if (defs.isNotEmpty) r'$defs': defs,
    };
  }

  /// Emits a JSON Schema object for [surfaceProperties] (`theme`).
  static Map<String, Object?> surfacePropertiesToJsonSchema(
    SurfacePropertiesDefinition surfaceProperties, {
    bool atLeastV1 = true,
  }) {
    if (surfaceProperties.rawSchema != null) {
      return deepCopyJsonMap(surfaceProperties.rawSchema!.schema);
    }
    return _objectSchemaMap(
      properties: surfaceProperties.properties,
      additionalProperties: surfaceProperties.additionalProperties,
      additionalPropertiesType: surfaceProperties.additionalPropertiesType,
      atLeastOneOf: null,
      description: surfaceProperties.description,
      atLeastV1: atLeastV1,
    );
  }

  /// Emits a JSON Schema object for [component].
  static Map<String, Object?> componentDefinitionToJsonSchema(
    ComponentDefinition component, {
    bool atLeastV1 = true,
    bool includeEnvelope = true,
  }) {
    if (component.rawSchema != null) {
      return deepCopyJsonMap(component.rawSchema!.schema);
    }

    final hasCustomAccessibility = component.parameter('accessibility') != null;
    final bool includeV09ComponentCommon =
        !atLeastV1 && includeEnvelope && !hasCustomAccessibility;
    final bool needsExplicitV09Id =
        !atLeastV1 && includeEnvelope && hasCustomAccessibility;

    final properties = <String, Object?>{
      if (needsExplicitV09Id) 'id': <String, Object?>{'type': 'string'},
      if (includeEnvelope)
        'component': <String, Object?>{'const': component.name},
      for (final p in component.parameters)
        p.name: typeDefinitionToJsonSchema(p.type, atLeastV1: atLeastV1),
    };
    final required = <String>[
      if (needsExplicitV09Id) 'id',
      if (includeEnvelope) 'component',
      for (final p in component.parameters)
        if (p.required) p.name,
    ];
    final mixins = <Map<String, Object?>>[
      if (includeV09ComponentCommon)
        <String, Object?>{r'$ref': _commonRef('ComponentCommon')},
      if (component.checkable)
        <String, Object?>{r'$ref': _commonRef('Checkable')},
    ];

    final Map<String, Object?> result;
    if (mixins.isEmpty) {
      result = <String, Object?>{
        'type': 'object',
        'description': ?component.description,
        'properties': properties,
        if (required.isNotEmpty) 'required': required,
        ..._atLeastOneOfToJsonSchema(component.atLeastOneOf),
        if (!atLeastV1 && includeEnvelope) 'unevaluatedProperties': false,
      };
    } else {
      result = <String, Object?>{
        'type': 'object',
        'description': ?component.description,
        'allOf': <Object?>[
          ...mixins,
          <String, Object?>{
            'type': 'object',
            'properties': properties,
            if (required.isNotEmpty) 'required': required,
            ..._atLeastOneOfToJsonSchema(component.atLeastOneOf),
          },
        ],
        if (!atLeastV1 && includeEnvelope) 'unevaluatedProperties': false,
      };
    }

    return <String, Object?>{
      ...result,
      if (component.allowedParents != null)
        'allowedParents': List<String>.of(component.allowedParents!),
      if (component.allowedChildren != null)
        'allowedChildren': List<String>.of(component.allowedChildren!),
      if (component.metadata != null)
        'metadata': deepCopyJson(component.metadata),
      if (component.deprecated) 'deprecated': true,
      if (component.deprecatedReason != null)
        'x-deprecated-reason': component.deprecatedReason,
    };
  }

  /// Emits the `args` JSON Schema object of [function].
  static Map<String, Object?> functionDefinitionToArgumentSchema(
    FunctionDefinition function, {
    bool atLeastV1 = true,
  }) {
    if (function.rawArgumentSchema != null) {
      return deepCopyJsonMap(function.rawArgumentSchema!.schema);
    }
    return _objectSchemaMap(
      properties: function.parameters,
      additionalProperties: function.additionalParameters,
      additionalPropertiesType: function.additionalParametersType,
      atLeastOneOf: function.atLeastOneOf,
      description: null,
      atLeastV1: atLeastV1,
      omitEmptyProperties: false,
    );
  }

  /// Emits a full catalog `functions.<name>` JSON Schema object for [function].
  static Map<String, Object?> functionDefinitionToJsonSchema(
    FunctionDefinition function, {
    bool atLeastV1 = true,
  }) {
    final callKey = atLeastV1 ? '@call' : 'call';
    final Map<String, Object?> argsSchema = functionDefinitionToArgumentSchema(
      function,
      atLeastV1: atLeastV1,
    );
    final bool hasRequiredArgs =
        function.parameters.any((p) => p.required) ||
        (function.atLeastOneOf?.isNotEmpty ?? false);
    final required = <String>[callKey, if (hasRequiredArgs) 'args'];
    final callerMeta = <String, Object?>{
      if (function.declaredAllowedCallers != null)
        'allowedCallers': function.declaredAllowedCallers!.jsonValue,
      if (function.declaredRequiresUserActivation != null)
        'requiresUserActivation': function.declaredRequiresUserActivation,
    };

    if (atLeastV1) {
      return <String, Object?>{
        'type': 'object',
        'description': ?function.description,
        'returnType': function.returnType.returnType.jsonValue,
        ...callerMeta,
        'properties': <String, Object?>{
          callKey: <String, Object?>{'const': function.name},
          'args': argsSchema,
        },
        'required': required,
        if (function.deprecated) 'deprecated': true,
        if (function.deprecatedReason != null)
          'x-deprecated-reason': function.deprecatedReason,
      };
    }
    return <String, Object?>{
      'type': 'object',
      'description': ?function.description,
      ...callerMeta,
      'properties': <String, Object?>{
        callKey: <String, Object?>{'const': function.name},
        'args': argsSchema,
        'returnType': <String, Object?>{
          'const': function.returnType.returnType.jsonValue,
        },
      },
      'required': required,
      'unevaluatedProperties': false,
      if (function.deprecated) 'deprecated': true,
      if (function.deprecatedReason != null)
        'x-deprecated-reason': function.deprecatedReason,
    };
  }

  /// Emits a JSON Schema object for a single [TypeDefinition].
  static Map<String, Object?> typeDefinitionToJsonSchema(
    TypeDefinition type, {
    bool atLeastV1 = true,
  }) {
    final meta = <String, Object?>{
      'description': ?type.description,
      if (type.deprecated) 'deprecated': true,
      if (type.deprecatedReason != null)
        'x-deprecated-reason': type.deprecatedReason,
    };

    Map<String, Object?> wrapDynamic(
      Map<String, Object?> literal, {
      String? commonRefName,
    }) {
      if (commonRefName != null) {
        return <String, Object?>{
          r'$ref': _commonRef(commonRefName),
          ...meta,
          if (type.hasDefault) 'default': deepCopyJson(type.defaultValue),
        };
      }
      return <String, Object?>{
        ...meta,
        'oneOf': <Object?>[
          literal,
          <String, Object?>{r'$ref': _commonRef('DataBinding')},
          <String, Object?>{r'$ref': _commonRef('FunctionCall')},
        ],
        if (type.hasDefault) 'default': deepCopyJson(type.defaultValue),
      };
    }

    switch (type) {
      case StringType(
        :final dynamic,
        :final pattern,
        :final minLength,
        :final maxLength,
        :final defaultValue,
      ):
        final List<String> allFmts = type.allFormats;
        final bool unconstrained =
            allFmts.isEmpty &&
            pattern == null &&
            minLength == null &&
            maxLength == null;
        if (dynamic && unconstrained) {
          return wrapDynamic(const {}, commonRefName: 'DynamicString');
        }
        if (dynamic &&
            allFmts.length > 1 &&
            pattern == null &&
            minLength == null &&
            maxLength == null) {
          return <String, Object?>{
            ...meta,
            'allOf': <Object?>[
              <String, Object?>{r'$ref': _commonRef('DynamicString')},
              <String, Object?>{
                'if': <String, Object?>{'type': 'string'},
                'then': <String, Object?>{
                  'oneOf': <Object?>[
                    for (final f in allFmts) <String, Object?>{'format': f},
                  ],
                },
              },
            ],
            'default': ?defaultValue,
          };
        }
        final literal = <String, Object?>{
          'type': 'string',
          if (allFmts.length == 1) 'format': allFmts.single,
          if (allFmts.length > 1)
            'oneOf': <Object?>[
              for (final f in allFmts) <String, Object?>{'format': f},
            ],
          'pattern': ?pattern,
          'minLength': ?minLength,
          'maxLength': ?maxLength,
        };
        if (dynamic) return wrapDynamic(literal);
        return <String, Object?>{...literal, ...meta, 'default': ?defaultValue};

      case NumberType(
        :final dynamic,
        :final min,
        :final max,
        :final defaultValue,
      ):
        if (dynamic && min == null && max == null) {
          return wrapDynamic(const {}, commonRefName: 'DynamicNumber');
        }
        final literal = <String, Object?>{
          'type': 'number',
          'minimum': ?min,
          'maximum': ?max,
        };
        if (dynamic) return wrapDynamic(literal);
        return <String, Object?>{...literal, ...meta, 'default': ?defaultValue};

      case IntegerType(
        :final dynamic,
        :final min,
        :final max,
        :final defaultValue,
      ):
        final literal = <String, Object?>{
          'type': 'integer',
          'minimum': ?min,
          'maximum': ?max,
        };
        if (dynamic) return wrapDynamic(literal);
        return <String, Object?>{...literal, ...meta, 'default': ?defaultValue};

      case BooleanType(:final dynamic, :final defaultValue):
        if (dynamic) {
          return wrapDynamic(const {}, commonRefName: 'DynamicBoolean');
        }
        return <String, Object?>{
          'type': 'boolean',
          ...meta,
          'default': ?defaultValue,
        };

      case EnumType(
        :final values,
        :final declaredValueType,
        :final dynamic,
        :final defaultValue,
      ):
        final literal = <String, Object?>{
          if (declaredValueType != null) 'type': declaredValueType.jsonValue,
          'enum': List<Object>.of(values),
        };
        if (dynamic) return wrapDynamic(literal);
        return <String, Object?>{...literal, ...meta, 'default': ?defaultValue};

      case ConstType(:final value):
        return <String, Object?>{'const': value, ...meta};

      case AnyType(
        :final dynamic,
        :final nullable,
        :final hasDefault,
        :final defaultValue,
      ):
        if (dynamic && !nullable) {
          return <String, Object?>{
            r'$ref': _commonRef('DynamicValue'),
            ...meta,
            if (hasDefault) 'default': deepCopyJson(defaultValue),
          };
        }
        if (!dynamic && !nullable) {
          return <String, Object?>{
            'not': <String, Object?>{'type': 'null'},
            ...meta,
            if (hasDefault) 'default': deepCopyJson(defaultValue),
          };
        }
        if (!dynamic && nullable) {
          return <String, Object?>{
            'type': List<String>.of(_allJsonTypes),
            ...meta,
            if (hasDefault) 'default': deepCopyJson(defaultValue),
          };
        }
        return <String, Object?>{
          ...meta,
          if (hasDefault) 'default': deepCopyJson(defaultValue),
        };

      case ObjectType(
        :final dynamic,
        :final properties,
        :final additionalProperties,
        :final additionalPropertiesType,
        :final atLeastOneOf,
        :final defaultValue,
      ):
        final Map<String, Object?> literal = _objectSchemaMap(
          properties: properties,
          additionalProperties: additionalProperties,
          additionalPropertiesType: additionalPropertiesType,
          atLeastOneOf: atLeastOneOf,
          description: null,
          atLeastV1: atLeastV1,
        );
        if (dynamic) return wrapDynamic(literal);
        return <String, Object?>{
          ...literal,
          ...meta,
          if (defaultValue != null) 'default': deepCopyJson(defaultValue),
        };

      case ArrayType(
        :final dynamic,
        :final items,
        :final minItems,
        :final maxItems,
        :final uniqueItems,
        :final defaultValue,
      ):
        final bool isDynamicStringList =
            dynamic &&
            items is StringType &&
            !items.dynamic &&
            items.allFormats.isEmpty &&
            items.pattern == null &&
            items.minLength == null &&
            items.maxLength == null &&
            minItems == null &&
            maxItems == null &&
            !uniqueItems;
        if (isDynamicStringList) {
          return wrapDynamic(const {}, commonRefName: 'DynamicStringList');
        }
        final literal = <String, Object?>{
          'type': 'array',
          if (items != null)
            'items': typeDefinitionToJsonSchema(items, atLeastV1: atLeastV1),
          'minItems': ?minItems,
          'maxItems': ?maxItems,
          if (uniqueItems) 'uniqueItems': true,
        };
        if (dynamic) return wrapDynamic(literal);
        return <String, Object?>{
          ...literal,
          ...meta,
          if (defaultValue != null) 'default': deepCopyJson(defaultValue),
        };

      case UnionType(
        :final variants,
        :final exclusive,
        :final dynamic,
        :final hasDefault,
        :final defaultValue,
      ):
        final branches = <Object?>[
          for (final v in variants)
            typeDefinitionToJsonSchema(v, atLeastV1: atLeastV1),
          if (dynamic) <String, Object?>{r'$ref': _commonRef('DataBinding')},
          if (dynamic) <String, Object?>{r'$ref': _commonRef('FunctionCall')},
        ];
        return <String, Object?>{
          ...meta,
          exclusive ? 'oneOf' : 'anyOf': branches,
          if (hasDefault) 'default': deepCopyJson(defaultValue),
        };

      case RefType(:final ref, :final hasDefault, :final defaultValue):
        return <String, Object?>{
          r'$ref': '#/${r'$defs'}/$ref',
          ...meta,
          if (hasDefault) 'default': deepCopyJson(defaultValue),
        };

      case DataBindingType():
        return <String, Object?>{r'$ref': _commonRef('DataBinding'), ...meta};
      case FunctionCallType():
        return <String, Object?>{r'$ref': _commonRef('FunctionCall'), ...meta};
      case ChildType():
        return <String, Object?>{
          r'$ref': _commonRef(atLeastV1 ? 'Child' : 'ComponentId'),
          ...meta,
        };
      case ChildListType():
        return <String, Object?>{r'$ref': _commonRef('ChildList'), ...meta};
      case ActionType():
        return <String, Object?>{r'$ref': _commonRef('Action'), ...meta};
      case CheckRuleType():
        return <String, Object?>{r'$ref': _commonRef('CheckRule'), ...meta};
      case AccessibilityType():
        return <String, Object?>{
          r'$ref': _commonRef('AccessibilityAttributes'),
          ...meta,
        };
      case RawJsonSchemaType(:final schema):
        return deepCopyJsonMap(schema);
    }
  }

  static Map<String, Object?> _objectSchemaMap({
    required List<ParameterDefinition> properties,
    required bool additionalProperties,
    required TypeDefinition? additionalPropertiesType,
    required List<List<String>>? atLeastOneOf,
    required String? description,
    required bool atLeastV1,
    bool omitEmptyProperties = true,
  }) {
    final propsMap = <String, Object?>{
      for (final p in properties)
        p.name: typeDefinitionToJsonSchema(p.type, atLeastV1: atLeastV1),
    };
    final required = <String>[
      for (final p in properties)
        if (p.required) p.name,
    ];
    return <String, Object?>{
      'type': 'object',
      'description': ?description,
      if (!omitEmptyProperties || propsMap.isNotEmpty) 'properties': propsMap,
      if (required.isNotEmpty) 'required': required,
      ..._atLeastOneOfToJsonSchema(atLeastOneOf),
      'additionalProperties': additionalPropertiesType != null
          ? typeDefinitionToJsonSchema(
              additionalPropertiesType,
              atLeastV1: atLeastV1,
            )
          : additionalProperties,
    };
  }

  static String _commonRef(String name) =>
      'common_types.json#/${r'$defs'}/$name';

  static Map<String, Object?> _atLeastOneOfToJsonSchema(
    List<List<String>>? groups,
  ) {
    if (groups == null || groups.isEmpty) return const {};
    Map<String, Object?> anyOfGroup(List<String> names) => <String, Object?>{
      'anyOf': <Object?>[
        for (final n in names)
          <String, Object?>{
            'required': <String>[n],
          },
      ],
    };
    if (groups.length == 1) return anyOfGroup(groups.single);
    return <String, Object?>{
      'allOf': <Object?>[for (final g in groups) anyOfGroup(g)],
    };
  }

  static List<String>? _extractAtLeastOneOfGroup(List<Object?> anyOfList) {
    if (anyOfList.isEmpty) return null;
    final names = <String>[];
    for (final branch in anyOfList) {
      final Map<String, Object?>? map = _asStringMap(branch);
      if (map == null || map.length != 1) return null;
      final Object? req = map['required'];
      if (req is! List || req.length != 1 || req.single is! String) return null;
      names.add(req.single! as String);
    }
    return List<String>.unmodifiable(names);
  }

  static List<String>? _extractFormatUnion(List<Object?> oneOfList) {
    if (oneOfList.isEmpty) return null;
    final formats = <String>[];
    for (final b in oneOfList) {
      final Map<String, Object?>? bm = _asStringMap(b);
      if (bm == null || bm.length != 1 || bm['format'] is! String) return null;
      formats.add(bm['format']! as String);
    }
    return List<String>.unmodifiable(formats);
  }

  static String? _rawRef(Map<String, Object?> schema) =>
      _str(schema['commonTypesRef']) ?? _str(schema[r'$ref']);

  static String? _commonTypeNameFromRef(String ref) {
    final int hash = ref.indexOf('#');
    if (hash <= 0) return null;
    final String doc = ref.substring(0, hash);
    final String fragment = ref.substring(hash);
    if (!doc.endsWith('common_types.json') ||
        !fragment.startsWith(r'#/$defs/')) {
      return null;
    }
    final String name = fragment.substring(8);
    return name.contains('/') ? null : name;
  }

  static String? _localDefName(String ref) {
    if (!ref.startsWith(r'#/$defs/')) return null;
    final String name = ref.substring(8);
    return name.contains('/') ? null : name;
  }

  static bool _isComponentMixinDef(Map<String, Object?> defMap) {
    if (defMap['allOf'] is List) return true;
    final Map<String, Object?>? props = _asStringMap(defMap['properties']);
    return props != null && props.containsKey('component');
  }

  static bool _isStandardChecksProp(Map<String, Object?>? prop) {
    if (prop == null) return false;
    final String? ref = _rawRef(prop);
    if (ref != null &&
        (ref.endsWith('/Checkable') || ref.endsWith('/CheckRule'))) {
      return true;
    }
    if (prop['type'] != 'array') return false;
    final Map<String, Object?>? items = _asStringMap(prop['items']);
    if (items == null) return true;
    final String? itemRef = _rawRef(items);
    if (itemRef != null && itemRef.endsWith('/CheckRule')) return true;
    final Map<String, Object?>? itemProps = _asStringMap(items['properties']);
    return itemProps != null &&
        itemProps.containsKey('condition') &&
        itemProps.containsKey('message');
  }

  static bool _hasUnsupportedKeyword(Map<String, Object?> schema) =>
      _unsupportedKeywords.any(schema.containsKey);

  static Map<String, Object?>? _asStringMap(Object? value) {
    if (value is Map<String, Object?>) return value;
    if (value is Map) {
      return <String, Object?>{
        for (final MapEntry<Object?, Object?> e in value.entries)
          if (e.key is String) e.key! as String: e.value,
      };
    }
    return null;
  }

  static String? _str(Object? v) => v is String ? v : null;
  static int? _int(Object? v) => v is int ? v : null;
  static num? _num(Object? v) => v is num ? v : null;

  static List<String>? _stringList(Object? value) {
    if (value is! List) return null;
    return List<String>.unmodifiable([
      for (final Object? item in value)
        if (item is String) item,
    ]);
  }

  static Set<String> _stringSet(Object? value) {
    if (value is! List) return const {};
    return {
      for (final Object? item in value)
        if (item is String) item,
    };
  }
}

// -----------------------------------------------------------------------------
// Stateful JSON Schema decoder with push/pop cycle guards
// -----------------------------------------------------------------------------

typedef _TypeMeta = ({
  String? description,
  String? embeddedRef,
  bool deprecated,
  String? deprecatedReason,
  bool hasDefault,
  Object? defaultValue,
});

typedef _FlattenedObject = ({
  Map<String, Map<String, Object?>> properties,
  Set<String> required,
  List<List<String>> atLeastOneOf,
  bool additionalFlag,
  TypeDefinition? additionalType,
  bool hasCheckableMixin,
  bool hasUnsupportedRoot,
  String? description,
  bool deprecated,
  String? deprecatedReason,
});

final class _SchemaDecoder {
  _SchemaDecoder({
    required this.definitions,
    required Map<String, Object?>? rootDoc,
    required this.knownTypeNames,
    required this.atLeastV1,
    required this.allowComponentTypes,
  }) : effectiveRoot = rootDoc ?? <String, Object?>{r'$defs': definitions};

  final Map<String, Object?> definitions;
  final Map<String, Object?> effectiveRoot;
  final Set<String> knownTypeNames;
  final bool atLeastV1;
  final bool allowComponentTypes;
  final Set<String> _visitedRefs = <String>{};
  final Set<Object> _visitedMaps = Set<Object>.identity();

  List<ParameterDefinition> decodeProperties(
    Map<String, Map<String, Object?>> props,
    Set<String> required,
  ) => [
    for (final MapEntry<String, Map<String, Object?>> e in props.entries)
      ParameterDefinition(
        name: e.key,
        required: required.contains(e.key),
        type: decode(e.value),
      ),
  ];

  /// Flattens an object schema across `allOf` and local `$ref` mixins.
  ///
  /// Inline object properties (from [schema] and inline `allOf` members) are
  /// ordered before `$ref` mixin properties (such as `CatalogComponentCommon`),
  /// and explicit `additionalProperties` / `unevaluatedProperties` rules from
  /// any subschema are honored.
  _FlattenedObject flattenObject(
    Map<String, Object?> schema, {
    required bool defaultOpen,
    required bool allowCommonMixins,
  }) {
    var hasCheckableMixin = false;
    final inlineSubs = <Map<String, Object?>>[];
    final mixinSubs = <Map<String, Object?>>[];
    final seenRefs = <String>{};
    final seenMaps = Set<Object>.identity();

    void collect(Map<String, Object?> node, {required bool isMixin}) {
      if (!seenMaps.add(node)) return;
      final String? ref = JsonSchemaCodec._rawRef(node);
      if (ref != null) {
        final String? commonName = JsonSchemaCodec._commonTypeNameFromRef(ref);
        if (allowCommonMixins && commonName == 'Checkable') {
          hasCheckableMixin = true;
          return;
        }
        if (allowCommonMixins && commonName == 'ComponentCommon') {
          return;
        }
        if (ref.startsWith('#/') && seenRefs.add(ref)) {
          final Map<String, Object?>? target = _resolvePointer(ref);
          if (target != null) {
            collect(target, isMixin: true);
            return;
          }
        }
      }
      if (node['allOf'] case final List<Object?> members) {
        for (final m in members) {
          if (JsonSchemaCodec._asStringMap(m) case final mMap?) {
            collect(mMap, isMixin: isMixin);
          }
        }
      }
      (isMixin ? mixinSubs : inlineSubs).add(node);
    }

    collect(schema, isMixin: false);

    // Inline properties first, followed by referenced mixin properties
    // (without overriding component-declared properties).
    final orderedSubs = <Map<String, Object?>>[...inlineSubs, ...mixinSubs];
    var hasUnsupportedRoot = false;
    final mergedProps = <String, Map<String, Object?>>{};
    final requiredSet = <String>{};
    final atLeastOneOf = <List<String>>[];
    String? description;
    var deprecated = false;
    String? deprecatedReason;

    for (final sub in orderedSubs) {
      if (sub['description'] is String && sub['commonTypesRef'] == null) {
        description ??= sub['description']! as String;
      }
      if (sub['deprecated'] == true) deprecated = true;
      if (sub['x-deprecated-reason'] is String) {
        deprecatedReason ??= sub['x-deprecated-reason']! as String;
      }
      if (JsonSchemaCodec._hasUnsupportedKeyword(sub) ||
          sub.containsKey('oneOf')) {
        hasUnsupportedRoot = true;
      }
      if (sub['anyOf'] case final List<Object?> anyOfList) {
        final List<String>? group = JsonSchemaCodec._extractAtLeastOneOfGroup(
          anyOfList,
        );
        if (group != null) {
          atLeastOneOf.add(group);
        } else {
          hasUnsupportedRoot = true;
        }
      }
      if (JsonSchemaCodec._asStringMap(sub['properties']) case final props?) {
        for (final MapEntry<String, Object?> e in props.entries) {
          mergedProps.putIfAbsent(
            e.key,
            () => JsonSchemaCodec._asStringMap(e.value) ?? const {},
          );
        }
      }
      requiredSet.addAll(JsonSchemaCodec._stringSet(sub['required']));
    }
    if (schema['description'] is String) {
      description = schema['description']! as String;
    }

    // Extract additionalProperties / unevaluatedProperties across all
    // subschemas, giving the outer schema first precedence.
    var additionalFlag = defaultOpen;
    TypeDefinition? additionalType;
    var foundAdditional = false;
    for (final sub in <Map<String, Object?>>[schema, ...orderedSubs]) {
      final Object? ap = sub.containsKey('additionalProperties')
          ? sub['additionalProperties']
          : sub['unevaluatedProperties'];
      if (ap == null) continue;
      if (ap is bool) {
        if (!foundAdditional || !ap) {
          additionalFlag = ap;
          additionalType = null;
          foundAdditional = true;
        }
      } else if (JsonSchemaCodec._asStringMap(ap) case final apMap?) {
        if (!foundAdditional) {
          additionalFlag = false;
          additionalType = decode(apMap);
          foundAdditional = true;
        }
      }
    }

    return (
      properties: mergedProps,
      required: requiredSet,
      atLeastOneOf: atLeastOneOf,
      additionalFlag: additionalFlag,
      additionalType: additionalType,
      hasCheckableMixin: hasCheckableMixin,
      hasUnsupportedRoot: hasUnsupportedRoot,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
    );
  }

  TypeDefinition decode(Map<String, Object?> schema) {
    final _TypeMeta meta = _extractMeta(schema);
    if (!_visitedMaps.add(schema)) return _raw(schema, meta);
    try {
      return _decodeBody(schema, meta);
    } finally {
      _visitedMaps.remove(schema);
    }
  }

  TypeDefinition _decodeBody(Map<String, Object?> schema, _TypeMeta meta) {
    // 1. `$ref` / `commonTypesRef` / `catalogDefRef` / embedded `REF:`.
    final String? rawRef =
        meta.embeddedRef ??
        JsonSchemaCodec._str(schema['catalogDefRef']) ??
        JsonSchemaCodec._rawRef(schema);
    if (rawRef != null) {
      return _decodeRef(rawRef, schema, meta);
    }

    // 2. `allOf`: constrained DynamicString, v0.9 FunctionCall specialization,
    //    single-element wrapper, or merged plain object.
    if (schema['allOf'] case final List<Object?> allOfList) {
      if (_tryConstrainedDynamicString(allOfList, meta) case final st?) {
        return st;
      }
      if (_tryFunctionCallAllOf(allOfList, meta) case final fc?) {
        return fc;
      }
      if (allOfList.length == 1) {
        if (JsonSchemaCodec._asStringMap(allOfList.first) case final single?) {
          return decode(_mergeMeta(single, meta));
        }
      }
      if (_tryMergeAllOfObject(schema, allOfList, meta) case final obj?) {
        return obj;
      }
      return _raw(schema, meta);
    }

    // 3. Recognize `AnyType(dynamic: false, nullable: false)` encoded as
    //    `{"not": {"type": "null"}}` before generic unsupported-keyword check.
    if (_isNotNullSchema(schema)) {
      return AnyType(
        defaultValue: meta.hasDefault
            ? deepCopyJson(meta.defaultValue, unmodifiable: true)
            : noDefaultValue,
        description: meta.description,
        deprecated: meta.deprecated,
        deprecatedReason: meta.deprecatedReason,
      );
    }

    // 4. Unsupported exotic keywords -> RawJsonSchemaType.
    if (JsonSchemaCodec._hasUnsupportedKeyword(schema)) {
      return _raw(schema, meta);
    }

    // 5. `const`.
    if (schema.containsKey('const')) {
      final Object? val = schema['const'];
      if (val == null || val is String || val is num || val is bool) {
        return ConstType(
          value: val,
          description: meta.description,
          deprecated: meta.deprecated,
          deprecatedReason: meta.deprecatedReason,
        );
      }
      return _raw(schema, meta);
    }

    // 6. `enum`.
    if (schema['enum'] case final List<Object?> rawEnum) {
      if (rawEnum.isNotEmpty &&
          rawEnum.every((v) => v is String || v is num || v is bool)) {
        final EnumValueType? vt = switch (schema['type']) {
          'string' => EnumValueType.string,
          'number' || 'integer' => EnumValueType.number,
          'boolean' => EnumValueType.boolean,
          _ => null,
        };
        return EnumType(
          values: List<Object>.unmodifiable(rawEnum.cast<Object>()),
          valueType: vt,
          defaultValue: meta.defaultValue,
          description: meta.description,
          deprecated: meta.deprecated,
          deprecatedReason: meta.deprecatedReason,
        );
      }
      return _raw(schema, meta);
    }

    // 7. Special structured forms that legitimately carry `oneOf`/`anyOf`:
    //    (a) `type: "string"` with `oneOf: [{format: ...}, ...]`
    //    (b) `type: "object"` with `anyOf: [{required: [a]}, ...]`
    if (schema['type'] == 'string' && schema['oneOf'] is List) {
      final List<String>? fmts = JsonSchemaCodec._extractFormatUnion(
        schema['oneOf']! as List<Object?>,
      );
      if (fmts != null) {
        return StringType(
          format: fmts.length == 1 ? fmts.single : null,
          formats: fmts.length > 1 ? fmts : null,
          pattern: JsonSchemaCodec._str(schema['pattern']),
          minLength: JsonSchemaCodec._int(schema['minLength']),
          maxLength: JsonSchemaCodec._int(schema['maxLength']),
          defaultValue: meta.defaultValue is String
              ? meta.defaultValue! as String
              : null,
          description: meta.description,
          deprecated: meta.deprecated,
          deprecatedReason: meta.deprecatedReason,
        );
      }
    }

    final bool isObjectWithAtLeastOneOf =
        (schema['type'] == 'object' ||
            schema.containsKey('properties') ||
            schema.containsKey('additionalProperties')) &&
        schema['anyOf'] is List &&
        JsonSchemaCodec._extractAtLeastOneOfGroup(
              schema['anyOf']! as List<Object?>,
            ) !=
            null;

    // 8. Generic `oneOf` / `anyOf` unions.
    if (!isObjectWithAtLeastOneOf) {
      final isOneOf = schema['oneOf'] is List;
      final Object? unionRaw = isOneOf ? schema['oneOf'] : schema['anyOf'];
      if (unionRaw is List && unionRaw.isNotEmpty) {
        return _decodeUnion(unionRaw, exclusive: isOneOf, meta: meta);
      }
    }

    // 9. `type` array (e.g. `["boolean", "object"]` or all-6-types AnyType).
    final Object? rawType = schema['type'];
    if (rawType is List) {
      if (_isAllJsonTypesList(rawType)) {
        return AnyType(
          nullable: true,
          defaultValue: meta.hasDefault
              ? deepCopyJson(meta.defaultValue, unmodifiable: true)
              : noDefaultValue,
          description: meta.description,
          deprecated: meta.deprecated,
          deprecatedReason: meta.deprecatedReason,
        );
      }
      final variants = <TypeDefinition>[];
      for (final Object? entry in rawType) {
        if (entry == 'null') {
          variants.add(const ConstType(value: null));
        } else if (entry is String) {
          final sub = <String, Object?>{...schema, 'type': entry}
            ..remove('description')
            ..remove('default');
          variants.add(decode(sub));
        }
      }
      if (variants.length == 1) return variants.single;
      if (variants.length >= 2) {
        return UnionType(
          variants: List<TypeDefinition>.unmodifiable(variants),
          defaultValue: meta.hasDefault
              ? deepCopyJson(meta.defaultValue, unmodifiable: true)
              : noDefaultValue,
          description: meta.description,
          deprecated: meta.deprecated,
          deprecatedReason: meta.deprecatedReason,
        );
      }
    }

    // 10. Scalar / array / object / null / unconstrained `{}`.
    final String? typeStr = rawType is String
        ? rawType
        : (schema.containsKey('properties') ||
                  schema.containsKey('additionalProperties')
              ? 'object'
              : schema.containsKey('items')
              ? 'array'
              : null);

    switch (typeStr) {
      case 'string':
        return StringType(
          format: JsonSchemaCodec._str(schema['format']),
          pattern: JsonSchemaCodec._str(schema['pattern']),
          minLength: JsonSchemaCodec._int(schema['minLength']),
          maxLength: JsonSchemaCodec._int(schema['maxLength']),
          defaultValue: meta.defaultValue is String
              ? meta.defaultValue! as String
              : null,
          description: meta.description,
          deprecated: meta.deprecated,
          deprecatedReason: meta.deprecatedReason,
        );
      case 'number':
        return NumberType(
          min: JsonSchemaCodec._num(schema['minimum']),
          max: JsonSchemaCodec._num(schema['maximum']),
          defaultValue: meta.defaultValue is num
              ? meta.defaultValue! as num
              : null,
          description: meta.description,
          deprecated: meta.deprecated,
          deprecatedReason: meta.deprecatedReason,
        );
      case 'integer':
        return IntegerType(
          min: JsonSchemaCodec._int(schema['minimum']),
          max: JsonSchemaCodec._int(schema['maximum']),
          defaultValue: meta.defaultValue is int
              ? meta.defaultValue! as int
              : null,
          description: meta.description,
          deprecated: meta.deprecated,
          deprecatedReason: meta.deprecatedReason,
        );
      case 'boolean':
        return BooleanType(
          defaultValue: meta.defaultValue is bool
              ? meta.defaultValue! as bool
              : null,
          description: meta.description,
          deprecated: meta.deprecated,
          deprecatedReason: meta.deprecatedReason,
        );
      case 'array':
        final Map<String, Object?>? itemsMap = JsonSchemaCodec._asStringMap(
          schema['items'],
        );
        return ArrayType(
          items: itemsMap == null ? null : decode(itemsMap),
          minItems: JsonSchemaCodec._int(schema['minItems']),
          maxItems: JsonSchemaCodec._int(schema['maxItems']),
          uniqueItems: schema['uniqueItems'] == true,
          defaultValue: meta.defaultValue is List
              ? (deepCopyJson(meta.defaultValue, unmodifiable: true)!
                    as List<Object?>)
              : null,
          description: meta.description,
          deprecated: meta.deprecated,
          deprecatedReason: meta.deprecatedReason,
        );
      case 'object':
        final Map<String, Object?> propsMap =
            JsonSchemaCodec._asStringMap(schema['properties']) ?? const {};
        final Set<String> reqSet = JsonSchemaCodec._stringSet(
          schema['required'],
        );
        final properties = <ParameterDefinition>[
          for (final MapEntry<String, Object?> e in propsMap.entries)
            ParameterDefinition(
              name: e.key,
              required: reqSet.contains(e.key),
              type: decode(JsonSchemaCodec._asStringMap(e.value) ?? const {}),
            ),
        ];
        final List<String>? atLeastGroup = schema['anyOf'] is List
            ? JsonSchemaCodec._extractAtLeastOneOfGroup(
                schema['anyOf']! as List<Object?>,
              )
            : null;
        final (:bool flag, :TypeDefinition? type) = _extractAdditional(
          schema,
          defaultOpen: true,
        );
        final Map<String, Object?>? defMap = JsonSchemaCodec._asStringMap(
          meta.defaultValue,
        );
        return ObjectType(
          properties: List<ParameterDefinition>.unmodifiable(properties),
          additionalProperties: flag,
          additionalPropertiesType: type,
          atLeastOneOf: atLeastGroup == null
              ? null
              : List<List<String>>.unmodifiable([atLeastGroup]),
          defaultValue: defMap == null
              ? null
              : deepCopyJsonMap(defMap, unmodifiable: true),
          description: meta.description,
          deprecated: meta.deprecated,
          deprecatedReason: meta.deprecatedReason,
        );
      case 'null':
        return ConstType(
          value: null,
          description: meta.description,
          deprecated: meta.deprecated,
          deprecatedReason: meta.deprecatedReason,
        );
      default:
        final bool hasNonMeta = schema.keys.any(
          (k) => !JsonSchemaCodec._metadataOnlyKeywords.contains(k),
        );
        if (hasNonMeta) return _raw(schema, meta);
        return AnyType(
          dynamic: true,
          nullable: true,
          defaultValue: meta.hasDefault
              ? deepCopyJson(meta.defaultValue, unmodifiable: true)
              : noDefaultValue,
          description: meta.description,
          deprecated: meta.deprecated,
          deprecatedReason: meta.deprecatedReason,
        );
    }
  }

  TypeDefinition _decodeRef(
    String rawRef,
    Map<String, Object?> schema,
    _TypeMeta meta,
  ) {
    final String? commonName = JsonSchemaCodec._commonTypeNameFromRef(rawRef);
    if (commonName != null &&
        !knownTypeNames.contains(commonName) &&
        !definitions.containsKey(commonName)) {
      final TypeDefinition? common = _commonType(commonName, meta);
      if (common != null) return common;
    }

    if (JsonSchemaCodec._localDefName(rawRef) case final defName?) {
      if (knownTypeNames.contains(defName)) {
        return RefType(
          ref: defName,
          defaultValue: meta.hasDefault
              ? deepCopyJson(meta.defaultValue, unmodifiable: true)
              : noDefaultValue,
          description: meta.description,
          deprecated: meta.deprecated,
          deprecatedReason: meta.deprecatedReason,
        );
      }
      if (JsonSchemaCodec._commonTypeNames.contains(defName) &&
          !definitions.containsKey(defName)) {
        final TypeDefinition? common = _commonType(defName, meta);
        if (common != null) return common;
      }
    }

    if (rawRef.startsWith('#/')) {
      if (!_visitedRefs.add(rawRef)) return _raw(schema, meta);
      try {
        final Map<String, Object?>? target = _resolvePointer(rawRef);
        if (target != null) return decode(_mergeMeta(target, meta));
      } finally {
        _visitedRefs.remove(rawRef);
      }
    }
    return _raw(schema, meta);
  }

  TypeDefinition _decodeUnion(
    List<Object?> branches, {
    required bool exclusive,
    required _TypeMeta meta,
  }) {
    final translated = <TypeDefinition>[];
    var hasBinding = false;
    var hasCall = false;
    final valueBranches = <TypeDefinition>[];

    for (final rawBranch in branches) {
      final Map<String, Object?>? branchMap = JsonSchemaCodec._asStringMap(
        rawBranch,
      );
      if (branchMap == null) continue;
      final TypeDefinition bt = decode(branchMap);
      translated.add(bt);
      if (bt is DataBindingType) {
        hasBinding = true;
      } else if (bt is FunctionCallType) {
        hasCall = true;
      } else {
        valueBranches.add(bt);
      }
    }

    if (hasBinding && hasCall && valueBranches.isNotEmpty) {
      if (valueBranches.length == 1) {
        final TypeDefinition? collapsed = _withDynamic(
          valueBranches.single,
          meta,
        );
        if (collapsed != null) return collapsed;
      } else {
        return UnionType(
          variants: List<TypeDefinition>.unmodifiable(valueBranches),
          exclusive: exclusive,
          dynamic: true,
          defaultValue: meta.hasDefault
              ? deepCopyJson(meta.defaultValue, unmodifiable: true)
              : noDefaultValue,
          description: meta.description,
          deprecated: meta.deprecated,
          deprecatedReason: meta.deprecatedReason,
        );
      }
    }

    if (translated.length == 1) return translated.single;
    return UnionType(
      variants: List<TypeDefinition>.unmodifiable(translated),
      exclusive: exclusive,
      defaultValue: meta.hasDefault
          ? deepCopyJson(meta.defaultValue, unmodifiable: true)
          : noDefaultValue,
      description: meta.description,
      deprecated: meta.deprecated,
      deprecatedReason: meta.deprecatedReason,
    );
  }

  /// Recognizes `allOf: [DynamicString, {if: {type: string}, then: ...}]`.
  StringType? _tryConstrainedDynamicString(
    List<Object?> allOf,
    _TypeMeta meta,
  ) {
    if (allOf.length != 2) return null;
    final Map<String, Object?>? first = JsonSchemaCodec._asStringMap(allOf[0]);
    final Map<String, Object?>? second = JsonSchemaCodec._asStringMap(allOf[1]);
    if (first == null || second == null) return null;
    final String? ref = JsonSchemaCodec._rawRef(first);
    if (ref == null ||
        JsonSchemaCodec._commonTypeNameFromRef(ref) != 'DynamicString') {
      return null;
    }
    final Map<String, Object?>? ifMap = JsonSchemaCodec._asStringMap(
      second['if'],
    );
    final Map<String, Object?>? thenMap = JsonSchemaCodec._asStringMap(
      second['then'],
    );
    if (ifMap == null || thenMap == null || ifMap['type'] != 'string') {
      return null;
    }
    String? singleFmt = JsonSchemaCodec._str(thenMap['format']);
    List<String>? multiFmts;
    if (thenMap['oneOf'] case final List<Object?> branches) {
      final List<String>? fmts = JsonSchemaCodec._extractFormatUnion(branches);
      if (fmts == null) return null;
      if (fmts.length == 1) {
        singleFmt = fmts.single;
      } else {
        multiFmts = fmts;
      }
    }
    final String? pattern = JsonSchemaCodec._str(thenMap['pattern']);
    final int? minLen = JsonSchemaCodec._int(thenMap['minLength']);
    final int? maxLen = JsonSchemaCodec._int(thenMap['maxLength']);
    if (singleFmt == null &&
        multiFmts == null &&
        pattern == null &&
        minLen == null &&
        maxLen == null) {
      return null;
    }
    return StringType(
      dynamic: true,
      format: multiFmts == null ? singleFmt : null,
      formats: multiFmts,
      pattern: pattern,
      minLength: minLen,
      maxLength: maxLen,
      defaultValue: meta.defaultValue is String
          ? meta.defaultValue! as String
          : null,
      description: meta.description,
      deprecated: meta.deprecated,
      deprecatedReason: meta.deprecatedReason,
    );
  }

  /// Recognizes v0.9/v0.9.1 `allOf: [FunctionCall, {properties: {returnType: ...}}]`.
  FunctionCallType? _tryFunctionCallAllOf(List<Object?> allOf, _TypeMeta meta) {
    if (allOf.length != 2) return null;
    var hasFnCallRef = false;
    var hasReturnConstraint = false;
    for (final member in allOf) {
      final Map<String, Object?>? m = JsonSchemaCodec._asStringMap(member);
      if (m == null) return null;
      final String? ref = JsonSchemaCodec._rawRef(m);
      if (ref != null) {
        final String? common =
            JsonSchemaCodec._commonTypeNameFromRef(ref) ??
            JsonSchemaCodec._localDefName(ref);
        if (common == 'FunctionCall') {
          hasFnCallRef = true;
          continue;
        }
      }
      final Map<String, Object?>? props = JsonSchemaCodec._asStringMap(
        m['properties'],
      );
      if (props != null &&
          props.length == 1 &&
          props.containsKey('returnType')) {
        hasReturnConstraint = true;
      }
    }
    if (!hasFnCallRef || !hasReturnConstraint) return null;
    return FunctionCallType(
      description: meta.description,
      deprecated: meta.deprecated,
      deprecatedReason: meta.deprecatedReason,
    );
  }

  ObjectType? _tryMergeAllOfObject(
    Map<String, Object?> schema,
    List<Object?> allOfList,
    _TypeMeta meta,
  ) {
    for (final item in allOfList) {
      final Map<String, Object?>? m = JsonSchemaCodec._asStringMap(item);
      if (m == null ||
          JsonSchemaCodec._hasUnsupportedKeyword(m) ||
          (m['type'] != null && m['type'] != 'object')) {
        return null;
      }
      if (m.containsKey(r'$ref')) {
        final String? ref = JsonSchemaCodec._rawRef(m);
        if (ref == null || !ref.startsWith('#/')) return null;
        final Map<String, Object?>? target = _resolvePointer(ref);
        if (target == null ||
            (target['type'] != null && target['type'] != 'object') ||
            !target.containsKey('properties')) {
          return null;
        }
      }
    }
    final _FlattenedObject flat = flattenObject(
      schema,
      defaultOpen: true,
      allowCommonMixins: false,
    );
    if (flat.hasUnsupportedRoot || flat.properties.isEmpty) return null;
    final Map<String, Object?>? defMap = JsonSchemaCodec._asStringMap(
      meta.defaultValue,
    );
    return ObjectType(
      properties: List<ParameterDefinition>.unmodifiable(
        decodeProperties(flat.properties, flat.required),
      ),
      additionalProperties: flat.additionalFlag,
      additionalPropertiesType: flat.additionalType,
      atLeastOneOf: flat.atLeastOneOf.isEmpty
          ? null
          : List<List<String>>.unmodifiable(flat.atLeastOneOf),
      defaultValue: defMap == null
          ? null
          : deepCopyJsonMap(defMap, unmodifiable: true),
      description: meta.description ?? flat.description,
      deprecated: meta.deprecated || flat.deprecated,
      deprecatedReason: meta.deprecatedReason ?? flat.deprecatedReason,
    );
  }

  TypeDefinition? _commonType(String name, _TypeMeta meta) {
    final String? desc = meta.description;
    final bool dep = meta.deprecated;
    final String? depR = meta.deprecatedReason;
    final Object? def = meta.defaultValue;
    return switch (name) {
      'DynamicString' => StringType(
        dynamic: true,
        defaultValue: def is String ? def : null,
        description: desc,
        deprecated: dep,
        deprecatedReason: depR,
      ),
      'DynamicNumber' => NumberType(
        dynamic: true,
        defaultValue: def is num ? def : null,
        description: desc,
        deprecated: dep,
        deprecatedReason: depR,
      ),
      'DynamicBoolean' => BooleanType(
        dynamic: true,
        defaultValue: def is bool ? def : null,
        description: desc,
        deprecated: dep,
        deprecatedReason: depR,
      ),
      'DynamicStringList' => ArrayType(
        dynamic: true,
        items: const StringType(),
        defaultValue: def is List
            ? (deepCopyJson(def, unmodifiable: true)! as List<Object?>)
            : null,
        description: desc,
        deprecated: dep,
        deprecatedReason: depR,
      ),
      'DynamicValue' => AnyType(
        dynamic: true,
        defaultValue: meta.hasDefault
            ? deepCopyJson(def, unmodifiable: true)
            : noDefaultValue,
        description: desc,
        deprecated: dep,
        deprecatedReason: depR,
      ),
      'DataBinding' => DataBindingType(
        description: desc,
        deprecated: dep,
        deprecatedReason: depR,
      ),
      'FunctionCall' => FunctionCallType(
        description: desc,
        deprecated: dep,
        deprecatedReason: depR,
      ),
      'Child' || 'ComponentId' when allowComponentTypes => ChildType(
        description: desc,
        deprecated: dep,
        deprecatedReason: depR,
      ),
      'ChildList' when allowComponentTypes => ChildListType(
        description: desc,
        deprecated: dep,
        deprecatedReason: depR,
      ),
      'Action' when allowComponentTypes => ActionType(
        description: desc,
        deprecated: dep,
        deprecatedReason: depR,
      ),
      'CheckRule' when allowComponentTypes => CheckRuleType(
        description: desc,
        deprecated: dep,
        deprecatedReason: depR,
      ),
      'AccessibilityAttributes' when allowComponentTypes => AccessibilityType(
        description: desc,
        deprecated: dep,
        deprecatedReason: depR,
      ),
      _ => null,
    };
  }

  TypeDefinition? _withDynamic(TypeDefinition inner, _TypeMeta meta) {
    final String? desc = meta.description ?? inner.description;
    final bool dep = meta.deprecated || inner.deprecated;
    final String? depR = meta.deprecatedReason ?? inner.deprecatedReason;
    final Object? def = meta.defaultValue;
    return switch (inner) {
      StringType(
        :final format,
        :final formats,
        :final pattern,
        :final minLength,
        :final maxLength,
        defaultValue: final innerDef,
      ) =>
        StringType(
          dynamic: true,
          format: formats != null && formats.length > 1 ? null : format,
          formats: formats != null && formats.length > 1 ? formats : null,
          pattern: pattern,
          minLength: minLength,
          maxLength: maxLength,
          defaultValue: def is String ? def : innerDef,
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        ),
      NumberType(:final min, :final max, defaultValue: final innerDef) =>
        NumberType(
          dynamic: true,
          min: min,
          max: max,
          defaultValue: def is num ? def : innerDef,
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        ),
      IntegerType(:final min, :final max, defaultValue: final innerDef) =>
        IntegerType(
          dynamic: true,
          min: min,
          max: max,
          defaultValue: def is int ? def : innerDef,
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        ),
      BooleanType(defaultValue: final innerDef) => BooleanType(
        dynamic: true,
        defaultValue: def is bool ? def : innerDef,
        description: desc,
        deprecated: dep,
        deprecatedReason: depR,
      ),
      EnumType(
        :final values,
        :final declaredValueType,
        defaultValue: final innerDef,
      ) =>
        EnumType(
          values: values,
          valueType: declaredValueType,
          dynamic: true,
          defaultValue: meta.hasDefault ? def : innerDef,
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        ),
      ArrayType(
        :final items,
        :final minItems,
        :final maxItems,
        :final uniqueItems,
        defaultValue: final innerDef,
      ) =>
        ArrayType(
          dynamic: true,
          items: items,
          minItems: minItems,
          maxItems: maxItems,
          uniqueItems: uniqueItems,
          defaultValue: def is List
              ? (deepCopyJson(def, unmodifiable: true)! as List<Object?>)
              : innerDef,
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        ),
      ObjectType(
        :final properties,
        :final additionalProperties,
        :final additionalPropertiesType,
        :final atLeastOneOf,
        defaultValue: final innerDef,
      ) =>
        ObjectType(
          dynamic: true,
          properties: properties,
          additionalProperties: additionalProperties,
          additionalPropertiesType: additionalPropertiesType,
          atLeastOneOf: atLeastOneOf,
          defaultValue: JsonSchemaCodec._asStringMap(def) != null
              ? deepCopyJsonMap(
                  JsonSchemaCodec._asStringMap(def)!,
                  unmodifiable: true,
                )
              : innerDef,
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        ),
      _ => null,
    };
  }

  ({bool flag, TypeDefinition? type}) _extractAdditional(
    Map<String, Object?> schema, {
    required bool defaultOpen,
  }) {
    final Object? ap = schema.containsKey('additionalProperties')
        ? schema['additionalProperties']
        : schema['unevaluatedProperties'];
    if (ap == null) return (flag: defaultOpen, type: null);
    if (ap is bool) return (flag: ap, type: null);
    if (JsonSchemaCodec._asStringMap(ap) case final apMap?) {
      return (flag: false, type: decode(apMap));
    }
    return (flag: defaultOpen, type: null);
  }

  Map<String, Object?>? _resolvePointer(String ref) {
    final Object? target =
        followJsonPointer(effectiveRoot, ref.substring(1)) ??
        (ref.startsWith(r'#/$defs/')
            ? followJsonPointer(definitions, '/${ref.substring(8)}')
            : null);
    return JsonSchemaCodec._asStringMap(target);
  }

  RawJsonSchemaType _raw(Map<String, Object?> schema, _TypeMeta meta) =>
      RawJsonSchemaType(
        deepCopyJsonMap(schema),
        description: meta.description,
        deprecated: meta.deprecated,
        deprecatedReason: meta.deprecatedReason,
      );

  static _TypeMeta _extractMeta(Map<String, Object?> schema) {
    String? description;
    String? embeddedRef;
    final String? rawDesc = JsonSchemaCodec._str(schema['description']);
    if (rawDesc != null) {
      final RegExpMatch? m = JsonSchemaCodec._refDescriptionPattern.firstMatch(
        rawDesc,
      );
      if (m == null) {
        description = rawDesc;
      } else {
        embeddedRef = m.group(1);
        final String? rem = m.group(2);
        description = (rem != null && rem.isNotEmpty) ? rem : null;
      }
    }
    return (
      description: description,
      embeddedRef: embeddedRef,
      deprecated: schema['deprecated'] == true,
      deprecatedReason: JsonSchemaCodec._str(schema['x-deprecated-reason']),
      hasDefault: schema.containsKey('default'),
      defaultValue: schema['default'],
    );
  }

  static Map<String, Object?> _mergeMeta(
    Map<String, Object?> target,
    _TypeMeta meta,
  ) => <String, Object?>{
    ...target,
    'description': ?meta.description,
    if (meta.hasDefault) 'default': meta.defaultValue,
    if (meta.deprecated) 'deprecated': true,
    if (meta.deprecatedReason != null)
      'x-deprecated-reason': meta.deprecatedReason,
  };

  static bool _isNotNullSchema(Map<String, Object?> schema) {
    final Map<String, Object?>? notMap = JsonSchemaCodec._asStringMap(
      schema['not'],
    );
    if (notMap == null || notMap.length != 1 || notMap['type'] != 'null') {
      return false;
    }
    return schema.keys.every(
      (k) => k == 'not' || JsonSchemaCodec._metadataOnlyKeywords.contains(k),
    );
  }

  static bool _isAllJsonTypesList(List<Object?> list) =>
      list.length == JsonSchemaCodec._allJsonTypes.length &&
      JsonSchemaCodec._allJsonTypes.every(list.contains);
}
