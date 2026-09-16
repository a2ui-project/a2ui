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

import '../primitives/errors.dart';
import '../primitives/protocol_version.dart';
import 'catalog.dart';

/// The catalogs a renderer can render for one protocol version, mirroring
/// `A2uiVersionCapabilities` in `client_capabilities.json`.
class A2uiVersionCapabilities {
  /// Ids of the catalogs the renderer supports.
  final List<String> supportedCatalogIds;

  /// Catalogs supplied inline, meaningful only when the agent advertises
  /// `acceptsInlineCatalogs`.
  final List<SchemaCatalog> inlineCatalogs;

  A2uiVersionCapabilities({
    required this.supportedCatalogIds,
    this.inlineCatalogs = const [],
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

  Map<String, Object?> toJson() => {
    'supportedCatalogIds': supportedCatalogIds,
    if (inlineCatalogs.isNotEmpty)
      'inlineCatalogs': [
        for (final SchemaCatalog catalog in inlineCatalogs)
          catalog.catalogSchema,
      ],
  };
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
    List<SchemaCatalog> inlineCatalogs = const [],
    A2uiProtocolVersion version = A2uiProtocolVersion.v0_9,
  }) => A2uiRendererCapabilities(
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

  /// The capabilities declared for [version], or null if it declares none.
  A2uiVersionCapabilities? forVersion(A2uiProtocolVersion version) =>
      versions[version];

  Map<String, Object?> toJson() => {
    for (final MapEntry<A2uiProtocolVersion, A2uiVersionCapabilities> entry
        in versions.entries)
      entry.key.jsonValue: entry.value.toJson(),
  };
}
