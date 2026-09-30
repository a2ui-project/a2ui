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

/// A catalog the agent supports, registered with an `A2uiGenerator`, and the
/// transformers applied to it.
///
/// The catalog is registered for protocol v0.9, the only version this SDK
/// implements.
class CatalogConfig {
  /// The catalog as its document declares it, parsed by [Catalog.fromJson] or
  /// loaded by a [CatalogProvider].
  final SchemaCatalog catalog;

  /// The transformers applied to [catalog], in order, before it reaches a
  /// prompt or a validator.
  final List<CatalogTransformer> transformers;

  const CatalogConfig(this.catalog, {this.transformers = const []});

  /// Loads the catalog document at [catalogPath] with a
  /// [FileSystemCatalogProvider] given [protocolVersion] and [catalogId].
  ///
  /// Throws [A2uiCatalogError] if the document cannot be loaded.
  factory CatalogConfig.fromPath(
    String catalogPath, {
    List<CatalogTransformer> transformers = const [],
    A2uiProtocolVersion? protocolVersion,
    String? catalogId,
  }) => CatalogConfig(
    FileSystemCatalogProvider(
      catalogPath,
      protocolVersion: protocolVersion,
      catalogId: catalogId,
    ).load(),
    transformers: transformers,
  );

  /// [catalog] after each of [transformers] in turn, each seeing the previous
  /// result.
  SchemaCatalog get transformedCatalog => transformers.fold(
    catalog,
    (SchemaCatalog current, CatalogTransformer transformer) =>
        transformer.transform(current),
  );
}
