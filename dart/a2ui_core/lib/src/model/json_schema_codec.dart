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

  /// Exotic JSON Schema keywords that cannot be represented losslessly in the
  /// canonical [TypeDefinition] AST and therefore fall back to
  /// [RawJsonSchemaType].
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
    final Map<String, Object?>? rawComponents = _asStringMap(
      json['components'],
    );
    if (rawComponents != null) {
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
        final fnName = entry.key! as String;
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
      title: json['title'] is String ? json['title']! as String : null,
      description: json['description'] is String
          ? json['description']! as String
          : null,
      instructions: json['instructions'] is String
          ? json['instructions']! as String
          : null,
      metadata: _asStringMap(json['metadata']),
      types: Map.unmodifiable(types),
      surfaceProperties: surfaceProperties,
      components: List.unmodifiable(components),
      functions: List.unmodifiable(functions),
    );
  }

  /// Extracts catalog-local leaf data types from a JSON Schema `$defs` map.
  static Map<String, TypeDefinition> extractLeafTypes(
    Map<String, Object?> definitions, {
    Map<String, Object?>? rootDoc,
    bool atLeastV1 = true,
  }) {
    final result = <String, TypeDefinition>{};
    // First collect candidate names so mutually referencing leaf defs resolve
    // to RefType rather than eagerly inlining.
    final Set<String> candidateNames = {
      for (final MapEntry<String, Object?> entry in definitions.entries)
        if (!_reservedDefNames.contains(entry.key) &&
            !_commonTypeNames.contains(entry.key) &&
            isValidUax31Identifier(entry.key) &&
            entry.value is Map)
          entry.key,
    };

    // Translate each candidate with `allowComponentTypes: true` so local
    // aliases to component-only protocol types (e.g. `Action`, `ComponentId`)
    // translate accurately and are excluded from catalog-local leaf `types`.
    final activeCandidates = Set<String>.of(candidateNames);
    while (true) {
      result.clear();
      final excluded = <String>{};
      for (final name in activeCandidates) {
        final Map<String, Object?>? defMap = _asStringMap(definitions[name]);
        if (defMap == null) {
          excluded.add(name);
          continue;
        }
        // Skip component-like mixin defs (e.g. defs containing 'component'
        // const or referencing ComponentCommon/Checkable).
        if (_isComponentMixinDef(defMap)) {
          excluded.add(name);
          continue;
        }
        final TypeDefinition translated = schemaToTypeDefinition(
          defMap,
          definitions: definitions,
          rootDoc: rootDoc,
          knownTypeNames: activeCandidates.difference({name}),
          atLeastV1: atLeastV1,
          allowComponentTypes: true,
        );
        if (translated.containsComponentOnlyType) {
          excluded.add(name);
        } else {
          result[name] = translated;
        }
      }
      if (excluded.isEmpty) break;
      activeCandidates.removeAll(excluded);
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
        description: _stringOrNull(schema['description']),
        rawSchema: RawJsonSchemaType(_deepCopyMap(schema)),
      );
    }
    final Set<String> knownNames = knownTypes.keys.toSet();
    final Map<String, Object?> propsMap =
        _asStringMap(schema['properties']) ?? const {};
    final Set<String> reqSet = _stringSet(schema['required']);
    final properties = <ParameterDefinition>[
      for (final MapEntry<String, Object?> entry in propsMap.entries)
        ParameterDefinition(
          name: entry.key,
          required: reqSet.contains(entry.key),
          type: schemaToTypeDefinition(
            _asStringMap(entry.value) ?? const {},
            definitions: definitions,
            rootDoc: rootDoc,
            knownTypeNames: knownNames,
            atLeastV1: atLeastV1,
            allowComponentTypes: false,
          ),
        ),
    ];
    final (:bool flag, :TypeDefinition? type) = _extractAdditionalProperties(
      schema,
      definitions: definitions,
      rootDoc: rootDoc,
      knownTypeNames: knownNames,
      atLeastV1: atLeastV1,
      allowComponentTypes: false,
      defaultOpen: true,
    );
    return SurfacePropertiesDefinition(
      description: _stringOrNull(schema['description']),
      properties: List.unmodifiable(properties),
      additionalProperties: flag,
      additionalPropertiesType: type,
    );
  }

  /// Translates a component JSON Schema (either authored with `allOf` or
  /// already flattened) into a [ComponentDefinition].
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
    final Set<String> knownNames = knownTypes.keys.toSet();
    final Map<String, Object?> effectiveRoot =
        rootDoc ?? <String, Object?>{r'$defs': definitions};

    var isCheckable = isCheckableHint;
    var hasComponentCommon = false;
    final subschemas = <Map<String, Object?>>[];
    final visitedRefs = <String>{};

    void collectSubschemas(Map<String, Object?> node) {
      final String? ref = _rawRef(node);
      if (ref != null) {
        final String? commonName = _commonTypeNameFromRef(ref);
        if (commonName == 'Checkable') {
          isCheckable = true;
          return;
        }
        if (commonName == 'ComponentCommon') {
          hasComponentCommon = true;
          return;
        }
        if (ref.startsWith('#/') && visitedRefs.add(ref)) {
          final Object? target = followJsonPointer(
            effectiveRoot,
            ref.substring(1),
          );
          if (_asStringMap(target) case final Map<String, Object?> targetMap) {
            collectSubschemas(targetMap);
            return;
          }
        }
      }
      if (node['allOf'] case final List<Object?> members) {
        for (final member in members) {
          if (_asStringMap(member) case final Map<String, Object?> memberMap) {
            collectSubschemas(memberMap);
          }
        }
      }
      subschemas.add(node);
    }

    collectSubschemas(schema);

    // Check for unsupported root-level keywords on any subschema (excluding
    // standard atLeastOneOf `anyOf: [{required: ...}]`).
    var hasUnsupportedRoot = false;
    final mergedProps = <String, Map<String, Object?>>{};
    final requiredSet = <String>{};
    final atLeastOneOf = <List<String>>[];
    String? description;
    var deprecated = false;
    String? deprecatedReason;

    for (final sub in subschemas) {
      if (sub['description'] is String && sub['commonTypesRef'] == null) {
        description = sub['description']! as String;
      }
      if (sub['deprecated'] == true) deprecated = true;
      if (sub['x-deprecated-reason'] is String) {
        deprecatedReason = sub['x-deprecated-reason']! as String;
      }
      if (_hasUnsupportedKeyword(sub) || sub.containsKey('oneOf')) {
        hasUnsupportedRoot = true;
      }
      if (sub['anyOf'] case final List<Object?> anyOfList) {
        final List<String>? group = _extractAtLeastOneOfGroup(anyOfList);
        if (group != null) {
          atLeastOneOf.add(group);
        } else {
          hasUnsupportedRoot = true;
        }
      }
      final Map<String, Object?>? props = _asStringMap(sub['properties']);
      if (props != null) {
        for (final MapEntry<String, Object?> entry in props.entries) {
          final Map<String, Object?>? propMap = _asStringMap(entry.value);
          mergedProps[entry.key] = propMap ?? const <String, Object?>{};
        }
      }
      requiredSet.addAll(_stringSet(sub['required']));
    }
    if (schema['description'] is String) {
      description = schema['description']! as String;
    }

    // Detect checkable via `@checks` or standard `checks` array property.
    if (mergedProps.containsKey('@checks')) {
      isCheckable = true;
    }
    if (!atLeastV1 && _isStandardChecksProp(mergedProps['checks'])) {
      isCheckable = true;
    }
    if (atLeastV1 &&
        isCheckable &&
        _isStandardChecksProp(mergedProps['checks'])) {
      // Standard Checkable mixin checks property.
    }

    // Preserve authored property order: component's own properties first,
    // followed by allOf / mixin properties, excluding protocol envelopes.
    final parameters = <ParameterDefinition>[];
    for (final MapEntry<String, Map<String, Object?>> entry
        in mergedProps.entries) {
      final String propName = entry.key;
      final Map<String, Object?> propMap = entry.value;
      if (propName == 'component' || propName == 'id') continue;
      if (propName == '@catalogId' ||
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
          required: requiredSet.contains(propName),
          type: schemaToTypeDefinition(
            propMap,
            definitions: definitions,
            rootDoc: effectiveRoot,
            knownTypeNames: knownNames,
            atLeastV1: atLeastV1,
            allowComponentTypes: true,
          ),
        ),
      );
    }

    // For pre-v1.0 catalogs that explicitly mix in ComponentCommon, include
    // `accessibility` as a canonical AccessibilityType parameter (matching
    // flattened v0.9 schemas) unless already declared.
    if (!atLeastV1 &&
        hasComponentCommon &&
        !mergedProps.containsKey('accessibility')) {
      parameters.add(ParameterDefinition.accessibility('accessibility'));
    }

    return ComponentDefinition(
      name: name,
      description: description,
      checkable: isCheckable,
      parameters: List.unmodifiable(parameters),
      atLeastOneOf: atLeastOneOf.isEmpty
          ? null
          : List.unmodifiable(atLeastOneOf),
      allowedParents: allowedParents ?? _stringList(schema['allowedParents']),
      allowedChildren:
          allowedChildren ?? _stringList(schema['allowedChildren']),
      metadata: metadata ?? _asStringMap(schema['metadata']),
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
      rawSchema: hasUnsupportedRoot
          ? RawJsonSchemaType(_deepCopyMap(schema))
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
    final Set<String> knownNames = knownTypes.keys.toSet();
    final localDefs = <String, Object?>{
      ...definitions,
      if (_asStringMap(argumentSchema[r'$defs'])
          case final Map<String, Object?> inner)
        ...inner,
    };
    final Map<String, Object?> effectiveRoot =
        rootDoc ?? <String, Object?>{r'$defs': localDefs};

    final subschemas = <Map<String, Object?>>[];
    final visitedRefs = <String>{};

    void collect(Map<String, Object?> node) {
      final String? ref = _rawRef(node);
      if (ref != null && ref.startsWith('#/') && visitedRefs.add(ref)) {
        final Object? target = followJsonPointer(
          effectiveRoot,
          ref.substring(1),
        );
        final Object? localTarget =
            target ??
            (ref.startsWith(r'#/$defs/')
                ? followJsonPointer(localDefs, '/${ref.substring(8)}')
                : null);
        if (_asStringMap(localTarget) case final Map<String, Object?> tMap) {
          collect(tMap);
          return;
        }
      }
      if (node['allOf'] case final List<Object?> members) {
        for (final member in members) {
          if (_asStringMap(member) case final Map<String, Object?> mMap) {
            collect(mMap);
          }
        }
      }
      subschemas.add(node);
    }

    collect(argumentSchema);

    var hasUnsupportedRoot = false;
    final mergedProps = <String, Map<String, Object?>>{};
    final requiredSet = <String>{};
    final atLeastOneOf = <List<String>>[];
    var deprecated = false;
    String? deprecatedReason;

    for (final sub in subschemas) {
      if (sub['deprecated'] == true) deprecated = true;
      if (sub['x-deprecated-reason'] is String) {
        deprecatedReason = sub['x-deprecated-reason']! as String;
      }
      if (_hasUnsupportedKeyword(sub) || sub.containsKey('oneOf')) {
        hasUnsupportedRoot = true;
      }
      if (sub['anyOf'] case final List<Object?> anyOfList) {
        final List<String>? group = _extractAtLeastOneOfGroup(anyOfList);
        if (group != null) {
          atLeastOneOf.add(group);
        } else {
          hasUnsupportedRoot = true;
        }
      }
      final Map<String, Object?>? props = _asStringMap(sub['properties']);
      if (props != null) {
        for (final MapEntry<String, Object?> entry in props.entries) {
          mergedProps[entry.key] =
              _asStringMap(entry.value) ?? const <String, Object?>{};
        }
      }
      requiredSet.addAll(_stringSet(sub['required']));
    }

    final parameters = <ParameterDefinition>[
      for (final MapEntry<String, Map<String, Object?>> entry
          in mergedProps.entries)
        ParameterDefinition(
          name: entry.key,
          required: requiredSet.contains(entry.key),
          type: schemaToTypeDefinition(
            entry.value,
            definitions: localDefs,
            rootDoc: effectiveRoot,
            knownTypeNames: knownNames,
            atLeastV1: atLeastV1,
            allowComponentTypes: false,
          ),
        ),
    ];

    final (:bool flag, :TypeDefinition? type) = _extractAdditionalProperties(
      argumentSchema,
      definitions: localDefs,
      rootDoc: effectiveRoot,
      knownTypeNames: knownNames,
      atLeastV1: atLeastV1,
      allowComponentTypes: false,
      defaultOpen: atLeastV1,
    );

    return FunctionDefinition(
      name: name,
      description: description ?? _stringOrNull(argumentSchema['description']),
      returnType: FunctionReturnDefinition.shorthand(returnType),
      allowedCallers: allowedCallers,
      requiresUserActivation: requiresUserActivation,
      parameters: List.unmodifiable(parameters),
      atLeastOneOf: atLeastOneOf.isEmpty
          ? null
          : List.unmodifiable(atLeastOneOf),
      additionalParameters: flag,
      additionalParametersType: type,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
      rawArgumentSchema: hasUnsupportedRoot
          ? RawJsonSchemaType(_deepCopyMap(argumentSchema))
          : null,
    );
  }

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
      description: _stringOrNull(fnMap['description']),
      allowedCallers: allowedCallers,
      requiresUserActivation: requiresUserActivation,
      definitions: definitions,
      rootDoc: rootDoc,
      knownTypes: knownTypes,
      atLeastV1: atLeastV1,
    );
  }

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

  /// Translates a single JSON Schema property/type map into a [TypeDefinition].
  static TypeDefinition schemaToTypeDefinition(
    Map<String, Object?> schema, {
    Map<String, Object?> definitions = const {},
    Map<String, Object?>? rootDoc,
    Set<String> knownTypeNames = const {},
    bool atLeastV1 = true,
    bool allowComponentTypes = true,
    Set<String>? visitedRefs,
    Set<Object>? visitedMaps,
  }) {
    final Set<String> seen = visitedRefs ?? <String>{};
    final Set<Object> seenMaps = visitedMaps ?? Set<Object>.identity();
    if (!seenMaps.add(schema)) {
      return RawJsonSchemaType(
        _deepCopyMap(schema),
        description: _stringOrNull(schema['description']),
        deprecated: schema['deprecated'] == true,
        deprecatedReason: _stringOrNull(schema['x-deprecated-reason']),
      );
    }
    final (:String? description, :String? embeddedRef) = _extractDescription(
      schema,
    );
    final deprecated = schema['deprecated'] == true;
    final String? deprecatedReason = _stringOrNull(
      schema['x-deprecated-reason'],
    );
    final bool hasDefault = schema.containsKey('default');
    final Object? defaultVal = schema['default'];

    // 1. Check catalogDefRef / local $ref into known leaf types.
    final String? rawRef =
        embeddedRef ??
        _stringOrNull(schema['catalogDefRef']) ??
        _rawRef(schema);
    if (rawRef != null) {
      final String? commonName = _commonTypeNameFromRef(rawRef);
      if (commonName != null &&
          !knownTypeNames.contains(commonName) &&
          !definitions.containsKey(commonName)) {
        final TypeDefinition? commonType = _commonTypeToDefinition(
          commonName,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
          hasDefault: hasDefault,
          defaultValue: defaultVal,
          allowComponentTypes: allowComponentTypes,
        );
        if (commonType != null) return commonType;
      }

      if (_localDefName(rawRef) case final String defName) {
        if (knownTypeNames.contains(defName)) {
          return hasDefault
              ? RefType(
                  ref: defName,
                  defaultValue: _deepCopyValue(defaultVal),
                  description: description,
                  deprecated: deprecated,
                  deprecatedReason: deprecatedReason,
                )
              : RefType(
                  ref: defName,
                  description: description,
                  deprecated: deprecated,
                  deprecatedReason: deprecatedReason,
                );
        }
        // Check if it is a bare `#/$defs/DynamicString` etc. common-type ref.
        if (_commonTypeNames.contains(defName) &&
            !definitions.containsKey(defName)) {
          final TypeDefinition? commonType = _commonTypeToDefinition(
            defName,
            description: description,
            deprecated: deprecated,
            deprecatedReason: deprecatedReason,
            hasDefault: hasDefault,
            defaultValue: defaultVal,
            allowComponentTypes: allowComponentTypes,
          );
          if (commonType != null) return commonType;
        }
      }

      // Resolve local JSON Pointer ref when not a named leaf RefType.
      if (rawRef.startsWith('#/')) {
        if (!seen.add(rawRef)) {
          return RawJsonSchemaType(
            _deepCopyMap(schema),
            description: description,
            deprecated: deprecated,
            deprecatedReason: deprecatedReason,
          );
        }
        final Map<String, Object?> effectiveRoot =
            rootDoc ?? <String, Object?>{r'$defs': definitions};
        final Object? target =
            followJsonPointer(effectiveRoot, rawRef.substring(1)) ??
            (rawRef.startsWith(r'#/$defs/')
                ? followJsonPointer(definitions, '/${rawRef.substring(8)}')
                : null);
        if (_asStringMap(target) case final Map<String, Object?> targetMap) {
          final merged = <String, Object?>{
            ...targetMap,
            'description': ?description,
            if (hasDefault) 'default': defaultVal,
            if (deprecated) 'deprecated': true,
            'x-deprecated-reason': ?deprecatedReason,
          };
          return schemaToTypeDefinition(
            merged,
            definitions: definitions,
            rootDoc: rootDoc,
            knownTypeNames: knownTypeNames,
            atLeastV1: atLeastV1,
            allowComponentTypes: allowComponentTypes,
            visitedRefs: Set<String>.of(seen),
            visitedMaps: Set<Object>.identity()..addAll(seenMaps),
          );
        }
        return RawJsonSchemaType(
          _deepCopyMap(schema),
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );
      }
      return RawJsonSchemaType(
        _deepCopyMap(schema),
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
      );
    }

    // 2. Check DateTimeInput-style constrained DynamicString `allOf`:
    //    allOf: [DynamicString, {if: {type: string}, then: {oneOf: [...]}}]
    if (schema['allOf'] case final List<Object?> allOfList) {
      final StringType? constrainedDynStr = _tryParseConstrainedDynamicString(
        allOfList,
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
        defaultValue: defaultVal is String ? defaultVal : null,
      );
      if (constrainedDynStr != null) return constrainedDynStr;

      // Single-member allOf unwrapping.
      if (allOfList.length == 1) {
        if (_asStringMap(allOfList.first)
            case final Map<String, Object?> single) {
          final merged = <String, Object?>{
            ...single,
            'description': ?description,
            if (hasDefault) 'default': defaultVal,
          };
          return schemaToTypeDefinition(
            merged,
            definitions: definitions,
            rootDoc: rootDoc,
            knownTypeNames: knownTypeNames,
            atLeastV1: atLeastV1,
            allowComponentTypes: allowComponentTypes,
            visitedRefs: Set<String>.of(seen),
            visitedMaps: Set<Object>.identity()..addAll(seenMaps),
          );
        }
      }

      // Check if allOf merges plain object subschemas.
      final TypeDefinition? mergedObj = _tryMergeAllOfObject(
        schema,
        allOfList,
        definitions: definitions,
        rootDoc: rootDoc,
        knownTypeNames: knownTypeNames,
        atLeastV1: atLeastV1,
        allowComponentTypes: allowComponentTypes,
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
        visitedRefs: Set<String>.of(seen),
        visitedMaps: Set<Object>.identity()..addAll(seenMaps),
      );
      if (mergedObj != null) return mergedObj;

      return RawJsonSchemaType(
        _deepCopyMap(schema),
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
      );
    }

    // 3. Check unsupported exotic keywords.
    if (_hasUnsupportedKeyword(schema)) {
      return RawJsonSchemaType(
        _deepCopyMap(schema),
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
      );
    }

    // 4. Check `const`.
    if (schema.containsKey('const')) {
      final Object? constVal = schema['const'];
      if (constVal == null ||
          constVal is String ||
          constVal is num ||
          constVal is bool) {
        return ConstType(
          value: constVal,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );
      }
      return RawJsonSchemaType(
        _deepCopyMap(schema),
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
      );
    }

    // 5. Check `enum`.
    if (schema['enum'] case final List<Object?> rawEnum) {
      if (rawEnum.isNotEmpty &&
          rawEnum.every((v) => v is String || v is num || v is bool)) {
        final List<Object> values = rawEnum.cast<Object>().toList();
        final EnumValueType? valueType = switch (schema['type']) {
          'string' => EnumValueType.string,
          'number' || 'integer' => EnumValueType.number,
          'boolean' => EnumValueType.boolean,
          _ => null,
        };
        return EnumType(
          values: List.unmodifiable(values),
          valueType: valueType,
          defaultValue: defaultVal,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );
      }
      return RawJsonSchemaType(
        _deepCopyMap(schema),
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
      );
    }

    // 6. Check `oneOf` / `anyOf`.
    final isOneOf = schema['oneOf'] is List;
    final Object? unionRaw = isOneOf ? schema['oneOf'] : schema['anyOf'];
    if (unionRaw is List && unionRaw.isNotEmpty) {
      return _parseUnionSchema(
        unionRaw,
        exclusive: isOneOf,
        definitions: definitions,
        rootDoc: rootDoc,
        knownTypeNames: knownTypeNames,
        atLeastV1: atLeastV1,
        allowComponentTypes: allowComponentTypes,
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
        hasDefault: hasDefault,
        defaultValue: defaultVal,
        visitedRefs: Set<String>.of(seen),
        visitedMaps: Set<Object>.identity()..addAll(seenMaps),
      );
    }

    // 7. Check `type` (scalar or list of types like `["boolean", "object"]`).
    final Object? rawType = schema['type'];
    if (rawType is List) {
      final variants = <TypeDefinition>[];
      for (final Object? entry in rawType) {
        if (entry == 'null') {
          variants.add(const ConstType(value: null));
        } else if (entry is String) {
          variants.add(
            schemaToTypeDefinition(
              <String, Object?>{
                ...schema,
                'type': entry,
                'description': null,
                'default': null,
              }..removeWhere((k, v) => k == 'description' || k == 'default'),
              definitions: definitions,
              rootDoc: rootDoc,
              knownTypeNames: knownTypeNames,
              atLeastV1: atLeastV1,
              allowComponentTypes: allowComponentTypes,
              visitedRefs: Set<String>.of(seen),
              visitedMaps: Set<Object>.identity()..addAll(seenMaps),
            ),
          );
        }
      }
      if (variants.length == 1) return variants.first;
      if (variants.length >= 2) {
        return hasDefault
            ? UnionType(
                variants: List.unmodifiable(variants),
                defaultValue: _deepCopyValue(defaultVal),
                description: description,
                deprecated: deprecated,
                deprecatedReason: deprecatedReason,
              )
            : UnionType(
                variants: List.unmodifiable(variants),
                description: description,
                deprecated: deprecated,
                deprecatedReason: deprecatedReason,
              );
      }
    }

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
          format: _stringOrNull(schema['format']),
          pattern: _stringOrNull(schema['pattern']),
          minLength: _intOrNull(schema['minLength']),
          maxLength: _intOrNull(schema['maxLength']),
          defaultValue: defaultVal is String ? defaultVal : null,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      case 'number':
        return NumberType(
          min: _numOrNull(schema['minimum']),
          max: _numOrNull(schema['maximum']),
          defaultValue: defaultVal is num ? defaultVal : null,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      case 'integer':
        return IntegerType(
          min: _intOrNull(schema['minimum']),
          max: _intOrNull(schema['maximum']),
          defaultValue: defaultVal is int ? defaultVal : null,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      case 'boolean':
        return BooleanType(
          defaultValue: defaultVal is bool ? defaultVal : null,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      case 'array':
        final Map<String, Object?>? itemsMap = _asStringMap(schema['items']);
        final TypeDefinition? items = itemsMap == null
            ? null
            : schemaToTypeDefinition(
                itemsMap,
                definitions: definitions,
                rootDoc: rootDoc,
                knownTypeNames: knownTypeNames,
                atLeastV1: atLeastV1,
                allowComponentTypes: allowComponentTypes,
                visitedRefs: Set<String>.of(seen),
                visitedMaps: Set<Object>.identity()..addAll(seenMaps),
              );
        return ArrayType(
          items: items,
          minItems: _intOrNull(schema['minItems']),
          maxItems: _intOrNull(schema['maxItems']),
          uniqueItems: schema['uniqueItems'] == true,
          defaultValue: defaultVal is List
              ? (_deepCopyValue(defaultVal)! as List<Object?>)
              : null,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      case 'object':
        final Map<String, Object?> propsMap =
            _asStringMap(schema['properties']) ?? const {};
        final Set<String> reqSet = _stringSet(schema['required']);
        final properties = <ParameterDefinition>[
          for (final MapEntry<String, Object?> entry in propsMap.entries)
            ParameterDefinition(
              name: entry.key,
              required: reqSet.contains(entry.key),
              type: schemaToTypeDefinition(
                _asStringMap(entry.value) ?? const {},
                definitions: definitions,
                rootDoc: rootDoc,
                knownTypeNames: knownNamesOrEmpty(knownTypeNames),
                atLeastV1: atLeastV1,
                allowComponentTypes: allowComponentTypes,
                visitedRefs: Set<String>.of(seen),
                visitedMaps: Set<Object>.identity()..addAll(seenMaps),
              ),
            ),
        ];
        final (
          :bool flag,
          :TypeDefinition? type,
        ) = _extractAdditionalProperties(
          schema,
          definitions: definitions,
          rootDoc: rootDoc,
          knownTypeNames: knownTypeNames,
          atLeastV1: atLeastV1,
          allowComponentTypes: allowComponentTypes,
          defaultOpen: true,
          visitedRefs: Set<String>.of(seen),
          visitedMaps: Set<Object>.identity()..addAll(seenMaps),
        );
        return ObjectType(
          properties: List.unmodifiable(properties),
          additionalProperties: flag,
          additionalPropertiesType: type,
          defaultValue: _asStringMap(defaultVal) != null
              ? _deepCopyMap(_asStringMap(defaultVal)!)
              : null,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      case 'null':
        return ConstType(
          value: null,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
        );

      default:
        // Only treat truly unconstrained schemas (no structural/combinator/type
        // keywords beyond metadata like `description`/`default`) as `AnyType`.
        // Malformed or unknown keyword combinations fall back to
        // `RawJsonSchemaType` so static/dynamic semantics are preserved.
        final bool hasNonMetadataKey = schema.keys.any(
          (k) => !_metadataOnlyKeywords.contains(k),
        );
        if (hasNonMetadataKey) {
          return RawJsonSchemaType(
            _deepCopyMap(schema),
            description: description,
            deprecated: deprecated,
            deprecatedReason: deprecatedReason,
          );
        }
        return hasDefault
            ? AnyType(
                dynamic: true,
                nullable: true,
                defaultValue: _deepCopyValue(defaultVal),
                description: description,
                deprecated: deprecated,
                deprecatedReason: deprecatedReason,
              )
            : AnyType(
                dynamic: true,
                nullable: true,
                description: description,
                deprecated: deprecated,
                deprecatedReason: deprecatedReason,
              );
    }
  }

  static Set<String> knownNamesOrEmpty(Set<String> names) => names;

  static TypeDefinition _parseUnionSchema(
    List<Object?> branches, {
    required bool exclusive,
    required Map<String, Object?> definitions,
    required Map<String, Object?>? rootDoc,
    required Set<String> knownTypeNames,
    required bool atLeastV1,
    required bool allowComponentTypes,
    required String? description,
    required bool deprecated,
    required String? deprecatedReason,
    required bool hasDefault,
    required Object? defaultValue,
    required Set<String> visitedRefs,
    required Set<Object> visitedMaps,
  }) {
    final translated = <TypeDefinition>[];
    var hasBinding = false;
    var hasCall = false;
    final valueBranches = <TypeDefinition>[];

    for (final rawBranch in branches) {
      final Map<String, Object?>? branchMap = _asStringMap(rawBranch);
      if (branchMap == null) continue;
      final TypeDefinition branchType = schemaToTypeDefinition(
        branchMap,
        definitions: definitions,
        rootDoc: rootDoc,
        knownTypeNames: knownTypeNames,
        atLeastV1: atLeastV1,
        allowComponentTypes: allowComponentTypes,
        visitedRefs: Set<String>.of(visitedRefs),
        visitedMaps: Set<Object>.identity()..addAll(visitedMaps),
      );
      translated.add(branchType);
      if (branchType is DataBindingType) {
        hasBinding = true;
      } else if (branchType is FunctionCallType) {
        hasCall = true;
      } else {
        valueBranches.add(branchType);
      }
    }

    // Collapse `[T, DataBinding, FunctionCall]` into `T(dynamic: true)` when
    // BOTH DataBinding and FunctionCall are present alongside value branch(es).
    if (hasBinding && hasCall && valueBranches.isNotEmpty) {
      if (valueBranches.length == 1) {
        final TypeDefinition? collapsed = _withDynamic(
          valueBranches.single,
          description: description,
          deprecated: deprecated,
          deprecatedReason: deprecatedReason,
          hasDefault: hasDefault,
          defaultValue: defaultValue,
        );
        if (collapsed != null) return collapsed;
      }
      if (valueBranches.length >= 2) {
        return hasDefault
            ? UnionType(
                variants: List.unmodifiable(valueBranches),
                exclusive: exclusive,
                dynamic: true,
                defaultValue: _deepCopyValue(defaultValue),
                description: description,
                deprecated: deprecated,
                deprecatedReason: deprecatedReason,
              )
            : UnionType(
                variants: List.unmodifiable(valueBranches),
                exclusive: exclusive,
                dynamic: true,
                description: description,
                deprecated: deprecated,
                deprecatedReason: deprecatedReason,
              );
      }
    }

    if (translated.length == 1) {
      return translated.single;
    }
    return hasDefault
        ? UnionType(
            variants: List.unmodifiable(translated),
            exclusive: exclusive,
            defaultValue: _deepCopyValue(defaultValue),
            description: description,
            deprecated: deprecated,
            deprecatedReason: deprecatedReason,
          )
        : UnionType(
            variants: List.unmodifiable(translated),
            exclusive: exclusive,
            description: description,
            deprecated: deprecated,
            deprecatedReason: deprecatedReason,
          );
  }

  static TypeDefinition? _withDynamic(
    TypeDefinition inner, {
    required String? description,
    required bool deprecated,
    required String? deprecatedReason,
    required bool hasDefault,
    required Object? defaultValue,
  }) {
    final String? desc = description ?? inner.description;
    final bool dep = deprecated || inner.deprecated;
    final String? depReason = deprecatedReason ?? inner.deprecatedReason;
    return switch (inner) {
      StringType(
        :final format,
        :final formats,
        :final pattern,
        :final minLength,
        :final maxLength,
        defaultValue: final String? innerDef,
      ) =>
        StringType(
          dynamic: true,
          format: formats != null && formats.length > 1 ? null : format,
          formats: formats != null && formats.length > 1 ? formats : null,
          pattern: pattern,
          minLength: minLength,
          maxLength: maxLength,
          defaultValue: defaultValue is String ? defaultValue : innerDef,
          description: desc,
          deprecated: dep,
          deprecatedReason: depReason,
        ),
      NumberType(:final min, :final max, defaultValue: final num? innerDef) =>
        NumberType(
          dynamic: true,
          min: min,
          max: max,
          defaultValue: defaultValue is num ? defaultValue : innerDef,
          description: desc,
          deprecated: dep,
          deprecatedReason: depReason,
        ),
      IntegerType(:final min, :final max, defaultValue: final int? innerDef) =>
        IntegerType(
          dynamic: true,
          min: min,
          max: max,
          defaultValue: defaultValue is int ? defaultValue : innerDef,
          description: desc,
          deprecated: dep,
          deprecatedReason: depReason,
        ),
      BooleanType(defaultValue: final bool? innerDef) => BooleanType(
        dynamic: true,
        defaultValue: defaultValue is bool ? defaultValue : innerDef,
        description: desc,
        deprecated: dep,
        deprecatedReason: depReason,
      ),
      EnumType(
        :final values,
        :final declaredValueType,
        defaultValue: final Object? innerDef,
      ) =>
        EnumType(
          values: values,
          valueType: declaredValueType,
          dynamic: true,
          defaultValue: hasDefault ? defaultValue : innerDef,
          description: desc,
          deprecated: dep,
          deprecatedReason: depReason,
        ),
      ArrayType(
        :final items,
        :final minItems,
        :final maxItems,
        :final uniqueItems,
        defaultValue: final List<Object?>? innerDef,
      ) =>
        ArrayType(
          dynamic: true,
          items: items,
          minItems: minItems,
          maxItems: maxItems,
          uniqueItems: uniqueItems,
          defaultValue: defaultValue is List
              ? (_deepCopyValue(defaultValue)! as List<Object?>)
              : innerDef,
          description: desc,
          deprecated: dep,
          deprecatedReason: depReason,
        ),
      ObjectType(
        :final properties,
        :final additionalProperties,
        :final additionalPropertiesType,
        :final atLeastOneOf,
        defaultValue: final Map<String, Object?>? innerDef,
      ) =>
        ObjectType(
          dynamic: true,
          properties: properties,
          additionalProperties: additionalProperties,
          additionalPropertiesType: additionalPropertiesType,
          atLeastOneOf: atLeastOneOf,
          defaultValue: _asStringMap(defaultValue) != null
              ? _deepCopyMap(_asStringMap(defaultValue)!)
              : innerDef,
          description: desc,
          deprecated: dep,
          deprecatedReason: depReason,
        ),
      _ => null,
    };
  }

  /// Recognizes `allOf: [DynamicString, {if: {type: string}, then: ...}]`.
  static StringType? _tryParseConstrainedDynamicString(
    List<Object?> allOf, {
    required String? description,
    required bool deprecated,
    required String? deprecatedReason,
    required String? defaultValue,
  }) {
    if (allOf.length != 2) return null;
    final Map<String, Object?>? first = _asStringMap(allOf[0]);
    final Map<String, Object?>? second = _asStringMap(allOf[1]);
    if (first == null || second == null) return null;
    final String? ref = _rawRef(first);
    if (ref == null || _commonTypeNameFromRef(ref) != 'DynamicString') {
      return null;
    }
    final Map<String, Object?>? ifMap = _asStringMap(second['if']);
    final Map<String, Object?>? thenMap = _asStringMap(second['then']);
    if (ifMap == null || thenMap == null || ifMap['type'] != 'string') {
      return null;
    }
    if (thenMap['format'] case final String singleFormat) {
      return StringType(
        dynamic: true,
        format: singleFormat,
        defaultValue: defaultValue,
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
      );
    }
    if (thenMap['oneOf'] case final List<Object?> branches
        when branches.isNotEmpty) {
      final formats = <String>[];
      for (final b in branches) {
        final Map<String, Object?>? bm = _asStringMap(b);
        if (bm == null || bm.length != 1 || bm['format'] is! String) {
          return null;
        }
        formats.add(bm['format']! as String);
      }
      return StringType(
        dynamic: true,
        format: formats.length == 1 ? formats.first : null,
        formats: formats.length > 1 ? List.unmodifiable(formats) : null,
        defaultValue: defaultValue,
        description: description,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
      );
    }
    return null;
  }

  static TypeDefinition? _tryMergeAllOfObject(
    Map<String, Object?> schema,
    List<Object?> allOfList, {
    required Map<String, Object?> definitions,
    required Map<String, Object?>? rootDoc,
    required Set<String> knownTypeNames,
    required bool atLeastV1,
    required bool allowComponentTypes,
    required String? description,
    required bool deprecated,
    required String? deprecatedReason,
    required Set<String> visitedRefs,
    required Set<Object> visitedMaps,
  }) {
    final mergedProps = <String, Map<String, Object?>>{};
    final requiredSet = <String>{};
    final atLeastOneOf = <List<String>>[];

    final nodes = <Map<String, Object?>>[
      for (final Object? item in allOfList)
        if (_asStringMap(item) case final Map<String, Object?> m) m,
      schema,
    ];
    for (final node in nodes) {
      if (node.containsKey(r'$ref') && !identical(node, schema)) return null;
      if (_hasUnsupportedKeyword(node)) return null;
      if (node['type'] != null && node['type'] != 'object') return null;
      if (node['anyOf'] case final List<Object?> anyOfList) {
        final List<String>? group = _extractAtLeastOneOfGroup(anyOfList);
        if (group == null) return null;
        atLeastOneOf.add(group);
      }
      if (_asStringMap(node['properties']) case final Map<String, Object?> p) {
        for (final MapEntry<String, Object?> e in p.entries) {
          mergedProps[e.key] = _asStringMap(e.value) ?? const {};
        }
      }
      requiredSet.addAll(_stringSet(node['required']));
    }
    if (mergedProps.isEmpty) return null;

    final properties = <ParameterDefinition>[
      for (final MapEntry<String, Map<String, Object?>> entry
          in mergedProps.entries)
        ParameterDefinition(
          name: entry.key,
          required: requiredSet.contains(entry.key),
          type: schemaToTypeDefinition(
            entry.value,
            definitions: definitions,
            rootDoc: rootDoc,
            knownTypeNames: knownTypeNames,
            atLeastV1: atLeastV1,
            allowComponentTypes: allowComponentTypes,
            visitedRefs: Set<String>.of(visitedRefs),
            visitedMaps: Set<Object>.identity()..addAll(visitedMaps),
          ),
        ),
    ];
    final (:bool flag, :TypeDefinition? type) = _extractAdditionalProperties(
      schema,
      definitions: definitions,
      rootDoc: rootDoc,
      knownTypeNames: knownTypeNames,
      atLeastV1: atLeastV1,
      allowComponentTypes: allowComponentTypes,
      defaultOpen: true,
      visitedRefs: Set<String>.of(visitedRefs),
      visitedMaps: Set<Object>.identity()..addAll(visitedMaps),
    );
    return ObjectType(
      properties: List.unmodifiable(properties),
      additionalProperties: flag,
      additionalPropertiesType: type,
      atLeastOneOf: atLeastOneOf.isEmpty
          ? null
          : List.unmodifiable(atLeastOneOf),
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
    );
  }

  // ---------------------------------------------------------------------------
  // CatalogModel -> JSON Schema
  // ---------------------------------------------------------------------------

  /// Emits a clean, spec-compliant JSON Schema catalog document from [model].
  static Map<String, Object?> toJsonSchema(
    CatalogModel model, {
    A2uiProtocolVersion? protocolVersion,
  }) {
    final A2uiProtocolVersion? effectiveVersion =
        protocolVersion ?? model.protocolVersion;
    final bool atLeastV1 =
        effectiveVersion?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false;

    final componentsMap = <String, Object?>{
      for (final ComponentDefinition comp in model.components)
        comp.name: componentDefinitionToJsonSchema(comp, atLeastV1: atLeastV1),
    };

    final functionsMap = <String, Object?>{
      for (final FunctionDefinition fn in model.functions)
        fn.name: functionDefinitionToJsonSchema(fn, atLeastV1: atLeastV1),
    };

    final defs = <String, Object?>{
      if (model.components.isNotEmpty)
        'anyComponent': <String, Object?>{
          'oneOf': [
            for (final ComponentDefinition comp in model.components)
              <String, Object?>{r'$ref': '#/components/${comp.name}'},
          ],
          'discriminator': <String, Object?>{'propertyName': 'component'},
        },
      if (model.functions.isNotEmpty)
        'anyFunction': <String, Object?>{
          'oneOf': [
            for (final FunctionDefinition fn in model.functions)
              <String, Object?>{r'$ref': '#/functions/${fn.name}'},
          ],
        }
      else if (atLeastV1)
        'anyFunction': <String, Object?>{'not': <String, Object?>{}},
      if (model.surfaceProperties != null)
        'theme': surfacePropertiesToJsonSchema(
          model.surfaceProperties!,
          atLeastV1: atLeastV1,
        ),
      for (final MapEntry<String, TypeDefinition> entry in model.types.entries)
        entry.key: typeDefinitionToJsonSchema(
          entry.value,
          atLeastV1: atLeastV1,
        ),
    };

    return <String, Object?>{
      r'$schema': _jsonSchemaDialect,
      r'$id': model.catalogId,
      if (effectiveVersion != null)
        'protocolVersion': effectiveVersion.semverValue,
      if (model.title != null) 'title': model.title,
      if (model.description != null) 'description': model.description,
      'catalogId': model.catalogId,
      if (model.instructions != null) 'instructions': model.instructions,
      if (model.metadata != null) 'metadata': _deepCopyValue(model.metadata),
      'components': componentsMap,
      if (functionsMap.isNotEmpty) 'functions': functionsMap,
      if (defs.isNotEmpty) r'$defs': defs,
    };
  }

  /// Emits a component JSON Schema from [component].
  static Map<String, Object?> componentDefinitionToJsonSchema(
    ComponentDefinition component, {
    bool atLeastV1 = true,
    bool includeEnvelope = true,
  }) {
    if (component.rawSchema != null) {
      return _deepCopyMap(component.rawSchema!.schema);
    }

    final properties = <String, Object?>{
      if (includeEnvelope)
        'component': <String, Object?>{'const': component.name},
      for (final ParameterDefinition param in component.parameters)
        param.name: typeDefinitionToJsonSchema(
          param.type,
          atLeastV1: atLeastV1,
        ),
    };
    final required = <String>[
      if (includeEnvelope) 'component',
      for (final ParameterDefinition param in component.parameters)
        if (param.required) param.name,
    ];

    final coreObj = <String, Object?>{
      'type': 'object',
      'properties': properties,
      if (required.isNotEmpty) 'required': required,
      ..._atLeastOneOfToJsonSchema(component.atLeastOneOf),
    };

    final mixins = <Map<String, Object?>>[
      if (!atLeastV1 &&
          includeEnvelope &&
          component.parameter('accessibility') == null)
        <String, Object?>{r'$ref': _commonRef('ComponentCommon', false)},
      if (component.checkable)
        <String, Object?>{r'$ref': _commonRef('Checkable', atLeastV1)},
    ];

    final Map<String, Object?> result;
    if (mixins.isEmpty) {
      result = <String, Object?>{
        'type': 'object',
        if (component.description != null) 'description': component.description,
        'properties': properties,
        if (required.isNotEmpty) 'required': required,
        ..._atLeastOneOfToJsonSchema(component.atLeastOneOf),
        if (!atLeastV1 && includeEnvelope) 'unevaluatedProperties': false,
      };
    } else {
      result = <String, Object?>{
        'type': 'object',
        if (component.description != null) 'description': component.description,
        'allOf': <Object?>[...mixins, coreObj],
        if (!atLeastV1 && includeEnvelope) 'unevaluatedProperties': false,
      };
    }

    if (component.allowedParents != null) {
      result['allowedParents'] = List<String>.of(component.allowedParents!);
    }
    if (component.allowedChildren != null) {
      result['allowedChildren'] = List<String>.of(component.allowedChildren!);
    }
    if (component.metadata != null) {
      result['metadata'] = _deepCopyValue(component.metadata);
    }
    if (component.deprecated) {
      result['deprecated'] = true;
    }
    if (component.deprecatedReason != null) {
      result['x-deprecated-reason'] = component.deprecatedReason;
    }
    return result;
  }

  /// Emits the `args` JSON Schema object of [function].
  static Map<String, Object?> functionDefinitionToArgumentSchema(
    FunctionDefinition function, {
    bool atLeastV1 = true,
  }) {
    if (function.rawArgumentSchema != null) {
      return _deepCopyMap(function.rawArgumentSchema!.schema);
    }
    final properties = <String, Object?>{
      for (final ParameterDefinition param in function.parameters)
        param.name: typeDefinitionToJsonSchema(
          param.type,
          atLeastV1: atLeastV1,
        ),
    };
    final required = <String>[
      for (final ParameterDefinition param in function.parameters)
        if (param.required) param.name,
    ];
    final result = <String, Object?>{
      'type': 'object',
      'properties': properties,
      if (required.isNotEmpty) 'required': required,
      ..._atLeastOneOfToJsonSchema(function.atLeastOneOf),
    };
    if (function.additionalParametersType != null) {
      result['additionalProperties'] = typeDefinitionToJsonSchema(
        function.additionalParametersType!,
        atLeastV1: atLeastV1,
      );
    } else if (function.additionalParameters) {
      result['additionalProperties'] = true;
    } else {
      result['unevaluatedProperties'] = false;
    }
    return result;
  }

  /// Emits the full wire `FunctionCallValidationSchema` JSON Schema for
  /// [function].
  static Map<String, Object?> functionDefinitionToJsonSchema(
    FunctionDefinition function, {
    bool atLeastV1 = true,
  }) {
    final callKey = atLeastV1 ? '@call' : 'call';
    final Map<String, Object?> argsSchema = functionDefinitionToArgumentSchema(
      function,
      atLeastV1: atLeastV1,
    );
    final bool requiresArgs =
        function.requiredParameters.isNotEmpty ||
        (function.atLeastOneOf?.isNotEmpty ?? false);
    final String returnTypeStr = function.returnType.returnType.jsonValue;

    final result = <String, Object?>{
      'type': 'object',
      if (function.description != null) 'description': function.description,
      if (atLeastV1) 'returnType': returnTypeStr,
      if (atLeastV1 &&
          function.declaredAllowedCallers != null &&
          function.declaredAllowedCallers != AllowedCallers.rendererOnly)
        'allowedCallers': function.declaredAllowedCallers!.jsonValue,
      if (atLeastV1 && function.requiresUserActivation)
        'requiresUserActivation': true,
      if (function.deprecated) 'deprecated': true,
      if (function.deprecatedReason != null)
        'x-deprecated-reason': function.deprecatedReason,
      'properties': <String, Object?>{
        callKey: <String, Object?>{'const': function.name},
        'args': argsSchema,
        if (!atLeastV1) 'returnType': <String, Object?>{'const': returnTypeStr},
      },
      'required': <String>[callKey, if (requiresArgs) 'args'],
      if (!atLeastV1) 'unevaluatedProperties': false,
    };
    return result;
  }

  /// Emits a `theme` JSON Schema from [surfaceProperties].
  static Map<String, Object?> surfacePropertiesToJsonSchema(
    SurfacePropertiesDefinition surfaceProperties, {
    bool atLeastV1 = true,
  }) {
    if (surfaceProperties.rawSchema != null) {
      return _deepCopyMap(surfaceProperties.rawSchema!.schema);
    }
    final properties = <String, Object?>{
      for (final ParameterDefinition param in surfaceProperties.properties)
        param.name: typeDefinitionToJsonSchema(
          param.type,
          atLeastV1: atLeastV1,
        ),
    };
    final required = <String>[
      for (final ParameterDefinition param in surfaceProperties.properties)
        if (param.required) param.name,
    ];
    return <String, Object?>{
      'type': 'object',
      if (surfaceProperties.description != null)
        'description': surfaceProperties.description,
      if (properties.isNotEmpty) 'properties': properties,
      if (required.isNotEmpty) 'required': required,
      if (surfaceProperties.additionalPropertiesType != null)
        'additionalProperties': typeDefinitionToJsonSchema(
          surfaceProperties.additionalPropertiesType!,
          atLeastV1: atLeastV1,
        )
      else
        'additionalProperties': surfaceProperties.additionalProperties,
    };
  }

  /// Emits a JSON Schema fragment for a single [TypeDefinition].
  static Map<String, Object?> typeDefinitionToJsonSchema(
    TypeDefinition type, {
    bool atLeastV1 = true,
  }) {
    final meta = <String, Object?>{
      if (type.description != null) 'description': type.description,
      if (type.deprecated) 'deprecated': true,
      if (type.deprecatedReason != null)
        'x-deprecated-reason': type.deprecatedReason,
    };

    Map<String, Object?> wrapDynamic(
      Map<String, Object?> literalSchema, {
      bool includeDefault = true,
    }) => <String, Object?>{
      ...meta,
      if (includeDefault && type.hasDefault)
        'default': _deepCopyValue(type.defaultValue),
      'oneOf': <Object?>[
        literalSchema,
        <String, Object?>{r'$ref': _commonRef('DataBinding', atLeastV1)},
        <String, Object?>{r'$ref': _commonRef('FunctionCall', atLeastV1)},
      ],
    };

    switch (type) {
      case StringType(
        :final dynamic,
        :final format,
        :final formats,
        :final pattern,
        :final minLength,
        :final maxLength,
        :final defaultValue,
      ):
        final bool hasConstraints =
            formats != null ||
            pattern != null ||
            minLength != null ||
            maxLength != null;
        if (dynamic && !hasConstraints) {
          return <String, Object?>{
            r'$ref': _commonRef('DynamicString', atLeastV1),
            ...meta,
            'default': ?defaultValue,
          };
        }
        if (dynamic &&
            formats != null &&
            formats.length > 1 &&
            pattern == null &&
            minLength == null &&
            maxLength == null) {
          return <String, Object?>{
            'allOf': <Object?>[
              <String, Object?>{
                r'$ref': _commonRef('DynamicString', atLeastV1),
              },
              <String, Object?>{
                'if': <String, Object?>{'type': 'string'},
                'then': <String, Object?>{
                  'oneOf': <Object?>[
                    for (final String f in formats)
                      <String, Object?>{'format': f},
                  ],
                },
              },
            ],
            ...meta,
            'default': ?defaultValue,
          };
        }
        final literal = <String, Object?>{
          'type': 'string',
          if (format != null)
            'format': format
          else if (formats != null && formats.length > 1)
            'oneOf': [
              for (final String f in formats) <String, Object?>{'format': f},
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
          return <String, Object?>{
            r'$ref': _commonRef('DynamicNumber', atLeastV1),
            ...meta,
            'default': ?defaultValue,
          };
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
          return <String, Object?>{
            r'$ref': _commonRef('DynamicBoolean', atLeastV1),
            ...meta,
            'default': ?defaultValue,
          };
        }
        return <String, Object?>{
          'type': 'boolean',
          ...meta,
          'default': ?defaultValue,
        };

      case EnumType(
        :final values,
        :final valueType,
        :final dynamic,
        :final defaultValue,
      ):
        final literal = <String, Object?>{
          'type': valueType.jsonValue,
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
            r'$ref': _commonRef('DynamicValue', atLeastV1),
            ...meta,
            if (hasDefault) 'default': _deepCopyValue(defaultValue),
          };
        }
        return <String, Object?>{
          ...meta,
          if (hasDefault) 'default': _deepCopyValue(defaultValue),
        };

      case ObjectType(
        :final dynamic,
        :final properties,
        :final additionalProperties,
        :final additionalPropertiesType,
        :final atLeastOneOf,
        :final defaultValue,
      ):
        final propsMap = <String, Object?>{
          for (final ParameterDefinition p in properties)
            p.name: typeDefinitionToJsonSchema(p.type, atLeastV1: atLeastV1),
        };
        final required = <String>[
          for (final ParameterDefinition p in properties)
            if (p.required) p.name,
        ];
        final literal = <String, Object?>{
          'type': 'object',
          if (propsMap.isNotEmpty) 'properties': propsMap,
          if (required.isNotEmpty) 'required': required,
          ..._atLeastOneOfToJsonSchema(atLeastOneOf),
          if (additionalPropertiesType != null)
            'additionalProperties': typeDefinitionToJsonSchema(
              additionalPropertiesType,
              atLeastV1: atLeastV1,
            )
          else if (!additionalProperties && propsMap.isNotEmpty)
            'additionalProperties': false
          else if (additionalProperties)
            'additionalProperties': true
          else
            'additionalProperties': false,
        };
        if (dynamic) return wrapDynamic(literal);
        return <String, Object?>{
          ...literal,
          ...meta,
          if (defaultValue != null) 'default': _deepCopyValue(defaultValue),
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
            items.formats == null &&
            items.pattern == null &&
            items.minLength == null &&
            items.maxLength == null &&
            minItems == null &&
            maxItems == null &&
            !uniqueItems;
        if (isDynamicStringList) {
          return <String, Object?>{
            r'$ref': _commonRef('DynamicStringList', atLeastV1),
            ...meta,
            if (defaultValue != null) 'default': _deepCopyValue(defaultValue),
          };
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
          if (defaultValue != null) 'default': _deepCopyValue(defaultValue),
        };

      case UnionType(
        :final variants,
        :final exclusive,
        :final dynamic,
        :final hasDefault,
        :final defaultValue,
      ):
        final List<Object?> branchSchemas = [
          for (final TypeDefinition v in variants)
            typeDefinitionToJsonSchema(v, atLeastV1: atLeastV1),
          if (dynamic)
            <String, Object?>{r'$ref': _commonRef('DataBinding', atLeastV1)},
          if (dynamic)
            <String, Object?>{r'$ref': _commonRef('FunctionCall', atLeastV1)},
        ];
        return <String, Object?>{
          ...meta,
          if (hasDefault) 'default': _deepCopyValue(defaultValue),
          exclusive ? 'oneOf' : 'anyOf': branchSchemas,
        };

      case DataBindingType():
        return <String, Object?>{
          r'$ref': _commonRef('DataBinding', atLeastV1),
          ...meta,
        };

      case FunctionCallType():
        return <String, Object?>{
          r'$ref': _commonRef('FunctionCall', atLeastV1),
          ...meta,
        };

      case RefType(:final ref, :final hasDefault, :final defaultValue):
        return <String, Object?>{
          r'$ref': '#/\$defs/$ref',
          ...meta,
          if (hasDefault) 'default': _deepCopyValue(defaultValue),
        };

      case ChildType():
        return <String, Object?>{
          r'$ref': _commonRef(atLeastV1 ? 'Child' : 'ComponentId', atLeastV1),
          ...meta,
        };

      case ChildListType():
        return <String, Object?>{
          r'$ref': _commonRef('ChildList', atLeastV1),
          ...meta,
        };

      case ActionType():
        return <String, Object?>{
          r'$ref': _commonRef('Action', atLeastV1),
          ...meta,
        };

      case CheckRuleType():
        return <String, Object?>{
          r'$ref': _commonRef('CheckRule', atLeastV1),
          ...meta,
        };

      case AccessibilityType():
        return <String, Object?>{
          r'$ref': _commonRef('AccessibilityAttributes', atLeastV1),
          ...meta,
        };

      case RawJsonSchemaType(:final schema):
        return _deepCopyMap(schema);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  static String _commonRef(String name, bool atLeastV1) =>
      'common_types.json#/\$defs/$name';

  static TypeDefinition? _commonTypeToDefinition(
    String name, {
    required String? description,
    required bool deprecated,
    required String? deprecatedReason,
    required bool hasDefault,
    required Object? defaultValue,
    required bool allowComponentTypes,
  }) => switch (name) {
    'DynamicString' => StringType(
      dynamic: true,
      defaultValue: defaultValue is String ? defaultValue : null,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
    ),
    'DynamicNumber' => NumberType(
      dynamic: true,
      defaultValue: defaultValue is num ? defaultValue : null,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
    ),
    'DynamicBoolean' => BooleanType(
      dynamic: true,
      defaultValue: defaultValue is bool ? defaultValue : null,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
    ),
    'DynamicStringList' => ArrayType(
      dynamic: true,
      items: const StringType(),
      defaultValue: defaultValue is List
          ? (_deepCopyValue(defaultValue)! as List<Object?>)
          : null,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
    ),
    'DynamicValue' =>
      hasDefault
          ? AnyType(
              dynamic: true,
              defaultValue: _deepCopyValue(defaultValue),
              description: description,
              deprecated: deprecated,
              deprecatedReason: deprecatedReason,
            )
          : AnyType(
              dynamic: true,
              description: description,
              deprecated: deprecated,
              deprecatedReason: deprecatedReason,
            ),
    'DataBinding' => DataBindingType(
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
    ),
    'FunctionCall' => FunctionCallType(
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
    ),
    'Child' || 'ComponentId' when allowComponentTypes => ChildType(
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
    ),
    'ChildList' when allowComponentTypes => ChildListType(
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
    ),
    'Action' when allowComponentTypes => ActionType(
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
    ),
    'CheckRule' when allowComponentTypes => CheckRuleType(
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
    ),
    'AccessibilityAttributes' when allowComponentTypes => AccessibilityType(
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason,
    ),
    _ => null,
  };

  static Map<String, Object?> _atLeastOneOfToJsonSchema(
    List<List<String>>? groups,
  ) {
    if (groups == null || groups.isEmpty) return const {};
    if (groups.length == 1) {
      return <String, Object?>{
        'anyOf': <Object?>[
          for (final String name in groups.single)
            <String, Object?>{
              'required': <String>[name],
            },
        ],
      };
    }
    return <String, Object?>{
      'allOf': <Object?>[
        for (final List<String> group in groups)
          <String, Object?>{
            'anyOf': <Object?>[
              for (final String name in group)
                <String, Object?>{
                  'required': <String>[name],
                },
            ],
          },
      ],
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
    return List.unmodifiable(names);
  }

  static ({bool flag, TypeDefinition? type}) _extractAdditionalProperties(
    Map<String, Object?> schema, {
    required Map<String, Object?> definitions,
    required Map<String, Object?>? rootDoc,
    required Set<String> knownTypeNames,
    required bool atLeastV1,
    required bool allowComponentTypes,
    required bool defaultOpen,
    Set<String>? visitedRefs,
    Set<Object>? visitedMaps,
  }) {
    final Object? ap = schema.containsKey('additionalProperties')
        ? schema['additionalProperties']
        : schema['unevaluatedProperties'];
    if (ap == null) return (flag: defaultOpen, type: null);
    if (ap is bool) return (flag: ap, type: null);
    if (_asStringMap(ap) case final Map<String, Object?> apMap) {
      return (
        flag: false,
        type: schemaToTypeDefinition(
          apMap,
          definitions: definitions,
          rootDoc: rootDoc,
          knownTypeNames: knownTypeNames,
          atLeastV1: atLeastV1,
          allowComponentTypes: allowComponentTypes,
          visitedRefs: visitedRefs,
          visitedMaps: visitedMaps,
        ),
      );
    }
    return (flag: defaultOpen, type: null);
  }

  static ({String? description, String? embeddedRef}) _extractDescription(
    Map<String, Object?> schema,
  ) {
    final String? rawDesc = _stringOrNull(schema['description']);
    if (rawDesc == null) return (description: null, embeddedRef: null);
    final RegExpMatch? match = _refDescriptionPattern.firstMatch(rawDesc);
    if (match == null) return (description: rawDesc, embeddedRef: null);
    final String? remainder = match.group(2);
    return (
      description: (remainder != null && remainder.isNotEmpty)
          ? remainder
          : null,
      embeddedRef: match.group(1),
    );
  }

  static String? _rawRef(Map<String, Object?> schema) =>
      _stringOrNull(schema['commonTypesRef']) ?? _stringOrNull(schema[r'$ref']);

  static String? _commonTypeNameFromRef(String ref) {
    final int hash = ref.indexOf('#');
    if (hash <= 0) return null;
    final String doc = ref.substring(0, hash);
    final String fragment = ref.substring(hash);
    if (!doc.endsWith('common_types.json')) return null;
    if (!fragment.startsWith(r'#/$defs/')) return null;
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
    if (props != null && props.containsKey('component')) return true;
    return false;
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
    if (itemProps != null &&
        itemProps.containsKey('condition') &&
        itemProps.containsKey('message')) {
      return true;
    }
    return false;
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

  static String? _stringOrNull(Object? value) => value is String ? value : null;

  static int? _intOrNull(Object? value) => value is int ? value : null;

  static num? _numOrNull(Object? value) => value is num ? value : null;

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

  static Map<String, Object?> _deepCopyMap(
    Map<String, Object?> map, [
    Set<Object>? seen,
  ]) {
    final Set<Object> visited = seen ?? Set<Object>.identity();
    if (!visited.add(map)) return <String, Object?>{};
    try {
      return <String, Object?>{
        for (final MapEntry<String, Object?> entry in map.entries)
          entry.key: _deepCopyValue(entry.value, visited),
      };
    } finally {
      visited.remove(map);
    }
  }

  static Object? _deepCopyValue(Object? value, [Set<Object>? seen]) {
    if (value is Map) {
      final Set<Object> visited = seen ?? Set<Object>.identity();
      if (!visited.add(value)) return <String, Object?>{};
      try {
        return <String, Object?>{
          for (final MapEntry<Object?, Object?> entry in value.entries)
            '${entry.key}': _deepCopyValue(entry.value, visited),
        };
      } finally {
        visited.remove(value);
      }
    }
    if (value is List) {
      final Set<Object> visited = seen ?? Set<Object>.identity();
      if (!visited.add(value)) return <Object?>[];
      try {
        return <Object?>[
          for (final Object? item in value) _deepCopyValue(item, visited),
        ];
      } finally {
        visited.remove(value);
      }
    }
    return value;
  }
}
