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

import 'package:json_schema_builder/json_schema_builder.dart';
import '../primitives/cancellation.dart';
import '../primitives/errors.dart';
import '../primitives/reactivity.dart';
import '../validation/schema_resolution.dart';
import 'contexts.dart';

/// A definition of a UI component's API.
///
/// Carries the component's name and JSON schema and nothing else, so it is
/// what [Catalog.fromJson] produces directly. A renderer that attaches
/// behaviour subclasses it.
class ComponentApi {
  final String name;
  final Schema schema;

  const ComponentApi({required this.name, required this.schema});
}

/// The type of value a function returns.
enum A2uiReturnType {
  string,
  number,
  boolean,
  array,
  object,
  any,
  void_;

  /// The JSON value used in the A2UI protocol.
  String get jsonValue => this == void_ ? 'void' : name;

  /// Parses from the JSON string representation, falling back to [any] for
  /// unrecognized or extension return types (such as v1.0 `validationResult`).
  static A2uiReturnType fromJson(String value) {
    if (value == 'void') return void_;
    for (final A2uiReturnType candidate in values) {
      if (candidate.name == value) return candidate;
    }
    return any;
  }
}

/// A definition of a UI function's API.
///
/// Declares a signature only, so it is what [Catalog.fromJson] produces
/// directly. Renderers that also evaluate the function supply a
/// [FunctionImplementation] instead.
class FunctionApi {
  final String name;
  final A2uiReturnType returnType;
  final Schema argumentSchema;
  final String? description;

  const FunctionApi({
    required this.name,
    required this.argumentSchema,
    this.returnType = A2uiReturnType.any,
    this.description,
  });
}

/// A function implementation that can be registered with a catalog.
abstract class FunctionImplementation extends FunctionApi {
  const FunctionImplementation({
    required super.name,
    required super.argumentSchema,
    super.returnType,
    super.description,
  });

  /// Executes the function. Can return a static value or a [ReadonlySignal].
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]);
}

/// A catalog whose components and functions carry schemas only.
///
/// What [Catalog.fromJson] produces, and what agents work with: they prompt
/// and validate against signatures but never evaluate a function.
typedef SchemaCatalog = Catalog<ComponentApi, FunctionApi>;

/// A collection of available components and functions.
///
/// [C] is the component representation and [F] the function representation.
/// For renderers, [F] is [FunctionImplementation], for agents [F] is
/// [FunctionApi].
///
/// For a catalog that declares no functions, pass `Never`
/// (see https://dart.dev/language/built-in-types).
class Catalog<C extends ComponentApi, F extends FunctionApi> {
  /// The JSON Schema dialect a catalog document declares.
  static const String jsonSchemaDialect =
      'https://json-schema.org/draft/2020-12/schema';

  /// The catalog id, from the document's `catalogId` field.
  final String id;

  /// The document's `$id`, when it declares one.
  ///
  /// Kept separate from [id]: `catalogId` names the catalog, `$id` is the base
  /// that relative references in the document resolve against. Published
  /// catalogs give them the same value, but nothing requires it.
  final String? schemaId;

  /// The document's `title`, when it declares one.
  final String? title;

  /// The document's `description`, when it declares one.
  final String? description;
  final String? protocolVersion;

  final Map<String, C> components;
  final Map<String, F> functions;
  final Schema? themeSchema;

  Catalog({
    required this.id,
    required List<C> components,
    List<F> functions = const [],
    this.themeSchema,
    this.schemaId,
    this.title,
    this.description,
    this.protocolVersion,
  })  : components = {for (final c in components) c.name: c},
        functions = {for (final f in functions) f.name: f};

  /// Parses a catalog document into a schema-only [Catalog].
  ///
  /// Accepts both forms of `functions`: the map of name to JSON schema used by
  /// published catalog documents, and the list of definitions used by inline
  /// catalogs in renderer capabilities.
  ///
  /// A catalog document is version-agnostic: any `protocolVersion` it
  /// declares is ignored rather than checked against this SDK.
  ///
  /// Throws [A2uiCatalogError] if the document is malformed or conflicts with
  /// [expectedCatalogId].
  static SchemaCatalog fromJson(
    Map<String, Object?> json, {
    String? expectedCatalogId,
  }) {
    final Object? rawId = json['catalogId'];
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

    final Set<String>? allowedComponents = _extractAllowedRefs(
      json,
      'anyComponent',
      '#/components/',
    );
    final Set<String>? allowedFunctions = _extractAllowedRefs(
      json,
      'anyFunction',
      '#/functions/',
    );

    final document = inlineLocalRefs(json, json)! as Map<String, Object?>;
    final protocolVersion =
        (document['protocolVersion'] ?? document['specVersion']) as String?;

    return SchemaCatalog(
      id: rawId,
      components: _parseComponents(
        document['components'],
        document,
        rawId,
        allowedComponents,
      ),
      functions: _parseFunctions(
        document['functions'],
        rawId,
        allowedFunctions,
      ),
      themeSchema: _parseTheme(document),
      schemaId: document[r'$id'] as String?,
      title: document['title'] as String?,
      description: document['description'] as String?,
      protocolVersion: protocolVersion,
    );
  }

  static Set<String>? _extractAllowedRefs(
    Map<String, Object?> json,
    String defName,
    String prefix,
  ) {
    final Object? defs = json[r'$defs'];
    if (defs is! Map) return null;
    final Object? union = defs[defName];
    if (union is! Map) return null;
    final Object? oneOf = union['oneOf'];
    if (oneOf is! List) return null;
    final allowed = <String>{};
    for (final Object? item in oneOf) {
      if (item is Map && item[r'$ref'] is String) {
        final ref = item[r'$ref']! as String;
        if (ref.startsWith(prefix)) {
          allowed.add(
            ref
                .substring(prefix.length)
                .replaceAll('~1', '/')
                .replaceAll('~0', '~'),
          );
        }
      }
    }
    return allowed;
  }

  static List<ComponentApi> _parseComponents(
    Object? raw,
    Map<String, Object?> rootDoc,
    String catalogId, [
    Set<String>? allowed,
  ]) {
    if (raw == null) return const [];
    if (raw is! Map) {
      throw A2uiCatalogError(
        "Catalog 'components' must be an object mapping names to schemas.",
        catalogId: catalogId,
      );
    }
    final components = <ComponentApi>[];
    for (final MapEntry<Object?, Object?> entry in raw.entries) {
      final compName = entry.key! as String;
      if (allowed != null && !allowed.contains(compName)) continue;

      final Object? compVal = entry.value;
      if (compVal is! Map) {
        throw A2uiCatalogError(
          "Component '$compName' schema must be an object.",
          catalogId: catalogId,
        );
      }
      if (compVal.keys.any((k) => k is! String)) {
        throw A2uiCatalogError(
          "Component '$compName' schema keys must be strings.",
          catalogId: catalogId,
        );
      }
      final Map<String, Object?> compMap = compVal is Map<String, Object?>
          ? compVal
          : compVal.cast<String, Object?>();

      final subSchemas = <Map<String, Object?>>[];
      _collectComponentSubSchemas(compMap, rootDoc, subSchemas, <String>{});

      final mergedProperties = <String, Object?>{};
      final requiredSet = <String>{};
      var compDesc = compMap['description'] as String?;

      for (final s in subSchemas) {
        compDesc ??= s['description'] as String?;
        final Object? props = s['properties'];
        if (props is Map) {
          mergedProperties.addAll(props.cast<String, Object?>());
        }
        final Object? req = s['required'];
        if (req is List) {
          for (final Object? item in req) {
            if (item is String) requiredSet.add(item);
          }
        }
      }

      // Omit envelope keys from component-level properties
      mergedProperties.remove('id');
      mergedProperties.remove('component');
      mergedProperties.remove('catalogId');
      requiredSet.remove('id');
      requiredSet.remove('component');
      requiredSet.remove('catalogId');

      final sanitizedProperties = <String, Object?>{};
      for (final MapEntry<String, Object?> propEntry
          in mergedProperties.entries) {
        sanitizedProperties[propEntry.key] =
            _normalizePropertyRefs(propEntry.value);
      }

      final cleanSchema = <String, Object?>{
        'type': 'object',
        if (compDesc != null) 'description': compDesc,
        'properties': sanitizedProperties,
        if (requiredSet.isNotEmpty) 'required': requiredSet.toList()..sort(),
        if (compMap.containsKey('unevaluatedProperties'))
          'unevaluatedProperties': compMap['unevaluatedProperties'],
        if (compMap.containsKey('additionalProperties'))
          'additionalProperties': compMap['additionalProperties'],
      };

      components.add(
        ComponentApi(
          name: compName,
          schema: Schema.fromMap(cleanSchema),
        ),
      );
    }
    return components;
  }

  static void _collectComponentSubSchemas(
    Map<String, Object?> schema,
    Map<String, Object?> rootDoc,
    List<Map<String, Object?>> result,
    Set<String> visited,
  ) {
    final Object? allOf = schema['allOf'];
    if (allOf is List) {
      for (final Object? sub in allOf) {
        if (sub is! Map) continue;
        final Map<String, Object?> subMap = sub is Map<String, Object?>
            ? sub
            : sub.cast<String, Object?>();
        final Object? ref = subMap[r'$ref'];
        if (ref is String) {
          if (_isComponentCommonRef(ref)) {
            result.add({
              'properties': {
                'accessibility': {
                  r'$ref': r'common_types.json#/$defs/AccessibilityAttributes',
                  'description':
                      r'REF:common_types.json#/$defs/AccessibilityAttributes|Accessibility properties',
                },
              },
            });
          } else if (_isCheckableRef(ref)) {
            result.add({
              'properties': {
                'checks': {
                  'type': 'array',
                  'description': 'A list of checks to perform.',
                  'items': {
                    r'$ref': r'common_types.json#/$defs/CheckRule',
                    'description': r'REF:common_types.json#/$defs/CheckRule',
                  },
                },
              },
            });
          } else if (ref.startsWith('#/')) {
            if (visited.add(ref)) {
              final Object? target = _resolveJsonPointer(rootDoc, ref);
              if (target is Map) {
                _collectComponentSubSchemas(
                  target.cast<String, Object?>(),
                  rootDoc,
                  result,
                  visited,
                );
              }
            }
          }
        } else {
          _collectComponentSubSchemas(subMap, rootDoc, result, visited);
        }
      }
    }
    if (schema.containsKey('properties') || schema.containsKey('description')) {
      result.add(schema);
    }
  }

  static bool _isComponentCommonRef(String ref) =>
      ref.endsWith('ComponentCommon') ||
      (ref.contains('common_types.json') && ref.contains('ComponentCommon'));

  static bool _isCheckableRef(String ref) =>
      ref.endsWith('Checkable') ||
      (ref.contains('common_types.json') && ref.contains('Checkable'));

  static Object? _resolveJsonPointer(
    Map<String, Object?> rootDoc,
    String pointer,
  ) {
    if (!pointer.startsWith('#/')) return null;
    final Iterable<String> segments = pointer
        .substring(2)
        .split('/')
        .map((s) => s.replaceAllMapped(
              RegExp(r'~([01])'),
              (m) => m[1] == '1' ? '/' : '~',
            ));
    Object? current = rootDoc;
    for (final seg in segments) {
      if (current is Map && current.containsKey(seg)) {
        current = current[seg];
      } else {
        return null;
      }
    }
    return current;
  }

  static Object? _normalizePropertyRefs(Object? node) {
    if (node is List) {
      return [for (final item in node) _normalizePropertyRefs(item)];
    }
    if (node is! Map) return node;

    final map = Map<String, Object?>.from(
      node is Map<String, Object?> ? node : node.cast<String, Object?>(),
    );

    final Object? ref = map[r'$ref'];
    if (ref is String &&
        (ref.contains(r'common_types.json#/$defs/') ||
            ref.contains('common_types.json#') ||
            (ref.startsWith(r'#/$defs/') &&
                _isCommonTypeDef(ref.substring(8))))) {
      final String defName = ref.split('/').last;
      final target = 'common_types.json#/\$defs/$defName';
      final existingDesc = map['description'] as String?;
      final String tag =
          existingDesc != null && !existingDesc.startsWith('REF:')
              ? 'REF:$target|$existingDesc'
              : (existingDesc ?? 'REF:$target');
      map['description'] = tag;
      map[r'$ref'] = target;
    }

    final newEntries = <String, Object?>{};
    for (final MapEntry<String, Object?> entry in map.entries) {
      newEntries[entry.key] = _normalizePropertyRefs(entry.value);
    }
    return newEntries;
  }

  static bool _isCommonTypeDef(String name) => const {
        'ComponentId',
        'DynamicString',
        'DynamicNumber',
        'DynamicBoolean',
        'DynamicStringList',
        'DataBinding',
        'FunctionCall',
        'ChildList',
        'Action',
        'CheckRule',
        'AccessibilityAttributes',
      }.contains(name);

  static List<FunctionApi> _parseFunctions(
    Object? raw,
    String catalogId, [
    Set<String>? allowed,
  ]) {
    if (raw == null) return const [];

    // Inline form: {name, parameters, returnType} definitions.
    if (raw is List) {
      return [
        for (final Object? entry in raw)
          if (entry is Map)
            if (allowed == null ||
                (entry['name'] is String &&
                    allowed.contains(entry['name'] as String)))
              FunctionApi(
                name: (entry['name'] is String &&
                        (entry['name'] as String).isNotEmpty)
                    ? entry['name'] as String
                    : throw A2uiCatalogError(
                        "Function definition missing 'name' string.",
                        catalogId: catalogId,
                      ),
                description: entry['description'] as String?,
                argumentSchema: Schema.fromMap(
                  _asSchemaMap(
                      entry['parameters'] ?? const <String, Object?>{}),
                ),
                returnType: A2uiReturnType.fromJson(
                  entry['returnType'] as String? ?? 'any',
                ),
              ),
      ];
    }

    // Document form: name to JSON schema, with arguments under
    // `properties/args` and the return type under
    // `properties/returnType/const`, or shorthand `{returnType, parameters}`.
    if (raw is! Map) {
      throw A2uiCatalogError(
        "Catalog 'functions' must be an object or a list of definitions.",
        catalogId: catalogId,
      );
    }
    final functions = <FunctionApi>[];
    for (final MapEntry<Object?, Object?> entry in raw.entries) {
      final fnName = entry.key! as String;
      if (allowed != null && !allowed.contains(fnName)) continue;
      final Map<String, Object?> schema = _asSchemaMap(entry.value);
      final Object? rawProperties = schema['properties'];
      final Map<String, Object?> properties = switch (rawProperties) {
        null => const <String, Object?>{},
        final Map<Object?, Object?> map => map.cast<String, Object?>(),
        _ => throw A2uiCatalogError(
            "Catalog function '${entry.key}' has a non-object 'properties' "
            '(got ${rawProperties.runtimeType}).',
            catalogId: catalogId,
          ),
      };
      final Object? args = properties['args'] ?? schema['parameters'];
      final Object? returnType = properties['returnType'];
      final desc =
          (schema['description'] ?? properties['description']) as String?;
      final String returnTypeStr =
          (returnType is Map ? returnType[r'const'] as String? : null) ??
              (schema['returnType'] is String
                  ? schema['returnType'] as String
                  : null) ??
              'any';
      functions.add(
        FunctionApi(
          name: fnName,
          description: desc,
          argumentSchema: Schema.fromMap(
            _asSchemaMap(args ?? const <String, Object?>{}),
          ),
          returnType: A2uiReturnType.fromJson(returnTypeStr),
        ),
      );
    }
    return functions;
  }

  static Schema? _parseTheme(Map<String, Object?> json) {
    final Object? defs = json[r'$defs'];
    final Object? theme = json['theme'] ?? (defs is Map ? defs['theme'] : null);
    if (theme == null) return null;
    return Schema.fromMap(_asSchemaMap(theme));
  }

  static Map<String, Object?> _asSchemaMap(Object? value) {
    if (value is Map) return value.cast<String, Object?>();
    throw A2uiCatalogError('Expected a JSON schema object, got $value.');
  }

  /// The catalog document for this catalog, as JSON.
  ///
  /// The catalog as a document, rebuilt from the components and functions it
  /// currently holds.
  ///
  /// Nothing is cached: a pruned catalog renders a pruned document, with the
  /// `anyComponent` and `anyFunction` unions covering exactly what is left.
  /// Component and function schemas carry their local definitions inline, so
  /// the document needs no `$defs` beyond the theme and those two unions.
  ///
  /// `$schema` is always emitted; `$id`, `title` and `description` are emitted
  /// when the parsed document declared them, so a document round trips through
  /// [Catalog.fromJson] with its identity intact.
  Map<String, Object?> get catalogSchema => {
        r'$schema': jsonSchemaDialect,
        if (schemaId != null) r'$id': schemaId,
        if (title != null) 'title': title,
        if (description != null) 'description': description,
        'catalogId': id,
        'components': {
          for (final MapEntry<String, C> entry in components.entries)
            entry.key: _serializeComponent(entry.key, entry.value),
        },
        if (functions.isNotEmpty)
          'functions': {
            // The document form of a function is the schema of a call to it, so
            // this rebuilds that shape rather than listing the parts:
            // `anyFunction` and every `DynamicString` reach these through
            // `#/functions/<name>`, and a different shape would silently stop
            // matching.
            for (final MapEntry<String, F> entry in functions.entries)
              entry.key: <String, Object?>{
                'type': 'object',
                if (entry.value.description != null)
                  'description': entry.value.description,
                'properties': <String, Object?>{
                  'call': <String, Object?>{'const': entry.key},
                  'args': _deepCopyValue(entry.value.argumentSchema.value),
                  'returnType': <String, Object?>{
                    'const': entry.value.returnType.jsonValue,
                  },
                },
                'required': <Object?>['call', 'args'],
                'unevaluatedProperties': false,
              },
          },
        r'$defs': {
          if (themeSchema != null) 'theme': _deepCopyValue(themeSchema!.value),
          'anyComponent': {
            'oneOf': [
              for (final String name in components.keys)
                {r'$ref': '#/components/$name'},
            ],
            'discriminator': {'propertyName': 'component'},
          },
          if (functions.isNotEmpty)
            'anyFunction': {
              'oneOf': [
                for (final String name in functions.keys)
                  {r'$ref': '#/functions/$name'},
              ],
            },
        },
      };

  static Map<String, Object?> _serializeComponent(
    String name,
    ComponentApi comp,
  ) {
    final raw = _deepCopyValue(comp.schema.value) as Map<String, Object?>;
    _restoreRefs(raw);

    final rawProps = <String, Object?>{};
    final rawReq = <String>[];
    if (raw['properties'] is Map<String, Object?>) {
      rawProps.addAll(raw['properties'] as Map<String, Object?>);
    }
    if (raw['required'] is List) {
      rawReq.addAll((raw['required'] as List).cast<String>());
    }
    if (raw['allOf'] is List) {
      for (final branch in raw['allOf'] as List) {
        if (branch is Map) {
          if (branch['properties'] is Map<String, Object?>) {
            rawProps.addAll(
              branch['properties'] as Map<String, Object?>,
            );
          }
          if (branch['required'] is List) {
            rawReq.addAll((branch['required'] as List).cast<String>());
          }
        }
      }
    }

    final sanitizedProps = Map<String, Object?>.from(rawProps)
      ..remove('id')
      ..remove('component');

    final innerProperties = <String, Object?>{
      'id': <String, Object?>{r'$ref': '#/\$defs/ComponentId'},
      'component': <String, Object?>{'const': name},
      ...sanitizedProps,
    };

    final innerRequired = <String>[
      'id',
      for (final r in rawReq)
        if (r != 'id' && r != 'component') r,
      'component',
    ];

    return <String, Object?>{
      'type': 'object',
      if (raw.containsKey('description')) 'description': raw['description'],
      'properties': innerProperties,
      'required': innerRequired,
      if (raw.containsKey('unevaluatedProperties'))
        'unevaluatedProperties': raw['unevaluatedProperties'],
      if (raw.containsKey('additionalProperties'))
        'additionalProperties': raw['additionalProperties'],
    };
  }

  static void _restoreRefs(Object? node) {
    if (node is List) {
      for (final Object? item in node) {
        _restoreRefs(item);
      }
    } else if (node is Map<String, Object?>) {
      final map = node;
      final Object? desc = map['description'];
      if (desc is String && desc.startsWith('REF:')) {
        final List<String> parts = desc.substring(4).split('|');
        final String target = parts[0];
        final String? actualDesc = parts.length > 1 ? parts[1] : null;

        final String defName = target.split('/').last;
        map[r'$ref'] = '#/\$defs/$defName';
        if (actualDesc != null) {
          map['description'] = actualDesc;
        } else {
          map.remove('description');
        }
      }
      for (final Object? val in map.values) {
        _restoreRefs(val);
      }
    }
  }

  /// A copy of this catalog with the given components and functions.
  ///
  /// Used by catalog transformers to narrow a catalog before prompting or
  /// validation.
  Catalog<C, F> copyWith({
    Iterable<C>? components,
    Iterable<F>? functions,
    Schema? themeSchema,
    String? protocolVersion,
  }) =>
      Catalog<C, F>(
        id: id,
        components: (components ?? this.components.values).toList(),
        functions: (functions ?? this.functions.values).toList(),
        themeSchema: themeSchema ?? this.themeSchema,
        schemaId: schemaId,
        title: title,
        description: description,
        protocolVersion: protocolVersion ?? this.protocolVersion,
      );

  static Object? _deepCopyValue(Object? value) {
    if (value is Map) {
      return {
        for (final MapEntry<Object?, Object?> entry in value.entries)
          entry.key! as String: _deepCopyValue(entry.value),
      };
    }
    if (value is List) {
      return [for (final Object? item in value) _deepCopyValue(item)];
    }
    return value;
  }
}
