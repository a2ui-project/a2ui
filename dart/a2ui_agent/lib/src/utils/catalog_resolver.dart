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

/// Negotiates the catalogs the agent registered against the capabilities a
/// renderer declared, and returns the catalogs active for the session.
///
/// [rendererCapabilities] is null for a request that carries no capabilities.
/// The renderer has then stated no preference, so every registered catalog
/// is active, in registration order.
///
/// Every registered catalog the renderer supports for protocol v0.9 is
/// active, in the renderer's preference order, so the renderer's first choice
/// is the first catalog the model reads about. An id the renderer names and
/// the agent does not hold is ignored.
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
/// The active catalogs are copies linked with one another, with each
/// registered catalog as declared and as transformed, so a cross-catalog
/// `$ref` resolves, including one to an entry a transformer pruned; see
/// [linkCatalogs]. The registered catalogs are not changed. A refused inline
/// catalog is linked with nothing.
///
/// Throws [A2uiValidationError] if [rendererCapabilities] declares nothing
/// for v0.9, and [A2uiCatalogError] if no catalog is active: the renderer
/// supports none of the registered catalogs and declares no inline catalog
/// the agent accepts.
List<CatalogApi> resolveCatalogs(
  List<CatalogConfig> catalogs,
  A2uiRendererCapabilities? rendererCapabilities, {
  bool acceptsInlineCatalogs = false,
}) {
  final List<CatalogApi> transformed = [
    for (final CatalogConfig config in catalogs) config.transformedCatalog,
  ];
  // Each registered catalog, as declared and as transformed, so a reference
  // to an entry a transformer pruned still resolves.
  final List<CatalogApi> extraPeers = [
    for (final CatalogConfig config in catalogs) config.catalog,
    ...transformed,
  ];
  if (rendererCapabilities == null) {
    return linkCatalogs(transformed, extraPeers: extraPeers);
  }
  const A2uiProtocolVersion version = A2uiProtocolVersion.v0_9;
  final A2uiVersionCapabilities? capabilities = rendererCapabilities.forVersion(
    version,
  );
  if (capabilities == null) {
    throw A2uiValidationError(
      'Renderer capabilities declare nothing for ${version.jsonValue}, the '
      'only version this SDK supports.',
    );
  }

  final Map<String, CatalogApi> registered = {
    for (var i = 0; i < catalogs.length; i++)
      catalogs[i].catalog.id: transformed[i],
  };
  final List<CatalogApi> active = [
    ...{
      for (final String id in capabilities.supportedCatalogIds) ?registered[id],
    },
  ];
  if (acceptsInlineCatalogs) {
    for (final CatalogApi inline in capabilities.inlineCatalogs) {
      if (active.every((CatalogApi c) => c.id != inline.id)) {
        active.add(inline);
      }
    }
  }
  if (active.isEmpty) {
    throw A2uiCatalogError(
      'The renderer supports none of the catalogs registered with this '
      'agent. Renderer: ${capabilities.supportedCatalogIds}; agent: '
      '${registered.keys.toList()}.',
    );
  }
  // An accepted inline catalog is already active, and a refused one is
  // linked with nothing.
  return linkCatalogs(active, extraPeers: extraPeers);
}
