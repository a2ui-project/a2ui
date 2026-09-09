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

import '../catalog_transformers/base.dart';
import 'catalog_providers.dart';

/// Pairs a catalog with the protocol version it is registered for and the
/// transformers applied before prompting or validation.
class CatalogConfig {
  /// The pristine catalog, as loaded from a [CatalogProvider].
  final SchemaCatalog catalog;

  /// Transformers applied in order by [transformedCatalog].
  final List<CatalogTransformer> transformers;

  /// The protocol version this catalog is registered for.
  ///
  /// A catalog document is version-agnostic, so the version belongs to the
  /// registration rather than to the document. It is what
  /// `A2uiGenerator.agentCapabilities` advertises the catalog under, which is
  /// how one agent can register catalogs for several versions at once.
  final A2uiProtocolVersion protocolVersion;

  const CatalogConfig(
    this.catalog, {
    this.transformers = const [],
    this.protocolVersion = A2uiProtocolVersion.v0_9,
  });

  /// Loads a catalog from a JSON file on disk.
  ///
  /// Throws the errors documented on [FileSystemCatalogProvider.load].
  static CatalogConfig fromPath(
    String catalogPath, {
    List<CatalogTransformer> transformers = const [],
    A2uiProtocolVersion protocolVersion = A2uiProtocolVersion.v0_9,
    String? catalogId,
  }) => CatalogConfig(
    FileSystemCatalogProvider(
      catalogPath,
      protocolVersion: protocolVersion,
      catalogId: catalogId,
    ).load(),
    transformers: transformers,
    protocolVersion: protocolVersion,
  );

  /// The catalog with every transformer applied, in order.
  SchemaCatalog get transformedCatalog {
    SchemaCatalog current = catalog;
    for (final CatalogTransformer transformer in transformers) {
      current = transformer.transform(current);
    }
    return current;
  }
}
