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

  /// Parses from the JSON string representation.
  static A2uiReturnType fromJson(String value) {
    if (value == 'void') return void_;
    return values.byName(value);
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

  const FunctionApi({
    required this.name,
    required this.argumentSchema,
    this.returnType = A2uiReturnType.any,
  });
}

/// A function implementation that can be registered with a catalog.
abstract class FunctionImplementation extends FunctionApi {
  const FunctionImplementation({
    required super.name,
    required super.argumentSchema,
    super.returnType,
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
  }) : components = {for (final c in components) c.name: c},
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

    // Local references are expanded here, once, so each component and function
    // schema stands alone afterwards. The document is then no longer needed,
    // and [catalogSchema] rebuilds it from the parts rather than caching it.
    final document = inlineLocalRefs(json, json)! as Map<String, Object?>;

    return SchemaCatalog(
      id: rawId,
      components: _parseComponents(document['components'], rawId),
      functions: _parseFunctions(document['functions'], rawId),
      themeSchema: _parseTheme(document),
      schemaId: document[r'$id'] as String?,
      title: document['title'] as String?,
      description: document['description'] as String?,
    );
  }

  static List<ComponentApi> _parseComponents(Object? raw, String catalogId) {
    if (raw == null) return const [];
    if (raw is! Map) {
      throw A2uiCatalogError(
        "Catalog 'components' must be an object mapping names to schemas.",
        catalogId: catalogId,
      );
    }
    return [
      for (final MapEntry<Object?, Object?> entry in raw.entries)
        ComponentApi(
          name: entry.key! as String,
          schema: Schema.fromMap(_asSchemaMap(entry.value)),
        ),
    ];
  }

  static List<FunctionApi> _parseFunctions(Object? raw, String catalogId) {
    if (raw == null) return const [];

    // Inline form: {name, parameters, returnType} definitions.
    if (raw is List) {
      return [
        for (final Object? entry in raw)
          if (entry is Map)
            FunctionApi(
              name: entry['name']! as String,
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
    final functions = <FunctionApi>[];
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
        FunctionApi(
          name: entry.key! as String,
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
        entry.key: _deepCopyValue(entry.value.schema.value),
    },
    if (functions.isNotEmpty)
      'functions': {
        // The document form of a function is the schema of a call to it, so
        // this rebuilds that shape rather than listing the parts: `anyFunction`
        // and every `DynamicString` reach these through `#/functions/<name>`,
        // and a different shape would silently stop matching.
        for (final MapEntry<String, F> entry in functions.entries)
          entry.key: <String, Object?>{
            'type': 'object',
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
    schemaId: schemaId,
    title: title,
    description: description,
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
