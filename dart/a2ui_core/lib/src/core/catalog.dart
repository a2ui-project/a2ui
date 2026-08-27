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
import '../primitives/protocol_version.dart';
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
/// This declares a function's signature only. Renderers that can also evaluate
/// the function supply a [FunctionImplementation] instead; agents, which only
/// need the signature to prompt and validate, use plain [FunctionApi] values.
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

/// A [ComponentApi] backed directly by a catalog document's JSON schema.
///
/// Produced by [Catalog.fromJson]. Carries no rendering behaviour, which makes
/// it the component representation used on the agent side.
class CatalogComponent implements ComponentApi {
  @override
  final String name;

  @override
  final Schema schema;

  CatalogComponent({required this.name, required this.schema});
}

/// A [FunctionApi] backed directly by a catalog document's JSON schema.
///
/// Produced by [Catalog.fromJson]. Declares a signature but cannot be
/// evaluated; see [FunctionImplementation] for the renderer-side counterpart.
class CatalogFunction implements FunctionApi {
  @override
  final String name;

  @override
  final A2uiReturnType returnType;

  @override
  final Schema argumentSchema;

  /// A human readable description of the function, when the catalog declares
  /// one.
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
/// This is the shape [Catalog.fromJson] produces and the shape agents work
/// with, since an agent prompts and validates against signatures but never
/// evaluates a function.
typedef SchemaCatalog = Catalog<CatalogComponent, CatalogFunction>;

/// A collection of available components and functions.
///
/// [C] is the component representation and [F] the function representation.
/// Renderers parameterise this with [FunctionImplementation] so functions can
/// be evaluated locally; agents parameterise it with [CatalogFunction], which
/// declares a signature only.
class Catalog<C extends ComponentApi, F extends FunctionApi> {
  /// The catalog id, as declared by the `catalogId` field of a catalog
  /// document.
  final String id;

  /// The protocol version this catalog conforms to.
  final A2uiProtocolVersion protocolVersion;

  final Map<String, C> components;
  final Map<String, F> functions;
  final Schema? themeSchema;

  /// The catalog document this catalog was parsed from, when it was built by
  /// [Catalog.fromJson].
  final Map<String, Object?>? _sourceSchema;

  Catalog({
    required this.id,
    required List<C> components,
    List<F> functions = const [],
    this.themeSchema,
    this.protocolVersion = A2uiProtocolVersion.v0_9,
    Map<String, Object?>? sourceSchema,
  }) : components = {for (final c in components) c.name: c},
       functions = {for (final f in functions) f.name: f},
       _sourceSchema = sourceSchema;

  /// Parses a catalog document into a schema-only [Catalog].
  ///
  /// Accepts both the catalog document form used under
  /// `specification/*/catalogs/*/catalog.json`, where `functions` is a map of
  /// name to JSON schema, and the inline catalog form used in renderer
  /// capabilities, where `functions` is a list of function definitions.
  ///
  /// Throws [A2uiCatalogError] if the document is malformed or if
  /// [expectedCatalogId] conflicts with the document's `catalogId`. Throws
  /// [A2uiValidationError] if the document declares a protocol version this
  /// SDK does not implement, or one that conflicts with
  /// [expectedProtocolVersion].
  static SchemaCatalog fromJson(
    Map<String, Object?> json, {
    A2uiProtocolVersion? expectedProtocolVersion,
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

    // `protocolVersion` is not declared by catalog documents before v1.0, so
    // an absent value means the version this SDK implements.
    final A2uiProtocolVersion version = json.containsKey('protocolVersion')
        ? A2uiProtocolVersion.fromJson(json['protocolVersion'], details: json)
        : A2uiProtocolVersion.v0_9;
    if (expectedProtocolVersion != null && expectedProtocolVersion != version) {
      throw A2uiValidationError(
        'Catalog protocol version mismatch: expected '
        "'${expectedProtocolVersion.jsonValue}' but the document declares "
        "'${version.jsonValue}'.",
        details: json,
      );
    }

    return SchemaCatalog(
      id: rawId,
      protocolVersion: version,
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

    // Inline catalog form: a list of {name, description, parameters,
    // returnType} definitions.
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

    // Catalog document form: a map of name to the function's JSON schema, with
    // the argument schema under `properties/args` and the declared return type
    // under `properties/returnType/const`.
    if (raw is! Map) {
      throw A2uiCatalogError(
        "Catalog 'functions' must be an object or a list of definitions.",
        catalogId: catalogId,
      );
    }
    final functions = <CatalogFunction>[];
    for (final MapEntry<Object?, Object?> entry in raw.entries) {
      final Map<String, Object?> schema = _asSchemaMap(entry.value);
      final Map<String, Object?> properties =
          schema['properties'] as Map<String, Object?>? ??
          const <String, Object?>{};
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
  /// When the catalog was built by [Catalog.fromJson], the original document is
  /// returned with its `components`, `functions` and `$defs` narrowed to the
  /// entries this catalog actually holds, so that a pruned catalog renders a
  /// pruned document. Otherwise a document is synthesised from the component
  /// and function schemas.
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

  /// Drops `$defs/<name>/oneOf` entries whose `$ref` points at an entry that is
  /// no longer part of this catalog.
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

  /// Returns a copy of this catalog with the given components and functions.
  ///
  /// Used by catalog transformers, which narrow a pristine catalog before it is
  /// rendered into a prompt or used for validation.
  Catalog<C, F> copyWith({
    Iterable<C>? components,
    Iterable<F>? functions,
    Schema? themeSchema,
  }) => Catalog<C, F>(
    id: id,
    protocolVersion: protocolVersion,
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
