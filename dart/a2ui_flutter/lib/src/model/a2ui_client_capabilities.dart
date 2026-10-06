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

import '../primitives/simple_items.dart';
import 'catalog.dart';

/// Defines how catalogs should be handled when generating client capabilities.
enum InlineCatalogHandling {
  /// Do not inline any catalogs. If a catalog is missing a `catalogId`, an
  /// exception is thrown.
  none,

  /// Inline only catalogs that do not have a `catalogId`. Send the rest as
  /// supported IDs.
  missingIds,

  /// Inline all provided catalogs, regardless of whether they have a
  /// `catalogId`.
  all,
}

/// Describes the client's UI rendering capabilities to the server.
///
/// This class represents the `a2uiClientCapabilities` object that is sent
/// from a client using the [A2UI extension](https://a2ui.org) to the
/// [A2A protocol](https://a2a-protocol.org) with each message it sends, in
/// order to inform the server about the component catalogs the client supports.
class A2UiClientCapabilities {
  /// Creates a new [A2UiClientCapabilities] instance.
  const A2UiClientCapabilities({
    required this.supportedCatalogIds,
    this.inlineCatalogs,
  });

  /// Creates client capabilities from a collection of catalogs.
  ///
  /// This is used to create an [A2UiClientCapabilities] instance from a
  /// collection of [Catalog] objects to send to an A2A server that supports
  /// the [A2UI extension](https://a2ui.org).
  ///
  /// [inlineHandling] determines how catalogs without a `catalogId` are
  /// handled. See [InlineCatalogHandling] for more information.
  factory A2UiClientCapabilities.fromCatalogs(
    Iterable<Catalog> catalogs, {
    InlineCatalogHandling inlineHandling = InlineCatalogHandling.missingIds,
  }) {
    // A `Set` keeps insertion order while dropping IDs that repeat, so a
    // catalog whose alias matches another catalog's ID is advertised once.
    final supportedIds = <String>{};
    final inlineDefinitions = <JsonMap>[];

    for (final catalog in catalogs) {
      if (inlineHandling == InlineCatalogHandling.all) {
        inlineDefinitions.add(catalog.toCapabilitiesJson());
        continue;
      }

      if (catalog.catalogId != null) {
        supportedIds.add(catalog.catalogId!);
        supportedIds.addAll(catalog.catalogIdAliases);
      } else {
        if (inlineHandling == InlineCatalogHandling.none) {
          throw StateError(
            'Catalog provided without a catalogId, but '
            'inlineHandling is set to InlineCatalogHandling.none',
          );
        }
        inlineDefinitions.add(catalog.toCapabilitiesJson());
      }
    }

    return A2UiClientCapabilities(
      supportedCatalogIds: supportedIds.toList(),
      inlineCatalogs: inlineDefinitions.isNotEmpty ? inlineDefinitions : null,
    );
  }

  /// A list of identifiers for all pre-defined catalogs the client supports.
  ///
  /// The client MUST always include the basic catalog ID here if it
  /// supports said catalog.
  final List<String> supportedCatalogIds;

  /// An array of full Catalog Definition Documents.
  ///
  /// This allows a client to provide custom, on-the-fly catalogs. This should
  /// only be provided if the server has advertised
  /// `acceptsInlineCatalogs: true`. This is not yet implemented.
  final List<JsonMap>? inlineCatalogs;

  /// Serializes this object to a JSON-compatible map.
  JsonMap toJson() {
    final JsonMap json = {'supportedCatalogIds': supportedCatalogIds};
    if (inlineCatalogs != null) {
      json['inlineCatalogs'] = inlineCatalogs;
    }
    return {'v0.9': json};
  }
}
