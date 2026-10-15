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
import '../resolution/data_context.dart';
import '../validation/schema_resolution.dart';
import 'legacy_inline_catalog.dart';

/// A definition of a UI component's API.
///
/// Carries the component's name and JSON schema, plus the composition
/// constraints a catalog document may give it, so it is what
/// [Catalog.fromJson] produces directly. A renderer that attaches behaviour
/// subclasses it.
class ComponentApi {
  final String name;

  /// The JSON schema of the component's definition.
  ///
  /// For a component read by [Catalog.fromJson], this is the definition as
  /// the catalog document wrote it: `allOf` mixins, local `#/$defs/...` and
  /// `common_types.json` references, descriptions and closure keywords are
  /// all kept, so [Catalog.toJson] writes it back unchanged. Only
  /// `allowedParents` and `allowedChildren` are taken out, into
  /// [allowedParents] and [allowedChildren].
  ///
  /// Renderers and validators work with the flattened form instead, which
  /// [Catalog.resolvedComponentSchemas] holds.
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

  /// The JSON schema of the function's `args`.
  ///
  /// For a function read by [Catalog.fromJson], this is the schema as the
  /// catalog document wrote it, with its references kept.
  final Schema argumentSchema;
  final String? description;

  /// The `allowedCallers` the definition declares, or null when it declares
  /// none.
  final AllowedCallers? declaredAllowedCallers;

  /// The `requiresUserActivation` the definition declares, or null when it
  /// declares none.
  final bool? declaredRequiresUserActivation;

  /// The definition as the catalog document wrote it, or null for a function
  /// defined in code.
  ///
  /// For a function read by [Catalog.fromJson], this is the value under the
  /// function's name in a `functions` map, or its item in a `functions`
  /// list, in whichever shape the document used, and [Catalog.toJson] writes
  /// it back unchanged. The other fields are read from it. A function
  /// without one is written in the shape of the catalog's protocol version,
  /// from its other fields.
  final Map<String, Object?>? definition;

  /// Creates a function signature.
  ///
  /// [allowedCallers] and [requiresUserActivation] are written to
  /// [Catalog.toJson] only when given, even when given their default value,
  /// so a definition that states a default keeps stating it. [definition],
  /// when given, is written instead of the other fields, so it must describe
  /// the same function; pass it on when wrapping a function read by
  /// [Catalog.fromJson].
  const FunctionApi({
    required this.name,
    required this.argumentSchema,
    this.returnType = A2uiReturnType.any,
    this.description,
    AllowedCallers? allowedCallers,
    bool? requiresUserActivation,
    this.definition,
  })  : declaredAllowedCallers = allowedCallers,
        declaredRequiresUserActivation = requiresUserActivation;

  /// Who may invoke this function. An agent's `callRendererFunction` is
  /// refused unless this allows the agent.
  AllowedCallers get allowedCallers =>
      declaredAllowedCallers ?? AllowedCallers.rendererOnly;

  /// Whether the function runs only from a user activation, such as an
  /// action the user triggered, and not from a dynamic value.
  bool get requiresUserActivation => declaredRequiresUserActivation ?? false;
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
    super.definition,
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
///
/// The catalog is a model of a catalog document: [Catalog.fromJson] reads a
/// document into the model, keeping each component and function schema as
/// the document wrote it, and [toJson] writes the model back, so
/// `Catalog.fromJson(document).toJson()` equals `document`. [toJson],
/// [validationSchema] and [resolvedComponentSchemas] are computed from the
/// model on first access and cached on the instance.
class Catalog<C extends ComponentApi, F extends FunctionApi> {
  /// The JSON Schema dialect a catalog document declares.
  static const String jsonSchemaDialect =
      'https://json-schema.org/draft/2020-12/schema';

  /// The catalog id, from the document's `catalogId` field.
  final String id;

  /// The document's `$schema`, the JSON Schema dialect it is written in, or
  /// null when it declares none.
  final String? schemaDialect;

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

  /// The protocol version the catalog targets: the one its document declares
  /// as `protocolVersion`, or else the one it was read or defined with.
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
  /// schema requires, when the document declares it.
  final A2uiProtocolVersion? protocolVersion;

  /// The document's `protocolVersion` as it is written, or null when the
  /// document declares none.
  final String? _declaredProtocolVersion;

  /// Markdown design guidelines for this catalog, which agents add to the
  /// prompt alongside its components and functions.
  final String? instructions;

  final Map<String, C> components;
  final Map<String, F> functions;
  final Schema? themeSchema;

  /// The document's shared named definitions: its `$defs`, except `theme`
  /// when [themeSchema] was read from there, and the `anyComponent` and
  /// `anyFunction` unions, which [toJson] computes from [components] and
  /// [functions].
  ///
  /// Component and function schemas reference these as `#/$defs/<name>`.
  /// [validationSchema] bundles the ones they reach.
  final Map<String, Object?> definitions;

  /// The document's top-level keys that this model has no field for, which
  /// [toJson] writes back as they are.
  final Map<String, Object?> _otherFields;

  /// Where [toJson] writes the parts of the document that may be laid out
  /// in more than one way.
  final _DocumentLayout _layout;

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
  /// from [resolvedComponentSchemas], [validationSchema] and
  /// [commonTypesSchema] on first access and then cached; a catalog is not
  /// expected to change its components after that.
  late final ComponentRefMap refMap = ComponentRefMap(
    {
      for (final MapEntry<String, C> entry in components.entries)
        entry.key: _flatOf(entry.value).schema.value,
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
  ///
  /// [toJson] writes [protocolVersion] as the document's `protocolVersion`
  /// unless [declaresProtocolVersion] is false, as for a catalog published
  /// before the field existed. [definitions] are the shared `$defs` the
  /// component and function schemas reference, and [schemaDialect] is the
  /// document's `$schema`.
  Catalog({
    required String id,
    required List<C> components,
    List<F> functions = const [],
    Schema? themeSchema,
    String? schemaId,
    String? title,
    String? description,
    A2uiProtocolVersion? protocolVersion,
    bool declaresProtocolVersion = true,
    String? instructions,
    String? schemaDialect = jsonSchemaDialect,
    Map<String, Object?> definitions = const {},
  }) : this._(
          id: id,
          components: components,
          functions: functions,
          themeSchema: themeSchema,
          schemaDialect: schemaDialect,
          schemaId: schemaId,
          title: title,
          description: description,
          protocolVersion: protocolVersion,
          declaredProtocolVersion:
              declaresProtocolVersion ? protocolVersion?.semverValue : null,
          instructions: instructions,
          definitions: definitions,
          otherFields: const {},
          layout: const _DocumentLayout(),
        );

  Catalog._({
    required this.id,
    required List<C> components,
    required List<F> functions,
    required this.themeSchema,
    required this.schemaDialect,
    required this.schemaId,
    required this.title,
    required this.description,
    required this.protocolVersion,
    required String? declaredProtocolVersion,
    required this.instructions,
    required Map<String, Object?> definitions,
    required Map<String, Object?> otherFields,
    required _DocumentLayout layout,
  })  : components = _indexComponents(id, components),
        functions = _indexFunctions(id, functions, protocolVersion),
        definitions = _frozenCopy(definitions)! as Map<String, Object?>,
        _declaredProtocolVersion = declaredProtocolVersion,
        _otherFields = _frozenCopy(otherFields)! as Map<String, Object?>,
        _layout = layout;

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
    return Map.unmodifiable(byName);
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
    return Map.unmodifiable(byName);
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
  /// Each component and function keeps its schema as the document wrote it,
  /// and every other part of the document is read into a field of the
  /// catalog, so [toJson] writes the document back. Accepts both forms of
  /// `functions`: the map of name to JSON schema used by published catalog
  /// documents, and the list of definitions used by inline catalogs in
  /// renderer capabilities.
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
  /// A document whose `anyComponent` or `anyFunction` union lists only some
  /// of its components or functions defines only the listed ones.
  ///
  /// [catalogId], when given, is the catalog's id in place of the one the
  /// document declares. It is required for a document that declares none,
  /// such as the published v0.8 basic catalog.
  ///
  /// Throws [A2uiCatalogError] if the document is malformed, has no catalog
  /// id, conflicts with [expectedCatalogId], declares a `protocolVersion`
  /// this SDK does not implement, or holds a local `$ref` that names
  /// nothing.
  static CatalogApi fromJson(
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
    final A2uiProtocolVersion? declaredVersion = _parseProtocolVersion(
      rawVersion,
      rawId,
    );
    final A2uiProtocolVersion? version = declaredVersion ?? protocolVersion;

    // Expanding the local references checks that each names something, and
    // lets the identifier check see names reached through them. The
    // expanded copy is not kept: the model holds the schemas as written.
    final inlined = inlineLocalRefs(json, json)! as Map<String, Object?>;
    if (version?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false) {
      _checkIdentifiers(inlined, rawId);
    }

    final Object? rawDefs = json[r'$defs'];
    if (rawDefs != null && rawDefs is! Map) {
      throw A2uiCatalogError(
        r"Catalog '$defs' must be an object.",
        catalogId: rawId,
      );
    }
    final Map<String, Object?> defs =
        rawDefs is Map ? rawDefs.cast<String, Object?>() : const {};

    final List<ComponentApi> components = _parseComponents(
      json['components'],
      rawId,
      allowedComponents,
    );
    final Object? rawFunctions = json['functions'];
    final List<FunctionApi> functions = _parseFunctions(
      rawFunctions,
      rawId,
      allowedFunctions,
    );

    final Object? topLevelTheme = json['theme'];
    final bool themeInDefs = topLevelTheme == null && defs['theme'] != null;
    final Object? theme = topLevelTheme ?? defs['theme'];

    // A union is computed from the components and functions, so it is not
    // kept when it is exactly the one this catalog computes. Any other
    // definition of the name, such as the MCP catalog's open
    // `anyComponent`, is a definition of its own.
    final bool componentUnion = defs.containsKey('anyComponent') &&
        _jsonEquals(
          defs['anyComponent'],
          _componentUnionOf([for (final c in components) c.name]),
        );
    final bool functionUnion = defs.containsKey('anyFunction') &&
        _jsonEquals(
          defs['anyFunction'],
          _functionUnionOf([for (final f in functions) f.name]),
        );

    final CatalogApi catalog = CatalogApi._(
      id: rawId,
      components: components,
      functions: functions,
      themeSchema: theme == null
          ? null
          : Schema.fromMap(
              _markRead(
                _frozenCopy(_asSchemaMap(theme))! as Map<String, Object?>,
              ),
            ),
      schemaDialect: _optionalString(json, r'$schema', rawId),
      schemaId: _optionalString(json, r'$id', rawId),
      title: _optionalString(json, 'title', rawId),
      description: _optionalString(json, 'description', rawId),
      protocolVersion: version,
      declaredProtocolVersion: rawVersion as String?,
      instructions: _optionalString(json, 'instructions', rawId),
      definitions: {
        for (final MapEntry<String, Object?> entry in defs.entries)
          if (!(entry.key == 'theme' && themeInDefs) &&
              !(entry.key == 'anyComponent' && componentUnion) &&
              !(entry.key == 'anyFunction' && functionUnion))
            entry.key: entry.value,
      },
      otherFields: {
        for (final MapEntry<String, Object?> entry in json.entries)
          if (!_documentKeys.contains(entry.key)) entry.key: entry.value,
      },
      layout: _DocumentLayout(
        writesCatalogId: json.containsKey('catalogId'),
        writesComponents: json.containsKey('components'),
        writesFunctions: rawFunctions != null,
        listsFunctions: rawFunctions is List,
        writesDefs: rawDefs != null,
        themeInDefs: theme == null ? null : themeInDefs,
        writesComponentUnion: componentUnion,
        writesFunctionUnion: functionUnion,
      ),
    );
    // Flattening each component checks its definition now, rather than when
    // a renderer or validator first needs it.
    components.forEach(catalog._flatOf);
    return catalog;
  }

  /// The string [json] holds under [key], or null when it holds none.
  ///
  /// Throws [A2uiCatalogError] when the value is not a string.
  static String? _optionalString(
    Map<String, Object?> json,
    String key,
    String catalogId,
  ) {
    final Object? value = json[key];
    if (value == null || value is String) return value as String?;
    throw A2uiCatalogError(
      "Catalog '$key' must be a string.",
      catalogId: catalogId,
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
    // `allOf` members declare, since flattening merges them in.
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

    // The names of a function's parameters, whether declared under a JSON
    // Schema's `properties`/`allOf` or directly as a shorthand parameter map.
    Iterable<String> parameterNames(Object? schema) sync* {
      if (schema is! Map) return;
      if (schema.containsKey('properties') || schema.containsKey('allOf')) {
        yield* propertyNames(schema);
        return;
      }
      if (schema['type'] is! String &&
          !schema.containsKey(r'$ref') &&
          !schema.containsKey('oneOf') &&
          !schema.containsKey('anyOf') &&
          !schema.containsKey('not') &&
          schema.values.every((v) => v is Map || v is bool)) {
        yield* schema.keys.whereType<String>();
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
      for (final String arg in parameterNames(args)) {
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

  /// The components of a document's `components` map, each with its
  /// definition as written, except `allowedParents` and `allowedChildren`,
  /// which become fields.
  static List<ComponentApi> _parseComponents(
    Object? raw,
    String catalogId,
    Set<String>? allowed,
  ) {
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
      final Object? parents = compVal['allowedParents'];
      final Object? children = compVal['allowedChildren'];
      final Map<String, Object?> schema = _markRead(
        _frozenCopy({
          for (final MapEntry<Object?, Object?> property in compVal.entries)
            if (property.key != 'allowedParents' &&
                property.key != 'allowedChildren')
              property.key: property.value,
        })! as Map<String, Object?>,
      );
      components.add(
        ComponentApi(
          name: compName,
          schema: Schema.fromMap(schema),
          allowedParents: _parseTypeList(
            parents,
            'allowedParents',
            compName,
            catalogId,
          ),
          allowedChildren: _parseTypeList(
            children,
            'allowedChildren',
            compName,
            catalogId,
          ),
        ),
      );
    }
    return components;
  }

  /// The functions of a document's `functions`, each keeping its definition
  /// as written in [FunctionApi.definition], from which the other fields are
  /// read.
  static List<FunctionApi> _parseFunctions(
    Object? raw,
    String catalogId, [
    Set<String>? allowed,
  ]) {
    if (raw == null) return const [];

    // Inline form: {name, parameters, returnType} definitions.
    if (raw is List) {
      final functions = <FunctionApi>[];
      for (final Object? entry in raw) {
        if (entry is! Map) continue;
        final Object? rawName = entry['name'];
        if (allowed != null &&
            !(rawName is String && allowed.contains(rawName))) {
          continue;
        }
        if (rawName is! String || rawName.isEmpty) {
          throw A2uiCatalogError(
            "Function definition missing 'name' string.",
            catalogId: catalogId,
          );
        }
        final Object? rawDesc = entry['description'];
        if (rawDesc != null && rawDesc is! String) {
          throw A2uiCatalogError(
            "Function definition 'description' must be a string.",
            catalogId: catalogId,
          );
        }
        final definition =
            _frozenCopy(_asSchemaMap(entry))! as Map<String, Object?>;
        functions.add(
          FunctionApi(
            name: rawName,
            description: rawDesc as String?,
            argumentSchema: _argumentSchema(definition['parameters']),
            returnType: A2uiReturnType.fromJson(
              definition['returnType'] as String? ?? 'any',
            ),
            allowedCallers: _parseAllowedCallers(
              definition['allowedCallers'],
              rawName,
              catalogId,
            ),
            requiresUserActivation: _parseRequiresUserActivation(
              definition['requiresUserActivation'],
              rawName,
              catalogId,
            ),
            definition: definition,
          ),
        );
      }
      return functions;
    }

    // Document form: name to JSON schema, with arguments under
    // `properties/args` and the return type under `returnType` (v1.0) or
    // `properties/returnType/const` (v0.9), or shorthand
    // `{returnType, parameters}`.
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
      final schema =
          _frozenCopy(_asSchemaMap(entry.value))! as Map<String, Object?>;
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
      final Object? rawFnDesc = schema['description'];
      if (rawFnDesc != null && rawFnDesc is! String) {
        throw A2uiCatalogError(
          "Catalog function '$fnName' description must be a string.",
          catalogId: catalogId,
        );
      }
      final String returnTypeStr =
          (returnType is Map ? returnType[r'const'] as String? : null) ??
              (schema['returnType'] is String
                  ? schema['returnType'] as String
                  : null) ??
              'any';
      functions.add(
        FunctionApi(
          name: fnName,
          description: rawFnDesc as String?,
          argumentSchema: _argumentSchema(args),
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
          definition: schema,
        ),
      );
    }
    return functions;
  }

  /// The argument schema [raw], a part of a frozen definition, or an empty
  /// schema when the definition gives none.
  static Schema _argumentSchema(Object? raw) {
    final Map<String, Object?> map = raw is Map<String, Object?>
        ? raw
        : _frozenCopy(_asSchemaMap(raw ?? const <String, Object?>{}))!
            as Map<String, Object?>;
    final normalized = map.isNotEmpty &&
            !map.containsKey('properties') &&
            map['type'] is! String &&
            !map.containsKey(r'$ref') &&
            !map.containsKey('allOf') &&
            !map.containsKey('oneOf') &&
            !map.containsKey('anyOf') &&
            !map.containsKey('not') &&
            map.values.every((v) => v is Map || v is bool)
        ? <String, Object?>{'type': 'object', 'properties': map}
        : map;
    return Schema.fromMap(_markRead(normalized));
  }

  /// Reads a function's `allowedCallers`, or null when it declares none.
  static AllowedCallers? _parseAllowedCallers(
    Object? raw,
    String functionName,
    String catalogId,
  ) {
    if (raw == null) return null;
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

  /// Reads a function's `requiresUserActivation`, or null when it declares
  /// none.
  static bool? _parseRequiresUserActivation(
    Object? raw,
    String functionName,
    String catalogId,
  ) {
    if (raw == null) return null;
    if (raw is! bool) {
      throw A2uiCatalogError(
        "Catalog function '$functionName' requiresUserActivation must be a "
        'boolean.',
        catalogId: catalogId,
      );
    }
    return raw;
  }

  static Map<String, Object?> _asSchemaMap(Object? value) {
    if (value is Map) return value.cast<String, Object?>();
    throw A2uiCatalogError('Expected a JSON schema object, got $value.');
  }

  /// Each component's schema, flattened into the shape renderers bind and
  /// validators check, by component name.
  ///
  /// Flattening merges the properties, `required` names and description of
  /// the component's `allOf` members into the schema itself, with the
  /// component's own properties winning over its mixins'; expands the
  /// standard `ComponentCommon` and `Checkable` mixins into the properties
  /// they contribute; inlines local references in the properties, except
  /// those to common types; writes references to common types as
  /// `common_types.json#/$defs/...`; and leaves out the `id`, `component`
  /// and `catalogId` envelope properties. Other keywords are kept as
  /// written, and so is an `allOf` member whose reference the catalog cannot
  /// follow.
  ///
  /// Each component is flattened from [ComponentApi.schema] and
  /// [definitions] when first needed, and the result is cached for that
  /// component. [Catalog.fromJson] flattens every component straight away,
  /// so a malformed definition fails there. To look up one component, use
  /// [resolvedComponentSchema].
  Map<String, Schema> get resolvedComponentSchemas => Map.unmodifiable({
        for (final MapEntry<String, C> entry in components.entries)
          entry.key: _flatOf(entry.value).schema,
      });

  /// The flattened schema of the component named [name], as
  /// [resolvedComponentSchemas] describes, or null when the catalog has no
  /// such component.
  Schema? resolvedComponentSchema(String name) => switch (components[name]) {
        final C component => _flatOf(component).schema,
        null => null,
      };

  /// The flattened schemas computed so far, by component.
  final Map<ComponentApi, _FlatComponent> _flatComponents = Map.identity();

  _FlatComponent _flatOf(ComponentApi component) =>
      _flatComponents[component] ??= _flatten(
        component.name,
        component.schema.value,
      );

  /// [compMap], the schema of the component [compName], flattened as
  /// [resolvedComponentSchemas] describes.
  _FlatComponent _flatten(String compName, Map<String, Object?> compMap) {
    final Map<String, Object?> rootDoc = _document;
    final bool atLeastV1 = _isAtLeastV1;
    final subSchemas = <Map<String, Object?>>[];
    final unmerged = <Map<String, Object?>>[];
    _collectComponentSubSchemas(
      compMap,
      rootDoc,
      subSchemas,
      <String>{},
      atLeastV1: atLeastV1,
      unmerged: unmerged,
    );

    final mergedProperties = <String, Object?>{};
    final requiredSet = <String>{};
    final Object? rawCompDesc = compMap['description'];
    if (rawCompDesc != null && rawCompDesc is! String) {
      throw A2uiCatalogError(
        "Component '$compName' description must be a string.",
        catalogId: id,
      );
    }
    String? subSchemaDesc;

    for (final s in subSchemas) {
      final Object? subDesc = s['description'];
      if (subDesc != null && subDesc is! String) {
        throw A2uiCatalogError(
          "Component '$compName' description must be a string.",
          catalogId: id,
        );
      }
      // Subschemas run from least to most specific, so the last
      // description wins. A schema standing in for a common type, as a
      // catalog defined in code writes one, describes that type rather than
      // the component.
      if (subDesc != null && s['commonTypesRef'] == null) {
        subSchemaDesc = subDesc as String;
      }
      final Object? props = s['properties'];
      if (props is Map<String, Object?>) {
        mergedProperties.addAll(props);
      } else if (props is Map) {
        if (props.keys.any((k) => k is! String)) {
          throw A2uiCatalogError(
            "Component '$compName' property keys must be strings.",
            catalogId: id,
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

    // The most specific subschema's value wins, but the properties keep
    // their authored order: the component's own, then its `allOf`
    // branches (local references in place), then mixins.
    final keySubSchemas = <Map<String, Object?>>[];
    _collectComponentSubSchemas(
      compMap,
      rootDoc,
      keySubSchemas,
      <String>{},
      atLeastV1: atLeastV1,
      keyOrder: true,
    );
    final Map<String, Object?> orderedProperties = {
      for (final Map<String, Object?> s in keySubSchemas)
        if (s['properties'] case final Map<Object?, Object?> props)
          for (final String key in props.keys.whereType<String>())
            if (mergedProperties.containsKey(key)) key: mergedProperties[key],
    };

    final String? compDesc = rawCompDesc as String? ?? subSchemaDesc;

    // Leave out the envelope keys, which the message carries.
    const envelope = {'id', 'component', 'catalogId'};
    orderedProperties.removeWhere((String key, _) => envelope.contains(key));
    requiredSet.removeAll(envelope);

    // Keywords other than those merged here, such as `type`, closure
    // keywords, `anyOf` or the schema's own `$defs`, are kept as written.
    const merged = {'allOf', 'properties', 'required', 'description'};
    final cleanSchema = <String, Object?>{
      for (final MapEntry<String, Object?> entry in compMap.entries)
        if (!merged.contains(entry.key)) entry.key: entry.value,
      if (compDesc != null) 'description': compDesc,
      'properties': {
        for (final MapEntry<String, Object?> entry in orderedProperties.entries)
          entry.key: _normalizePropertyRefs(
            inlineLocalRefs(entry.value, rootDoc),
          ),
      },
      if (requiredSet.isNotEmpty) 'required': requiredSet.toList()..sort(),
      if (unmerged.isNotEmpty) 'allOf': unmerged,
    };
    return _FlatComponent(
      schema: Schema.fromMap(cleanSchema),
      propertiesWithDefRefs: {
        for (final MapEntry<String, Object?> entry in orderedProperties.entries)
          entry.key: _normalizePropertyRefs(
            _keepAuthoredDefRefs(entry.value, rootDoc),
          ),
      },
    );
  }

  /// [node] with its local references inlined, except references into a
  /// definition the document [root] declares in its own `$defs`, which stay
  /// references.
  ///
  /// The built `theme`, `anyComponent` and `anyFunction` and the common
  /// types are not kept: the former are inlined as before, and
  /// [inlineLocalRefs] keeps the latter.
  static Object? _keepAuthoredDefRefs(Object? node, Map<String, Object?> root) {
    final Object? defs = root[r'$defs'];
    if (defs is! Map) return inlineLocalRefs(node, root);
    final Set<String> authored = {
      for (final Object? name in defs.keys)
        if (name is String &&
            !_builtDefNames.contains(name) &&
            !isCommonTypeDef(name))
          name,
    };
    if (authored.isEmpty) return inlineLocalRefs(node, root);

    Object? visit(Object? node) {
      if (node is List) return [for (final Object? item in node) visit(item)];
      if (node is! Map) return node;
      final Object? ref = node[r'$ref'];
      if (ref is String && ref.startsWith('#/')) {
        final bool keep = ref.startsWith(r'#/$defs/') &&
            authored.contains(ref.substring(8).split('/').first);
        if (!keep) return inlineLocalRefs(node, root);
      }
      return <String, Object?>{
        for (final MapEntry<Object?, Object?> entry in node.entries)
          entry.key! as String: visit(entry.value),
      };
    }

    return visit(node);
  }

  /// The `$defs` validationSchema builds itself rather than copying from the
  /// document.
  static const Set<String> _builtDefNames = {
    'theme',
    'anyComponent',
    'anyFunction',
  };

  /// Collects the subschemas of [schema] that contribute component
  /// properties into [result], following `allOf` and local references.
  ///
  /// [result] runs from least to most specific: mixins, then local
  /// references, then inline `allOf` branches, then [schema] itself.
  /// With [keyOrder], [result] instead lists the merged properties in the
  /// order they had when local references were inlined before parsing:
  /// [schema] itself, then its `allOf` branches in authored order (local
  /// references in place), then mixins.
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
    bool keyOrder = false,
    List<Map<String, Object?>>? unmerged,
  }) {
    final bool contributes =
        schema.containsKey('properties') || schema.containsKey('description');
    if (contributes && keyOrder) result.add(schema);
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
                  'description': atLeastV1
                      ? _checksDescriptionV1_0()
                      : 'A list of checks to perform. These are '
                          'function calls that must return a boolean '
                          'indicating validity.',
                  'items': {
                    r'$ref': r'common_types.json#/$defs/CheckRule',
                    'commonTypesRef': r'common_types.json#/$defs/CheckRule',
                  },
                },
              },
            });
          } else if (ref.startsWith('#/')) {
            final Object? target = _resolveJsonPointer(rootDoc, ref);
            if (target is Map) {
              if (visited.add(ref)) {
                _collectComponentSubSchemas(
                  target.cast<String, Object?>(),
                  rootDoc,
                  keyOrder ? inlineSubs : localRefSubs,
                  visited,
                  atLeastV1: atLeastV1,
                  keyOrder: keyOrder,
                  unmerged: unmerged,
                );
              }
            } else {
              unmerged?.add(subMap);
            }
          } else {
            // A reference this catalog cannot follow, such as one into the
            // schema's own `$defs`, stays an `allOf` member.
            unmerged?.add(subMap);
          }
          continue;
        }
        _collectComponentSubSchemas(
          subMap,
          rootDoc,
          inlineSubs,
          visited,
          atLeastV1: atLeastV1,
          keyOrder: keyOrder,
          unmerged: unmerged,
        );
      }
      if (keyOrder) {
        // [schema] first, then its `allOf` branches in authored order with
        // local references in place, then mixins.
        result.addAll(inlineSubs);
        result.addAll(commonSubs);
      } else {
        // From least to most specific, so a component's own definition of a
        // property overrides the one a mixin or local definition
        // contributes.
        result.addAll(commonSubs);
        result.addAll(localRefSubs);
        result.addAll(inlineSubs);
      }
    }
    if (contributes && !keyOrder) result.add(schema);
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

  /// The description of `Checkable.checks` in the v1.0 common types.
  static String _checksDescriptionV1_0() {
    final checkable = _standardDefsV1_0['Checkable']! as Map;
    final checks = (checkable['properties']! as Map)['checks']! as Map;
    return checks['description']! as String;
  }

  static Object? _resolveJsonPointer(
    Map<String, Object?> rootDoc,
    String pointer,
  ) {
    if (!pointer.startsWith('#/')) return null;
    final Iterable<String> segments = pointer.substring(2).split('/').map(
          (s) => s.replaceAllMapped(
            RegExp(r'~([01])'),
            (m) => m[1] == '1' ? '/' : '~',
          ),
        );
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

  /// [node] with each reference to a common type written as
  /// `common_types.json#/$defs/...`, together with a `commonTypesRef` marker
  /// naming the same definition.
  static Object? _normalizePropertyRefs(Object? node) {
    if (node is List) {
      return [for (final item in node) _normalizePropertyRefs(item)];
    }
    if (node is! Map) return node;

    final map = Map<String, Object?>.from(
      node is Map<String, Object?> ? node : node.cast<String, Object?>(),
    );

    final String? fragment = _commonTypesFragment(map[r'$ref']);
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

  Map<String, Object?>? _memoizedValidationSchema;

  /// This catalog as one self-contained JSON Schema, for validating payloads
  /// and prompting models.
  ///
  /// Built from the components and functions the catalog holds: each
  /// component's [resolvedComponentSchemas] entry carries the message
  /// envelope (`id` and a `component` constant), every reference to
  /// `common_types.json` becomes a local `#/$defs/` reference, and the
  /// standard definitions those references reach are copied into `$defs`,
  /// alongside the [definitions] the schemas reference and the
  /// `anyComponent` and `anyFunction` unions. The standard definitions
  /// follow [protocolVersion]: v1.0 and later use the v1.0 common types, and
  /// every earlier or undeclared version uses the v0.9 ones (this SDK does
  /// not embed the v0.8 definitions).
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

  /// The catalog document [toJson] copies, built from the model on first
  /// access.
  late final Map<String, Object?> _document = _buildDocument();

  /// This catalog as a catalog document, the JSON [Catalog.fromJson] reads.
  ///
  /// The document is assembled from the model: each component's
  /// [ComponentApi.schema] with its `allowedParents` and `allowedChildren`;
  /// each function's [FunctionApi.definition], or, for a function defined in
  /// code, its signature in the shape of [protocolVersion] (`@call` and a
  /// top-level `returnType` from v1.0, `call` and a `returnType` property
  /// before), or as a `functions` list item when the catalog was read from a
  /// list; [themeSchema]; [definitions] with the computed `anyComponent` and
  /// `anyFunction` unions; and the document metadata. References stay as the
  /// schemas write them, and no standard definitions are copied in. In a
  /// catalog defined in code, a schema that marks a common type with
  /// `commonTypesRef` is written as a `common_types.json` reference; a
  /// document read by [Catalog.fromJson] is written as it was read.
  ///
  /// So a catalog read by [Catalog.fromJson] writes back the document it was
  /// read from: `Catalog.fromJson(json).toJson()` equals `json`, up to the
  /// order of object keys and of `enum` values and `required` names. Because
  /// [Catalog.fromJson] loads only the components and functions listed in
  /// `anyComponent.oneOf` and `anyFunction.oneOf`, entries that the document's
  /// union left out are omitted.
  ///
  /// Built on first call and cached; each call returns a fresh copy that the
  /// caller may edit.
  ///
  /// A catalog defined in code declares `anyComponent`, and declares
  /// `anyFunction` when it has functions or targets v1.0 or later, where a
  /// catalog document requires both. A union with no members is
  /// `{"not": {}}`, since JSON Schema requires `oneOf` to be non-empty.
  ///
  /// To advertise a catalog to an agent below protocol v1.0, whose inline
  /// catalog shape differs, use [toLegacyInlineCatalog].
  Map<String, Object?> toJson() =>
      _deepCopyValue(_document)! as Map<String, Object?>;

  Map<String, Object?> _buildDocument() {
    final _DocumentLayout layout = _layout;
    final bool themeInDefs = layout.themeInDefs ?? true;
    final Object? theme =
        themeSchema == null ? null : _asWritten(themeSchema!.value);
    final defs = <String, Object?>{
      for (final MapEntry<String, Object?> entry in definitions.entries)
        if (entry.key != 'anyFunction') entry.key: _deepCopyValue(entry.value),
      if (theme != null && themeInDefs) 'theme': theme,
      if (layout.writesComponentUnion)
        'anyComponent': _componentUnionOf(components.keys),
      if (definitions.containsKey('anyFunction'))
        'anyFunction': _deepCopyValue(definitions['anyFunction']),
      if (layout.writesFunctionUnion ?? (functions.isNotEmpty || _isAtLeastV1))
        'anyFunction': _functionUnionOf(functions.keys),
    };

    // The keys follow the order of the published catalogs.
    return <String, Object?>{
      if (schemaDialect != null) r'$schema': schemaDialect,
      if (schemaId != null) r'$id': schemaId,
      if (_declaredProtocolVersion != null)
        'protocolVersion': _declaredProtocolVersion,
      if (title != null) 'title': title,
      if (description != null) 'description': description,
      if (layout.writesCatalogId) 'catalogId': id,
      if (instructions != null) 'instructions': instructions,
      if (layout.writesComponents || components.isNotEmpty)
        'components': <String, Object?>{
          for (final MapEntry<String, C> entry in components.entries)
            entry.key: _componentDocument(entry.value),
        },
      if (layout.writesFunctions || functions.isNotEmpty)
        'functions': layout.listsFunctions
            ? <Object?>[
                for (final MapEntry<String, F> entry in functions.entries)
                  _functionListItem(entry.key, entry.value),
              ]
            : <String, Object?>{
                for (final MapEntry<String, F> entry in functions.entries)
                  entry.key: _functionDocument(entry.key, entry.value),
              },
      if (theme != null && !themeInDefs) 'theme': theme,
      if (layout.writesDefs || defs.isNotEmpty) r'$defs': defs,
      for (final MapEntry<String, Object?> entry in _otherFields.entries)
        entry.key: _deepCopyValue(entry.value),
    };
  }

  /// The top-level keys of a catalog document that [toJson] writes from the
  /// model's fields.
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

  /// The catalog document definition of [component].
  Map<String, Object?> _componentDocument(ComponentApi component) =>
      <String, Object?>{
        ...(_asWritten(component.schema.value)! as Map<String, Object?>),
        if (component.allowedParents case final List<String> parents)
          'allowedParents': [...parents],
        if (component.allowedChildren case final List<String> children)
          'allowedChildren': [...children],
      };

  /// The catalog document definition of [function]: its
  /// [FunctionApi.definition] when it has one matching [protocolVersion]'s
  /// call key, and otherwise its signature in the shape of [protocolVersion].
  Map<String, Object?> _functionDocument(String name, FunctionApi function) {
    final String callKey = _callKey;
    final otherCallKey = _isAtLeastV1 ? 'call' : r'@call';
    if (function.definition case final Map<String, Object?> definition) {
      final Object? props = definition['properties'];
      if (props is! Map ||
          props.containsKey(callKey) ||
          !props.containsKey(otherCallKey)) {
        return _deepCopyValue(definition)! as Map<String, Object?>;
      }
    }
    final Object? args = _asWritten(function.argumentSchema.value);
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

  /// The `functions` list item for [function]: its [FunctionApi.definition]
  /// when it has one, and otherwise one built from its signature.
  Map<String, Object?> _functionListItem(String name, FunctionApi function) {
    if (function.definition case final Map<String, Object?> definition) {
      return _deepCopyValue(definition)! as Map<String, Object?>;
    }
    return <String, Object?>{
      'name': name,
      if (function.description != null) 'description': function.description,
      'returnType': function.returnType.jsonValue,
      ..._callerMetadata(function),
      'parameters': _asWritten(function.argumentSchema.value),
    };
  }

  /// A copy of the schema [node] as the catalog document writes it: as it
  /// is when [Catalog.fromJson] read it, whatever keys it holds, and with
  /// [_unbundleMarkers] applied when it was defined in code.
  static Object? _asWritten(Object? node) =>
      node is Map && (_readSchemas[node] ?? false)
          ? _deepCopyValue(node)
          : _unbundleMarkers(node);

  /// Marks the schemas [Catalog.fromJson] read from a document, which
  /// [toJson] writes back as they are even after [copyWith] moves them into
  /// another catalog.
  static final Expando<bool> _readSchemas = Expando('read schemas');

  /// [schema], a frozen schema read from a document, marked as read.
  static Map<String, Object?> _markRead(Map<String, Object?> schema) {
    _readSchemas[schema] = true;
    return schema;
  }

  /// [node] as a catalog document writes it: a copy in which each schema
  /// marked with a `commonTypesRef`, as a catalog defined in code writes a
  /// common type, becomes a `common_types.json` reference that keeps the
  /// schema's annotations. Everything else is copied as it is.
  static Object? _unbundleMarkers(Object? node) {
    if (node is List) {
      return [for (final Object? item in node) _unbundleMarkers(item)];
    }
    if (node is! Map) return node;
    final Object? marker = node['commonTypesRef'];
    if (marker is String) {
      return <String, Object?>{
        r'$ref': _externalRef(marker),
        for (final MapEntry<Object?, Object?> entry in node.entries)
          if (_annotationKeywords.contains(entry.key))
            entry.key! as String: _deepCopyValue(entry.value),
      };
    }
    return <String, Object?>{
      for (final MapEntry<Object?, Object?> entry in node.entries)
        entry.key! as String: _unbundleMarkers(entry.value),
    };
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

  /// The union of the components [names], `$defs/anyComponent`.
  ///
  /// With no components, a schema nothing matches, `{"not": {}}`: JSON
  /// Schema requires `oneOf` to list at least one schema.
  static Map<String, Object?> _componentUnionOf(Iterable<String> names) =>
      names.isEmpty
          ? {'not': <String, Object?>{}}
          : {
              'oneOf': [
                for (final String name in names)
                  {r'$ref': '#/components/${_escapePointer(name)}'},
              ],
              'discriminator': {'propertyName': 'component'},
            };

  /// The union of the functions [names], `$defs/anyFunction`, or
  /// `{"not": {}}` with no functions.
  static Map<String, Object?> _functionUnionOf(Iterable<String> names) =>
      names.isEmpty
          ? {'not': <String, Object?>{}}
          : {
              'oneOf': [
                for (final String name in names)
                  {r'$ref': '#/functions/${_escapePointer(name)}'},
              ],
            };

  static String _escapePointer(String segment) =>
      segment.replaceAll('~', '~0').replaceAll('/', '~1');

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
    final String? emittedVersion =
        _declaredProtocolVersion == null ? null : protocolVersion?.semverValue;

    // The catalog's own `$defs` that entries reference are copied too, so
    // that no reference dangles. A standard definition of the same name
    // wins, and the unions and theme are built above.
    final Map<String, Object?> authoredDefs = definitions;
    const Set<String> builtDefs = _builtDefNames;

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
        } else if (authoredDefs.containsKey(refName) &&
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
  /// `allowedCallers` and `requiresUserActivation` when declared, are
  /// top-level keywords, and the entry is not closed. Below 1.0 the call may
  /// restate its `returnType` as a property, and the entry is closed.
  ///
  /// The arguments keep their references to the catalog's [definitions],
  /// and other local references are inlined. An object `args` schema is
  /// closed with `unevaluatedProperties`: the authored
  /// `unevaluatedProperties` or `additionalProperties`, and `false` when it
  /// declares neither.
  Map<String, Object?> _serializeFunction(String name, FunctionApi fn) {
    final String callKey = _callKey;
    final Object? argsValue = _deepCopyValue(
      _keepAuthoredDefRefs(fn.argumentSchema.value, _document),
    );
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
        'returnType': <String, Object?>{'const': fn.returnType.jsonValue},
      },
      'required': required,
      'unevaluatedProperties': false,
    };
  }

  /// The `allowedCallers` and `requiresUserActivation` that [fn] declares.
  static Map<String, Object?> _callerMetadata(FunctionApi fn) =>
      <String, Object?>{
        if (fn.declaredAllowedCallers case final AllowedCallers callers)
          'allowedCallers': callers.jsonValue,
        if (fn.declaredRequiresUserActivation case final bool activation)
          'requiresUserActivation': activation,
      };

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

  /// The flattened schema of [comp] with the component envelope: an `id`,
  /// the `component` constant, and `unevaluatedProperties` from the authored
  /// `unevaluatedProperties` or `additionalProperties`. Below 1.0 it is
  /// `false` when the component declares neither; from 1.0 it is then
  /// omitted. Non-empty [ComponentApi.allowedParents] and
  /// [ComponentApi.allowedChildren] are carried over, and the properties
  /// keep their references to the catalog's [definitions].
  Map<String, Object?> _serializeComponent(String name, ComponentApi comp) {
    final _FlatComponent flat = _flatOf(comp);
    final Map<String, Object?> raw = flat.schema.value;
    final properties =
        _deepCopyValue(flat.propertiesWithDefRefs)! as Map<String, Object?>;
    _restoreRefs(properties);
    properties
      ..remove('id')
      ..remove('component');

    final Map<String, Object?> id = {};
    _localizeRef(id, 'ComponentId');
    final Object? closed =
        raw['unevaluatedProperties'] ?? raw['additionalProperties'];
    final innerProperties = <String, Object?>{
      'id': id,
      'component': <String, Object?>{'const': name},
      ...properties,
    };

    final innerRequired = <String>[
      'id',
      for (final Object? r in raw['required'] as List? ?? const [])
        if (r is String && r != 'id' && r != 'component') r,
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
  /// as a local `#/$defs/` reference, in place. A deep pointer below a
  /// definition, such as `DynamicString/oneOf/0`, keeps its full path.
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
        map.removeWhere((k, _) => !_annotationKeywords.contains(k));
        _localizeRef(
          map,
          _commonTypesFragment(target) ?? target.split('/').last,
        );
        return;
      }
      final Object? ref = map[r'$ref'];
      final String? fragment = _commonTypesFragment(ref);
      if (fragment != null &&
          _standardDefs.containsKey(fragment.split('/').first)) {
        _localizeRef(map, fragment);
      }
      for (final Object? val in map.values) {
        _restoreRefs(val);
      }
    }
  }

  /// Points [node] at [fragment] of the standard definitions, such as
  /// `DynamicString` or the deep pointer `DynamicString/oneOf/0`, and, when
  /// [fragment] names a whole definition and [node] has no description,
  /// gives it the definition's.
  void _localizeRef(Map<dynamic, dynamic> node, String fragment) {
    node[r'$ref'] = '#/\$defs/$fragment';
    if (node.containsKey('description') || fragment.contains('/')) return;
    final Object? definition = _standardDefs[fragment];
    if (definition is Map && definition['description'] is String) {
      node['description'] = definition['description'];
    }
  }

  /// A copy of this catalog with the given components and functions.
  ///
  /// Used by catalog transformers to narrow a catalog before prompting or
  /// validation. The copy keeps the document metadata and layout that
  /// [toJson] writes, and the [definitions], except one that only removed
  /// or replaced entries referenced. The `anyComponent` and `anyFunction`
  /// unions follow the new components and functions.
  Catalog<C, F> copyWith({
    Iterable<C>? components,
    Iterable<F>? functions,
    Schema? themeSchema,
    A2uiProtocolVersion? protocolVersion,
  }) {
    final List<C> newComponents =
        (components ?? this.components.values).toList();
    final List<F> newFunctions = (functions ?? this.functions.values).toList();
    final Schema? newTheme = themeSchema ?? this.themeSchema;
    final A2uiProtocolVersion? nextVersion =
        protocolVersion ?? this.protocolVersion;
    final bool nextIsAtLeastV1 =
        nextVersion?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false;
    final Map<String, Object?> nextDefs = _definitionsFor(
      newComponents,
      newFunctions,
      newTheme,
    );
    return Catalog<C, F>._(
      id: id,
      components: newComponents,
      functions: newFunctions,
      themeSchema: newTheme,
      schemaDialect: schemaDialect,
      schemaId: schemaId,
      title: title,
      description: description,
      protocolVersion: nextVersion,
      declaredProtocolVersion:
          protocolVersion == null || protocolVersion == this.protocolVersion
              ? _declaredProtocolVersion
              : protocolVersion.semverValue,
      instructions: instructions,
      definitions: {
        for (final MapEntry<String, Object?> entry in nextDefs.entries)
          if ((components == null || entry.key != 'anyComponent') &&
              (functions == null || entry.key != 'anyFunction'))
            entry.key: entry.value,
      },
      otherFields: _otherFields,
      layout: _DocumentLayout(
        writesCatalogId: _layout.writesCatalogId,
        writesComponents: _layout.writesComponents,
        writesFunctions: _layout.writesFunctions,
        listsFunctions: nextIsAtLeastV1 ? false : _layout.listsFunctions,
        writesDefs: _layout.writesDefs,
        themeInDefs: _layout.themeInDefs,
        writesComponentUnion: components != null
            ? (_layout.writesComponentUnion ||
                definitions.containsKey('anyComponent'))
            : _layout.writesComponentUnion,
        writesFunctionUnion: functions != null
            ? (definitions.containsKey('anyFunction')
                ? true
                : _layout.writesFunctionUnion)
            : (nextIsAtLeastV1 &&
                    _layout.writesFunctionUnion == null &&
                    !definitions.containsKey('anyFunction')
                ? true
                : _layout.writesFunctionUnion),
      ),
    );
  }

  /// [definitions] without those that the current entries reference but
  /// [components], [functions] and [theme] no longer do.
  Map<String, Object?> _definitionsFor(
    Iterable<ComponentApi> components,
    Iterable<FunctionApi> functions,
    Schema? theme,
  ) {
    if (definitions.isEmpty) return definitions;
    Set<String> referencedBy(
      Iterable<ComponentApi> components,
      Iterable<FunctionApi> functions,
      Schema? theme,
    ) =>
        _referencedDefs([
          for (final ComponentApi component in components)
            component.schema.value,
          for (final FunctionApi function in functions)
            function.definition ?? function.argumentSchema.value,
          theme?.value,
        ]);
    final Set<String> before = referencedBy(
      this.components.values,
      this.functions.values,
      themeSchema,
    );
    final Set<String> after = referencedBy(components, functions, theme);
    return {
      for (final MapEntry<String, Object?> entry in definitions.entries)
        if (!before.contains(entry.key) || after.contains(entry.key))
          entry.key: entry.value,
    };
  }

  /// The names of the [definitions] that [roots] reference, directly or
  /// through other definitions.
  Set<String> _referencedDefs(List<Object?> roots) {
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
            if (referenced.add(name) && definitions.containsKey(name)) {
              pending.add(definitions[name]);
            }
          }
        }
        pending.addAll(node.values);
      }
    }
    return referenced;
  }

  /// A copy of this catalog with [functions], which may be of another
  /// [FunctionApi] type, in place of its own.
  ///
  /// Everything else is kept as [copyWith] keeps it. Use it to give a
  /// catalog read by [Catalog.fromJson] evaluable functions, such as
  /// [FunctionImplementation]s with the same signatures.
  Catalog<C, G> withFunctions<G extends FunctionApi>(Iterable<G> functions) {
    final List<G> newFunctions = functions.toList();
    return Catalog<C, G>._(
      id: id,
      components: components.values.toList(),
      functions: newFunctions,
      themeSchema: themeSchema,
      schemaDialect: schemaDialect,
      schemaId: schemaId,
      title: title,
      description: description,
      protocolVersion: protocolVersion,
      declaredProtocolVersion: _declaredProtocolVersion,
      instructions: instructions,
      definitions: _definitionsFor(
        components.values,
        newFunctions,
        themeSchema,
      ),
      otherFields: _otherFields,
      layout: _layout,
    );
  }

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

  /// Whether the JSON values [a] and [b] are equal.
  static bool _jsonEquals(Object? a, Object? b) {
    if (a is Map && b is Map) {
      if (a.length != b.length) return false;
      for (final MapEntry<Object?, Object?> entry in a.entries) {
        if (!b.containsKey(entry.key) ||
            !_jsonEquals(entry.value, b[entry.key])) {
          return false;
        }
      }
      return true;
    }
    if (a is List && b is List) {
      if (a.length != b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if (!_jsonEquals(a[i], b[i])) return false;
      }
      return true;
    }
    return a == b;
  }
}

/// A component schema flattened by [Catalog.resolvedComponentSchemas].
final class _FlatComponent {
  const _FlatComponent({
    required this.schema,
    required this.propertiesWithDefRefs,
  });

  /// The flattened schema, with local references inlined.
  final Schema schema;

  /// The flattened properties with their references to the catalog's own
  /// `$defs` kept, which [Catalog.validationSchema] writes so that a shared
  /// definition is bundled once.
  final Map<String, Object?> propertiesWithDefRefs;
}

/// How [Catalog.toJson] lays out the parts of a catalog document that may be
/// written in more than one way.
///
/// [Catalog.fromJson] records the layout of the document it read; a catalog
/// defined in code uses the defaults.
final class _DocumentLayout {
  const _DocumentLayout({
    this.writesCatalogId = true,
    this.writesComponents = true,
    this.writesFunctions = false,
    this.listsFunctions = false,
    this.writesDefs = false,
    this.themeInDefs,
    this.writesComponentUnion = true,
    this.writesFunctionUnion,
  });

  /// Whether the document declares `catalogId`. The published v0.8 basic
  /// catalog does not.
  final bool writesCatalogId;

  /// Whether `components` is written even when the catalog has none.
  final bool writesComponents;

  /// Whether `functions` is written even when the catalog has none.
  final bool writesFunctions;

  /// Whether `functions` is a list of definitions rather than a map.
  final bool listsFunctions;

  /// Whether `$defs` is written even when it is empty.
  final bool writesDefs;

  /// Whether the theme is `$defs/theme` rather than a top-level `theme`;
  /// null for `$defs/theme`.
  final bool? themeInDefs;

  /// Whether `$defs/anyComponent` is the union of the components.
  final bool writesComponentUnion;

  /// Whether `$defs/anyFunction` is the union of the functions; null when
  /// the catalog has functions or targets v1.0 or later.
  final bool? writesFunctionUnion;
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
