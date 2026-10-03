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

import '../primitives/errors.dart';
import '../primitives/protocol_version.dart';
import '../primitives/semver.dart';
import 'catalog.dart';

/// Options for `MessageProcessor.getRendererCapabilities`.
class CapabilitiesOptions {
  /// The protocol versions to describe, one capabilities entry each.
  ///
  /// Must not be empty.
  final List<A2uiProtocolVersion> versions;

  /// Whether each version entry carries every catalog inline, in addition to
  /// listing its id.
  final bool includeInlineCatalogs;

  /// The `$ref` of the envelope schema each inline component is wrapped in.
  ///
  /// See [A2uiVersionCapabilities.componentEnvelopeRef].
  final String? componentEnvelopeRef;

  const CapabilitiesOptions({
    required this.versions,
    this.includeInlineCatalogs = false,
    this.componentEnvelopeRef,
  });
}

/// The envelope that legacy inline catalogs wrap each component in when no
/// [A2uiVersionCapabilities.componentEnvelopeRef] is given.
const String _legacyComponentEnvelopeRef =
    r'common_types.json#/$defs/ComponentCommon';

/// The catalogs a renderer can render for one protocol version, mirroring
/// `A2uiVersionCapabilities` in `client_capabilities.json`.
class A2uiVersionCapabilities {
  /// Ids of the catalogs the renderer supports.
  final List<String> supportedCatalogIds;

  /// Catalogs supplied inline, meaningful only when the agent advertises
  /// `acceptsInlineCatalogs`.
  final List<CatalogApi> inlineCatalogs;

  /// The `$ref` of the envelope schema that [toJson] wraps each inline
  /// component in.
  ///
  /// Below v1.0 every component is wrapped, in
  /// `common_types.json#/$defs/ComponentCommon` when this is null. From v1.0
  /// components are wrapped only when this is set. This is an emitter option,
  /// not a wire field: [A2uiVersionCapabilities.fromJson] never sets it.
  final String? componentEnvelopeRef;

  A2uiVersionCapabilities({
    required this.supportedCatalogIds,
    this.inlineCatalogs = const [],
    this.componentEnvelopeRef,
  });

  /// Parses a version capabilities object.
  ///
  /// Throws [A2uiValidationError] unless `supportedCatalogIds` is a list of
  /// strings and `inlineCatalogs`, if present, holds catalog objects.
  factory A2uiVersionCapabilities.fromJson(Map<String, Object?> json) {
    final Object? rawIds = json['supportedCatalogIds'];
    if (rawIds is! List) {
      throw A2uiValidationError(
        "Renderer capabilities must declare a 'supportedCatalogIds' array.",
        details: json,
      );
    }
    final Object? rawInline = json['inlineCatalogs'];
    return A2uiVersionCapabilities(
      supportedCatalogIds: [
        for (final Object? id in rawIds)
          if (id is String)
            id
          else
            throw A2uiValidationError(
              "'supportedCatalogIds' must contain only strings.",
              details: json,
            ),
      ],
      inlineCatalogs: [
        if (rawInline is List)
          for (final Object? catalog in rawInline)
            if (catalog is Map)
              Catalog.fromJson(catalog.cast<String, Object?>())
            else
              throw A2uiValidationError(
                "'inlineCatalogs' must contain only catalog objects (got "
                '${catalog.runtimeType}).',
                details: json,
              ),
      ],
    );
  }

  /// Serializes these capabilities as the entry for [version].
  ///
  /// The shape of each inline catalog depends on [version]. Below v1.0 it is
  /// the legacy inline catalog: components wrapped in the
  /// [componentEnvelopeRef] envelope, `functions` as a list of definitions,
  /// and `theme` as the theme's property map. From v1.0 it is the standalone
  /// catalog schema document, [Catalog.catalogSchema].
  ///
  /// Schemas built from `CommonSchemas` mark shared definitions with a
  /// description of the form `REF:uri|text`; both shapes replace such a node
  /// with a `$ref` to `uri`.
  Map<String, Object?> toJson({required A2uiProtocolVersion version}) => {
        'supportedCatalogIds': supportedCatalogIds,
        if (inlineCatalogs.isNotEmpty)
          'inlineCatalogs': [
            for (final CatalogApi catalog in inlineCatalogs)
              if (version.isAtLeast(A2uiProtocolVersion.v1_0))
                _catalogDocument(catalog, componentEnvelopeRef)
              else
                _legacyInlineCatalog(
                  catalog,
                  componentEnvelopeRef ?? _legacyComponentEnvelopeRef,
                ),
          ],
      };
}

/// The standalone catalog schema document for [catalog], with each component
/// wrapped in [envelopeRef] when one is given.
Map<String, Object?> _catalogDocument(CatalogApi catalog, String? envelopeRef) {
  // catalogSchema builds a fresh copy, so it can be rewritten in place.
  final Map<String, Object?> document = catalog.catalogSchema;
  if (envelopeRef != null) {
    (document['components']! as Map<String, Object?>).updateAll(
      (_, schema) => <String, Object?>{
        'allOf': <Object?>[
          <String, Object?>{r'$ref': envelopeRef},
          schema,
        ],
      },
    );
  }
  _resolveRefDescriptions(document);
  return document;
}

/// The legacy (below v1.0) inline catalog for [catalog].
Map<String, Object?> _legacyInlineCatalog(
  CatalogApi catalog,
  String envelopeRef,
) {
  final components = <String, Object?>{
    for (final MapEntry<String, ComponentApi> entry
        in catalog.components.entries)
      entry.key: <String, Object?>{
        'allOf': <Object?>[
          <String, Object?>{r'$ref': envelopeRef},
          _legacyComponentBody(
            entry.key,
            _resolvedCopy(entry.value.schema.value),
            envelopeRef,
          ),
        ],
      },
  };
  final functions = <Object?>[
    for (final FunctionApi function in catalog.functions.values)
      <String, Object?>{
        'name': function.name,
        'returnType': function.returnType.jsonValue,
        'parameters': _resolvedCopy(function.argumentSchema.value),
      },
  ];
  final Schema? themeSchema = catalog.themeSchema;
  final Object? theme = themeSchema == null
      ? null
      : _resolvedCopy(themeSchema.value)['properties'];
  return {
    'catalogId': catalog.id,
    if (components.isNotEmpty) 'components': components,
    if (functions.isNotEmpty) 'functions': functions,
    if (theme != null) 'theme': theme,
  };
}

/// The second `allOf` member of a legacy component: [schema]'s properties
/// and required list, led by the `component` discriminator.
///
/// `id` and `component` are dropped from the component's own properties and
/// required list, since the envelope and the discriminator supply them.
Map<String, Object?> _legacyComponentBody(
  String name,
  Map<String, Object?> schema,
  String envelopeRef,
) {
  final Map<String, Object?> body = _legacySchemaBody(schema, envelopeRef);
  final Map<String, Object?> properties =
      (body['properties'] as Map<String, Object?>?) ?? const {};
  final List<Object?> required =
      (body['required'] as List<Object?>?) ?? const [];
  return {
    ...body,
    'properties': <String, Object?>{
      'component': <String, Object?>{'const': name},
      for (final MapEntry<String, Object?> entry in properties.entries)
        if (entry.key != 'id' && entry.key != 'component')
          entry.key: entry.value,
    },
    'required': <Object?>[
      'component',
      for (final Object? key in required)
        if (key != 'id' && key != 'component') key,
    ],
  };
}

/// Reduces an object schema to the keywords the legacy shape keeps:
/// `properties`, `required`, `anyOf`, `oneOf`, and `allOf` members that
/// cannot be merged.
///
/// The legacy shape has no `type` or `additionalProperties`, so those and
/// other keywords are dropped, as they always were. `allOf` members are
/// merged into the result, a property declared twice keeping the later
/// declaration; a `$ref` member stays in `allOf`, except one naming
/// [envelopeRef], which the legacy wrapper already applies. `anyOf` and
/// `oneOf` branches are reduced the same way and kept, since they constrain
/// the component rather than describe it.
Map<String, Object?> _legacySchemaBody(
  Map<String, Object?> schema,
  String envelopeRef,
) {
  final properties = <String, Object?>{};
  final required = <Object?>[];
  final allOf = <Object?>[];
  final branches = <String, List<Object?>>{};

  void merge(Map<Object?, Object?> node) {
    if (node['properties'] case final Map<Object?, Object?> nodeProperties) {
      for (final MapEntry<Object?, Object?> entry in nodeProperties.entries) {
        properties[entry.key! as String] = entry.value;
      }
    }
    if (node['required'] case final List<Object?> nodeRequired) {
      for (final key in nodeRequired) {
        if (!required.contains(key)) required.add(key);
      }
    }
    if (node['allOf'] case final List<Object?> members) {
      for (final member in members) {
        if (member is! Map) continue;
        if (member.containsKey(r'$ref')) {
          if (member[r'$ref'] != envelopeRef) allOf.add(member);
        } else {
          merge(member);
        }
      }
    }
    for (final keyword in const ['anyOf', 'oneOf']) {
      if (node[keyword] case final List<Object?> options) {
        final reduced = <Object?>[
          for (final Object? option in options)
            option is Map
                ? _legacySchemaBody(option.cast<String, Object?>(), envelopeRef)
                : option,
        ];
        if (branches.containsKey(keyword)) {
          // A second set of branches for the same keyword must hold as well,
          // so it joins the conjunction instead of replacing the first.
          allOf.add(<String, Object?>{keyword: reduced});
        } else {
          branches[keyword] = reduced;
        }
      }
    }
  }

  merge(schema);
  return {
    if (properties.isNotEmpty) 'properties': properties,
    if (required.isNotEmpty) 'required': required,
    ...branches,
    if (allOf.isNotEmpty) 'allOf': allOf,
  };
}

/// A deep copy of [schema] with its `REF:` descriptions resolved.
Map<String, Object?> _resolvedCopy(Map<String, Object?> schema) {
  final copy = _deepCopy(schema)! as Map<String, Object?>;
  _resolveRefDescriptions(copy);
  return copy;
}

Object? _deepCopy(Object? value) => switch (value) {
      final Map<Object?, Object?> map => <String, Object?>{
          for (final MapEntry<Object?, Object?> entry in map.entries)
            entry.key! as String: _deepCopy(entry.value),
        },
      final List<Object?> list => <Object?>[
          for (final Object? item in list) _deepCopy(item),
        ],
      _ => value,
    };

/// Replaces, in place, every node whose description has the form
/// `REF:uri|text` with `{"$ref": "uri", "description": "text"}`, the
/// convention `CommonSchemas` uses to mark a shared definition.
///
/// Only call this on a copy: the schemas it would otherwise rewrite are
/// shared statics.
void _resolveRefDescriptions(Object? node) {
  if (node is List) {
    node.forEach(_resolveRefDescriptions);
    return;
  }
  if (node is! Map) return;
  final Object? description = node['description'];
  if (description is String && description.startsWith('REF:')) {
    final int separator = description.indexOf('|');
    node
      ..clear()
      ..[r'$ref'] = separator < 0
          ? description.substring(4)
          : description.substring(4, separator);
    if (separator >= 0) {
      node['description'] = description.substring(separator + 1);
    }
    return;
  }
  node.values.forEach(_resolveRefDescriptions);
}

/// The rendering capabilities a renderer advertises, mirroring
/// `a2uiClientCapabilities` in `client_capabilities.json` and web_core's
/// `A2uiClientCapabilities`.
///
/// The object is a map keyed by protocol version, so a renderer may advertise
/// several versions at once. [versions] holds every entry this SDK
/// implements. An entry for a version it does not implement is not an error:
/// its key is recorded in [unsupportedVersions] and the entry is otherwise
/// ignored, so [toJson] does not re-emit it. A capabilities object naming no
/// implemented version is rejected.
class A2uiRendererCapabilities {
  /// Capabilities per protocol version, for the versions this SDK implements.
  ///
  /// Never empty: [A2uiRendererCapabilities.fromJson] rejects an object that
  /// declares none.
  final Map<A2uiProtocolVersion, A2uiVersionCapabilities> versions;

  /// Version keys in the source object that this SDK does not implement.
  final List<String> unsupportedVersions;

  A2uiRendererCapabilities({
    required this.versions,
    this.unsupportedVersions = const [],
  }) : assert(versions.isNotEmpty, 'Declare at least one supported version.');

  /// A renderer that supports catalogs by id only, for one protocol version.
  factory A2uiRendererCapabilities.forCatalogIds(
    List<String> supportedCatalogIds, {
    List<CatalogApi> inlineCatalogs = const [],
    A2uiProtocolVersion version = A2uiProtocolVersion.v0_9,
  }) =>
      A2uiRendererCapabilities(
        versions: {
          version: A2uiVersionCapabilities(
            supportedCatalogIds: supportedCatalogIds,
            inlineCatalogs: inlineCatalogs,
          ),
        },
      );

  /// Parses an `a2uiClientCapabilities` object.
  ///
  /// Throws [A2uiValidationError] if the object carries no entry for any
  /// version this SDK implements.
  factory A2uiRendererCapabilities.fromJson(Map<String, Object?> json) {
    final versions = <A2uiProtocolVersion, A2uiVersionCapabilities>{};
    final unsupported = <String>[];

    for (final MapEntry<String, Object?> entry in json.entries) {
      final A2uiProtocolVersion? version = A2uiProtocolVersion.tryParse(
        entry.key,
      );
      if (version == null) {
        unsupported.add(entry.key);
        continue;
      }
      final Object? value = entry.value;
      if (value is! Map) {
        throw A2uiValidationError(
          "Renderer capabilities entry '${entry.key}' must be an object.",
          details: json,
        );
      }
      versions[version] = A2uiVersionCapabilities.fromJson(
        value.cast<String, Object?>(),
      );
    }

    if (versions.isEmpty) {
      throw A2uiValidationError(
        'Renderer capabilities must declare an entry for a supported '
        'version; this SDK supports only '
        '${A2uiProtocolVersion.supportedVersions}.',
        details: json,
      );
    }

    return A2uiRendererCapabilities(
      versions: versions,
      unsupportedVersions: unsupported,
    );
  }

  /// The capabilities declared for [version], or for a version compatible
  /// with it (see [isCatalogVersionCompatible]) when [version] itself is not
  /// declared, so a renderer declaring v0.9.1 serves a v0.9 agent and the
  /// reverse. Null if no compatible version is declared.
  A2uiVersionCapabilities? forVersion(A2uiProtocolVersion version) {
    final A2uiVersionCapabilities? declared = versions[version];
    if (declared != null) return declared;
    for (final MapEntry<A2uiProtocolVersion, A2uiVersionCapabilities> entry
        in versions.entries) {
      if (isCatalogVersionCompatible(entry.key.jsonValue, version.jsonValue)) {
        return entry.value;
      }
    }
    return null;
  }

  Map<String, Object?> toJson() => {
        for (final MapEntry<A2uiProtocolVersion, A2uiVersionCapabilities> entry
            in versions.entries)
          entry.key.jsonValue: entry.value.toJson(version: entry.key),
      };
}
