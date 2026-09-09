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

/// The [PayloadValidator]s for one turn's active catalogs, one per catalog.
///
/// A [PayloadValidator] checks a component, function call or theme against a
/// single catalog; deciding which catalog an item belongs to is the caller's
/// job. An agent knows its active catalogs for the whole turn, so the
/// validators are built here once and looked up by catalog id, the same split
/// `MessageProcessor` makes on the renderer side.
class CatalogValidators {
  /// The catalogs active for the turn, in agent preference order.
  final List<SchemaCatalog> catalogs;

  /// The protocol version the validators accept.
  final A2uiProtocolVersion protocolVersion;

  /// One validator per catalog id, built on first use.
  final Map<String, PayloadValidator<ComponentApi, FunctionApi>> _validators =
      {};

  CatalogValidators({
    required this.catalogs,
    this.protocolVersion = A2uiProtocolVersion.v0_9,
  });

  /// The catalog with [catalogId] among [catalogs].
  ///
  /// Throws [A2uiCatalogError] when the turn negotiated no such catalog, which
  /// for an agent means the model named one outside the active set.
  SchemaCatalog catalogFor(String catalogId) {
    for (final SchemaCatalog catalog in catalogs) {
      if (catalog.id == catalogId) return catalog;
    }
    throw A2uiCatalogError(
      "Catalog '$catalogId' is not active for this request. Active: "
      '${catalogs.map((SchemaCatalog c) => c.id).join(', ')}.',
      catalogId: catalogId,
    );
  }

  /// The validator for the catalog with [catalogId].
  ///
  /// Built once per catalog and reused, so the schema resolution each
  /// validator caches is shared across the turn.
  ///
  /// Throws [A2uiCatalogError] when the turn negotiated no such catalog.
  PayloadValidator<ComponentApi, FunctionApi> validatorFor(String catalogId) =>
      _validators.putIfAbsent(
        catalogId,
        () => PayloadValidator<ComponentApi, FunctionApi>(
          catalog: catalogFor(catalogId),
          protocolVersion: protocolVersion,
        ),
      );
}
