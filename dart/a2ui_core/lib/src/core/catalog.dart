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
import '../primitives/common_types_documents.dart';
import '../primitives/errors.dart';
import '../primitives/reactivity.dart';
import '../primitives/reference_schema.dart';
import '../primitives/semver.dart';
import '../primitives/uax31.dart';
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

  /// The component types that may hold this one as a child, from the catalog
  /// document's `allowedParents`.
  ///
  /// `Surface` stands for the surface itself, the implicit parent of the
  /// component with id `root`. Null allows any parent.
  final List<String>? allowedParents;

  /// The component types this one may hold as children, from the catalog
  /// document's `allowedChildren`. Null allows any child.
  final List<String>? allowedChildren;

  const ComponentApi({
    required this.name,
    required this.schema,
    this.allowedParents,
    this.allowedChildren,
  });
}

/// The type of value a function returns.
enum A2uiReturnType {
  string,
  number,
  boolean,
  array,
  object,

  /// A structured [ValidationResult] (`{valid, message?, code?, severity?}`).
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
/// and validate against signatures but never evaluate a function. A renderer
/// that evaluates functions needs a catalog of [FunctionImplementation]s
/// instead.
typedef CatalogApi = Catalog<ComponentApi, FunctionApi>;

/// The former name of [CatalogApi].
@Deprecated('Use CatalogApi instead.')
typedef SchemaCatalog = CatalogApi;

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

  /// The document's `protocolVersion`, such as `v1.0` or `1.0`, when it
  /// declares one.
  ///
  /// Selects the validation rules applied to payloads drawing on this catalog:
  /// v1.0 and later use the v1.0 rules (`@path` and `@call`, UAX #31
  /// identifiers, reserved `@` keys), anything else, including none, the v0.9
  /// rules.
  final String? protocolVersion;

  final Map<String, C> components;
  final Map<String, F> functions;
  final Schema? themeSchema;

  /// The `common_types.json` document this catalog's shared-type pointers
  /// resolve against: the embedded v1.0 document when [protocolVersion] is
  /// 1.0 or later, and the v0.9 document otherwise, including when no
  /// version is declared.
  ///
  /// Decoded once per catalog and shared by [refMap] and the renderer's
  /// binders, so treat it as read-only.
  late final Map<String, Object?> commonTypesSchema =
      commonTypesForProtocolVersion(protocolVersion);

  /// Which properties of each component type reference other components.
  ///
  /// Graph validation and node resolution both read this map, so a child
  /// reference the validator checks is one the resolver mounts. It is built
  /// from [components], [catalogSchema] and [commonTypesSchema] on first
  /// access and then cached; a catalog is not expected to change its
  /// components after that.
  late final ComponentRefMap refMap = ComponentRefMap(
    {
      for (final MapEntry<String, C> entry in components.entries)
        entry.key: entry.value.schema.value,
    },
    document: catalogSchema,
    commonTypes: commonTypesSchema,
  );

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
  /// A declared `protocolVersion` is kept as [protocolVersion] rather than
  /// checked against this SDK. From v1.0, component names, their property
  /// names, function names and argument names must be UAX #31 identifiers.
  ///
  /// Throws [A2uiCatalogError] if the document is malformed, conflicts with
  /// [expectedCatalogId], or holds a local `$ref` that names nothing.
  static CatalogApi fromJson(
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

    final Object? rawVersion = json['protocolVersion'];
    if (rawVersion != null && rawVersion is! String) {
      throw A2uiCatalogError(
        "Catalog 'protocolVersion' must be a string.",
        catalogId: rawId,
      );
    }
    final protocolVersion = rawVersion as String?;
    if (isVersionAtLeast(protocolVersion, 'v1.0')) {
      _checkIdentifiers(json, rawId);
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

    // Local references are expanded here, once, so each component and function
    // schema stands alone afterwards. The document is then no longer needed,
    // and [catalogSchema] rebuilds it from the parts rather than caching it.
    final document = inlineLocalRefs(json, json)! as Map<String, Object?>;

    return CatalogApi(
      id: rawId,
      components: _parseComponents(
        document['components'],
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

  /// Checks the names a v1.0 catalog declares against UAX #31.
  static void _checkIdentifiers(Map<String, Object?> json, String catalogId) {
    // Only function and argument names may start with `@`, as system
    // functions such as `@index` do.
    void check(String name, String context, {bool allowLeadingAt = false}) {
      try {
        assertUax31Identifier(
          name,
          context: context,
          allowLeadingAt: allowLeadingAt,
        );
      } on A2uiCatalogError catch (error) {
        throw A2uiCatalogError(error.message, catalogId: catalogId);
      }
    }

    Iterable<String> propertyNames(Object? schema) => switch (schema) {
          {'properties': final Map<Object?, Object?> properties} =>
            properties.keys.whereType<String>(),
          _ => const <String>[],
        };

    if (json['components'] case final Map<Object?, Object?> components) {
      for (final MapEntry<Object?, Object?> entry in components.entries) {
        final name = entry.key! as String;
        check(name, "component identifier '$name'");
        for (final String property in propertyNames(entry.value)) {
          check(property, "property identifier '$property' in '$name'");
        }
      }
    }
    final Object? functions = json['functions'];
    final Iterable<(String, Object?)> definitions = switch (functions) {
      final Map<Object?, Object?> map => [
          for (final MapEntry<Object?, Object?> entry in map.entries)
            (
              entry.key! as String,
              switch (entry.value) {
                {'properties': {'args': final Object? args}} => args,
                {'parameters': final Object? args} => args,
                _ => null,
              },
            ),
        ],
      final List<Object?> list => [
          for (final Object? entry in list)
            if (entry case {'name': final String name})
              (name, entry['parameters']),
        ],
      _ => const <(String, Object?)>[],
    };
    for (final (String name, Object? args) in definitions) {
      check(name, "function identifier '$name'", allowLeadingAt: true);
      for (final String arg in propertyNames(args)) {
        check(
          arg,
          "argument identifier '$arg' in function '$name'",
          allowLeadingAt: true,
        );
      }
    }
  }

  static List<String>? _parseTypeList(
    Object? raw,
    String key,
    String component,
    String catalogId,
  ) {
    if (raw == null) return null;
    if (raw is List && raw.every((Object? item) => item is String)) {
      return List<String>.unmodifiable(raw.cast<String>());
    }
    throw A2uiCatalogError(
      "Component '$component' declares a '$key' that is not a list of "
      'component type names.',
      catalogId: catalogId,
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
    return [
      for (final MapEntry<Object?, Object?> entry in raw.entries)
        if (allowed == null || allowed.contains(entry.key! as String))
          _parseComponent(
            entry.key! as String,
            _asSchemaMap(entry.value),
            catalogId,
          ),
    ];
  }

  static ComponentApi _parseComponent(
    String name,
    Map<String, Object?> schema,
    String catalogId,
  ) {
    return ComponentApi(
      name: name,
      schema: Schema.fromMap(schema),
      allowedParents: _parseTypeList(
        schema['allowedParents'],
        'allowedParents',
        name,
        catalogId,
      ),
      allowedChildren: _parseTypeList(
        schema['allowedChildren'],
        'allowedChildren',
        name,
        catalogId,
      ),
    );
  }

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
      final String returnTypeStr =
          (returnType is Map ? returnType[r'const'] as String? : null) ??
              (schema['returnType'] is String
                  ? schema['returnType'] as String
                  : null) ??
              'any';
      functions.add(
        FunctionApi(
          name: fnName,
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
  Map<String, Object?> get catalogSchema {
    final bool v1 = isVersionAtLeast(protocolVersion, 'v1.0');
    // From v1.0 a call names its function under `@call`.
    final callKey = v1 ? '@call' : 'call';
    return {
      r'$schema': jsonSchemaDialect,
      if (schemaId != null) r'$id': schemaId,
      if (title != null) 'title': title,
      if (description != null) 'description': description,
      if (protocolVersion != null) 'protocolVersion': protocolVersion,
      'catalogId': id,
      'components': {
        for (final MapEntry<String, C> entry in components.entries)
          entry.key: _deepCopyValue(entry.value.schema.value),
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
              'properties': <String, Object?>{
                callKey: <String, Object?>{'const': entry.key},
                'args': _deepCopyValue(entry.value.argumentSchema.value),
                'returnType': <String, Object?>{
                  'const': entry.value.returnType.jsonValue,
                },
              },
              'required': <Object?>[callKey, 'args'],
              // v1.0's `FunctionCall` closes the object itself, after
              // adding `catalogId` from `FunctionCommon`.
              if (!v1) 'unevaluatedProperties': false,
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
        if (functions.isNotEmpty || v1)
          'anyFunction': {
            'oneOf': [
              for (final String name in functions.keys)
                {r'$ref': '#/functions/$name'},
              // From v1.0 a call to a function the catalog does not declare
              // is forwarded to the agent, so it matches with its arguments
              // unchecked. `@index` is matched by `IndexSystemFunction`.
              if (v1)
                {
                  'type': 'object',
                  'properties': {
                    '@call': {
                      'not': {
                        'enum': [...functions.keys, '@index'],
                      },
                    },
                    'args': {'type': 'object'},
                  },
                  'required': ['@call'],
                },
            ],
          },
      },
    };
  }

  /// A copy of this catalog with the given components and functions.
  ///
  /// Used by catalog transformers to narrow a catalog before prompting or
  /// validation.
  Catalog<C, F> copyWith({
    Iterable<C>? components,
    Iterable<F>? functions,
    Schema? themeSchema,
  }) =>
      Catalog<C, F>(
        id: id,
        components: (components ?? this.components.values).toList(),
        functions: (functions ?? this.functions.values).toList(),
        themeSchema: themeSchema ?? this.themeSchema,
        schemaId: schemaId,
        title: title,
        description: description,
        protocolVersion: protocolVersion,
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
