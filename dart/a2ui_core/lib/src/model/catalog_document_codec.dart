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

import '../primitives/errors.dart';
import '../primitives/protocol_version.dart';
import '../primitives/uax31.dart';
import 'catalog_model.dart';
import 'json_utils.dart';
import 'type_definition.dart';

/// A single structural or semantic diagnostic produced while validating an
/// A2UI Catalog Document (`formatVersion: "1.0"`).
@immutable
final class CatalogDocumentDiagnostic {
  const CatalogDocumentDiagnostic({
    required this.code,
    required this.path,
    required this.message,
  });

  /// Machine-readable diagnostic identifier (e.g. `'invalid_catalog_schema'`,
  /// `'reserved_component_name'`, `'unresolved_local_ref'`).
  final String code;

  /// RFC 6901 JSON Pointer locating the offending node.
  final String path;

  /// Human-readable description of the violation.
  final String message;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CatalogDocumentDiagnostic &&
          code == other.code &&
          path == other.path &&
          message == other.message;

  @override
  int get hashCode => Object.hash(code, path, message);

  @override
  String toString() => 'CatalogDocumentDiagnostic($code at $path: $message)';
}

/// Returns `true` if [json] is an A2UI Catalog Document (declares
/// `formatVersion`) rather than a legacy JSON Schema catalog.
bool isCatalogDocument(Map<String, Object?> json) =>
    json.containsKey('formatVersion');

/// Parses a Catalog Document (`formatVersion: "1.0"`) into a [CatalogModel].
///
/// Throws [A2uiCatalogError] on any structural or semantic violation.
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

/// Validates a Catalog Document (`formatVersion: "1.0"`) and returns every
/// structural and semantic [CatalogDocumentDiagnostic] with its JSON Pointer.
List<CatalogDocumentDiagnostic> validateCatalogDocument(
  Map<String, Object?> json,
) => CatalogDocumentCodec.validateCatalogDocument(json);

/// Serializes [model] into a plain mutable Catalog Document JSON map
/// (`formatVersion: "1.0"`).
///
/// Validates [model] first and throws [A2uiCatalogError] on any violation or
/// when [model] contains a [RawJsonSchemaType].
Map<String, Object?> serializeCatalogDocument(CatalogModel model) =>
    CatalogDocumentCodec.serializeCatalogDocument(model);

/// Codec for parsing, validating, and serializing A2UI Catalog Documents
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
  static const Set<String> _surfacePropKeys = {
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
  static const Set<String> _paramKeys = {'name', 'required'};
  static const Set<String> _shorthandReturns = {
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

  /// Parses [json] into a [CatalogModel], throwing [A2uiCatalogError] on the
  /// first violation.
  static CatalogModel parseCatalogDocument(
    Map<String, Object?> json, {
    String? expectedCatalogId,
    A2uiProtocolVersion? protocolVersion,
    String? catalogId,
  }) => _Parser(_DiagSink(failFast: true)).parseDocument(
    json,
    expectedCatalogId: expectedCatalogId,
    protocolVersion: protocolVersion,
    catalogIdOverride: catalogId,
  );

  /// Collects all structural and semantic diagnostics in [json].
  static List<CatalogDocumentDiagnostic> validateCatalogDocument(
    Map<String, Object?> json,
  ) {
    final sink = _DiagSink(failFast: false);
    _Parser(sink).parseDocument(json);
    return List<CatalogDocumentDiagnostic>.unmodifiable(sink.diagnostics);
  }

  /// Validates an in-memory [CatalogModel] against all Catalog Document
  /// invariants, throwing [A2uiCatalogError] on the first violation.
  static void validateModel(CatalogModel model) => _validateModel(
    model,
    _DiagSink(failFast: true, catalogId: model.catalogId),
  );

  /// Serializes [model] into a plain mutable Catalog Document JSON map.
  static Map<String, Object?> serializeCatalogDocument(CatalogModel model) {
    validateModel(model);
    final String? pv =
        model.declaredProtocolVersion ?? model.protocolVersion?.semverValue;
    return <String, Object?>{
      r'$schema': ?model.schemaUri,
      'formatVersion': model.formatVersion,
      'catalogId': model.catalogId,
      'protocolVersion': ?pv,
      'title': ?model.title,
      'description': ?model.description,
      'instructions': ?model.instructions,
      if (model.metadata != null) 'metadata': deepCopyJson(model.metadata),
      if (model.types.isNotEmpty)
        'types': <String, Object?>{
          for (final MapEntry<String, TypeDefinition> e in model.types.entries)
            e.key: _serializeType(e.value),
        },
      if (model.surfaceProperties case final SurfacePropertiesDefinition sp)
        'surfaceProperties': _serializeSurfaceProperties(sp),
      if (model.components.isNotEmpty)
        'components': [
          for (final c in model.components) _serializeComponent(c),
        ],
      if (model.functions.isNotEmpty)
        'functions': [for (final f in model.functions) _serializeFunction(f)],
    };
  }

  // ---------------------------------------------------------------------------
  // Single-source-of-truth semantic validator (used by parse, lint, serialize)
  // ---------------------------------------------------------------------------

  static void _validateModel(
    CatalogModel model,
    _DiagSink sink, {
    bool checkEmptyNames = true,
  }) {
    if (model.formatVersion != catalogDocumentFormatVersion) {
      sink.schema(
        '/formatVersion',
        "Unsupported Catalog Document 'formatVersion' '${model.formatVersion}'"
            "; expected '$catalogDocumentFormatVersion'.",
      );
    }
    if (model.catalogId.isEmpty) {
      sink.schema(
        '/catalogId',
        "Catalog Document 'catalogId' must be a non-empty string.",
      );
    }
    _validateMetadataMap(model.metadata, '/metadata', sink);

    for (final MapEntry<String, TypeDefinition> e in model.types.entries) {
      final ptr = '/types/${_esc(e.key)}';
      _checkId(e.key, "type name '${e.key}'", ptr, sink);
      _validateType(
        e.value,
        ptr,
        knownTypes: model.types,
        allowComponentTypes: false,
        checkEmptyNames: checkEmptyNames,
        sink: sink,
      );
    }
    _detectStructuralCycles(model.types, sink);

    if (model.surfaceProperties case final SurfacePropertiesDefinition sp) {
      if (sp.rawSchema != null) {
        sink.schema(
          '/surfaceProperties',
          'RawJsonSchemaType is not valid in a Catalog Document.',
        );
      }
      _validateParams(
        sp.properties,
        '/surfaceProperties/properties',
        knownTypes: model.types,
        allowComponentTypes: false,
        checkEmptyNames: checkEmptyNames,
        sink: sink,
      );
      if (sp.additionalPropertiesType case final TypeDefinition extra) {
        _validateType(
          extra,
          '/surfaceProperties/additionalProperties',
          knownTypes: model.types,
          allowComponentTypes: false,
          checkEmptyNames: checkEmptyNames,
          sink: sink,
        );
      }
    }

    final seenComponents = <String>{};
    for (var i = 0; i < model.components.length; i++) {
      final ComponentDefinition c = model.components[i];
      final ptr = '/components/$i';
      if (c.rawSchema != null) {
        sink.schema(
          ptr,
          'RawJsonSchemaType is not valid in a Catalog Document.',
        );
      }
      if (c.name == 'Surface') {
        sink.add(
          'reserved_component_name',
          '$ptr/name',
          "Component name 'Surface' is reserved.",
        );
      } else if (c.name.isEmpty) {
        if (checkEmptyNames) {
          sink.schema(
            '$ptr/name',
            'Component name must be a non-empty string.',
          );
        }
      } else {
        _checkId(c.name, "component name '${c.name}'", '$ptr/name', sink);
        if (!seenComponents.add(c.name)) {
          sink.add(
            'duplicate_name',
            '$ptr/name',
            "Duplicate component name '${c.name}'.",
          );
        }
      }
      _validateMetadataMap(c.metadata, '$ptr/metadata', sink);
      final Set<String> paramNames = _validateParams(
        c.parameters,
        '$ptr/parameters',
        knownTypes: model.types,
        allowComponentTypes: true,
        checkEmptyNames: checkEmptyNames,
        sink: sink,
      );
      _validateAtLeastOneOf(
        c.atLeastOneOf,
        paramNames,
        '$ptr/atLeastOneOf',
        sink,
      );
    }

    final seenFunctions = <String>{};
    for (var i = 0; i < model.functions.length; i++) {
      final FunctionDefinition fn = model.functions[i];
      final ptr = '/functions/$i';
      if (fn.rawArgumentSchema != null) {
        sink.schema(
          ptr,
          'RawJsonSchemaType is not valid in a Catalog Document.',
        );
      }
      if (fn.name.startsWith('@')) {
        sink.add(
          'reserved_function_name',
          '$ptr/name',
          "Function name '${fn.name}' must not start with '@'.",
        );
      } else if (fn.name.isEmpty) {
        if (checkEmptyNames) {
          sink.schema('$ptr/name', 'Function name must be a non-empty string.');
        }
      } else {
        _checkId(fn.name, "function name '${fn.name}'", '$ptr/name', sink);
        if (!seenFunctions.add(fn.name)) {
          sink.add(
            'duplicate_name',
            '$ptr/name',
            "Duplicate function name '${fn.name}'.",
          );
        }
      }
      if (fn.requiresUserActivation &&
          fn.allowedCallers != AllowedCallers.rendererOnly) {
        sink.add(
          'user_activation_allows_agent',
          '$ptr/requiresUserActivation',
          "Function '${fn.name}' sets requiresUserActivation: true, so "
              "allowedCallers must be 'rendererOnly' (got "
              "'${fn.allowedCallers.jsonValue}').",
        );
      }
      if (fn.returnType.type case final TypeDefinition retType) {
        _validateType(
          retType,
          '$ptr/returnType',
          knownTypes: model.types,
          allowComponentTypes: false,
          checkEmptyNames: checkEmptyNames,
          sink: sink,
        );
      }
      final Set<String> paramNames = _validateParams(
        fn.parameters,
        '$ptr/parameters',
        knownTypes: model.types,
        allowComponentTypes: false,
        checkEmptyNames: checkEmptyNames,
        sink: sink,
      );
      _validateAtLeastOneOf(
        fn.atLeastOneOf,
        paramNames,
        '$ptr/atLeastOneOf',
        sink,
      );
      if (fn.additionalParametersType case final TypeDefinition extra) {
        _validateType(
          extra,
          '$ptr/additionalParameters',
          knownTypes: model.types,
          allowComponentTypes: false,
          checkEmptyNames: checkEmptyNames,
          sink: sink,
        );
      }
    }
  }

  static void _checkId(String value, String label, String ptr, _DiagSink sink) {
    if (!isValidUax31Identifier(value)) {
      sink.add(
        'invalid_identifier',
        ptr,
        'Invalid $label: must be a Unicode UAX #31 identifier.',
      );
    }
  }

  static void _checkRange(
    num? min,
    num? max,
    String minKey,
    String maxKey,
    String ptr,
    _DiagSink sink, {
    bool nonNegative = false,
  }) {
    if (nonNegative && min != null && min < 0) {
      sink.constraint('$ptr/$minKey', '$minKey must be >= 0.');
    }
    if (nonNegative && max != null && max < 0) {
      sink.constraint('$ptr/$maxKey', '$maxKey must be >= 0.');
    }
    if (min != null && max != null && min > max) {
      sink.constraint(
        '$ptr/$minKey',
        '$minKey ($min) must not exceed $maxKey ($max).',
      );
    }
  }

  static void _validateMetadataMap(
    Map<String, Object?>? meta,
    String ptr,
    _DiagSink sink,
  ) {
    if (meta == null) return;
    for (final String key in meta.keys) {
      if (key != 'extensions') {
        sink.schema(
          '$ptr/${_esc(key)}',
          "Unknown property '$key' on metadata; only 'extensions' is allowed.",
        );
      }
    }
    if (!meta.containsKey('extensions')) return;
    final Object? ext = meta['extensions'];
    if (ext is! Map) {
      sink.schema(
        '$ptr/extensions',
        "Metadata 'extensions' must be a JSON object.",
      );
      return;
    }
    for (final Object? key in ext.keys) {
      if (key is! String || !isValidUax31Identifier(key)) {
        sink.add(
          'invalid_identifier',
          '$ptr/extensions/${_esc('$key')}',
          "Invalid metadata extension key '$key': must be a UAX #31 "
              'identifier.',
        );
      }
    }
  }

  static Set<String> _validateParams(
    List<ParameterDefinition> params,
    String ptr, {
    required Map<String, TypeDefinition> knownTypes,
    required bool allowComponentTypes,
    required bool checkEmptyNames,
    required _DiagSink sink,
  }) {
    final seen = <String>{};
    for (var i = 0; i < params.length; i++) {
      final ParameterDefinition p = params[i];
      final itemPtr = '$ptr/$i';
      if (p.name.isEmpty) {
        if (checkEmptyNames) {
          sink.schema(
            '$itemPtr/name',
            'Parameter name must be a non-empty string.',
          );
        }
      } else {
        _checkId(p.name, "parameter name '${p.name}'", '$itemPtr/name', sink);
        if (!seen.add(p.name)) {
          sink.add(
            'duplicate_name',
            '$itemPtr/name',
            "Duplicate parameter name '${p.name}'.",
          );
        }
      }
      _validateType(
        p.type,
        itemPtr,
        knownTypes: knownTypes,
        allowComponentTypes: allowComponentTypes,
        checkEmptyNames: checkEmptyNames,
        sink: sink,
      );
    }
    return seen;
  }

  static void _validateAtLeastOneOf(
    List<List<String>>? groups,
    Set<String> declared,
    String ptr,
    _DiagSink sink,
  ) {
    if (groups == null) return;
    for (var i = 0; i < groups.length; i++) {
      final List<String> group = groups[i];
      final gPtr = '$ptr/$i';
      if (group.length < 2) {
        sink.constraint(
          gPtr,
          'Each atLeastOneOf group must list at least 2 parameter names.',
        );
      }
      final seen = <String>{};
      for (var j = 0; j < group.length; j++) {
        final String name = group[j];
        if (!seen.add(name)) {
          sink.constraint(
            '$gPtr/$j',
            "Duplicate parameter '$name' in atLeastOneOf group.",
          );
        }
        if (!declared.contains(name)) {
          sink.constraint(
            '$gPtr/$j',
            "atLeastOneOf references unknown parameter '$name'.",
          );
        }
      }
    }
  }

  static void _validateType(
    TypeDefinition type,
    String ptr, {
    required Map<String, TypeDefinition> knownTypes,
    required bool allowComponentTypes,
    required bool checkEmptyNames,
    required _DiagSink sink,
  }) {
    if (!allowComponentTypes &&
        (type is ChildType ||
            type is ChildListType ||
            type is ActionType ||
            type is CheckRuleType ||
            type is AccessibilityType)) {
      sink.schema(
        '$ptr/type',
        'Component-only type ${type.runtimeType} is not allowed in a '
            'data-only context.',
      );
      return;
    }
    switch (type) {
      case StringType(
        :final format,
        :final formats,
        :final pattern,
        :final minLength,
        :final maxLength,
      ):
        if (format != null && formats != null) {
          sink.constraint(
            '$ptr/formats',
            "Type 'string' cannot specify both 'format' and 'formats'.",
          );
        }
        if (formats != null && formats.isEmpty) {
          sink.constraint(
            '$ptr/formats',
            "Field 'formats' must be a non-empty array of strings.",
          );
        }
        _checkRange(
          minLength,
          maxLength,
          'minLength',
          'maxLength',
          ptr,
          sink,
          nonNegative: true,
        );
        if (pattern != null) {
          try {
            RegExp(pattern, unicode: true);
          } on FormatException catch (e) {
            sink.constraint(
              '$ptr/pattern',
              "Invalid regular expression pattern '$pattern': ${e.message}",
            );
          }
        }
      case NumberType(:final min, :final max):
        _checkRange(min, max, 'min', 'max', ptr, sink);
      case IntegerType(:final min, :final max):
        _checkRange(min, max, 'min', 'max', ptr, sink);
      case EnumType(:final values, :final valueType, :final defaultValue):
        if (values.isEmpty) {
          sink.constraint('$ptr/values', 'EnumType values must be non-empty.');
        }
        for (var i = 0; i < values.length; i++) {
          if (!_matchesEnumValueType(values[i], valueType)) {
            sink.schema(
              '$ptr/values/$i',
              "Enum value '${values[i]}' does not match valueType "
                  "'${valueType.jsonValue}'.",
            );
          }
        }
        if (defaultValue != null &&
            (!_matchesEnumValueType(defaultValue, valueType) ||
                !values.contains(defaultValue))) {
          sink.constraint(
            '$ptr/default',
            "Enum default '$defaultValue' must be a member of values matching "
                "valueType '${valueType.jsonValue}'.",
          );
        }
      case ObjectType(
        :final properties,
        :final additionalPropertiesType,
        :final atLeastOneOf,
      ):
        final Set<String> names = _validateParams(
          properties,
          '$ptr/properties',
          knownTypes: knownTypes,
          allowComponentTypes: allowComponentTypes,
          checkEmptyNames: checkEmptyNames,
          sink: sink,
        );
        _validateAtLeastOneOf(atLeastOneOf, names, '$ptr/atLeastOneOf', sink);
        if (additionalPropertiesType != null) {
          _validateType(
            additionalPropertiesType,
            '$ptr/additionalProperties',
            knownTypes: knownTypes,
            allowComponentTypes: allowComponentTypes,
            checkEmptyNames: checkEmptyNames,
            sink: sink,
          );
        }
      case ArrayType(:final items, :final minItems, :final maxItems):
        _checkRange(
          minItems,
          maxItems,
          'minItems',
          'maxItems',
          ptr,
          sink,
          nonNegative: true,
        );
        if (items != null) {
          _validateType(
            items,
            '$ptr/items',
            knownTypes: knownTypes,
            allowComponentTypes: allowComponentTypes,
            checkEmptyNames: checkEmptyNames,
            sink: sink,
          );
        }
      case UnionType(:final variants):
        if (variants.length < 2) {
          sink.constraint(
            '$ptr/variants',
            'UnionType must declare at least 2 variants.',
          );
        }
        for (var i = 0; i < variants.length; i++) {
          _validateType(
            variants[i],
            '$ptr/variants/$i',
            knownTypes: knownTypes,
            allowComponentTypes: allowComponentTypes,
            checkEmptyNames: checkEmptyNames,
            sink: sink,
          );
        }
      case RefType(:final ref):
        if (ref.isEmpty) {
          if (checkEmptyNames) {
            sink.schema('$ptr/ref', 'RefType ref must be a non-empty string.');
          }
        } else if (!knownTypes.containsKey(ref)) {
          sink.add(
            'unresolved_local_ref',
            '$ptr/ref',
            "Unresolved local type reference '$ref'.",
          );
        }
      case RawJsonSchemaType():
        sink.schema(
          ptr,
          'RawJsonSchemaType is not valid in a Catalog Document.',
        );
      case BooleanType() ||
          ConstType() ||
          AnyType() ||
          DataBindingType() ||
          FunctionCallType() ||
          ChildType() ||
          ChildListType() ||
          ActionType() ||
          CheckRuleType() ||
          AccessibilityType():
        break;
    }
  }

  /// Detects direct and structural cycles in [types] via 3-color DFS.
  static void _detectStructuralCycles(
    Map<String, TypeDefinition> types,
    _DiagSink sink,
  ) {
    final state = <String, int>{}; // 1 = visiting, 2 = done
    final reported = <String>{};
    late final void Function(String, List<String>) visitName;

    void visitType(TypeDefinition type, String origin, List<String> chain) {
      switch (type) {
        case RefType(:final ref):
          if (!types.containsKey(ref)) return;
          if (state[ref] == 1) {
            if (reported.add(ref)) {
              final int start = chain.indexOf(ref);
              final String cycle = [
                ...(start >= 0 ? chain.sublist(start) : chain),
                ref,
              ].join(' -> ');
              sink.add(
                'invalid_constraint',
                '/types/${_esc(origin)}',
                "Cyclic local type reference in 'types': $cycle.",
              );
            }
            return;
          }
          if (state[ref] == 2) return;
          visitName(ref, chain);
        case ObjectType(:final properties, :final additionalPropertiesType):
          for (final p in properties) {
            visitType(p.type, origin, chain);
          }
          if (additionalPropertiesType != null) {
            visitType(additionalPropertiesType, origin, chain);
          }
        case ArrayType(:final items):
          if (items != null) visitType(items, origin, chain);
        case UnionType(:final variants):
          for (final v in variants) {
            visitType(v, origin, chain);
          }
        case StringType() ||
            NumberType() ||
            IntegerType() ||
            BooleanType() ||
            EnumType() ||
            ConstType() ||
            AnyType() ||
            DataBindingType() ||
            FunctionCallType() ||
            ChildType() ||
            ChildListType() ||
            ActionType() ||
            CheckRuleType() ||
            AccessibilityType() ||
            RawJsonSchemaType():
          break;
      }
    }

    visitName = (String name, List<String> chain) {
      state[name] = 1;
      chain.add(name);
      visitType(types[name]!, name, chain);
      chain.removeLast();
      state[name] = 2;
    };

    for (final String name in types.keys) {
      if (state[name] == null) visitName(name, <String>[]);
    }
  }

  static bool _matchesEnumValueType(Object value, EnumValueType type) =>
      switch (type) {
        EnumValueType.string => value is String,
        EnumValueType.number => value is num,
        EnumValueType.boolean => value is bool,
      };

  // ---------------------------------------------------------------------------
  // Serialization helpers (plain mutable JSON output)
  // ---------------------------------------------------------------------------

  static Map<String, Object?> _serializeSurfaceProperties(
    SurfacePropertiesDefinition sp,
  ) => <String, Object?>{
    'description': ?sp.description,
    if (sp.properties.isNotEmpty)
      'properties': [for (final p in sp.properties) _serializeParameter(p)],
    if (sp.additionalPropertiesType case final TypeDefinition extra)
      'additionalProperties': _serializeType(extra)
    else if (sp.additionalProperties)
      'additionalProperties': true,
  };

  static Map<String, Object?> _serializeComponent(ComponentDefinition c) =>
      <String, Object?>{
        'name': c.name,
        'description': ?c.description,
        if (c.checkable) 'checkable': true,
        if (c.parameters.isNotEmpty)
          'parameters': [for (final p in c.parameters) _serializeParameter(p)],
        if (c.atLeastOneOf case final List<List<String>> groups
            when groups.isNotEmpty)
          'atLeastOneOf': [for (final g in groups) List<String>.of(g)],
        if (c.allowedParents case final List<String> parents)
          'allowedParents': List<String>.of(parents),
        if (c.allowedChildren case final List<String> children)
          'allowedChildren': List<String>.of(children),
        if (c.metadata != null) 'metadata': deepCopyJson(c.metadata),
        if (c.deprecated) 'deprecated': true,
        'deprecatedReason': ?c.deprecatedReason,
      };

  static Map<String, Object?> _serializeFunction(FunctionDefinition f) =>
      <String, Object?>{
        'name': f.name,
        'description': ?f.description,
        'returnType': _serializeReturnType(f.returnType),
        if (f.allowedCallers != AllowedCallers.rendererOnly)
          'allowedCallers': f.allowedCallers.jsonValue,
        if (f.requiresUserActivation) 'requiresUserActivation': true,
        if (f.parameters.isNotEmpty)
          'parameters': [for (final p in f.parameters) _serializeParameter(p)],
        if (f.atLeastOneOf case final List<List<String>> groups
            when groups.isNotEmpty)
          'atLeastOneOf': [for (final g in groups) List<String>.of(g)],
        if (f.additionalParametersType case final TypeDefinition extra)
          'additionalParameters': _serializeType(extra)
        else if (f.additionalParameters)
          'additionalParameters': true,
        if (f.deprecated) 'deprecated': true,
        'deprecatedReason': ?f.deprecatedReason,
      };

  static Object _serializeReturnType(FunctionReturnDefinition ret) {
    if (ret.shorthandName case final String short) return short;
    if (ret.type case final TypeDefinition t) return _serializeType(t);
    return <String, Object?>{
      'type': ret.isIntegerShorthand ? 'integer' : ret.returnType.jsonValue,
      'description': ?ret.description,
    };
  }

  static Map<String, Object?> _serializeParameter(ParameterDefinition p) =>
      <String, Object?>{
        'name': p.name,
        ..._serializeType(p.type),
        if (p.required) 'required': true,
      };

  static Map<String, Object?> _serializeType(TypeDefinition t) {
    final common = <String, Object?>{
      'description': ?t.description,
      if (t.deprecated) 'deprecated': true,
      'deprecatedReason': ?t.deprecatedReason,
    };
    return switch (t) {
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
          'format': ?format,
          if (formats != null) 'formats': List<String>.of(formats),
          'pattern': ?pattern,
          'minLength': ?minLength,
          'maxLength': ?maxLength,
          'default': ?defaultValue,
          ...common,
        },
      NumberType(:final dynamic, :final min, :final max, :final defaultValue) =>
        <String, Object?>{
          'type': 'number',
          if (dynamic) 'dynamic': true,
          'min': ?min,
          'max': ?max,
          'default': ?defaultValue,
          ...common,
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
          ...common,
        },
      BooleanType(:final dynamic, :final defaultValue) => <String, Object?>{
        'type': 'boolean',
        if (dynamic) 'dynamic': true,
        'default': ?defaultValue,
        ...common,
      },
      EnumType(
        :final values,
        :final valueType,
        :final dynamic,
        :final defaultValue,
      ) =>
        <String, Object?>{
          'type': 'enum',
          if (valueType != EnumValueType.string)
            'valueType': valueType.jsonValue,
          'values': List<Object>.of(values),
          if (dynamic) 'dynamic': true,
          'default': ?defaultValue,
          ...common,
        },
      ConstType(:final value) => <String, Object?>{
        'type': 'const',
        'value': value,
        ...common,
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
          if (hasDefault) 'default': deepCopyJson(defaultValue),
          ...common,
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
            'properties': [for (final p in properties) _serializeParameter(p)],
          if (additionalPropertiesType != null)
            'additionalProperties': _serializeType(additionalPropertiesType)
          else if (additionalProperties)
            'additionalProperties': true,
          if (atLeastOneOf != null && atLeastOneOf.isNotEmpty)
            'atLeastOneOf': [for (final g in atLeastOneOf) List<String>.of(g)],
          if (defaultValue != null) 'default': deepCopyJson(defaultValue),
          ...common,
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
          if (items != null) 'items': _serializeType(items),
          'minItems': ?minItems,
          'maxItems': ?maxItems,
          if (uniqueItems) 'uniqueItems': true,
          if (defaultValue != null) 'default': deepCopyJson(defaultValue),
          ...common,
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
          'variants': [for (final v in variants) _serializeType(v)],
          if (exclusive) 'exclusive': true,
          if (dynamic) 'dynamic': true,
          if (hasDefault) 'default': deepCopyJson(defaultValue),
          ...common,
        },
      RefType(:final ref, :final hasDefault, :final defaultValue) =>
        <String, Object?>{
          'type': 'ref',
          'ref': ref,
          if (hasDefault) 'default': deepCopyJson(defaultValue),
          ...common,
        },
      DataBindingType() => <String, Object?>{'type': 'dataBinding', ...common},
      FunctionCallType() => <String, Object?>{
        'type': 'functionCall',
        ...common,
      },
      ChildType() => <String, Object?>{'type': 'child', ...common},
      ChildListType() => <String, Object?>{'type': 'childList', ...common},
      ActionType() => <String, Object?>{'type': 'action', ...common},
      CheckRuleType() => <String, Object?>{'type': 'checkRule', ...common},
      AccessibilityType() => <String, Object?>{
        'type': 'accessibility',
        ...common,
      },
      RawJsonSchemaType() => throw A2uiCatalogError(
        'Cannot serialize RawJsonSchemaType into a Catalog Document.',
      ),
    };
  }
}

// -----------------------------------------------------------------------------
// Diagnostic sink & strict JSON reader
// -----------------------------------------------------------------------------

final class _DiagSink {
  _DiagSink({required this.failFast, this.catalogId});

  final bool failFast;
  String? catalogId;
  final List<CatalogDocumentDiagnostic> diagnostics = [];

  void add(String code, String path, String message) {
    if (failFast) throw A2uiCatalogError(message, catalogId: catalogId);
    diagnostics.add(
      CatalogDocumentDiagnostic(code: code, path: path, message: message),
    );
  }

  void schema(String path, String message) =>
      add('invalid_catalog_schema', path, message);

  void constraint(String path, String message) =>
      add('invalid_constraint', path, message);
}

final class _JsonReader {
  _JsonReader(this.map, this.ptr, this.sink);

  final Map<String, Object?> map;
  final String ptr;
  final _DiagSink sink;

  String child(String key) => '$ptr/${_esc(key)}';

  void rejectUnknown(Set<String> allowed, String context) {
    for (final String key in map.keys) {
      if (!allowed.contains(key)) {
        sink.schema(child(key), "Unknown property '$key' on $context.");
      }
    }
  }

  T? opt<T>(String key, String typeName) {
    if (!map.containsKey(key)) return null;
    final Object? v = map[key];
    if (v is T) return v;
    sink.schema(child(key), "Field '$key' must be a $typeName.");
    return null;
  }

  String? str(String key) => opt<String>(key, 'string');

  String? nonEmptyStr(String key) {
    final String? s = str(key);
    if (s != null && s.isEmpty) {
      sink.schema(child(key), "Field '$key' must be a non-empty string.");
      return null;
    }
    return s;
  }

  String reqStr(String key) {
    if (!map.containsKey(key)) {
      sink.schema(child(key), "Missing required string field '$key'.");
      return '';
    }
    return nonEmptyStr(key) ?? '';
  }

  bool flag(String key) => opt<bool>(key, 'boolean') ?? false;
  bool? optBool(String key) => opt<bool>(key, 'boolean');
  num? number(String key) => opt<num>(key, 'number');
  int? integer(String key) => opt<int>(key, 'integer');
  List<Object?>? optList(String key) => opt<List<Object?>>(key, 'array');

  Map<String, Object?>? optMap(String key) {
    if (!map.containsKey(key)) return null;
    final Map<String, Object?>? m = _asStringMap(map[key]);
    if (m == null) {
      sink.schema(child(key), "Field '$key' must be a JSON object.");
    }
    return m;
  }

  List<String>? strList(String key, {bool nonEmpty = false}) {
    final List<Object?>? raw = optList(key);
    if (raw == null) return null;
    if (nonEmpty && raw.isEmpty) {
      sink.constraint(
        child(key),
        "Field '$key' must be a non-empty array of strings.",
      );
      return null;
    }
    final out = <String>[];
    for (var i = 0; i < raw.length; i++) {
      final Object? item = raw[i];
      if (item is! String || item.isEmpty) {
        sink.schema(
          '${child(key)}/$i',
          "Items of '$key' must be non-empty strings.",
        );
      } else {
        out.add(item);
      }
    }
    return List<String>.unmodifiable(out);
  }
}

// -----------------------------------------------------------------------------
// Syntax-only parser that delegates all semantic checks to `_validateModel`
// -----------------------------------------------------------------------------

typedef _MarkerCtor = TypeDefinition Function({
  String? description,
  bool deprecated,
  String? deprecatedReason,
});

final class _Parser {
  _Parser(this.sink);

  final _DiagSink sink;

  static const Map<String, _MarkerCtor> _markerTypes = {
    'dataBinding': DataBindingType.new,
    'functionCall': FunctionCallType.new,
    'child': ChildType.new,
    'childList': ChildListType.new,
    'action': ActionType.new,
    'checkRule': CheckRuleType.new,
    'accessibility': AccessibilityType.new,
  };

  CatalogModel parseDocument(
    Map<String, Object?> json, {
    String? expectedCatalogId,
    A2uiProtocolVersion? protocolVersion,
    String? catalogIdOverride,
  }) {
    final r = _JsonReader(json, '', sink);
    final rawFmt = json['formatVersion'] is String
        ? json['formatVersion']! as String
        : '${json['formatVersion']}';
    if (json['formatVersion'] != catalogDocumentFormatVersion) {
      sink.schema(
        '/formatVersion',
        "Unsupported Catalog Document 'formatVersion' "
            "'${json['formatVersion']}'; expected "
            "'$catalogDocumentFormatVersion'.",
      );
    }

    // `catalogId` is always required in a Catalog Document even with override.
    final String docCatalogId = r.reqStr('catalogId');
    final String effectiveId = catalogIdOverride ?? docCatalogId;
    if (catalogIdOverride != null && catalogIdOverride.isEmpty) {
      sink.schema(
        '/catalogId',
        'Override catalogId must be a non-empty string.',
      );
    }
    sink.catalogId = effectiveId.isEmpty ? null : effectiveId;
    if (expectedCatalogId != null &&
        effectiveId.isNotEmpty &&
        expectedCatalogId != effectiveId) {
      sink.schema(
        '/catalogId',
        "Catalog id mismatch: expected '$expectedCatalogId' but the document "
            "declares '$effectiveId'.",
      );
    }

    r.rejectUnknown(CatalogDocumentCodec._rootKeys, 'Catalog document');
    String? declaredVersion;
    A2uiProtocolVersion effectiveVersion =
        protocolVersion ?? A2uiProtocolVersion.v1_0;
    if (json.containsKey('protocolVersion')) {
      final String? rawVer = r.nonEmptyStr('protocolVersion');
      if (rawVer != null) {
        final A2uiProtocolVersion? parsed = A2uiProtocolVersion.tryParseSemVer(
          rawVer,
        );
        if (parsed == null) {
          sink.schema(
            '/protocolVersion',
            "Unsupported catalog 'protocolVersion' '$rawVer'; supported "
                'versions are ${A2uiProtocolVersion.supportedVersions}.',
          );
        } else {
          declaredVersion = rawVer;
          effectiveVersion = parsed;
        }
      }
    }

    final Map<String, Object?>? rawMeta = r.optMap('metadata');
    final types = <String, TypeDefinition>{};
    if (r.optMap('types') case final Map<String, Object?> rawTypes) {
      for (final MapEntry<String, Object?> e in rawTypes.entries) {
        final ptr = '/types/${_esc(e.key)}';
        final Map<String, Object?>? typeObj = _asStringMap(e.value);
        if (typeObj == null) {
          sink.schema(ptr, "Type '${e.key}' must be a JSON object.");
          continue;
        }
        types[e.key] = _parseType(typeObj, ptr, extraAllowedKeys: const {});
      }
    }

    SurfacePropertiesDefinition? surfaceProps;
    if (r.optMap('surfaceProperties') case final Map<String, Object?> spMap) {
      final sr = _JsonReader(spMap, '/surfaceProperties', sink);
      sr.rejectUnknown(
        CatalogDocumentCodec._surfacePropKeys,
        'surfaceProperties',
      );
      final (:bool flag, :TypeDefinition? type) = _parseAdditional(
        sr,
        'additionalProperties',
      );
      surfaceProps = SurfacePropertiesDefinition(
        description: sr.str('description'),
        properties: _parseParams(sr, 'properties'),
        additionalProperties: flag,
        additionalPropertiesType: type,
      );
    }

    final components = <ComponentDefinition>[];
    if (r.optList('components') case final List<Object?> rawComps) {
      for (var i = 0; i < rawComps.length; i++) {
        final ptr = '/components/$i';
        final Map<String, Object?>? obj = _asStringMap(rawComps[i]);
        if (obj == null) {
          sink.schema(ptr, 'Each component entry must be a JSON object.');
          continue;
        }
        components.add(_parseComponent(obj, ptr));
      }
    }

    final functions = <FunctionDefinition>[];
    if (r.optList('functions') case final List<Object?> rawFns) {
      for (var i = 0; i < rawFns.length; i++) {
        final ptr = '/functions/$i';
        final Map<String, Object?>? obj = _asStringMap(rawFns[i]);
        if (obj == null) {
          sink.schema(ptr, 'Each function entry must be a JSON object.');
          continue;
        }
        functions.add(_parseFunction(obj, ptr));
      }
    }

    final model = CatalogModel(
      formatVersion: rawFmt,
      schemaUri: r.str(r'$schema'),
      catalogId: effectiveId,
      protocolVersion: effectiveVersion,
      declaredProtocolVersion: declaredVersion,
      title: r.str('title'),
      description: r.str('description'),
      instructions: r.str('instructions'),
      metadata: rawMeta == null
          ? null
          : deepCopyJsonMap(rawMeta, unmodifiable: true),
      types: Map<String, TypeDefinition>.unmodifiable(types),
      surfaceProperties: surfaceProps,
      components: List<ComponentDefinition>.unmodifiable(components),
      functions: List<FunctionDefinition>.unmodifiable(functions),
    );
    final toValidate =
        model.formatVersion == catalogDocumentFormatVersion &&
            model.catalogId.isNotEmpty
        ? model
        : CatalogModel(
            catalogId: model.catalogId.isEmpty ? '_invalid_' : model.catalogId,
            protocolVersion: model.protocolVersion,
            metadata: model.metadata,
            types: model.types,
            surfaceProperties: model.surfaceProperties,
            components: model.components,
            functions: model.functions,
          );
    CatalogDocumentCodec._validateModel(
      toValidate,
      sink,
      checkEmptyNames: false,
    );
    return model;
  }

  ComponentDefinition _parseComponent(Map<String, Object?> json, String ptr) {
    final r = _JsonReader(json, ptr, sink);
    r.rejectUnknown(CatalogDocumentCodec._componentKeys, 'component');
    final Map<String, Object?>? rawMeta = r.optMap('metadata');
    return ComponentDefinition(
      name: r.reqStr('name'),
      description: r.str('description'),
      checkable: r.flag('checkable'),
      parameters: _parseParams(r, 'parameters'),
      atLeastOneOf: _parseAtLeastOneOf(r),
      allowedParents: r.strList('allowedParents'),
      allowedChildren: r.strList('allowedChildren'),
      metadata: rawMeta == null
          ? null
          : deepCopyJsonMap(rawMeta, unmodifiable: true),
      deprecated: r.flag('deprecated'),
      deprecatedReason: r.str('deprecatedReason'),
    );
  }

  FunctionDefinition _parseFunction(Map<String, Object?> json, String ptr) {
    final r = _JsonReader(json, ptr, sink);
    r.rejectUnknown(CatalogDocumentCodec._functionKeys, 'function');
    AllowedCallers? allowedCallers;
    if (json.containsKey('allowedCallers')) {
      final String? raw = r.nonEmptyStr('allowedCallers');
      if (raw != null) {
        try {
          allowedCallers = AllowedCallers.fromJson(raw);
        } on A2uiCatalogError catch (e) {
          sink.schema('$ptr/allowedCallers', e.message);
        }
      }
    }
    final (:bool flag, :TypeDefinition? type) = _parseAdditional(
      r,
      'additionalParameters',
    );
    return FunctionDefinition(
      name: r.reqStr('name'),
      description: r.str('description'),
      returnType: _parseReturnType(json, '$ptr/returnType'),
      allowedCallers: allowedCallers,
      requiresUserActivation: r.optBool('requiresUserActivation'),
      parameters: _parseParams(r, 'parameters'),
      atLeastOneOf: _parseAtLeastOneOf(r),
      additionalParameters: flag,
      additionalParametersType: type,
      deprecated: r.flag('deprecated'),
      deprecatedReason: r.str('deprecatedReason'),
    );
  }

  FunctionReturnDefinition _parseReturnType(
    Map<String, Object?> fnMap,
    String ptr,
  ) {
    if (!fnMap.containsKey('returnType')) {
      sink.schema(ptr, "Function is missing required field 'returnType'.");
      return const FunctionReturnDefinition.shorthand(A2uiReturnType.any);
    }
    final Object? raw = fnMap['returnType'];
    if (raw is String) {
      if (!CatalogDocumentCodec._shorthandReturns.contains(raw)) {
        sink.schema(
          ptr,
          "Invalid function returnType '$raw'; expected one of "
          '${CatalogDocumentCodec._shorthandReturns.join(', ')}.',
        );
        return const FunctionReturnDefinition.shorthand(A2uiReturnType.any);
      }
      if (raw == 'integer') return const FunctionReturnDefinition.integer();
      return FunctionReturnDefinition.shorthand(A2uiReturnType.fromJson(raw));
    }
    final Map<String, Object?>? obj = _asStringMap(raw);
    if (obj == null) {
      sink.schema(
        ptr,
        "Function 'returnType' must be a string or a type object.",
      );
      return const FunctionReturnDefinition.shorthand(A2uiReturnType.any);
    }
    final Object? objType = obj['type'];
    if (objType == 'void' || objType == 'validationResult') {
      final r = _JsonReader(obj, ptr, sink);
      r.rejectUnknown(const {'type', 'description'}, 'returnType');
      final String? desc = r.str('description');
      return objType == 'void'
          ? FunctionReturnDefinition.void_(description: desc)
          : FunctionReturnDefinition.validationResult(description: desc);
    }
    return FunctionReturnDefinition.typed(
      _parseType(obj, ptr, extraAllowedKeys: const {}),
    );
  }

  List<ParameterDefinition> _parseParams(_JsonReader parent, String key) {
    final List<Object?>? rawList = parent.optList(key);
    if (rawList == null) return const [];
    final String listPtr = parent.child(key);
    final out = <ParameterDefinition>[];
    for (var i = 0; i < rawList.length; i++) {
      final itemPtr = '$listPtr/$i';
      final Map<String, Object?>? pObj = _asStringMap(rawList[i]);
      if (pObj == null) {
        sink.schema(itemPtr, 'Each parameter entry must be a JSON object.');
        continue;
      }
      final pr = _JsonReader(pObj, itemPtr, sink);
      out.add(
        ParameterDefinition(
          name: pr.reqStr('name'),
          required: pr.flag('required'),
          type: _parseType(
            pObj,
            itemPtr,
            extraAllowedKeys: CatalogDocumentCodec._paramKeys,
          ),
        ),
      );
    }
    return List<ParameterDefinition>.unmodifiable(out);
  }

  List<List<String>>? _parseAtLeastOneOf(_JsonReader parent) {
    final List<Object?>? raw = parent.optList('atLeastOneOf');
    if (raw == null) return null;
    final String ptr = parent.child('atLeastOneOf');
    if (raw.isEmpty) {
      sink.constraint(ptr, 'atLeastOneOf must be non-empty.');
      return null;
    }
    final groups = <List<String>>[];
    for (var i = 0; i < raw.length; i++) {
      final gPtr = '$ptr/$i';
      final Object? item = raw[i];
      if (item is! List) {
        sink.constraint(
          gPtr,
          'Each atLeastOneOf group must be an array of parameter names.',
        );
        continue;
      }
      final group = <String>[];
      for (var j = 0; j < item.length; j++) {
        if (item[j] is! String || (item[j]! as String).isEmpty) {
          sink.schema(
            '$gPtr/$j',
            'atLeastOneOf entries must be non-empty strings.',
          );
        } else {
          group.add(item[j]! as String);
        }
      }
      groups.add(List<String>.unmodifiable(group));
    }
    return List<List<String>>.unmodifiable(groups);
  }

  ({bool flag, TypeDefinition? type}) _parseAdditional(
    _JsonReader parent,
    String key,
  ) {
    if (!parent.map.containsKey(key)) return (flag: false, type: null);
    final Object? raw = parent.map[key];
    if (raw is bool) return (flag: raw, type: null);
    final Map<String, Object?>? m = _asStringMap(raw);
    if (m != null) {
      return (
        flag: false,
        type: _parseType(m, parent.child(key), extraAllowedKeys: const {}),
      );
    }
    sink.schema(
      parent.child(key),
      "Field '$key' must be a boolean or a type object.",
    );
    return (flag: false, type: null);
  }

  TypeDefinition _parseType(
    Map<String, Object?> map,
    String ptr, {
    required Set<String> extraAllowedKeys,
  }) {
    final r = _JsonReader(map, ptr, sink);
    final String kind = r.reqStr('type');
    if (kind.isEmpty) return const AnyType();
    final String? desc = r.str('description');
    final bool dep = r.flag('deprecated');
    final String? depR = r.str('deprecatedReason');
    void allow(Set<String> specific) => r.rejectUnknown({
      ...CatalogDocumentCodec._baseTypeKeys,
      ...extraAllowedKeys,
      ...specific,
    }, "type '$kind'");

    if (_markerTypes[kind] case final _MarkerCtor ctor) {
      allow(const {});
      return ctor(description: desc, deprecated: dep, deprecatedReason: depR);
    }

    switch (kind) {
      case 'string':
        allow(const {
          'dynamic',
          'format',
          'formats',
          'pattern',
          'minLength',
          'maxLength',
          'default',
        });
        final String? format = r.nonEmptyStr('format');
        final List<String>? formats = r.strList('formats', nonEmpty: true);
        if (format != null && formats != null) {
          sink.constraint(
            '$ptr/formats',
            "Type 'string' cannot specify both 'format' and 'formats'.",
          );
        }
        return StringType(
          dynamic: r.flag('dynamic'),
          format: formats == null ? format : null,
          formats: formats,
          pattern: r.str('pattern'),
          minLength: r.integer('minLength'),
          maxLength: r.integer('maxLength'),
          defaultValue: r.str('default'),
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        );
      case 'number':
        allow(const {'dynamic', 'min', 'max', 'default'});
        return NumberType(
          dynamic: r.flag('dynamic'),
          min: r.number('min'),
          max: r.number('max'),
          defaultValue: r.number('default'),
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        );
      case 'integer':
        allow(const {'dynamic', 'min', 'max', 'default'});
        return IntegerType(
          dynamic: r.flag('dynamic'),
          min: r.integer('min'),
          max: r.integer('max'),
          defaultValue: r.integer('default'),
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        );
      case 'boolean':
        allow(const {'dynamic', 'default'});
        return BooleanType(
          dynamic: r.flag('dynamic'),
          defaultValue: r.optBool('default'),
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        );
      case 'enum':
        allow(const {'values', 'valueType', 'dynamic', 'default'});
        EnumValueType? declaredVt;
        if (map.containsKey('valueType')) {
          final String? rawVt = r.nonEmptyStr('valueType');
          if (rawVt != null) {
            try {
              declaredVt = EnumValueType.fromJson(rawVt);
            } on FormatException catch (e) {
              sink.schema('$ptr/valueType', e.message);
            }
          }
        }
        final List<Object?>? rawVals = r.optList('values');
        final values = <Object>[];
        if (rawVals != null) {
          for (var i = 0; i < rawVals.length; i++) {
            final Object? v = rawVals[i];
            if (v == null) {
              sink.schema(
                '$ptr/values/$i',
                'Enum values must not contain null.',
              );
            } else {
              values.add(v);
            }
          }
        }
        Object? defVal;
        if (map.containsKey('default')) {
          if (map['default'] == null) {
            sink.constraint('$ptr/default', 'Enum default must not be null.');
          } else {
            defVal = map['default'];
          }
        }
        return EnumType(
          values: List<Object>.unmodifiable(values),
          valueType: declaredVt,
          dynamic: r.flag('dynamic'),
          defaultValue: defVal,
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        );
      case 'const':
        allow(const {'value'});
        if (!map.containsKey('value')) {
          sink.schema('$ptr/value', "Const type requires a 'value' field.");
        }
        final Object? val = map['value'];
        if (val != null && val is! String && val is! num && val is! bool) {
          sink.schema(
            '$ptr/value',
            "Const 'value' must be a string, number, boolean, or null.",
          );
        }
        return ConstType(
          value: val,
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        );
      case 'any':
        allow(const {'dynamic', 'nullable', 'default'});
        return AnyType(
          dynamic: r.flag('dynamic'),
          nullable: r.flag('nullable'),
          defaultValue: map.containsKey('default')
              ? deepCopyJson(map['default'], unmodifiable: true)
              : noDefaultValue,
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        );
      case 'object':
        allow(const {
          'dynamic',
          'properties',
          'additionalProperties',
          'atLeastOneOf',
          'default',
        });
        final (:bool flag, :TypeDefinition? type) = _parseAdditional(
          r,
          'additionalProperties',
        );
        final Map<String, Object?>? rawDef = r.optMap('default');
        return ObjectType(
          dynamic: r.flag('dynamic'),
          properties: _parseParams(r, 'properties'),
          additionalProperties: flag,
          additionalPropertiesType: type,
          atLeastOneOf: _parseAtLeastOneOf(r),
          defaultValue: rawDef == null
              ? null
              : deepCopyJsonMap(rawDef, unmodifiable: true),
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        );
      case 'array':
        allow(const {
          'dynamic',
          'items',
          'minItems',
          'maxItems',
          'uniqueItems',
          'default',
        });
        final Map<String, Object?>? itemsObj = r.optMap('items');
        final List<Object?>? rawDef = r.optList('default');
        return ArrayType(
          dynamic: r.flag('dynamic'),
          items: itemsObj == null
              ? null
              : _parseType(itemsObj, '$ptr/items', extraAllowedKeys: const {}),
          minItems: r.integer('minItems'),
          maxItems: r.integer('maxItems'),
          uniqueItems: r.flag('uniqueItems'),
          defaultValue: rawDef == null
              ? null
              : (deepCopyJson(rawDef, unmodifiable: true)! as List<Object?>),
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        );
      case 'union':
        allow(const {'variants', 'exclusive', 'dynamic', 'default'});
        final List<Object?>? rawVars = r.optList('variants');
        final variants = <TypeDefinition>[];
        if (rawVars != null) {
          for (var i = 0; i < rawVars.length; i++) {
            final Map<String, Object?>? vObj = _asStringMap(rawVars[i]);
            if (vObj == null) {
              sink.schema(
                '$ptr/variants/$i',
                'Each union variant must be a JSON object.',
              );
              continue;
            }
            variants.add(
              _parseType(vObj, '$ptr/variants/$i', extraAllowedKeys: const {}),
            );
          }
        }
        return UnionType(
          variants: List<TypeDefinition>.unmodifiable(variants),
          exclusive: r.flag('exclusive'),
          dynamic: r.flag('dynamic'),
          defaultValue: map.containsKey('default')
              ? deepCopyJson(map['default'], unmodifiable: true)
              : noDefaultValue,
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        );
      case 'ref':
        allow(const {'ref', 'default'});
        return RefType(
          ref: r.reqStr('ref'),
          defaultValue: map.containsKey('default')
              ? deepCopyJson(map['default'], unmodifiable: true)
              : noDefaultValue,
          description: desc,
          deprecated: dep,
          deprecatedReason: depR,
        );
      default:
        sink.schema('$ptr/type', "Unknown Catalog Document type '$kind'.");
        return const AnyType();
    }
  }
}

Map<String, Object?>? _asStringMap(Object? value) {
  if (value is Map<String, Object?>) return value;
  if (value is Map) {
    final out = <String, Object?>{};
    for (final MapEntry<Object?, Object?> e in value.entries) {
      if (e.key is! String) return null;
      out[e.key! as String] = e.value;
    }
    return out;
  }
  return null;
}

String _esc(String segment) =>
    segment.replaceAll('~', '~0').replaceAll('/', '~1');
