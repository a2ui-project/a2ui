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
import 'legacy_inline_catalog.dart';

/// A definition of a UI component's API.
///
/// Carries the component's name and JSON schema, plus the composition
/// constraints and authored JSON a catalog document may give it, so it is
/// what [Catalog.fromJson] produces directly. A renderer that attaches
/// behaviour subclasses it.
class ComponentApi {
  final String name;
  final Schema schema;

  /// The component types that may contain this one, from the definition's
  /// `allowedParents`, or null when any parent is allowed.
  ///
  /// `'Surface'` names the surface itself, for a component that may be the
  /// root of a surface.
  final List<String>? allowedParents;

  /// The component types this one may contain, from the definition's
  /// `allowedChildren`, or null when any child is allowed.
  final List<String>? allowedChildren;

  /// The component's definition exactly as a catalog document wrote it, when
  /// it was read from one.
  ///
  /// [Catalog.toJson] emits it in place of a serialization of [schema], so a
  /// document read by [Catalog.fromJson] is written back unchanged. Leave it
  /// null for a component defined in code, and for a component derived from
  /// another with a different schema, so the serialization reflects
  /// [schema].
  final Map<String, Object?>? sourceJson;

  const ComponentApi({
    required this.name,
    required this.schema,
    this.allowedParents,
    this.allowedChildren,
    this.sourceJson,
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

  /// The function's definition exactly as a catalog document wrote it, when
  /// it was read from one: an entry of the `functions` map, or an item of the
  /// `functions` list.
  ///
  /// [Catalog.toJson] emits it in place of a serialization of the signature,
  /// so a document read by [Catalog.fromJson] is written back unchanged.
  /// Leave it null for a function defined in code, and for a function
  /// derived from another with a different signature.
  final Map<String, Object?>? sourceJson;

  const FunctionApi({
    required this.name,
    required this.argumentSchema,
    this.returnType = A2uiReturnType.any,
    this.description,
    this.allowedCallers = AllowedCallers.rendererOnly,
    this.requiresUserActivation = false,
    this.sourceJson,
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
    super.sourceJson,
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
  /// [validationSchema] writes it as the bare semantic version
  /// ([A2uiProtocolVersion.semverValue]), the spelling the catalog definition
  /// schema requires.
  final A2uiProtocolVersion? protocolVersion;

  /// Markdown design guidelines for this catalog, which agents add to the
  /// prompt alongside its components and functions.
  final String? instructions;

  final Map<String, C> components;
  final Map<String, F> functions;
  final Schema? themeSchema;

  /// What [Catalog.fromJson] read from the authored document, so [toJson]
  /// can write it back; null for a catalog defined in code.
  final _CatalogSource? _source;

  /// The component name the protocol reserves for the surface itself.
  static const String reservedComponentName = 'Surface';

  /// The `common_types.json` document this catalog's shared-type pointers
  /// resolve against: the embedded v1.0 document when [protocolVersion] is
  /// 1.0 or later, and the v0.9 document otherwise, including when no
  /// version is declared.
  ///
  /// Decoded once per catalog and shared by [refMap], [validationSchema] and
  /// the renderer's binders, so treat it as read-only. Internal to this
  /// package: callers that need the document call
  /// `commonTypesForProtocolVersion`.
  @internal
  late final Map<String, Object?> commonTypesSchema =
      commonTypesForProtocolVersion(protocolVersion);

  /// Which properties of each component type reference other components.
  ///
  /// Graph validation and node resolution both read this map, so a child
  /// reference the validator checks is one the resolver mounts. It is built
  /// from [components], [validationSchema] and [commonTypesSchema] on first
  /// access and then cached; a catalog is not expected to change its
  /// components after that.
  late final ComponentRefMap refMap = ComponentRefMap(
    {
      for (final MapEntry<String, C> entry in components.entries)
        entry.key: entry.value.schema.value,
    },
    document: validationSchema,
    commonTypes: commonTypesSchema,
  );

  /// Throws [A2uiCatalogError] when two components or two functions share a
  /// name, when a component is named [reservedComponentName], when a
  /// function name starts with `@`, which the protocol reserves for its own
  /// functions, or when a function declares [A2uiReturnType.validationResult]
  /// on a catalog whose effective protocol version is below 1.0 (an omitted
  /// [protocolVersion] is pre-v1.0).
  Catalog({
    required String id,
    required List<C> components,
    List<F> functions = const [],
    Schema? themeSchema,
    String? schemaId,
    String? title,
    String? description,
    A2uiProtocolVersion? protocolVersion,
    String? instructions,
  }) : this._(
          id: id,
          components: components,
          functions: functions,
          themeSchema: themeSchema,
          schemaId: schemaId,
          title: title,
          description: description,
          protocolVersion: protocolVersion,
          instructions: instructions,
          source: null,
        );

  Catalog._({
    required this.id,
    required List<C> components,
    required List<F> functions,
    required this.themeSchema,
    required this.schemaId,
    required this.title,
    required this.description,
    required this.protocolVersion,
    required this.instructions,
    required _CatalogSource? source,
  })  : components = _indexComponents(id, components),
        functions = _indexFunctions(id, functions, protocolVersion),
        _source = source;

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
  /// The catalog keeps the authored document, so [toJson] writes it back.
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

    final Object? rawVersion = json['protocolVersion'];
    final A2uiProtocolVersion? declaredVersion =
        _parseProtocolVersion(rawVersion, rawId);
    final A2uiProtocolVersion? version = declaredVersion ?? protocolVersion;
    final bool v1 = version?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false;

    // Local references are expanded here, once, so each component and
    // function schema stands alone afterwards.
    final document = inlineLocalRefs(json, json)! as Map<String, Object?>;
    if (v1) _checkIdentifiers(document, rawId);

    // The authored JSON, read before references are inlined, so that toJson
    // can write the document back as it was written.
    final Object? rawComponents = json['components'];
    final Object? rawFunctions = json['functions'];
    final Object? rawDefs = json[r'$defs'];

    final List<ComponentApi> components = [
      for (final ComponentApi parsed in _parseComponents(
        document['components'],
        document,
        rawId,
        allowed: allowedComponents,
        atLeastV1: v1,
      ))
        _withComponentSource(
          parsed,
          rawComponents is Map ? rawComponents[parsed.name] : null,
        ),
    ];
    final List<FunctionApi> functions = [
      for (final FunctionApi parsed in _parseFunctions(
        document['functions'],
        rawId,
        allowedFunctions,
      ))
        _withFunctionSource(parsed, _rawFunction(rawFunctions, parsed.name)),
    ];
    final Schema? themeSchema = _parseTheme(document);

    return CatalogApi._(
      id: rawId,
      components: components,
      functions: functions,
      themeSchema: themeSchema,
      schemaId: document[r'$id'] as String?,
      title: document['title'] as String?,
      description: document['description'] as String?,
      protocolVersion: version,
      instructions: document['instructions'] as String?,
      source: _CatalogSource(
        keyOrder: List.unmodifiable(json.keys),
        hasSchemaDialect: json.containsKey(r'$schema'),
        schemaDialect: _frozenCopy(json[r'$schema']),
        declaredProtocolVersion: rawVersion as String?,
        protocolVersion: version,
        hasComponents: json.containsKey('components'),
        componentsJson: _frozenCopy(rawComponents),
        functionsForm: switch (rawFunctions) {
          null => _FunctionsForm.absent,
          List() => _FunctionsForm.list,
          _ => _FunctionsForm.map,
        },
        functionsJson: _frozenCopy(rawFunctions),
        defs: rawDefs is Map
            ? _frozenCopy(rawDefs)! as Map<String, Object?>
            : null,
        theme: _frozenCopy(json['theme']),
        extras: _frozenCopy({
          for (final MapEntry<String, Object?> entry in json.entries)
            if (!_documentKeys.contains(entry.key)) entry.key: entry.value,
        })! as Map<String, Object?>,
        themeSchema: themeSchema,
        componentNames: {for (final c in components) c.name},
        functionNames: {for (final f in functions) f.name},
      ),
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

  /// [parsed] with the authored JSON of [raw], its definition as the
  /// document wrote it.
  static ComponentApi _withComponentSource(ComponentApi parsed, Object? raw) {
    if (raw is! Map) return parsed;
    return ComponentApi(
      name: parsed.name,
      schema: parsed.schema,
      allowedParents: parsed.allowedParents,
      allowedChildren: parsed.allowedChildren,
      sourceJson: _frozenCopy(raw)! as Map<String, Object?>,
    );
  }

  /// [parsed] with the authored JSON of [raw], its definition as the
  /// document wrote it.
  static FunctionApi _withFunctionSource(FunctionApi parsed, Object? raw) {
    if (raw is! Map) return parsed;
    return FunctionApi(
      name: parsed.name,
      argumentSchema: parsed.argumentSchema,
      returnType: parsed.returnType,
      description: parsed.description,
      allowedCallers: parsed.allowedCallers,
      requiresUserActivation: parsed.requiresUserActivation,
      sourceJson: _frozenCopy(raw)! as Map<String, Object?>,
    );
  }

  /// The authored definition of the function [name] in [rawFunctions], the
  /// document's `functions` in either form.
  static Object? _rawFunction(Object? rawFunctions, String name) {
    if (rawFunctions is Map) return rawFunctions[name];
    if (rawFunctions is List) {
      for (final Object? item in rawFunctions) {
        if (item is Map && item['name'] == name) return item;
      }
    }
    return null;
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
    String catalogId, {
    Set<String>? allowed,
    bool atLeastV1 = false,
  }) {
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
      _collectComponentSubSchemas(
        compMap,
        rootDoc,
        subSchemas,
        <String>{},
        atLeastV1: atLeastV1,
      );

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

  /// Collects the subschemas of [schema] that contribute component
  /// properties into [result], following `allOf` and local references.
  ///
  /// A `ComponentCommon` mixin contributes the standard properties of the
  /// protocol version: `accessibility`, and from 1.0 ([atLeastV1]) also
  /// `metadata`. Its envelope keys are dropped by the caller.
  static void _collectComponentSubSchemas(
    Map<String, Object?> schema,
    Map<String, Object?> rootDoc,
    List<Map<String, Object?>> result,
    Set<String> visited, {
    bool atLeastV1 = false,
  }) {
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
                },
                if (atLeastV1) 'metadata': _componentMetadataV1_0(),
              },
              'required': ['id'],
            });
          } else if (_isCheckableRef(ref)) {
            commonSubs.add({
              'properties': {
                'checks': {
                  'type': 'array',
                  'description': 'A list of checks to perform. These are '
                      'function calls that must return a boolean indicating '
                      'validity.',
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
              if (target is Map) {
                if (target.keys.any((k) => k is! String)) {
                  throw A2uiCatalogError(
                    'Target keys must be strings.',
                  );
                }
                _collectComponentSubSchemas(
                  target is Map<String, Object?>
                      ? target
                      : target.cast<String, Object?>(),
                  rootDoc,
                  localRefSubs,
                  visited,
                  atLeastV1: atLeastV1,
                );
              }
            }
          }
          continue;
        }
        _collectComponentSubSchemas(
          subMap,
          rootDoc,
          inlineSubs,
          visited,
          atLeastV1: atLeastV1,
        );
      }
      result.addAll(inlineSubs);
      result.addAll(localRefSubs);
      result.addAll(commonSubs);
    }
  }

  static bool _isComponentCommonRef(String ref) =>
      ref.endsWith('/ComponentCommon');

  static bool _isCheckableRef(String ref) => ref.endsWith('/Checkable');

  /// The `metadata` property of the v1.0 standard `ComponentCommon`, with
  /// its references pointing into `common_types.json`.
  static Map<String, Object?> _componentMetadataV1_0() {
    Object? externalize(Object? node) {
      if (node is List) return [for (final item in node) externalize(item)];
      if (node is! Map) return node;
      final copy = <String, Object?>{
        for (final MapEntry<Object?, Object?> entry in node.entries)
          entry.key! as String: externalize(entry.value),
      };
      final Object? ref = copy[r'$ref'];
      if (ref is String && ref.startsWith(r'#/$defs/')) {
        final target = 'common_types.json$ref';
        copy[r'$ref'] = target;
        copy['commonTypesRef'] = target;
      }
      return copy;
    }

    final common = _standardDefsV1_0['ComponentCommon']! as Map;
    final properties = common['properties']! as Map;
    return externalize(properties['metadata'])! as Map<String, Object?>;
  }

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

  Map<String, Object?>? _memoizedValidationSchema;

  /// This catalog as one self-contained JSON Schema, for validating payloads
  /// and prompting models.
  ///
  /// Rebuilt from the components and functions the catalog currently holds:
  /// each component carries the message envelope (`id` and a `component`
  /// constant), every reference to `common_types.json` becomes a local
  /// `#/$defs/` reference, and the standard definitions those references
  /// reach are copied into `$defs`, alongside the `anyComponent` and
  /// `anyFunction` unions. The standard definitions follow
  /// [protocolVersion]: v1.0 and later use the v1.0 common types, and every
  /// earlier or undeclared version uses the v0.9 ones (this SDK does not
  /// embed the v0.8 definitions).
  ///
  /// Components and object `args` schemas are closed with
  /// `unevaluatedProperties`: the authored `unevaluatedProperties` or
  /// `additionalProperties`, or `false` when they declare neither. A
  /// reference to a standard definition without a description of its own
  /// takes the definition's description.
  ///
  /// The document carries `$schema`, `catalogId`, `protocolVersion` when the
  /// catalog declares one, and `instructions` when set, but not the
  /// catalog's `$id`, `title` or `description`, which [toJson] writes. A
  /// `protocolVersion` passed to [Catalog.fromJson] as a fallback for a
  /// document that declares none is not emitted.
  ///
  /// Built on first access and memoized on the catalog instance. To write
  /// the catalog as a catalog document instead, for example to send it
  /// inline, use [toJson].
  Map<String, Object?> get validationSchema =>
      _memoizedValidationSchema ??= _buildValidationSchema();

  /// The former name of [validationSchema].
  @Deprecated('Use validationSchema, or toJson for the catalog document.')
  Map<String, Object?> get catalogSchema => validationSchema;

  /// Whether [protocolVersion] is 1.0 or later.
  bool get _isAtLeastV1 =>
      protocolVersion?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false;

  /// The `$defs` of [commonTypesSchema], the `common_types.json` document
  /// for [protocolVersion].
  ///
  /// Shared and read-only; copy an entry before handing it out.
  Map<String, Object?> get _standardDefs =>
      commonTypesSchema[r'$defs']! as Map<String, Object?>;

  /// The `$defs` of the v1.0 `common_types.json` document.
  static final Map<String, Object?> _standardDefsV1_0 =
      commonTypesForProtocolVersion(A2uiProtocolVersion.v1_0)[r'$defs']!
          as Map<String, Object?>;

  /// This catalog as a catalog document, the JSON [Catalog.fromJson] reads.
  ///
  /// The document is unbundled: references to `common_types.json` stay
  /// external, and no standard definitions are copied in. Each call returns
  /// a fresh copy that the caller may edit.
  ///
  /// A catalog read by [Catalog.fromJson] writes back the document it was
  /// read from, so `Catalog.fromJson(json).toJson()` equals `json`, up to
  /// the order of object keys:
  ///
  /// - A component or function with a [ComponentApi.sourceJson] or
  ///   [FunctionApi.sourceJson] is written as that JSON. One without, such as
  ///   one defined in code, is serialized from its schema: a `component`
  ///   constant (or the function's `@call` constant from v1.0, `call`
  ///   before), its properties with `common_types.json` references, and its
  ///   composition and caller metadata.
  /// - `$schema`, `$id`, `title`, `description`, `instructions` and
  ///   `protocolVersion` are written as the document declared them, and
  ///   omitted when it did not. A catalog defined in code writes
  ///   `protocolVersion` in its canonical form, such as `1.0` for `v1.0`.
  /// - `functions` keeps the form the document used, a map or a list.
  /// - The document's own `$defs` are kept, except one that the catalog's
  ///   components and functions no longer reference after a transformer
  ///   removed its users. `anyComponent` and `anyFunction` are kept while
  ///   the catalog holds the components and functions the document did, and
  ///   rebuilt from the current ones otherwise; a document that declared
  ///   neither does not gain them.
  /// - Other top-level keys of the document are written back as they are.
  ///
  /// A catalog defined in code always declares `anyComponent`, and declares
  /// `anyFunction` when it has functions or targets v1.0 or later, where a
  /// catalog document requires both. A rebuilt union with no members is
  /// `{"not": {}}`, since JSON Schema requires `oneOf` to be non-empty.
  ///
  /// To advertise a catalog to an agent below protocol v1.0, whose inline
  /// catalog shape differs, use [toLegacyInlineCatalog].
  Map<String, Object?> toJson() {
    final _CatalogSource? source = _source;
    final Set<String> authoredDefNames = {
      ...?source?.defs?.keys,
    };
    Object? unbundle(Object? node) =>
        _unbundleRefs(node, _standardDefs.keys.toSet(), authoredDefNames);

    final listsFunctions = source?.functionsForm == _FunctionsForm.list;
    final serializedComponents = <String, Object?>{
      for (final MapEntry<String, C> entry in components.entries)
        entry.key: entry.value.sourceJson != null
            ? _deepCopyValue(entry.value.sourceJson)
            : _unbundledComponent(entry.key, entry.value, unbundle),
    };
    final Object serializedFunctions = listsFunctions
        ? <Object?>[
            for (final MapEntry<String, F> entry in functions.entries)
              _isListItemSource(entry.key, entry.value.sourceJson)
                  ? _deepCopyValue(entry.value.sourceJson)
                  : _unbundledListFunction(entry.key, entry.value, unbundle),
          ]
        : <String, Object?>{
            for (final MapEntry<String, F> entry in functions.entries)
              entry.key: entry.value.sourceJson != null &&
                      !_isListItemSource(entry.key, entry.value.sourceJson)
                  ? _deepCopyValue(entry.value.sourceJson)
                  : _unbundledFunction(entry.key, entry.value, unbundle),
          };

    Object? theme;
    Map<String, Object?>? defs;
    if (source == null) {
      defs = {
        if (themeSchema != null && !_isAtLeastV1)
          'theme': unbundle(_deepCopyValue(themeSchema!.value)),
        'anyComponent': _componentUnion(),
        if (functions.isNotEmpty || _isAtLeastV1)
          'anyFunction': _functionUnion(),
      };
    } else {
      final bool themeChanged = !identical(themeSchema, source.themeSchema);
      final Object? newTheme = themeSchema == null
          ? null
          : unbundle(_deepCopyValue(themeSchema!.value));
      if (source.theme != null) {
        theme = themeChanged ? newTheme : _deepCopyValue(source.theme);
      }
      defs = source.defs == null
          ? null
          : _deepCopyValue(source.defs) as Map<String, Object?>;
      if (themeChanged &&
          newTheme != null &&
          source.theme == null &&
          !_isAtLeastV1) {
        (defs ??= {})['theme'] = newTheme;
      }
      if (defs != null) {
        if (defs.containsKey('anyComponent') &&
            !_sameNames(components.keys, source.componentNames)) {
          defs['anyComponent'] = _componentUnion();
        }
        if (defs.containsKey('anyFunction') &&
            !_sameNames(functions.keys, source.functionNames)) {
          defs['anyFunction'] = _functionUnion();
        }
        // Drop the definitions that only removed entries referenced.
        final Set<String> referencedBefore = _referencedDefs(
          [source.componentsJson, source.functionsJson, source.theme],
          source.defs!,
        );
        final Set<String> referencedAfter = _referencedDefs(
          [serializedComponents, serializedFunctions, theme],
          defs,
        );
        defs.removeWhere(
          (String name, _) =>
              referencedBefore.contains(name) &&
              !referencedAfter.contains(name),
        );
      }
    }

    final A2uiProtocolVersion? version = protocolVersion;
    final String? emittedVersion =
        source != null && version == source.protocolVersion
            ? source.declaredProtocolVersion
            : version?.semverValue;
    final bool emitComponents =
        source == null || source.hasComponents || components.isNotEmpty;
    final bool emitFunctions = source == null
        ? functions.isNotEmpty
        : source.functionsForm != _FunctionsForm.absent || functions.isNotEmpty;

    final document = <String, Object?>{
      if (source == null)
        r'$schema': jsonSchemaDialect
      else if (source.hasSchemaDialect)
        r'$schema': _deepCopyValue(source.schemaDialect),
      if (schemaId != null) r'$id': schemaId,
      if (title != null) 'title': title,
      if (description != null) 'description': description,
      if (emittedVersion != null) 'protocolVersion': emittedVersion,
      'catalogId': id,
      if (instructions != null) 'instructions': instructions,
      if (emitComponents) 'components': serializedComponents,
      if (emitFunctions) 'functions': serializedFunctions,
      if (theme != null) 'theme': theme,
      if (defs != null) r'$defs': defs,
      // Keys this SDK does not model pass through unchanged.
      if (source != null)
        for (final MapEntry<String, Object?> entry in source.extras.entries)
          if (!_documentKeys.contains(entry.key))
            entry.key: _deepCopyValue(entry.value),
    };
    if (source == null) return document;
    // Follow the key order of the source document.
    return {
      for (final String key in source.keyOrder)
        if (document.containsKey(key)) key: document[key],
      for (final MapEntry<String, Object?> entry in document.entries)
        if (!source.keyOrder.contains(entry.key)) entry.key: entry.value,
    };
  }

  /// The top-level keys of a catalog document that [toJson] writes from the
  /// model.
  static const Set<String> _documentKeys = {
    r'$schema',
    r'$id',
    'title',
    'description',
    'protocolVersion',
    'catalogId',
    'instructions',
    'components',
    'functions',
    'theme',
    r'$defs',
  };

  /// This catalog in the inline catalog shape of renderer capabilities below
  /// protocol v1.0, `client_capabilities.json#/$defs/Catalog` in v0.9 and
  /// v0.9.1.
  ///
  /// Each component is wrapped in the `ComponentCommon` envelope, functions
  /// are listed as `{name, description, returnType, parameters}`, and the
  /// theme is written as its property schemas. It is derived from
  /// [validationSchema], so `allOf` component schemas arrive flattened,
  /// bundled common types are referenced as `common_types.json#/$defs/...`
  /// again, and other local references are inlined. Function parameters and
  /// the theme are written as defined, without the `unevaluatedProperties`
  /// and `additionalProperties` that [validationSchema] adds. From v1.0, a
  /// renderer sends [toJson] instead.
  Map<String, Object?> toLegacyInlineCatalog() {
    final document = _deepCopyValue(validationSchema)! as Map<String, Object?>;
    Object? asDefined(Schema schema) {
      final Object? value = _deepCopyValue(schema.value);
      _restoreRefs(value);
      return value;
    }

    if (document['functions'] case final Map<String, Object?> serialized) {
      for (final MapEntry<String, Object?> entry in serialized.entries) {
        final F? function = functions[entry.key];
        final Object? properties = (entry.value! as Map)['properties'];
        if (function != null && properties is Map) {
          properties['args'] = asDefined(function.argumentSchema);
        }
      }
    }
    if (themeSchema != null && document[r'$defs'] is Map) {
      (document[r'$defs']! as Map)['theme'] = asDefined(themeSchema!);
    }
    return legacyInlineCatalog(document);
  }

  /// Whether [names] and [sourceNames] hold the same names.
  static bool _sameNames(Iterable<String> names, Set<String> sourceNames) {
    final Set<String> current = names.toSet();
    return current.length == sourceNames.length &&
        current.containsAll(sourceNames);
  }

  /// Whether [sourceJson] is an item of a `functions` list, `{name, ...}`,
  /// rather than an entry of a `functions` map.
  static bool _isListItemSource(
          String name, Map<String, Object?>? sourceJson) =>
      sourceJson != null &&
      sourceJson['name'] == name &&
      !sourceJson.containsKey('properties');

  /// The union of every component, `$defs/anyComponent`.
  ///
  /// With no components, a schema nothing matches, `{"not": {}}`: JSON
  /// Schema requires `oneOf` to list at least one schema.
  Map<String, Object?> _componentUnion() => components.isEmpty
      ? {'not': <String, Object?>{}}
      : {
          'oneOf': [
            for (final String name in components.keys)
              {r'$ref': '#/components/${_escapePointer(name)}'},
          ],
          'discriminator': {'propertyName': 'component'},
        };

  /// The union of every function, `$defs/anyFunction`, or `{"not": {}}`
  /// with no functions.
  Map<String, Object?> _functionUnion() => functions.isEmpty
      ? {'not': <String, Object?>{}}
      : {
          'oneOf': [
            for (final String name in functions.keys)
              {r'$ref': '#/functions/${_escapePointer(name)}'},
          ],
        };

  static String _escapePointer(String segment) =>
      segment.replaceAll('~', '~0').replaceAll('/', '~1');

  /// The names of the `$defs` entries [roots] reference, directly or through
  /// other entries of [defs].
  Set<String> _referencedDefs(
    List<Object?> roots,
    Map<String, Object?> defs,
  ) {
    final String? base = schemaId;
    final referenced = <String>{};
    final pending = <Object?>[...roots];
    while (pending.isNotEmpty) {
      final Object? node = pending.removeLast();
      if (node is List) {
        pending.addAll(node);
      } else if (node is Map) {
        final Object? ref = node[r'$ref'];
        if (ref is String) {
          String? fragment;
          if (ref.startsWith('#/')) {
            fragment = ref;
          } else if (base != null && ref.startsWith('$base#/')) {
            fragment = ref.substring(base.length);
          }
          if (fragment != null && fragment.startsWith(r'#/$defs/')) {
            final String name = fragment
                .substring(8)
                .split('/')
                .first
                .replaceAll('~1', '/')
                .replaceAll('~0', '~');
            if (referenced.add(name) && defs.containsKey(name)) {
              pending.add(defs[name]);
            }
          }
        }
        pending.addAll(node.values);
      }
    }
    return referenced;
  }

  /// [node] with its references to the standard definitions in
  /// [standardNames] written as `common_types.json` references, and the
  /// common types markers code-defined schemas carry collapsed into them.
  ///
  /// A local reference to a definition in [authoredDefNames] stays local.
  static Object? _unbundleRefs(
    Object? node,
    Set<String> standardNames,
    Set<String> authoredDefNames,
  ) {
    if (node is List) {
      return [
        for (final Object? item in node)
          _unbundleRefs(item, standardNames, authoredDefNames),
      ];
    }
    if (node is! Map) return node;
    final Object? marker = node['commonTypesRef'];
    if (marker is String) {
      return <String, Object?>{
        r'$ref': _externalRef(marker),
        for (final MapEntry<Object?, Object?> entry in node.entries)
          if (_annotationKeywords.contains(entry.key))
            entry.key! as String: entry.value,
      };
    }
    final result = <String, Object?>{};
    for (final MapEntry<Object?, Object?> entry in node.entries) {
      final key = entry.key! as String;
      final Object? value = entry.value;
      if (key == r'$ref' && value is String) {
        result[key] = _unbundleRef(value, standardNames, authoredDefNames);
      } else {
        result[key] = _unbundleRefs(value, standardNames, authoredDefNames);
      }
    }
    return result;
  }

  static String _unbundleRef(
    String ref,
    Set<String> standardNames,
    Set<String> authoredDefNames,
  ) {
    if (ref.contains('common_types.json#')) return _externalRef(ref);
    if (ref.startsWith(r'#/$defs/')) {
      final String name = ref.substring(8).split('/').first;
      if (standardNames.contains(name) && !authoredDefNames.contains(name)) {
        return 'common_types.json$ref';
      }
    }
    return ref;
  }

  /// [ref], a reference into some spelling of `common_types.json`, as the
  /// relative `common_types.json#...` a catalog document uses.
  static String _externalRef(String ref) {
    final int hash = ref.indexOf('#');
    return hash == -1 ? ref : 'common_types.json${ref.substring(hash)}';
  }

  static const Set<String> _annotationKeywords = {
    'description',
    'title',
    'default',
    'deprecated',
    'readOnly',
    'writeOnly',
    'examples',
  };

  /// The catalog document definition of [component], serialized from its
  /// schema.
  static Map<String, Object?> _unbundledComponent(
    String name,
    ComponentApi component,
    Object? Function(Object?) unbundle,
  ) {
    final raw = unbundle(component.schema.value)! as Map<String, Object?>;
    final properties = <String, Object?>{};
    final required = <String>[];
    void collect(Map<Object?, Object?> branch) {
      if (branch['properties'] case final Map<Object?, Object?> props) {
        properties.addAll(props.cast<String, Object?>());
      }
      if (branch['required'] case final List<Object?> names) {
        required.addAll(names.whereType<String>());
      }
    }

    collect(raw);
    if (raw['allOf'] case final List<Object?> branches) {
      for (final branch in branches) {
        if (branch is Map) collect(branch);
      }
    }
    const envelope = {'id', 'component', 'catalogId'};
    properties.removeWhere((String key, _) => envelope.contains(key));

    return <String, Object?>{
      'type': 'object',
      if (raw['description'] != null) 'description': raw['description'],
      if (component.allowedParents != null)
        'allowedParents': [...component.allowedParents!],
      if (component.allowedChildren != null)
        'allowedChildren': [...component.allowedChildren!],
      'properties': <String, Object?>{
        'component': <String, Object?>{'const': name},
        ...properties,
      },
      'required': <String>[
        'component',
        for (final String key in required)
          if (!envelope.contains(key)) key,
      ],
      if (raw.containsKey('unevaluatedProperties'))
        'unevaluatedProperties': raw['unevaluatedProperties'],
      if (raw.containsKey('additionalProperties'))
        'additionalProperties': raw['additionalProperties'],
    };
  }

  /// The catalog document definition of [function], serialized from its
  /// signature in the shape of [protocolVersion].
  Map<String, Object?> _unbundledFunction(
    String name,
    FunctionApi function,
    Object? Function(Object?) unbundle,
  ) {
    final Object? args = unbundle(function.argumentSchema.value);
    final String callKey = _callKey;
    final required = <String>[
      callKey,
      if (_hasRequiredParameters(function.argumentSchema)) 'args',
    ];
    if (_isAtLeastV1) {
      return <String, Object?>{
        'type': 'object',
        if (function.description != null) 'description': function.description,
        'returnType': function.returnType.jsonValue,
        ..._callerMetadata(function),
        'properties': <String, Object?>{
          callKey: <String, Object?>{'const': name},
          'args': args,
        },
        'required': required,
      };
    }
    return <String, Object?>{
      'type': 'object',
      if (function.description != null) 'description': function.description,
      ..._callerMetadata(function),
      'properties': <String, Object?>{
        callKey: <String, Object?>{'const': name},
        'args': args,
        'returnType': <String, Object?>{'const': function.returnType.jsonValue},
      },
      'required': required,
      'unevaluatedProperties': false,
    };
  }

  /// The `functions` list item for [function], serialized from its
  /// signature.
  static Map<String, Object?> _unbundledListFunction(
    String name,
    FunctionApi function,
    Object? Function(Object?) unbundle,
  ) =>
      <String, Object?>{
        'name': name,
        if (function.description != null) 'description': function.description,
        'returnType': function.returnType.jsonValue,
        'parameters': unbundle(function.argumentSchema.value),
      };

  Map<String, Object?> _buildValidationSchema() {
    final serializedComponents = <String, Object?>{
      for (final MapEntry<String, C> entry in components.entries)
        entry.key: _serializeComponent(entry.key, entry.value),
    };
    final serializedFunctions = <String, Object?>{
      for (final MapEntry<String, F> entry in functions.entries)
        entry.key: _serializeFunction(entry.key, entry.value),
    };

    final defs = <String, Object?>{
      if (themeSchema != null) 'theme': _validationTheme(),
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
    };

    final Map<String, Object?> standardDefs = _standardDefs;

    // The declared version, in the bare semantic version form the catalog
    // definition schema requires; a fallback passed to fromJson is not
    // emitted.
    final A2uiProtocolVersion? version = protocolVersion;
    final _CatalogSource? source = _source;
    final String? emittedVersion = source != null &&
            version == source.protocolVersion
        ? (source.declaredProtocolVersion == null ? null : version?.semverValue)
        : version?.semverValue;

    // The catalog's own `$defs` that entries reference are copied too, so
    // that no reference dangles. A standard definition of the same name
    // wins, and the unions and theme are built above.
    final Map<String, Object?>? authoredDefs = source?.defs;
    const builtDefs = {'theme', 'anyComponent', 'anyFunction'};

    int defsCountBefore;
    do {
      defsCountBefore = defs.length;
      final referenced = <String>{};
      _collectReferencedDefs(serializedComponents, referenced);
      _collectReferencedDefs(serializedFunctions, referenced);
      _collectReferencedDefs(defs, referenced);

      for (final refName in referenced) {
        if (defs.containsKey(refName)) continue;
        if (standardDefs.containsKey(refName)) {
          defs[refName] = _deepCopyValue(standardDefs[refName]);
        } else if (authoredDefs != null &&
            authoredDefs.containsKey(refName) &&
            !builtDefs.contains(refName)) {
          final Object? copy = _deepCopyValue(authoredDefs[refName]);
          _restoreRefs(copy);
          defs[refName] = copy;
        }
      }
    } while (defs.length > defsCountBefore);

    // The standard `FunctionCall` names the catalog's function union as
    // `catalog.json#/$defs/anyFunction`; point it, and any other reference
    // into another document's `$defs`, at this schema's own `$defs`. A
    // catalog without functions gets a union that matches nothing.
    if (_localizeExternalDefRefs(defs) && !defs.containsKey('anyFunction')) {
      defs['anyFunction'] = <String, Object?>{'not': <String, Object?>{}};
    }

    return {
      r'$schema': jsonSchemaDialect,
      if (emittedVersion != null) 'protocolVersion': emittedVersion,
      'catalogId': id,
      if (instructions != null) 'instructions': instructions,
      'components': serializedComponents,
      if (serializedFunctions.isNotEmpty) 'functions': serializedFunctions,
      r'$defs': defs,
    };
  }

  /// The key a function call names its function under: the reserved `@call`
  /// from protocol `1.0`, and `call` before it or when [protocolVersion] is
  /// unset.
  String get _callKey => _isAtLeastV1 ? '@call' : 'call';

  /// The schema of a wire `FunctionCall` of [fn]: the call names the
  /// function under [_callKey] and passes its arguments under `args`.
  ///
  /// From 1.0 this is the published v1 entry: `returnType`, and
  /// `allowedCallers` and `requiresUserActivation` when set, are top-level
  /// keywords, and the entry is not closed. Below 1.0 the call may restate
  /// its `returnType` as a property, and the entry is closed.
  ///
  /// An object `args` schema is closed with `unevaluatedProperties`: the
  /// authored `unevaluatedProperties` or `additionalProperties`, and `false`
  /// when it declares neither.
  Map<String, Object?> _serializeFunction(String name, FunctionApi fn) {
    final String callKey = _callKey;
    final Object? argsValue = _deepCopyValue(fn.argumentSchema.value);
    _restoreRefs(argsValue);
    if (argsValue is Map<String, Object?> && argsValue['type'] == 'object') {
      _closeObject(argsValue);
    }
    // A call to a function without required parameters may omit `args`
    // altogether.
    final required = <Object?>[
      callKey,
      if (_hasRequiredParameters(fn.argumentSchema)) 'args',
    ];
    if (_isAtLeastV1) {
      // The published v1 shape. The entry stays open: `FunctionCall` checks
      // the call against `allOf[FunctionCommon, oneOf[anyFunction]]`, so a
      // closed entry would reject the common keys, such as `catalogId`.
      return <String, Object?>{
        'type': 'object',
        if (fn.description != null) 'description': fn.description,
        'returnType': fn.returnType.jsonValue,
        ..._callerMetadata(fn),
        'properties': <String, Object?>{
          callKey: <String, Object?>{'const': name},
          'args': argsValue,
        },
        'required': required,
      };
    }
    return <String, Object?>{
      'type': 'object',
      if (fn.description != null) 'description': fn.description,
      'properties': <String, Object?>{
        callKey: <String, Object?>{'const': name},
        'args': argsValue,
        'returnType': <String, Object?>{
          'const': fn.returnType.jsonValue,
        },
      },
      'required': required,
      'unevaluatedProperties': false,
    };
  }

  /// The `allowedCallers` and `requiresUserActivation` of [fn], each when
  /// it differs from the catalog definition schema's default or when the
  /// function's authored definition declares it.
  static Map<String, Object?> _callerMetadata(FunctionApi fn) {
    final Map<String, Object?>? source = fn.sourceJson;
    return <String, Object?>{
      if (fn.allowedCallers != AllowedCallers.rendererOnly ||
          (source?.containsKey('allowedCallers') ?? false))
        'allowedCallers': fn.allowedCallers.jsonValue,
      if (fn.requiresUserActivation ||
          (source?.containsKey('requiresUserActivation') ?? false))
        'requiresUserActivation': fn.requiresUserActivation,
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

  /// [themeSchema] as written, with `additionalProperties: true` added when
  /// the theme sets neither `additionalProperties` nor
  /// `unevaluatedProperties`.
  Map<String, Object?> _validationTheme() {
    final theme = _deepCopyValue(themeSchema!.value)! as Map<String, Object?>;
    if (!theme.containsKey('additionalProperties') &&
        !theme.containsKey('unevaluatedProperties')) {
      theme['additionalProperties'] = true;
    }
    return theme;
  }

  /// Rewrites every `<document>#/$defs/<name>` reference in [node] as
  /// `#/$defs/<name>`, in place. Returns whether one named `anyFunction`.
  static bool _localizeExternalDefRefs(Object? node) {
    var namesFunctionUnion = false;
    void visit(Object? node) {
      if (node is List) {
        node.forEach(visit);
      } else if (node is Map) {
        final Object? ref = node[r'$ref'];
        if (ref is String && !ref.startsWith('#')) {
          final int marker = ref.indexOf(r'#/$defs/');
          if (marker > 0) {
            final String local = ref.substring(marker);
            node[r'$ref'] = local;
            if (local == r'#/$defs/anyFunction') namesFunctionUnion = true;
          }
        }
        node.values.forEach(visit);
      }
    }

    visit(node);
    return namesFunctionUnion;
  }

  /// Moves [schema]'s `additionalProperties` to `unevaluatedProperties`,
  /// which is `false` when the schema declares neither.
  static void _closeObject(Map<String, Object?> schema) {
    final Object? additional = schema.remove('additionalProperties');
    schema['unevaluatedProperties'] =
        schema['unevaluatedProperties'] ?? additional ?? false;
  }

  /// The schema of [comp] with the component envelope: an `id`, the
  /// `component` constant, and `unevaluatedProperties` from the authored
  /// `unevaluatedProperties` or `additionalProperties`. Below 1.0 it is
  /// `false` when the component declares neither; from 1.0 it is then
  /// omitted. Non-empty [ComponentApi.allowedParents] and
  /// [ComponentApi.allowedChildren] are carried over.
  Map<String, Object?> _serializeComponent(String name, ComponentApi comp) {
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

    final Map<String, Object?> id = {};
    _localizeRef(id, 'ComponentId');
    final Object? closed =
        raw['unevaluatedProperties'] ?? raw['additionalProperties'];
    final innerProperties = <String, Object?>{
      'id': id,
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
      if (comp.allowedParents case final List<String> parents
          when parents.isNotEmpty)
        'allowedParents': [...parents],
      if (comp.allowedChildren case final List<String> children
          when children.isNotEmpty)
        'allowedChildren': [...children],
      'properties': innerProperties,
      'required': innerRequired,
      // From 1.0 the protocol's component envelope closes the component, so
      // an entry is closed only when its source closes it.
      if (closed != null || !_isAtLeastV1)
        'unevaluatedProperties': closed ?? false,
    };
  }

  /// Rewrites every reference to a `common_types.json` definition in [node]
  /// as a local `#/$defs/` reference, in place.
  ///
  /// A reference without a `description` of its own takes the description
  /// of the definition it names, from the common types for
  /// [protocolVersion]. This includes references that are already local,
  /// `#/$defs/<name>` where `<name>` is a standard definition.
  void _restoreRefs(Object? node) {
    if (node is List) {
      for (final Object? item in node) {
        _restoreRefs(item);
      }
    } else if (node is Map) {
      final Map<dynamic, dynamic> map = node;
      if (map['commonTypesRef'] is String) {
        final target = map['commonTypesRef'] as String;
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
        _localizeRef(map, target.split('/').last);
        return;
      }
      final Object? ref = map[r'$ref'];
      if (ref is String) {
        final int marker = ref.indexOf(r'common_types.json#/$defs/');
        final bool isLocal = ref.startsWith(r'#/$defs/');
        if (marker >= 0 || isLocal) {
          final String defName = ref.split('/').last;
          if (_standardDefs.containsKey(defName)) _localizeRef(map, defName);
        }
      }
      for (final Object? val in map.values) {
        _restoreRefs(val);
      }
    }
  }

  /// Points [node] at the standard definition [defName] and, when [node]
  /// has no description, gives it the definition's.
  void _localizeRef(Map<dynamic, dynamic> node, String defName) {
    node[r'$ref'] = '#/\$defs/$defName';
    if (node.containsKey('description')) return;
    final Object? definition = _standardDefs[defName];
    if (definition is Map && definition['description'] is String) {
      node['description'] = definition['description'];
    }
  }

  /// A copy of this catalog with the given components and functions.
  ///
  /// Used by catalog transformers to narrow a catalog before prompting or
  /// validation. The copy keeps the document metadata and authored `$defs`
  /// that [toJson] writes, and each component and function keeps its
  /// authored JSON, so a transformer that changes an entry's schema must
  /// pass an entry without [ComponentApi.sourceJson] or
  /// [FunctionApi.sourceJson].
  Catalog<C, F> copyWith({
    Iterable<C>? components,
    Iterable<F>? functions,
    Schema? themeSchema,
    A2uiProtocolVersion? protocolVersion,
  }) =>
      Catalog<C, F>._(
        id: id,
        components: (components ?? this.components.values).toList(),
        functions: (functions ?? this.functions.values).toList(),
        themeSchema: themeSchema ?? this.themeSchema,
        schemaId: schemaId,
        title: title,
        description: description,
        protocolVersion: protocolVersion ?? this.protocolVersion,
        instructions: instructions,
        source: _source,
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

/// How a catalog document writes `functions`.
enum _FunctionsForm { absent, map, list }

/// What [Catalog.fromJson] read from an authored catalog document, beyond
/// the model, so that [Catalog.toJson] can write the document back.
///
/// Every JSON value here is a deep, unmodifiable copy.
final class _CatalogSource {
  const _CatalogSource({
    required this.keyOrder,
    required this.hasSchemaDialect,
    required this.schemaDialect,
    required this.declaredProtocolVersion,
    required this.protocolVersion,
    required this.hasComponents,
    required this.componentsJson,
    required this.functionsForm,
    required this.functionsJson,
    required this.defs,
    required this.theme,
    required this.extras,
    required this.themeSchema,
    required this.componentNames,
    required this.functionNames,
  });

  /// The document's top-level keys, in order.
  final List<String> keyOrder;

  /// Whether the document declares `$schema`, and its value.
  final bool hasSchemaDialect;
  final Object? schemaDialect;

  /// `protocolVersion` as the document declares it, or null when it does
  /// not declare one.
  final String? declaredProtocolVersion;

  /// The protocol version the catalog was read with: the declared one, else
  /// the one passed to [Catalog.fromJson].
  final A2uiProtocolVersion? protocolVersion;

  /// Whether the document declares `components`, and its value.
  final bool hasComponents;
  final Object? componentsJson;

  /// The form of the document's `functions`, and its value.
  final _FunctionsForm functionsForm;
  final Object? functionsJson;

  /// The document's `$defs`, including `anyComponent` and `anyFunction`.
  final Map<String, Object?>? defs;

  /// The document's top-level `theme`.
  final Object? theme;

  /// The document's other top-level keys, which [Catalog.toJson] writes
  /// back as they are.
  final Map<String, Object?> extras;

  /// The theme schema read from the document, to tell whether the catalog
  /// still carries it.
  final Schema? themeSchema;

  /// The names of the components and functions read from the document.
  final Set<String> componentNames;
  final Set<String> functionNames;
}

/// A deep copy of the JSON [value] whose maps and lists are unmodifiable.
Object? _frozenCopy(Object? value) {
  if (value is Map) {
    return Map<String, Object?>.unmodifiable({
      for (final MapEntry<Object?, Object?> entry in value.entries)
        entry.key! as String: _frozenCopy(entry.value),
    });
  }
  if (value is List) {
    return List<Object?>.unmodifiable([
      for (final Object? item in value) _frozenCopy(item),
    ]);
  }
  return value;
}
