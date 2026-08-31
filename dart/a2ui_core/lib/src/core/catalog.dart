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
import 'contexts.dart';

/// A definition of a UI component's API.
abstract class ComponentApi {
  String get name;
  Schema get schema;
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

  /// Parses from the JSON string representation.
  static A2uiReturnType fromJson(String value) {
    if (value == 'void') return void_;
    return values.byName(value);
  }
}

/// A definition of a UI function's API.
///
/// Declares a signature only. Renderers that also evaluate the function supply
/// a [FunctionImplementation] instead.
abstract class FunctionApi {
  String get name;
  A2uiReturnType get returnType;
  Schema get argumentSchema;
}

/// A function implementation that can be registered with a catalog.
abstract class FunctionImplementation extends FunctionApi {
  /// Executes the function. Can return a static value or a [ReadonlySignal].
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]);
}

/// A [ComponentApi] backed by a catalog document's JSON schema.
///
/// Produced by [Catalog.fromJson]; carries no rendering behaviour, so it is
/// the agent-side representation.
class CatalogComponent implements ComponentApi {
  @override
  final String name;

  @override
  final Schema schema;

  CatalogComponent({required this.name, required this.schema});
}

/// A [FunctionApi] backed by a catalog document's JSON schema.
///
/// Produced by [Catalog.fromJson]; declares a signature but cannot be
/// evaluated. See [FunctionImplementation] for the renderer-side counterpart.
class CatalogFunction implements FunctionApi {
  @override
  final String name;

  @override
  final A2uiReturnType returnType;

  @override
  final Schema argumentSchema;

  /// The function's description, when the catalog declares one.
  final String? description;

  CatalogFunction({
    required this.name,
    required this.argumentSchema,
    this.returnType = A2uiReturnType.any,
    this.description,
  });
}

/// A catalog whose components and functions carry schemas only.
///
/// What [Catalog.fromJson] produces, and what agents work with: they prompt
/// and validate against signatures but never evaluate a function.
typedef SchemaCatalog = Catalog<CatalogComponent, CatalogFunction>;

/// A collection of available components and functions.
///
/// [C] is the component representation and [F] the function representation:
/// renderers use [FunctionImplementation], agents [CatalogFunction].
class Catalog<C extends ComponentApi, F extends FunctionApi> {
  /// The catalog id, from the document's `catalogId` field.
  final String id;

  final Map<String, C> components;
  final Map<String, F> functions;
  final Schema? themeSchema;

  /// The document this catalog was parsed from, if any.
  final Map<String, Object?>? _sourceSchema;

  Catalog({
    required this.id,
    required List<C> components,
    List<F> functions = const [],
    this.themeSchema,
    Map<String, Object?>? sourceSchema,
  }) : components = {for (final c in components) c.name: c},
       functions = {for (final f in functions) f.name: f},
       _sourceSchema = sourceSchema;

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

    return SchemaCatalog(
      id: rawId,
      components: _parseComponents(json['components'], rawId),
      functions: _parseFunctions(json['functions'], rawId),
      themeSchema: _parseTheme(json),
      sourceSchema: json,
    );
  }

  static List<CatalogComponent> _parseComponents(
    Object? raw,
    String catalogId,
  ) {
    if (raw == null) return const [];
    if (raw is! Map) {
      throw A2uiCatalogError(
        "Catalog 'components' must be an object mapping names to schemas.",
        catalogId: catalogId,
      );
    }
    return [
      for (final MapEntry<Object?, Object?> entry in raw.entries)
        CatalogComponent(
          name: entry.key! as String,
          schema: Schema.fromMap(_asSchemaMap(entry.value)),
        ),
    ];
  }

  static List<CatalogFunction> _parseFunctions(Object? raw, String catalogId) {
    if (raw == null) return const [];

    // Inline form: {name, description, parameters, returnType} definitions.
    if (raw is List) {
      return [
        for (final Object? entry in raw)
          if (entry is Map)
            CatalogFunction(
              name: entry['name']! as String,
              description: entry['description'] as String?,
              argumentSchema: Schema.fromMap(
                _asSchemaMap(entry['parameters'] ?? const <String, Object?>{}),
              ),
              returnType: A2uiReturnType.fromJson(
                entry['returnType'] as String? ?? 'any',
              ),
            ),
      ];
    }

    // Document form: name to JSON schema, with arguments under
    // `properties/args` and the return type under
    // `properties/returnType/const`.
    if (raw is! Map) {
      throw A2uiCatalogError(
        "Catalog 'functions' must be an object or a list of definitions.",
        catalogId: catalogId,
      );
    }
    final functions = <CatalogFunction>[];
    for (final MapEntry<Object?, Object?> entry in raw.entries) {
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
      final Object? args = properties['args'];
      final Object? returnType = properties['returnType'];
      functions.add(
        CatalogFunction(
          name: entry.key! as String,
          description: schema['description'] as String?,
          argumentSchema: Schema.fromMap(
            _asSchemaMap(args ?? const <String, Object?>{}),
          ),
          returnType: A2uiReturnType.fromJson(
            (returnType is Map ? returnType[r'const'] as String? : null) ??
                'any',
          ),
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
  /// A parsed catalog returns its source document with `components`,
  /// `functions` and `$defs` narrowed to what it still holds, so a pruned
  /// catalog renders a pruned document. Otherwise the document is
  /// synthesised from the schemas.
  Map<String, Object?> get catalogSchema {
    final Map<String, Object?>? source = _sourceSchema;
    if (source == null) return _synthesizeSchema();

    final Map<String, Object?> document = _deepCopy(source);
    document['catalogId'] = id;
    final Object? sourceComponents = source['components'];
    if (sourceComponents is Map) {
      document['components'] = <String, Object?>{
        for (final String name in components.keys)
          if (sourceComponents.containsKey(name))
            name: _deepCopyValue(sourceComponents[name]),
      };
    }
    final Object? sourceFunctions = source['functions'];
    if (sourceFunctions is Map) {
      document['functions'] = <String, Object?>{
        for (final String name in functions.keys)
          if (sourceFunctions.containsKey(name))
            name: _deepCopyValue(sourceFunctions[name]),
      };
    } else if (sourceFunctions is List) {
      document['functions'] = [
        for (final Object? entry in sourceFunctions)
          if (entry is Map && functions.containsKey(entry['name']))
            _deepCopyValue(entry),
      ];
    }
    _narrowAnyOneOf(document, 'anyComponent', '#/components/', components.keys);
    _narrowAnyOneOf(document, 'anyFunction', '#/functions/', functions.keys);
    return document;
  }

  /// Drops `$defs/<name>/oneOf` entries whose `$ref` names a pruned entry.
  static void _narrowAnyOneOf(
    Map<String, Object?> document,
    String defName,
    String refPrefix,
    Iterable<String> kept,
  ) {
    final Object? defs = document[r'$defs'];
    if (defs is! Map) return;
    final Object? any = defs[defName];
    if (any is! Map) return;
    final Object? oneOf = any['oneOf'];
    if (oneOf is! List) return;
    final Set<String> keptRefs = {
      for (final String name in kept) '$refPrefix$name',
    };
    any['oneOf'] = [
      for (final Object? entry in oneOf)
        if (entry is! Map ||
            entry[r'$ref'] is! String ||
            !(entry[r'$ref']! as String).startsWith(refPrefix) ||
            keptRefs.contains(entry[r'$ref']))
          entry,
    ];
  }

  Map<String, Object?> _synthesizeSchema() => {
    'catalogId': id,
    'components': {
      for (final MapEntry<String, C> entry in components.entries)
        entry.key: entry.value.schema.value,
    },
    if (functions.isNotEmpty)
      'functions': [
        for (final F function in functions.values)
          {
            'name': function.name,
            'returnType': function.returnType.jsonValue,
            'parameters': function.argumentSchema.value,
          },
      ],
    if (themeSchema != null) r'$defs': {'theme': themeSchema!.value},
  };

  /// A copy of this catalog with the given components and functions.
  ///
  /// Used by catalog transformers to narrow a catalog before prompting or
  /// validation.
  Catalog<C, F> copyWith({
    Iterable<C>? components,
    Iterable<F>? functions,
    Schema? themeSchema,
  }) => Catalog<C, F>(
    id: id,
    components: (components ?? this.components.values).toList(),
    functions: (functions ?? this.functions.values).toList(),
    themeSchema: themeSchema ?? this.themeSchema,
    sourceSchema: _sourceSchema,
  );

  static Map<String, Object?> _deepCopy(Map<String, Object?> map) => {
    for (final MapEntry<String, Object?> entry in map.entries)
      entry.key: _deepCopyValue(entry.value),
  };

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
