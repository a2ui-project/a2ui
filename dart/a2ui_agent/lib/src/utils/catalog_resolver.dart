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

import 'package:a2ui_core/a2ui_core.dart';

import '../processor/catalog_config.dart';
import 'catalogs.dart';

/// Negotiates the catalogs the agent registered against the capabilities a
/// renderer declared, and returns the catalogs active for the session.
///
/// [rendererCapabilities] is null for a request that carries no capabilities.
/// The renderer has then stated no preference, so every registered catalog
/// is active, in registration order, and none is when none is registered.
/// Nothing then says which protocol version the renderer reads, so the
/// registered catalogs must target one.
///
/// Otherwise the agent and the renderer agree on a protocol version first.
/// The registered catalogs may target several, and the catalogs of one
/// version are negotiated against the renderer's capabilities for it,
/// starting from the latest version the renderer declares capabilities for.
/// If none of that version's catalogs becomes active, the next earlier
/// version both declare is tried, so the session uses the latest version in
/// which the two have a catalog in common. Catalogs of v0.9 and v0.9.1,
/// which share message shapes, are negotiated together.
///
/// Within a version, every registered catalog the renderer supports is
/// active, in the renderer's preference order, so the renderer's first choice
/// is the first catalog the model reads about. An id the renderer names and
/// the agent does not hold for that version is ignored, so a catalog id may
/// be registered once for each version.
///
/// The catalogs returned are the transformed ones, so a pruning transformer is
/// visible both in the prompt and in what the processor accepts.
///
/// Inline catalogs the renderer declares are ignored unless
/// [acceptsInlineCatalogs] is true. An accepted inline catalog is active as
/// the renderer declared it, after the registered ones: no transformer
/// applies to it, since transformers belong to a registration. One whose id
/// is already active is dropped, so a renderer that names a catalog and also
/// redefines it gets the agent's registration.
///
/// Without capabilities, throws [A2uiCatalogError] if the registered
/// catalogs target different versions. Given capabilities, throws
/// [A2uiValidationError] if they declare nothing for any version of the
/// registered catalogs, and [A2uiCatalogError] if no catalog is registered
/// or none is active: in no version both declare does the renderer support a
/// registered catalog or declare an inline catalog the agent accepts.
List<CatalogApi> resolveCatalogs(
  List<CatalogConfig> catalogs,
  A2uiRendererCapabilities? rendererCapabilities, {
  bool acceptsInlineCatalogs = false,
}) {
  if (rendererCapabilities == null) {
    if (catalogs.isNotEmpty) {
      catalogsProtocolVersion([
        for (final CatalogConfig config in catalogs) config.catalog,
      ]);
    }
    return [
      for (final CatalogConfig config in catalogs) config.transformedCatalog,
    ];
  }
  if (catalogs.isEmpty) {
    throw A2uiCatalogError(
      'No catalog is registered with this agent, so none can be active.',
    );
  }

  final Map<A2uiProtocolVersion, List<CatalogConfig>> registered = _byVersion(
    catalogs,
  );
  final declined = <String>[];
  for (final MapEntry(key: A2uiProtocolVersion version, value: configs)
      in registered.entries) {
    final A2uiVersionCapabilities? capabilities = rendererCapabilities
        .forVersion(version);
    if (capabilities == null) continue;
    final List<CatalogApi> active = _activate(
      configs,
      capabilities,
      acceptsInlineCatalogs: acceptsInlineCatalogs,
    );
    if (active.isNotEmpty) return active;
    declined.add(
      '${version.jsonValue}: renderer ${capabilities.supportedCatalogIds}, '
      'agent ${[for (final CatalogConfig c in configs) c.catalog.id]}',
    );
  }
  if (declined.isEmpty) {
    throw A2uiValidationError(
      'Renderer capabilities declare nothing for '
      '${registered.keys.map((v) => v.jsonValue).join(' or ')}, the '
      '${registered.length == 1 ? 'version' : 'versions'} of the registered '
      'catalogs.',
    );
  }
  throw A2uiCatalogError(
    'The renderer supports none of the catalogs registered with this agent. '
    '${declined.join('; ')}.',
  );
}

/// [catalogs] grouped by the protocol version they target, latest version
/// first, each group in registration order.
///
/// A group holds catalogs that [catalogsProtocolVersion] accepts together,
/// and is keyed by the version it returns for them, so v0.9 and v0.9.1
/// catalogs share the v0.9 group.
Map<A2uiProtocolVersion, List<CatalogConfig>> _byVersion(
  List<CatalogConfig> catalogs,
) {
  A2uiProtocolVersion versionOf(CatalogConfig config) =>
      catalogsProtocolVersion([config.catalog]);
  bool shareMessages(A2uiProtocolVersion a, A2uiProtocolVersion b) =>
      isCatalogVersionCompatible(a.jsonValue, b.jsonValue);

  final keys = <A2uiProtocolVersion>[];
  for (final A2uiProtocolVersion version
      in catalogs.map(versionOf).toSet().toList()..sort()) {
    if (!keys.any((key) => shareMessages(version, key))) keys.add(version);
  }
  return {
    for (final A2uiProtocolVersion key in keys.reversed)
      key: [
        for (final CatalogConfig config in catalogs)
          if (shareMessages(versionOf(config), key)) config,
      ],
  };
}

/// The catalogs of one protocol version that are active for [capabilities],
/// the renderer's capabilities for that version, or none.
///
/// [catalogs] are the registered catalogs of that version.
List<CatalogApi> _activate(
  List<CatalogConfig> catalogs,
  A2uiVersionCapabilities capabilities, {
  required bool acceptsInlineCatalogs,
}) {
  final Map<String, CatalogConfig> registered = {
    for (final CatalogConfig config in catalogs) config.catalog.id: config,
  };
  final List<CatalogApi> active = [
    for (final CatalogConfig config in {
      for (final String id in capabilities.supportedCatalogIds) ?registered[id],
    })
      config.transformedCatalog,
  ];
  if (acceptsInlineCatalogs) {
    for (final CatalogApi inline in capabilities.inlineCatalogs) {
      if (active.every((CatalogApi c) => c.id != inline.id)) {
        active.add(inline);
      }
    }
  }
  return active;
}
