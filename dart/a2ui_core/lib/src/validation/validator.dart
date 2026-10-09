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

import '../core/catalog.dart';
import '../primitives/common_types_documents.dart' as documents;
import '../primitives/errors.dart';
import '../primitives/protocol_version.dart';
import '../primitives/semver.dart';
import '../primitives/uax31.dart';
import 'component_graph.dart' show maxFunctionCallArgs;
import 'component_refs.dart';
import 'nested_calls.dart';
import 'schema_resolution.dart';
import 'validation_config.dart';

/// The component keys that belong to the envelope rather than to the
/// component's own properties, in v0.9.
const List<String> _v0_9EnvelopeKeys = ['id', 'component', 'catalogId'];

/// The component keys that belong to the envelope from v1.0, where every
/// component also carries the common `accessibility` and `metadata`.
const List<String> _v1EnvelopeKeys = [
  'id',
  'component',
  'catalogId',
  'accessibility',
  'metadata',
];

/// The envelope keys from v1.0 checked against `ComponentCommon` rather than
/// dropped, unless the component's own schema declares them.
///
/// `metadata` restates `ComponentCommon/properties/metadata` instead of
/// referencing it: `Extensions` constrains its keys with a `\p{XID_Start}`
/// pattern that `json_schema_builder` does not compile in Unicode mode, so
/// every key would fail. [PayloadValidator.validateComponent] checks those
/// keys against UAX #31 itself.
const Map<String, Map<String, Object?>> _v1CommonEnvelopeTypes = {
  'accessibility': {
    r'$ref': r'common_types.json#/$defs/AccessibilityAttributes',
  },
  'metadata': {
    'type': 'object',
    'properties': {
      'extensions': {'type': 'object'},
    },
    'additionalProperties': false,
  },
};

/// Matches a key reserved for protocol directives from v1.0: a single leading
/// `@`, so `@@name` is an escaped literal key.
final RegExp _reservedKey = RegExp(r'^@([^@]|$)');

/// The reserved keys v1.0 defines.
const Set<String> _reservedDirectives = {'@path', '@call'};

/// Verifies an item in an agent-to-renderer payload.
///
/// Checks one component, one function call, or one theme against one catalog.
///
/// Lives in `a2ui_core` because renderers and agents check that same payload
/// against the same catalogs. Envelopes are v0.9 only: [checkVersion] rejects
/// any other version, or none. The rules for the items themselves follow
/// [Catalog.protocolVersion]: a catalog declaring v1.0 or later is checked
/// with the v1.0 rules (`@path` and `@call`, UAX #31 identifiers, reserved
/// `@` keys, unknown functions forwarded to the agent), and any other catalog
/// with the v0.9 rules.
///
/// A validator is scoped to a single [catalog], and validates a single item
/// against it. It deliberately does not walk a payload: from v1.0 a surface
/// may mix catalogs, because a component and a function call each carry an
/// optional `catalogId` that overrides the surface-level default. Deciding
/// which catalog an item belongs to is therefore a per-item question that only
/// something holding every supported catalog can answer, which is
/// `MessageProcessor`. It resolves the catalog for each item and calls the
/// validator for it, so a payload spanning several catalogs is checked
/// item by item rather than rejected.
///
/// Both sides, agent and renderer, reach it through
/// `MessageProcessor.processMessages`, which checks each message against the
/// surface state it holds. An agent keeps a processor for the session and
/// checks its own output the same way a renderer checks what it receives.
///
/// Every entry point is synchronous. Component schemas reach the validator
/// with their references already inlined by `resolveSchemaRefs`, so schema
/// validation runs through `Schema.validateSync` and never performs I/O. A
/// caller can therefore validate inside a synchronous message-processing path.
class PayloadValidator<C extends ComponentApi, F extends FunctionApi> {
  /// The catalog items are validated against.
  ///
  /// Every component, function call and theme this validator is given is
  /// checked against this catalog. Routing an item to the validator for its
  /// own catalog is the caller's job; see the class comment.
  final Catalog<C, F> catalog;

  /// The protocol version whose envelopes [checkVersion] accepts.
  final A2uiProtocolVersion protocolVersion;

  /// The shared `common_types.json` definitions this validator resolves
  /// against.
  ///
  /// Catalogs state their component properties in terms of these shared types
  /// rather than restating them. Defaults to this package's copy of the
  /// document for [Catalog.protocolVersion] (see [commonTypesFor]); pass a
  /// different document to override it, or an empty map to leave the shared
  /// types unchecked.
  final Map<String, Object?> commonTypesSchema;

  /// Which unknown items pass rather than fail.
  ///
  /// Only [ValidationConfig.allowUnknownElements] applies here; the graph
  /// checks belong to `MessageProcessor`.
  final ValidationConfig config;

  /// Whether [catalog] declares v1.0 or later, selecting the v1.0 rules.
  final bool _v1;

  /// The other protocol version's `common_types.json`, consulted for a type
  /// [commonTypesSchema] lacks; null when the caller overrode the document.
  final Map<String, Object?>? _fallbackCommonTypes;

  /// [catalog]'s component schemas with their `$ref`s inlined, on first use.
  Map<String, Schema>? _resolvedComponents;

  /// [catalog]'s function argument schemas with their `$ref`s inlined, on
  /// first use.
  Map<String, Schema>? _resolvedFunctions;

  /// The v1.0 envelope schemas with their `$ref`s inlined, on first use.
  Map<String, Schema>? _resolvedEnvelope;

  /// Creates a validator for [catalog].
  ///
  /// [protocolVersion] and [commonTypesSchema] override the defaults derived
  /// from [catalog]; most callers pass neither.
  PayloadValidator({
    required this.catalog,
    A2uiProtocolVersion? protocolVersion,
    Map<String, Object?>? commonTypesSchema,
    this.config = ValidationConfig.strict,
  })  : protocolVersion = protocolVersion ??
            catalog.protocolVersion ??
            A2uiProtocolVersion.v0_9,
        _v1 = (protocolVersion ?? catalog.protocolVersion)
                ?.isAtLeast(A2uiProtocolVersion.v1_0) ??
            false,
        _fallbackCommonTypes = commonTypesSchema == null
            ? commonTypesFor(
                ((protocolVersion ?? catalog.protocolVersion)
                            ?.isAtLeast(A2uiProtocolVersion.v1_0) ??
                        false)
                    ? A2uiProtocolVersion.v0_9
                    : A2uiProtocolVersion.v1_0,
              )
            : null,
        commonTypesSchema = commonTypesSchema ??
            documents.commonTypesForProtocolVersion(
              protocolVersion ?? catalog.protocolVersion,
            );

  /// The `common_types.json` document this package publishes for [version].
  ///
  /// A copy of `specification/<version>/json/common_types.json`, embedded at
  /// build time by `tool/generate_common_types.dart` so that a package
  /// installed from pub.dev can resolve the shared types without reading the
  /// specification repository. Each call returns a fresh document, so a caller
  /// may edit the result. v0.9.1 shares the v0.9 document.
  ///
  /// The same selection backs [Catalog.commonTypesSchema], which the catalog's
  /// reference map and the renderer's binders read, so the validator and the
  /// readers resolve shared types against the same document.
  static Map<String, Object?> commonTypesFor(A2uiProtocolVersion version) =>
      documents.commonTypesForProtocolVersion(version);

  /// Creates a validator for [version].
  ///
  /// Throws [A2uiValidationError] for any version this SDK does not
  /// implement.
  factory PayloadValidator.forVersion(
    Object? version, {
    required Catalog<C, F> catalog,
    Map<String, Object?>? commonTypesSchema,
  }) =>
      PayloadValidator<C, F>(
        catalog: catalog,
        commonTypesSchema: commonTypesSchema,
        protocolVersion: A2uiProtocolVersion.fromJson(version),
      );

  /// Checks the `version` field of one payload envelope.
  ///
  /// A version compatible with [protocolVersion] (see
  /// [isCatalogVersionCompatible]) is accepted, so a v0.9 validator accepts
  /// v0.9.1 envelopes. Returns [protocolVersion], the version whose rules
  /// this validator applies.
  ///
  /// Throws [A2uiValidationError] if the version is missing or is not
  /// compatible with the version this validator accepts.
  A2uiProtocolVersion checkVersion(Map<String, Object?> envelope) {
    final A2uiProtocolVersion version = A2uiProtocolVersion.fromJson(
      envelope['version'],
      details: envelope,
    );
    if (!isCatalogVersionCompatible(
      version.jsonValue,
      protocolVersion.jsonValue,
    )) {
      throw A2uiValidationError(
        "Payload declares version '${version.jsonValue}' but this validator "
        "accepts only versions compatible with '${protocolVersion.jsonValue}'.",
        details: envelope,
      );
    }
    return protocolVersion;
  }

  /// Checks one component against [catalog]'s schema for its type.
  ///
  /// The caller decides which catalog the component belongs to; this checks it
  /// against the one catalog this validator holds.
  ///
  /// Envelope keys (`id`, `component` and `catalogId`, plus `accessibility`
  /// and `metadata` from v1.0) are removed before the schema check, from both
  /// the component and the requirements of its schema, so a closed schema
  /// need not list them. From v1.0, `accessibility` and `metadata` are
  /// checked against `ComponentCommon` instead, unless the schema declares
  /// them itself. Every function call nested in the component's properties is
  /// then checked with [validateFunction].
  ///
  /// Error paths are JSON Pointers relative to the component, such as `/id`
  /// or `/action/functionCall`.
  ///
  /// Throws [A2uiValidationError] if the component names no type, names one
  /// the catalog does not declare (unless
  /// [ValidationConfig.allowUnknownElements]), has a malformed id or call, or
  /// does not match its schema. Throws [A2uiCatalogError] if the schema holds
  /// a reference that names nothing.
  void validateComponent(Map<String, Object?> component) {
    component = _jsonMap(component);
    final Object? id = component['id'];
    if (_v1 && id is String && !isValidUax31Identifier(id)) {
      throw A2uiValidationError(
        "Component id '$id' must be a valid UAX #31 identifier",
        path: '/id',
        details: component,
      );
    }
    final Object? type = component['component'];
    if (type is! String) {
      throw A2uiValidationError(
        "Component '$id' does not name a component type.",
        path: '/component',
        details: component,
      );
    }
    if (_v1) {
      for (final MapEntry<String, Object?> entry in component.entries) {
        _checkCallEnvelopes(entry.value, component['id']);
      }
    }
    final Schema? schema = _resolvedComponentSchemas[type];
    if (schema == null && !config.allowUnknownElements) {
      throw A2uiValidationError(
        "Catalog '${catalog.id}' declares no component named '$type'.",
        path: '/component',
        details: component,
      );
    }

    final Object? rawCatalogId = component['catalogId'];
    if (rawCatalogId != null && rawCatalogId is! String) {
      throw A2uiValidationError(
        "Component '$id' has a non-string 'catalogId'.",
        path: '/catalogId',
        details: component,
      );
    }

    final Set<String> declared =
        schema == null ? const {} : _declaredProperties(schema.value);
    final List<String> envelopeKeys = _v1 ? _v1EnvelopeKeys : _v0_9EnvelopeKeys;
    final target = <String, Object?>{
      for (final MapEntry<String, Object?> entry in component.entries)
        if (!envelopeKeys.contains(entry.key) || declared.contains(entry.key))
          entry.key: entry.value,
    };

    // Calls and reserved keys first, so their errors name the call rather
    // than the alternative of a dynamic type that failed to match.
    _validateNested(
      target,
      '',
      componentId: component['id'],
      componentCatalogId: component['catalogId'],
    );

    if (schema == null) return;

    _throwOnErrors(
      Schema.fromMap(
        _withoutEnvelopeRequirements(schema.value, envelopeKeys, target),
      ).validateSync(target),
      "Component '$id' does not match the '$type' schema in catalog "
      "'${catalog.id}'",
      component,
    );

    if (!_v1) return;
    for (final MapEntry<String, Map<String, Object?>> entry
        in _v1CommonEnvelopeTypes.entries) {
      final String key = entry.key;
      if (!component.containsKey(key) || declared.contains(key)) continue;
      final Object? value = component[key];
      // `metadata.extensions` holds arbitrary vendor JSON, so only
      // `accessibility` carries dynamic values to walk.
      if (key == 'accessibility') {
        _validateNested(
          value,
          '/$key',
          componentId: component['id'],
          componentCatalogId: component['catalogId'],
        );
      }
      _throwOnErrors(
        _resolvedEnvelopeSchemas[key]!.validateSync(value),
        "Component '$id' has an invalid '$key'",
        component,
        path: '/$key',
      );
    }
    if (component['metadata']
        case {
          'extensions': final Map<Object?, Object?> extensions,
        } when !declared.contains('metadata')) {
      for (final Object? name in extensions.keys) {
        if (name is! String || !isValidUax31Identifier(name)) {
          throw A2uiValidationError(
            "Component '$id' has a metadata extension key '$name' that is "
            'not a valid UAX #31 identifier',
            path: '/metadata/extensions/${_escape('$name')}',
            details: component,
          );
        }
      }
    }
  }

  /// Checks one function call's arguments against [catalog]'s schema for it.
  ///
  /// [name] is the function, [args] the arguments the call passes. As with
  /// [validateComponent], the caller decides which catalog the call belongs
  /// to: from v1.0 a call carries an optional `catalogId` of its own. [path]
  /// locates the call in error reports.
  ///
  /// A call may pass at most [maxFunctionCallArgs] arguments. From v1.0 the
  /// name and argument names must be UAX #31 identifiers (the name may start
  /// with one `@`, as system functions such as `@index` do), and a function
  /// the catalog does not declare passes with its arguments unchecked,
  /// because a renderer forwards it to the agent. Below v1.0 an unknown
  /// function is rejected unless [ValidationConfig.allowUnknownElements].
  ///
  /// Throws [A2uiValidationError] if the call breaks any of those rules or the
  /// arguments do not match the function's schema.
  void validateFunction(
    String name,
    Map<String, Object?> args, {
    String path = '',
  }) {
    args = _jsonMap(args);
    if (_v1) {
      _checkCallEnvelopes(<String, Object?>{'@call': name, 'args': args});
    }
    _checkCallShape(name, args, path);
    for (final MapEntry<String, Object?> arg in args.entries) {
      _validateNested(
        arg.value,
        path.isEmpty
            ? '/args/${_escape(arg.key)}'
            : '$path/args/${_escape(arg.key)}',
      );
    }
    _checkArgs(name, args, path: path);
  }

  /// Checks [args] against [catalog]'s argument schema for [name], leaving
  /// the calls nested in [args] unchecked.
  ///
  /// For `MessageProcessor`, which has already checked every call's names
  /// through [validateComponent] and checks each nested call against the
  /// catalog it resolves to. [componentId] names the component the call is
  /// nested in, for the error message.
  ///
  /// Throws [A2uiValidationError] if the catalog declares no such function or
  /// the arguments do not match its schema.
  @internal
  void validateFunctionArgs(
    String name,
    Map<String, Object?> args, {
    Object? componentId,
  }) =>
      _checkArgs(name, _jsonMap(args), componentId: componentId);

  void _checkArgs(
    String name,
    Map<String, Object?> args, {
    Object? componentId,
    String? path,
  }) {
    final where = componentId == null ? '' : "In component '$componentId': ";
    final Schema? schema = _resolvedFunctionSchemas[name];
    if (schema == null) {
      if (!_v1 && config.allowUnknownElements) return;
      throw A2uiValidationError(
        "${where}Catalog '${catalog.id}' declares no function named '$name'.",
        path: path,
        details: args,
      );
    }

    final List<ValidationError> errors = schema.validateSync(args);
    if (errors.isNotEmpty) {
      throw A2uiValidationError(
        "${where}Call to '$name' does not match the argument schema in "
        "catalog '${catalog.id}': "
        '${errors.map((e) => e.toErrorString()).join('; ')}',
        path: path,
        details: args,
      );
    }
  }

  /// Checks a surface's theme against [catalog]'s theme schema.
  ///
  /// A catalog that declares no theme schema constrains nothing, so any theme
  /// passes. A null [theme] is the surface declaring none, which is always
  /// allowed.
  ///
  /// Throws [A2uiValidationError] if the theme does not match the schema.
  void validateTheme(Map<String, Object?>? theme) {
    final Schema? schema = catalog.themeSchema;
    if (schema == null || theme == null) return;

    _throwOnErrors(
      schema.validateSync(theme),
      "Theme does not match the theme schema in catalog '${catalog.id}'",
      theme,
    );
  }

  /// Which properties of [catalog]'s components hold child references.
  ///
  /// Graph checks span a whole surface, and from v1.0 a surface may hold
  /// components from several catalogs, so the walk itself belongs to
  /// `MessageProcessor`, which merges this map across the catalogs a surface
  /// draws on. Derived from [Catalog.refMap], the map the node resolver
  /// mounts children from.
  @internal
  Map<String, ComponentRefFields> get componentRefFields =>
      extractComponentRefFields(catalog);

  /// The name and argument count and names of one call, before its schema.
  void _checkCallShape(String name, Map<String, Object?> args, String path) {
    if (args.length > maxFunctionCallArgs) {
      throw A2uiValidationError(
        "Function call '$name' exceeds maximum allowed arguments count "
        '($maxFunctionCallArgs)',
        path: path,
      );
    }
    if (!_v1) return;
    if (!isValidUax31Identifier(name, allowLeadingAt: true)) {
      throw A2uiValidationError(
        "Function name '$name' must be a valid UAX #31 identifier",
        path: path,
      );
    }
    for (final String arg in args.keys) {
      if (!isValidUax31Identifier(arg, allowLeadingAt: true)) {
        throw A2uiValidationError(
          "Function argument '$arg' in function '$name' must be a valid "
          'UAX #31 identifier',
          path: '$path/args/${_escape(arg)}',
        );
      }
    }
  }

  /// Walks [value], at JSON Pointer [path], checking each function call and,
  /// from v1.0, each object's reserved keys.
  ///
  /// The component itself (an empty [path]) is never a call, whatever its
  /// properties are named, and once an object is read as a call the walk
  /// descends into its argument values only, so an argument named `call` is
  /// an argument.
  void _validateNested(
    Object? value,
    String path, {
    Object? componentId,
    Object? componentCatalogId,
  }) {
    if (value is List) {
      for (var i = 0; i < value.length; i++) {
        _validateNested(
          value[i],
          '$path/$i',
          componentId: componentId,
          componentCatalogId: componentCatalogId,
        );
      }
      return;
    }
    if (value is! Map) return;
    final Map<String, Object?> object = value.cast<String, Object?>();

    if (_v1) {
      for (final String key in object.keys) {
        if (_reservedKey.hasMatch(key) && !_reservedDirectives.contains(key)) {
          throw A2uiValidationError(
            "Unrecognized reserved protocol directive '$key' in v1.0 dynamic "
            'object. Reserved keys must be in '
            "${_reservedDirectives.join(', ')}, or escaped with prefix "
            "doubling (e.g. '@$key').",
            code: 'INVALID_RESERVED_KEY',
            path: '$path/${_escape(key)}',
          );
        }
      }
    }

    final Object? name = path.isEmpty ? null : object[_v1 ? '@call' : 'call'];
    if (name is String && name.isNotEmpty) {
      final Map<String, Object?> args = switch (object['args']) {
        null => const <String, Object?>{},
        final Map<Object?, Object?> map => map.cast<String, Object?>(),
        final Object other => throw A2uiValidationError(
            "Call to '$name' passes 'args' that is not an object "
            '(got ${other.runtimeType}).',
            path: '$path/args',
          ),
      };
      final Object? callCatalog = object['catalogId'];
      final bool runsInThisCatalog = !_v1 ||
          nestedCallRunsInCatalog(
            callCatalog,
            catalog.id,
            catalogIsDefault: componentCatalogId == null,
          );
      _checkCallShape(name, args, path);

      for (final MapEntry<String, Object?> arg in args.entries) {
        _validateNested(
          arg.value,
          '$path/args/${_escape(arg.key)}',
          componentId: componentId,
          componentCatalogId: componentCatalogId,
        );
      }

      if (_v1) {
        if (runsInThisCatalog && !name.startsWith('@')) {
          _checkArgs(name, args, componentId: componentId, path: path);
        }
      } else {
        _checkArgs(name, args, componentId: componentId, path: path);
      }
      return;
    }

    for (final MapEntry<String, Object?> entry in object.entries) {
      _validateNested(
        entry.value,
        '$path/${_escape(entry.key)}',
        componentId: componentId,
        componentCatalogId: componentCatalogId,
      );
    }
  }

  /// The one system function v1.0 defines in the reserved `@` namespace.
  static const String _indexFunction = '@index';

  /// Every call must name a UAX #31 identifier, or `@index`, the one system
  /// function in the reserved `@` namespace; its argument names must be
  /// identifiers too, and its `args`, when present, an object. `@index`
  /// belongs to no catalog, so it may not name a `catalogId`, and it takes
  /// only an `offset`. Any other call's `catalogId` must be a string.
  ///
  /// These checks run before the component schema, so the error names the
  /// rule a call breaks, and they hold whatever schema the property has.
  ///
  /// Throws [A2uiValidationError] for the first call that breaks one.
  /// [componentId], when given, names the component [node] belongs to.
  static void _checkCallEnvelopes(Object? node, [Object? componentId]) {
    if (node is List) {
      for (final Object? item in node) {
        _checkCallEnvelopes(item, componentId);
      }
      return;
    }
    if (node is! Map) return;
    final Object? name = node['@call'];
    if (name is String) {
      final subject = componentId == null
          ? "Function call '$name'"
          : "Function call '$name' in component '$componentId'";
      final Object? args = node['args'];
      if (args != null && args is! Map) {
        throw A2uiValidationError(
          "$subject has non-object 'args'.",
          details: node,
        );
      }
      if (name.startsWith('@')) {
        if (name != _indexFunction) {
          throw A2uiValidationError(
            "$subject names an unknown system function. The '@' namespace is "
            "reserved; only '$_indexFunction' is defined.",
            details: node,
          );
        }
        if (node.containsKey('catalogId')) {
          throw A2uiValidationError(
            "$subject names a catalogId, but '$_indexFunction' is a system "
            'function and belongs to no catalog.',
            details: node,
          );
        }
        if (args is Map) {
          for (final Object? argName in args.keys) {
            if (argName != 'offset') {
              throw A2uiValidationError(
                "$subject has unknown argument '$argName'; '$_indexFunction' "
                "takes only 'offset'.",
                details: node,
              );
            }
          }
        }
      } else {
        if (!isValidUax31Identifier(name)) {
          throw A2uiValidationError(
            '$subject does not name a valid UAX #31 identifier.',
            details: node,
          );
        }
        final Object? catalogId = node['catalogId'];
        if (catalogId != null && catalogId is! String) {
          throw A2uiValidationError(
            "$subject has a non-string 'catalogId'.",
            details: node,
          );
        }
        if (args is Map) {
          for (final Object? argName in args.keys) {
            if (argName is! String || !isValidUax31Identifier(argName)) {
              throw A2uiValidationError(
                "$subject has argument '$argName', which is not a valid "
                'UAX #31 identifier.',
                details: node,
              );
            }
          }
        }
      }
    }
    for (final Object? value in node.values) {
      _checkCallEnvelopes(value, componentId);
    }
  }

  /// Throws an [A2uiValidationError] listing [errors], if there are any.
  ///
  /// Each schema error becomes an [A2uiErrorDetail] whose path is a JSON
  /// Pointer below [path].
  static void _throwOnErrors(
    List<ValidationError> errors,
    String message,
    Object? details, {
    String path = '',
  }) {
    if (errors.isEmpty) return;
    throw A2uiValidationError(
      '$message: ${errors.map((e) => e.toErrorString()).join('; ')}',
      path: path,
      errors: [
        for (final ValidationError error in errors)
          A2uiErrorDetail(
            path: '$path${error.path.map((p) => '/${_escape(p)}').join()}',
            code: 'VALIDATION_FAILED',
            message: error.toErrorString(),
          ),
      ],
      details: details,
    );
  }

  static String _escape(String segment) =>
      segment.replaceAll('~', '~0').replaceAll('/', '~1');

  /// The property names [schema] declares at the component level: its own
  /// `properties` and those of its `allOf`, `anyOf` and `oneOf` branches.
  static Set<String> _declaredProperties(Map<String, Object?> schema) {
    final names = <String>{};
    final Map<String, Object?> defs = switch (schema[r'$defs']) {
      final Map<Object?, Object?> map => map.cast<String, Object?>(),
      _ => const <String, Object?>{},
    };
    final seen = <Object?>{};
    void visit(Object? node) {
      if (node is! Map || !seen.add(node)) return;
      if (node['properties'] case final Map<Object?, Object?> properties) {
        names.addAll(properties.keys.whereType<String>());
      }
      for (final key in const ['allOf', 'anyOf', 'oneOf']) {
        if (node[key] case final List<Object?> branches) {
          branches.forEach(visit);
        }
      }
      if (node[r'$ref'] case final String ref
          when ref.startsWith(r'#/$defs/')) {
        visit(defs[ref.substring(r'#/$defs/'.length)]);
      }
    }

    visit(schema);
    return names;
  }

  /// A copy of [schema] that no longer requires or describes the envelope
  /// keys [validateComponent] strips from the component.
  ///
  /// Walks the component-level applicators (`allOf`, `anyOf`, `oneOf` and
  /// local `$ref`s into `$defs`), where catalogs state the envelope through
  /// `ComponentCommon` and a `component` constant; property subschemas are
  /// left alone. A key kept in [target] (one the schema declares itself) keeps
  /// its requirement.
  static Map<String, Object?> _withoutEnvelopeRequirements(
    Map<String, Object?> schema,
    List<String> envelopeKeys,
    Map<String, Object?> target,
  ) {
    final Set<String> stripped = {
      for (final String key in envelopeKeys)
        if (!target.containsKey(key)) key,
    };
    final Map<String, Object?> defs = switch (schema[r'$defs']) {
      final Map<Object?, Object?> map => {...map.cast<String, Object?>()},
      _ => <String, Object?>{},
    };
    final rewritten = <String>{};

    Object? strip(Object? node) {
      if (node is! Map) return node;
      final Map<String, Object?> object = node.cast<String, Object?>();
      final Object? ref = object[r'$ref'];
      if (ref is String && ref.startsWith(r'#/$defs/')) {
        final String name = ref.substring(r'#/$defs/'.length);
        if (rewritten.add(name) && defs.containsKey(name)) {
          defs[name] = strip(defs[name]);
        }
      }
      return <String, Object?>{
        for (final MapEntry<String, Object?> entry in object.entries)
          entry.key: switch (entry.key) {
            'required' when entry.value is List => [
                for (final Object? key in entry.value! as List)
                  if (!stripped.contains(key)) key,
              ],
            'properties' when entry.value is Map => <String, Object?>{
                for (final MapEntry<Object?, Object?> property
                    in (entry.value! as Map).entries)
                  if (!stripped.contains(property.key))
                    property.key! as String: property.value,
              },
            'allOf' || 'anyOf' || 'oneOf' when entry.value is List => [
                for (final Object? branch in entry.value! as List)
                  strip(branch),
              ],
            _ => entry.value,
          },
      };
    }

    final result = strip(schema)! as Map<String, Object?>;
    if (defs.isEmpty) return result;
    return {...result, r'$defs': defs};
  }

  Map<String, Schema> get _resolvedComponentSchemas => _resolvedComponents ??= {
        for (final MapEntry<String, C> entry in catalog.components.entries)
          entry.key: _resolve(entry.value.schema.value),
      };

  Map<String, Schema> get _resolvedFunctionSchemas => _resolvedFunctions ??= {
        for (final MapEntry<String, F> entry in catalog.functions.entries)
          entry.key: _resolve(entry.value.argumentSchema.value),
      };

  Map<String, Schema> get _resolvedEnvelopeSchemas => _resolvedEnvelope ??= {
        for (final MapEntry<String, Map<String, Object?>> entry
            in _v1CommonEnvelopeTypes.entries)
          entry.key: _resolve(entry.value),
      };

  Schema _resolve(Map<String, Object?> schema) => Schema.fromMap(
        resolveSchemaRefs(
          schema,
          _referenceDocument,
          commonTypes: commonTypesSchema,
          fallbackCommonTypes: _fallbackCommonTypes,
        ),
      );

  Map<String, Object?> get _referenceDocument {
    final Map<String, Object?> document = catalog.catalogSchema;
    if (!_v1) return document;
    return <String, Object?>{
      ...document,
      r'$defs': <String, Object?>{
        ...?document[r'$defs'] as Map<String, Object?>?,
        'anyFunction': _anyV1FunctionCall,
      },
    };
  }

  static const Map<String, Object?> _anyV1FunctionCall = {
    'type': 'object',
    'properties': {
      '@call': {
        'type': 'string',
        'not': {'const': '@index'},
      },
      'args': {'type': 'object'},
    },
    'required': ['@call'],
  };

  static Map<String, Object?> _jsonMap(Map<String, Object?> value) =>
      _jsonValue(value)! as Map<String, Object?>;

  static Object? _jsonValue(Object? value) => switch (value) {
        final Map<Object?, Object?> map => <String, Object?>{
            for (final MapEntry<Object?, Object?> entry in map.entries)
              '${entry.key}': _jsonValue(entry.value),
          },
        final List<Object?> list => <Object?>[
            for (final Object? item in list) _jsonValue(item),
          ],
        _ => value,
      };
}
