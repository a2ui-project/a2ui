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
import 'package:meta/meta.dart';

import '../primitives/cancellation.dart';
import '../primitives/common_types_documents.dart';
import '../primitives/errors.dart';
import '../primitives/protocol_version.dart';
import '../primitives/reactivity.dart';
import '../primitives/reference_schema.dart';
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

  /// Who may invoke this function. An agent's `callRendererFunction` is
  /// refused unless this allows the agent.
  final AllowedCallers allowedCallers;

  /// Whether the function runs only from a user activation, such as an
  /// action the user triggered, and not from a dynamic value.
  final bool requiresUserActivation;

  const FunctionApi({
    required this.name,
    required this.argumentSchema,
    this.returnType = A2uiReturnType.any,
    this.description,
    this.allowedCallers = AllowedCallers.rendererOnly,
    this.requiresUserActivation = false,
  });
}

/// A function implementation that can be registered with a catalog.
abstract class FunctionImplementation extends FunctionApi {
  const FunctionImplementation({
    required super.name,
    required super.argumentSchema,
    super.returnType,
    super.description,
    super.allowedCallers,
    super.requiresUserActivation,
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

  /// The protocol version the document declared as its `protocolVersion`,
  /// when it declared one.
  ///
  /// Selects the validation rules applied to payloads drawing on this catalog:
  /// v1.0 and later use the v1.0 rules (`@path` and `@call`, UAX #31
  /// identifiers, reserved `@` keys), anything else, including none, the v0.9
  /// rules. A surface accepts only catalogs whose version is compatible with
  /// its own (see `isCatalogVersionCompatible`): null means unversioned, which
  /// predates the field and so is pre-v1.0, so a v0.9 or v0.9.1 surface
  /// accepts the catalog and a v1.0 or later surface rejects it.
  /// [catalogSchema] writes it back as the bare semantic version
  /// ([A2uiProtocolVersion.semverValue]), the spelling the catalog definition
  /// schema requires.
  final A2uiProtocolVersion? protocolVersion;

  /// Markdown design guidelines for this catalog, which agents add to the
  /// prompt alongside its components and functions.
  final String? instructions;

  final Map<String, C> components;
  final Map<String, F> functions;
  final Schema? themeSchema;

  /// The component name the protocol reserves for the surface itself.
  static const String reservedComponentName = 'Surface';

  /// The `common_types.json` document this catalog's shared-type pointers
  /// resolve against: the embedded v1.0 document when [protocolVersion] is
  /// 1.0 or later, and the v0.9 document otherwise, including when no
  /// version is declared.
  ///
  /// Decoded once per catalog and shared by [refMap] and the renderer's
  /// binders, so treat it as read-only. Internal to this package: callers that
  /// need the document call `commonTypesForProtocolVersion`.
  @internal
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

  /// Throws [A2uiCatalogError] when two components or two functions share a
  /// name, when a component is named [reservedComponentName], when a
  /// function name starts with `@`, which the protocol reserves for its own
  /// functions, or when a function declares [A2uiReturnType.validationResult]
  /// on a catalog whose effective protocol version is below 1.0 (an omitted
  /// [protocolVersion] is pre-v1.0).
  Catalog({
    required this.id,
    required List<C> components,
    List<F> functions = const [],
    this.themeSchema,
    this.schemaId,
    this.title,
    this.description,
    this.protocolVersion,
    this.instructions,
  })  : components = _indexComponents(id, components),
        functions = _indexFunctions(id, functions, protocolVersion);

  static Map<String, T> _indexComponents<T extends ComponentApi>(
    String catalogId,
    List<T> items,
  ) {
    final byName = <String, T>{};
    for (final item in items) {
      if (item.name == reservedComponentName) {
        throw A2uiCatalogError(
          "Catalog '$catalogId' declares a component named "
          "'$reservedComponentName', which is reserved.",
          catalogId: catalogId,
        );
      }
      _addUnique(byName, catalogId, 'component', item.name, item);
    }
    return byName;
  }

  static Map<String, T> _indexFunctions<T extends FunctionApi>(
    String catalogId,
    List<T> items,
    A2uiProtocolVersion? protocolVersion,
  ) {
    final bool allowsValidationResult =
        protocolVersion?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false;
    final byName = <String, T>{};
    for (final item in items) {
      if (item.name.startsWith('@')) {
        throw A2uiCatalogError(
          "Catalog '$catalogId' declares a function named '${item.name}'; "
          "names starting with '@' are reserved.",
          catalogId: catalogId,
        );
      }
      if (!allowsValidationResult &&
          item.returnType == A2uiReturnType.validationResult) {
        throw A2uiCatalogError(
          "Function '${item.name}' declares returnType 'validationResult', "
          'which protocol ${protocolVersion?.semverValue ?? '0.9'} does not '
          'define; declare protocolVersion 1.0 or later.',
          catalogId: catalogId,
        );
      }
      _addUnique(byName, catalogId, 'function', item.name, item);
    }
    return byName;
  }

  static void _addUnique<T>(
    Map<String, T> byName,
    String catalogId,
    String kind,
    String name,
    T item,
  ) {
    if (byName.containsKey(name)) {
      throw A2uiCatalogError(
        "Catalog '$catalogId' declares more than one $kind named '$name'.",
        catalogId: catalogId,
      );
    }
    byName[name] = item;
  }

  /// Parses a catalog document into a schema-only [Catalog].
  ///
  /// Accepts both forms of `functions`: the map of name to JSON schema used by
  /// published catalog documents, and the list of definitions used by inline
  /// catalogs in renderer capabilities.
  ///
  /// A declared `protocolVersion` is read as a semantic version
  /// ([A2uiProtocolVersion.tryParseSemVer]), so `1.0`, `v1.0` and `1.0.0` all
  /// name v1.0. When the document declares none, as documents written before
  /// v1.0 do not, [protocolVersion] is used instead; with neither the catalog
  /// is pre-v1.0. The version gates function capabilities
  /// (`returnType: 'validationResult'` requires 1.0 or later), and a surface
  /// checks it against its own. From v1.0, component names, their property
  /// names, function names and argument names must be UAX #31 identifiers.
  ///
  /// Throws [A2uiCatalogError] if the document is malformed, conflicts with
  /// [expectedCatalogId], declares a `protocolVersion` this SDK does not
  /// implement, or holds a local `$ref` that names nothing.
  static CatalogApi fromJson(
    Map<String, Object?> json, {
    String? expectedCatalogId,
    A2uiProtocolVersion? protocolVersion,
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

    final A2uiProtocolVersion? version =
        _parseProtocolVersion(json['protocolVersion'], rawId) ??
            protocolVersion;
    final bool v1 = version?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false;

    // Local references are expanded here, once, so each component and function
    // schema stands alone afterwards. The document is then no longer needed,
    // and [catalogSchema] rebuilds it from the parts rather than caching it.
    final document = inlineLocalRefs(json, json)! as Map<String, Object?>;
    if (v1) _checkIdentifiers(document, rawId);

    return CatalogApi(
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
      protocolVersion: version,
      instructions: document['instructions'] as String?,
    );
  }

  /// The protocol version a catalog document declares, or null when it
  /// declares none.
  ///
  /// Throws [A2uiCatalogError] when [raw] is not a string, is not a semantic
  /// version, or names a version this SDK does not implement.
  static A2uiProtocolVersion? _parseProtocolVersion(
    Object? raw,
    String catalogId,
  ) {
    if (raw == null) return null;
    if (raw is! String) {
      throw A2uiCatalogError(
        "Catalog 'protocolVersion' must be a string.",
        catalogId: catalogId,
      );
    }
    return A2uiProtocolVersion.tryParseSemVer(raw) ??
        (throw A2uiCatalogError(
          "Catalog declares protocol version '$raw'; this SDK supports only "
          '${A2uiProtocolVersion.supportedVersions}.',
          catalogId: catalogId,
        ));
  }

  /// Checks the names a v1.0 catalog declares against UAX #31.
  ///
  /// [json] is the document after local references are inlined, so property
  /// and argument names reached through `$ref` and `allOf` are checked too.
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

    // The names of an object schema's properties, including those its
    // `allOf` members declare, since `_parseComponents` merges them in.
    Iterable<String> propertyNames(Object? schema) sync* {
      if (schema is! Map) return;
      if (schema['properties'] case final Map<Object?, Object?> properties) {
        yield* properties.keys.whereType<String>();
      }
      if (schema['allOf'] case final List<Object?> members) {
        for (final member in members) {
          yield* propertyNames(member);
        }
      }
    }

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
      final Object? rawCompDesc = compMap['description'];
      if (rawCompDesc != null && rawCompDesc is! String) {
        throw A2uiCatalogError(
          "Component '$compName' description must be a string.",
          catalogId: catalogId,
        );
      }
      var compDesc = rawCompDesc as String?;

      for (final s in subSchemas) {
        final Object? subDesc = s['description'];
        if (subDesc != null && subDesc is! String) {
          throw A2uiCatalogError(
            "Component '$compName' description must be a string.",
            catalogId: catalogId,
          );
        }
        compDesc ??= subDesc as String?;
        final Object? props = s['properties'];
        if (props is Map<String, Object?>) {
          mergedProperties.addAll(props);
        } else if (props is Map) {
          if (props.keys.any((k) => k is! String)) {
            throw A2uiCatalogError(
              "Component '$compName' property keys must be strings.",
              catalogId: catalogId,
            );
          }
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
          allowedParents: _parseTypeList(
            compMap['allowedParents'],
            'allowedParents',
            compName,
            catalogId,
          ),
          allowedChildren: _parseTypeList(
            compMap['allowedChildren'],
            'allowedChildren',
            compName,
            catalogId,
          ),
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
    if (schema.containsKey('properties') || schema.containsKey('description')) {
      result.add(schema);
    }
    final Object? allOf = schema['allOf'];
    if (allOf is List) {
      final inlineSubs = <Map<String, Object?>>[];
      final localRefSubs = <Map<String, Object?>>[];
      final commonSubs = <Map<String, Object?>>[];

      for (final Object? sub in allOf) {
        if (sub is! Map) continue;
        final Map<String, Object?> subMap;
        if (sub is Map<String, Object?>) {
          subMap = sub;
        } else {
          if (sub.keys.any((k) => k is! String)) {
            throw A2uiCatalogError(
              "Subschema keys in 'allOf' must be strings.",
            );
          }
          subMap = sub.cast<String, Object?>();
        }

        final Object? ref = subMap[r'$ref'];
        if (ref is String) {
          if (_isComponentCommonRef(ref)) {
            commonSubs.add({
              'properties': {
                'id': {
                  r'$ref': r'common_types.json#/$defs/ComponentId',
                  'commonTypesRef': r'common_types.json#/$defs/ComponentId',
                },
                'accessibility': {
                  r'$ref': r'common_types.json#/$defs/AccessibilityAttributes',
                  'commonTypesRef':
                      r'common_types.json#/$defs/AccessibilityAttributes',
                  'description': 'Accessibility properties',
                },
              },
              'required': ['id'],
            });
          } else if (_isCheckableRef(ref)) {
            commonSubs.add({
              'properties': {
                'checks': {
                  'type': 'array',
                  'description': 'A list of checks to perform.',
                  'items': {
                    r'$ref': r'common_types.json#/$defs/CheckRule',
                    'commonTypesRef': r'common_types.json#/$defs/CheckRule',
                  },
                },
              },
            });
          } else if (ref.startsWith('#/')) {
            if (visited.add(ref)) {
              final Object? target = _resolveJsonPointer(rootDoc, ref);
              if (target is Map<String, Object?>) {
                _collectComponentSubSchemas(
                  target,
                  rootDoc,
                  localRefSubs,
                  visited,
                );
              } else if (target is Map) {
                if (target.keys.any((k) => k is! String)) {
                  throw A2uiCatalogError(
                    'Target keys must be strings.',
                  );
                }
                _collectComponentSubSchemas(
                  target.cast<String, Object?>(),
                  rootDoc,
                  localRefSubs,
                  visited,
                );
              }
            }
          }
          continue;
        }
        _collectComponentSubSchemas(subMap, rootDoc, inlineSubs, visited);
      }
      result.addAll(inlineSubs);
      result.addAll(localRefSubs);
      result.addAll(commonSubs);
    }
  }

  static bool _isComponentCommonRef(String ref) =>
      ref.endsWith('/ComponentCommon');

  static bool _isCheckableRef(String ref) => ref.endsWith('/Checkable');

  static Object? _resolveJsonPointer(
    Map<String, Object?> rootDoc,
    String pointer,
  ) {
    if (!pointer.startsWith('#/')) return null;
    final Iterable<String> segments =
        pointer.substring(2).split('/').map((s) => s.replaceAllMapped(
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

    final Object? ref = map[r'$ref'] ?? map['commonTypesRef'];
    final String? fragment = _commonTypesFragment(ref);
    if (fragment != null) {
      final target = 'common_types.json#/\$defs/$fragment';
      map['commonTypesRef'] = target;
      map[r'$ref'] = target;
    }

    final newEntries = <String, Object?>{};
    for (final MapEntry<String, Object?> entry in map.entries) {
      newEntries[entry.key] = _normalizePropertyRefs(entry.value);
    }
    return newEntries;
  }

  /// The `$defs` pointer fragment of [ref] when it names a common type.
  ///
  /// Accepts the external document form (`...common_types.json#/$defs/X...`)
  /// and the bundled form (`#/$defs/X...`). Deep pointers below the definition
  /// (`DynamicString/oneOf/0`) are kept intact so that resolution can follow
  /// them. Returns `null` for any other reference.
  static String? _commonTypesFragment(Object? ref) {
    if (ref is! String) return null;
    const marker = r'#/$defs/';
    final String fragment;
    if (ref.contains('common_types.json$marker')) {
      fragment = ref.substring(ref.indexOf(marker) + marker.length);
    } else if (ref.startsWith(marker)) {
      fragment = ref.substring(marker.length);
    } else {
      return null;
    }
    if (fragment.isEmpty) return null;
    return isCommonTypeDef(fragment.split('/').first) ? fragment : null;
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
                description: entry['description'] is String
                    ? entry['description'] as String
                    : (entry['description'] == null
                        ? null
                        : throw A2uiCatalogError(
                            "Function definition 'description' must be a "
                            'string.',
                            catalogId: catalogId,
                          )),
                argumentSchema: Schema.fromMap(
                  _asSchemaMap(
                      entry['parameters'] ?? const <String, Object?>{}),
                ),
                returnType: A2uiReturnType.fromJson(
                  entry['returnType'] as String? ?? 'any',
                ),
                allowedCallers: _parseAllowedCallers(
                  entry['allowedCallers'],
                  entry['name'] as String,
                  catalogId,
                ),
                requiresUserActivation: _parseRequiresUserActivation(
                  entry['requiresUserActivation'],
                  entry['name'] as String,
                  catalogId,
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
      final Object? rawFnDesc =
          schema['description'] ?? properties['description'];
      if (rawFnDesc != null && rawFnDesc is! String) {
        throw A2uiCatalogError(
          "Catalog function '$fnName' description must be a string.",
          catalogId: catalogId,
        );
      }
      final desc = rawFnDesc as String?;
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
          allowedCallers: _parseAllowedCallers(
            schema['allowedCallers'],
            fnName,
            catalogId,
          ),
          requiresUserActivation: _parseRequiresUserActivation(
            schema['requiresUserActivation'],
            fnName,
            catalogId,
          ),
        ),
      );
    }
    return functions;
  }

  /// Reads a function's `allowedCallers`, defaulting to
  /// [AllowedCallers.rendererOnly] as the catalog definition schema does.
  static AllowedCallers _parseAllowedCallers(
    Object? raw,
    String functionName,
    String catalogId,
  ) {
    if (raw == null) return AllowedCallers.rendererOnly;
    if (raw is! String) {
      throw A2uiCatalogError(
        "Catalog function '$functionName' allowedCallers must be a string.",
        catalogId: catalogId,
      );
    }
    try {
      return AllowedCallers.fromJson(raw);
    } on A2uiCatalogError catch (error) {
      throw A2uiCatalogError(
        "Catalog function '$functionName': ${error.message}",
        catalogId: catalogId,
        cause: error,
      );
    }
  }

  /// Reads a function's `requiresUserActivation`, defaulting to false.
  static bool _parseRequiresUserActivation(
    Object? raw,
    String functionName,
    String catalogId,
  ) {
    if (raw == null) return false;
    if (raw is! bool) {
      throw A2uiCatalogError(
        "Catalog function '$functionName' requiresUserActivation must be a "
        'boolean.',
        catalogId: catalogId,
      );
    }
    return raw;
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

  Map<String, Object?>? _memoizedCatalogSchema;

  /// The catalog document for this catalog, as JSON.
  ///
  /// The catalog as a document, rebuilt from the components and functions it
  /// currently holds.
  ///
  /// Rebuilt component schemas are memoized on the catalog instance.
  ///
  /// `$schema` is always emitted; `$id`, `title`, `description`, and
  /// `protocolVersion` are emitted when the parsed document declared them,
  /// so a document round trips through [Catalog.fromJson] with its identity
  /// intact.
  Map<String, Object?> get catalogSchema =>
      _memoizedCatalogSchema ??= _buildCatalogSchema();

  Map<String, Object?> _buildCatalogSchema() {
    final bool v1 =
        protocolVersion?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false;
    final serializedComponents = <String, Object?>{
      for (final MapEntry<String, C> entry in components.entries)
        entry.key: _serializeComponent(entry.key, entry.value, v1: v1),
    };
    final serializedFunctions = <String, Object?>{
      for (final MapEntry<String, F> entry in functions.entries)
        entry.key: _serializeFunction(entry.key, entry.value, v1: v1),
    };

    final defs = <String, Object?>{
      if (themeSchema != null) 'theme': _deepCopyValue(themeSchema!.value),
      'anyComponent': {
        'oneOf': [
          for (final String name in components.keys)
            {r'$ref': '#/components/$name'},
        ],
        'discriminator': {'propertyName': 'component'},
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
    };

    final standardDefs = commonTypesSchema[r'$defs']! as Map<String, Object?>;

    int defsCountBefore;
    do {
      defsCountBefore = defs.length;
      final referenced = <String>{};
      _collectReferencedDefs(serializedComponents, referenced);
      _collectReferencedDefs(serializedFunctions, referenced);
      _collectReferencedDefs(defs, referenced);

      for (final refName in referenced) {
        if (standardDefs.containsKey(refName) && !defs.containsKey(refName)) {
          defs[refName] = _deepCopyValue(standardDefs[refName]);
        }
      }
    } while (defs.length > defsCountBefore);

    return {
      r'$schema': jsonSchemaDialect,
      if (schemaId != null) r'$id': schemaId,
      if (title != null) 'title': title,
      if (description != null) 'description': description,
      if (protocolVersion case final A2uiProtocolVersion version)
        'protocolVersion': version.semverValue,
      'catalogId': id,
      if (instructions != null) 'instructions': instructions,
      'components': serializedComponents,
      if (serializedFunctions.isNotEmpty) 'functions': serializedFunctions,
      r'$defs': defs,
    };
  }

  /// The document form of a function: the schema of a call to it.
  ///
  /// `anyFunction` and every `DynamicString` reach these through
  /// `#/functions/<name>`, so a different shape would silently stop matching.
  /// From v1.0 a call names its function under `@call`, the return type is a
  /// keyword of the entry rather than a property of the call, and v1.0's
  /// `FunctionCall` closes the object itself after adding `catalogId` from
  /// `FunctionCommon`, so only the v0.9 form closes it here.
  static Map<String, Object?> _serializeFunction(
    String name,
    FunctionApi fn, {
    required bool v1,
  }) {
    final Object? argsValue = _deepCopyValue(fn.argumentSchema.value);
    _restoreRefs(argsValue);
    final callKey = v1 ? '@call' : 'call';
    return <String, Object?>{
      'type': 'object',
      if (fn.description != null) 'description': fn.description,
      if (v1) 'returnType': fn.returnType.jsonValue,
      // Emitted only when they differ from the schema defaults, so a
      // document that never declared them round-trips unchanged.
      if (fn.allowedCallers != AllowedCallers.rendererOnly)
        'allowedCallers': fn.allowedCallers.jsonValue,
      if (fn.requiresUserActivation) 'requiresUserActivation': true,
      'properties': <String, Object?>{
        callKey: <String, Object?>{'const': name},
        'args': argsValue,
        if (!v1)
          'returnType': <String, Object?>{
            'const': fn.returnType.jsonValue,
          },
      },
      // A call to a function without required parameters may omit `args`
      // altogether.
      'required': <Object?>[
        callKey,
        if (_hasRequiredParameters(fn.argumentSchema)) 'args',
      ],
      if (!v1) 'unevaluatedProperties': false,
    };
  }

  static void _collectReferencedDefs(Object? node, Set<String> result) {
    if (node is List) {
      for (final Object? item in node) {
        _collectReferencedDefs(item, result);
      }
    } else if (node is Map) {
      final Object? ref = node[r'$ref'];
      if (ref is String && ref.startsWith(r'#/$defs/')) {
        // Deep pointers (`#/$defs/X/oneOf/0`) still depend on `X`.
        result.add(ref.substring(8).split('/').first);
      }
      for (final Object? value in node.values) {
        _collectReferencedDefs(value, result);
      }
    }
  }

  /// The document form of a component.
  ///
  /// Below v1.0 the component declares its own `id`, as the v0.9 wire schema
  /// reaches the catalog without an envelope. From v1.0 the message envelope
  /// supplies `id`, so the component must not declare it.
  static Map<String, Object?> _serializeComponent(
    String name,
    ComponentApi comp, {
    required bool v1,
  }) {
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
      if (!v1)
        'id': <String, Object?>{
          r'$ref': '#/\$defs/ComponentId',
        },
      'component': <String, Object?>{'const': name},
      ...sanitizedProps,
    };

    final innerRequired = <String>[
      if (!v1) 'id',
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
    } else if (node is Map) {
      final Map<dynamic, dynamic> map = node;
      if (map['commonTypesRef'] is String) {
        final target = map['commonTypesRef'] as String;
        final String fragment =
            _commonTypesFragment(target) ?? target.split('/').last;
        const annotations = {
          'description',
          'title',
          'default',
          'deprecated',
          'readOnly',
          'writeOnly',
          'examples',
        };
        map.removeWhere((k, _) => !annotations.contains(k));
        map[r'$ref'] = '#/\$defs/$fragment';
        return;
      }
      final Object? ref = map[r'$ref'];
      if (ref is String && ref.startsWith('common_types.json#/\$defs/')) {
        final String? fragment = _commonTypesFragment(ref);
        if (fragment != null) map[r'$ref'] = '#/\$defs/$fragment';
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
    A2uiProtocolVersion? protocolVersion,
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
        instructions: instructions,
      );

  static bool _hasRequiredParameters(Schema schema) {
    final Object? required = schema.value['required'];
    return required is List && required.isNotEmpty;
  }

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
