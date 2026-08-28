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
/// A capabilities object without a `v0.9` entry is rejected. Other versions
/// are kept in [unsupportedVersions] but never negotiated against.
class A2uiRendererCapabilities {
  /// The capabilities declared for v0.9.
  final A2uiVersionCapabilities v0_9;

  /// Version keys in the source object that this SDK does not implement.
  final List<String> unsupportedVersions;

  A2uiRendererCapabilities({
    required this.v0_9,
    this.unsupportedVersions = const [],
  });

  /// A renderer that supports catalogs by id only.
  factory A2uiRendererCapabilities.forCatalogIds(
    List<String> supportedCatalogIds, {
    List<SchemaCatalog> inlineCatalogs = const [],
  }) => A2uiRendererCapabilities(
    v0_9: A2uiVersionCapabilities(
      supportedCatalogIds: supportedCatalogIds,
      inlineCatalogs: inlineCatalogs,
    ),
  );

  /// Parses an `a2uiClientCapabilities` object.
  ///
  /// Throws [A2uiValidationError] if the object carries no `v0.9` entry.
  factory A2uiRendererCapabilities.fromJson(Map<String, Object?> json) {
    final Object? v09 = json[A2uiProtocolVersion.v0_9.jsonValue];
    if (v09 is! Map) {
      throw A2uiValidationError(
        'Renderer capabilities must declare a '
        "'${A2uiProtocolVersion.v0_9.jsonValue}' entry; this SDK supports "
        'only ${A2uiProtocolVersion.supportedVersions}.',
        details: json,
      );
    }
    return A2uiRendererCapabilities(
      v0_9: A2uiVersionCapabilities.fromJson(v09.cast<String, Object?>()),
      unsupportedVersions: [
        for (final String key in json.keys)
          if (key != A2uiProtocolVersion.v0_9.jsonValue) key,
      ],
    );
  }

  /// The capabilities declared for [version].
  ///
  /// Throws [A2uiValidationError] for any version this SDK does not implement.
  A2uiVersionCapabilities forVersion(A2uiProtocolVersion version) {
    switch (version) {
      case A2uiProtocolVersion.v0_9:
        return v0_9;
    }
  }

  Map<String, Object?> toJson() => {
    A2uiProtocolVersion.v0_9.jsonValue: v0_9.toJson(),
  };
}
