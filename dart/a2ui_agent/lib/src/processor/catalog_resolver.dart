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

import 'catalog_config.dart';

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
/// Throws [A2uiValidationError] if [rendererCapabilities] declares nothing
/// for v0.9, and [A2uiCatalogError] if no catalog is active: the renderer
/// supports none of the registered catalogs and declares no inline catalog
/// the agent accepts.
List<CatalogApi> resolveCatalogs(
  List<CatalogConfig> catalogs,
  A2uiRendererCapabilities? rendererCapabilities, {
  bool acceptsInlineCatalogs = false,
}) {
  if (rendererCapabilities == null) {
    return [
      for (final CatalogConfig config in catalogs) config.transformedCatalog,
    ];
  }
  const A2uiProtocolVersion version = A2uiProtocolVersion.v0_9;
  final A2uiVersionCapabilities? capabilities = rendererCapabilities.forVersion(
    version,
  );
  if (capabilities == null) {
    throw A2uiValidationError(
      'Renderer capabilities declare nothing for ${version.jsonValue}, the '
      'only version this SDK supports.',
      details: rendererCapabilities.toJson(),
    );
  }

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
  if (active.isEmpty) {
    throw A2uiCatalogError(
      'The renderer supports none of the catalogs registered with this '
      'agent. Renderer: ${capabilities.supportedCatalogIds}; agent: '
      '${registered.keys.toList()}.',
    );
  }
  return active;
}
