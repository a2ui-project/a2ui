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

import 'dart:convert';

import '../primitives/errors.dart';
import '../primitives/protocol_version.dart';
import '../primitives/semver.dart';
import '../validation/common_types.g.dart';
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

  const CapabilitiesOptions({
    required this.versions,
    this.includeInlineCatalogs = false,
  });
}

/// The envelope each legacy (below v1.0) inline component is wrapped in.
///
/// Below v1.0 a catalog component carries its own envelope, so every inline
/// component is `allOf: [{$ref: <envelope>}, <body>]`. From v1.0 the message
/// schema composes the envelope, and catalog components must not.
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

  A2uiVersionCapabilities({
    required this.supportedCatalogIds,
    this.inlineCatalogs = const [],
  });

  /// Parses a version capabilities object.
  ///
  /// Throws [A2uiValidationError] unless `supportedCatalogIds` is a list of
  /// strings. Throws [A2uiCatalogError] if `inlineCatalogs`, when present, is
  /// not a list of valid catalog objects.
  factory A2uiVersionCapabilities.fromJson(Map<String, Object?> json) {
    final Object? rawIds = json['supportedCatalogIds'];
    if (rawIds is! List) {
      throw A2uiValidationError(
        "Renderer capabilities must declare a 'supportedCatalogIds' array.",
        details: json,
      );
    }
    final Object? rawInline = json['inlineCatalogs'];
    if (rawInline != null && rawInline is! List) {
      throw A2uiCatalogError(
        "'inlineCatalogs' must be an array of catalog objects.",
      );
    }
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
              throw A2uiCatalogError(
                "'inlineCatalogs' must contain only catalog objects (got "
                '${catalog.runtimeType}).',
              ),
      ],
    );
  }

  /// Serializes these capabilities as the entry for [version].
  ///
  /// The shape of each inline catalog depends on [version]. From v1.0 it is a
  /// copy of the standalone catalog document, [Catalog.catalogSchema]. Below
  /// v1.0 it is the legacy inline catalog derived from that same document:
  /// components wrapped in `common_types.json#/$defs/ComponentCommon`,
  /// `functions` as a list of definitions, and `theme` as the theme's
  /// property map. Deriving both shapes from [Catalog.catalogSchema] means
  /// one serializer decides a component's properties and required list.
  Map<String, Object?> toJson({required A2uiProtocolVersion version}) => {
        'supportedCatalogIds': supportedCatalogIds,
        if (inlineCatalogs.isNotEmpty)
          'inlineCatalogs': [
            for (final CatalogApi catalog in inlineCatalogs)
              if (version.isAtLeast(A2uiProtocolVersion.v1_0))
                // catalogSchema is memoized on the catalog, so callers get a
                // copy they may rewrite.
                _deepCopy(catalog.catalogSchema)! as Map<String, Object?>
              else
                _legacyInlineCatalog(catalog.catalogSchema),
          ],
      };
}

/// The legacy (below v1.0) inline catalog derived from the catalog
/// [document], a [Catalog.catalogSchema].
Map<String, Object?> _legacyInlineCatalog(Map<String, Object?> document) {
  final refs = _LegacyRefs(document);
  final components = <String, Object?>{
    if (document['components'] case final Map<String, Object?> serialized)
      for (final MapEntry<String, Object?> entry in serialized.entries)
        entry.key: <String, Object?>{
          'allOf': <Object?>[
            <String, Object?>{r'$ref': _legacyComponentEnvelopeRef},
            _legacyComponentBody(
              entry.key,
              entry.value! as Map<String, Object?>,
              refs,
            ),
          ],
        },
  };
  final functions = <Object?>[
    if (document['functions'] case final Map<String, Object?> serialized)
      for (final MapEntry<String, Object?> entry in serialized.entries)
        _legacyFunction(entry.key, entry.value! as Map<String, Object?>, refs),
  ];
  final Object? theme = switch (document[r'$defs']) {
    {'theme': {'properties': final Map<String, Object?> properties}} =>
      refs.rewrite(properties),
    _ => null,
  };
  return {
    'catalogId': document['catalogId'],
    if (components.isNotEmpty) 'components': components,
    if (functions.isNotEmpty) 'functions': functions,
    if (theme != null) 'theme': theme,
  };
}

/// The second `allOf` member of a legacy component: the serialized
/// [component]'s properties and required list, led by the `component`
/// discriminator.
///
/// The document form declares `id` and `component` itself; the legacy shape
/// leaves `id` to the envelope and keeps only the discriminator. `type` and
/// the `unevaluatedProperties`/`additionalProperties` keywords are dropped,
/// as the legacy shape never carried them.
Map<String, Object?> _legacyComponentBody(
  String name,
  Map<String, Object?> component,
  _LegacyRefs refs,
) {
  final Map<String, Object?> properties =
      (component['properties'] as Map<String, Object?>?) ?? const {};
  final List<Object?> required =
      (component['required'] as List<Object?>?) ?? const [];
  return {
    'properties': <String, Object?>{
      'component': <String, Object?>{'const': name},
      for (final MapEntry<String, Object?> entry in properties.entries)
        if (entry.key != 'id' && entry.key != 'component')
          entry.key: refs.rewrite(entry.value),
    },
    'required': <Object?>[
      'component',
      for (final Object? key in required)
        if (key != 'id' && key != 'component') key,
    ],
  };
}

/// A legacy function definition from the serialized [function], whose
/// `properties` hold `call`, `args`, and `returnType`.
Map<String, Object?> _legacyFunction(
  String name,
  Map<String, Object?> function,
  _LegacyRefs refs,
) {
  final Map<String, Object?> properties =
      (function['properties'] as Map<String, Object?>?) ?? const {};
  return {
    'name': name,
    if (function['description'] case final String description)
      'description': description,
    'returnType': switch (properties['returnType']) {
      {'const': final Object? returnType} => returnType,
      _ => null,
    },
    'parameters': refs.rewrite(properties['args']),
  };
}

/// Rewrites the local `#/...` references of a catalog document for the legacy
/// inline shape, which has no `$defs` to point into.
///
/// A reference to one of the bundled common types becomes the relative
/// `common_types.json#/$defs/<name>` reference again. Any other local
/// reference is inlined when it resolves within the document, and dropped
/// (its annotations kept) when it does not, so the agent never receives a
/// pointer it cannot follow.
class _LegacyRefs {
  _LegacyRefs(this.document);

  final Map<String, Object?> document;

  /// Local references being inlined, to stop a self-referential definition
  /// from recursing.
  final List<String> _inlining = [];

  static const String _defsPrefix = r'#/$defs/';

  static final Set<String> _commonDefs = ((jsonDecode(commonTypesV0_9Json)
          as Map<String, Object?>)[r'$defs']! as Map<String, Object?>)
      .keys
      .toSet();

  /// A deep copy of [node] with its local references rewritten.
  Object? rewrite(Object? node) {
    if (node is List) {
      return <Object?>[for (final Object? item in node) rewrite(item)];
    }
    if (node is! Map) return node;
    final Object? ref = node[r'$ref'];
    final rest = <String, Object?>{
      for (final MapEntry<Object?, Object?> entry in node.entries)
        if (entry.key != r'$ref') entry.key! as String: rewrite(entry.value),
    };
    if (ref is! String || !ref.startsWith('#')) {
      return <String, Object?>{if (ref != null) r'$ref': ref, ...rest};
    }
    if (ref.startsWith(_defsPrefix) &&
        _commonDefs.contains(ref.substring(_defsPrefix.length))) {
      return <String, Object?>{
        r'$ref':
            'common_types.json#/\$defs/${ref.substring(_defsPrefix.length)}',
        ...rest,
      };
    }
    final Object? target = _resolve(ref);
    if (target is! Map || _inlining.contains(ref)) return rest;
    _inlining.add(ref);
    final inlined = rewrite(target)! as Map<String, Object?>;
    _inlining.removeLast();
    return <String, Object?>{...inlined, ...rest};
  }

  /// The node a local JSON Pointer [ref] names in [document], or null.
  Object? _resolve(String ref) {
    Object? node = document;
    if (ref == '#') return node;
    if (!ref.startsWith('#/')) return null;
    for (final String raw in ref.substring(2).split('/')) {
      final String key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
      switch (node) {
        case final Map<Object?, Object?> map when map.containsKey(key):
          node = map[key];
        case final List<Object?> list:
          final int? index = int.tryParse(key);
          if (index == null || index < 0 || index >= list.length) return null;
          node = list[index];
        default:
          return null;
      }
    }
    return node;
  }
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
