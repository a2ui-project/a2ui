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

/// A [CatalogConfig] over schema-only catalogs.
///
/// This is the shape agents use, since [Catalog.fromJson] produces schema-only
/// catalogs and an agent never evaluates a catalog function.
typedef SchemaCatalogConfig = CatalogConfig<CatalogComponent, CatalogFunction>;

/// Associates a catalog with the transformations applied to it before it is
/// used for prompting or validation.
class CatalogConfig<C extends ComponentApi, F extends FunctionApi> {
  /// The pristine catalog, as loaded from a [CatalogProvider].
  final Catalog<C, F> catalog;

  /// Transformers applied in order by [transformedCatalog].
  final List<CatalogTransformer<C, F>> transformers;

  const CatalogConfig(this.catalog, {this.transformers = const []});

  /// Loads a catalog from a JSON file on disk.
  ///
  /// Throws the errors documented on [FileSystemCatalogProvider.load].
  static SchemaCatalogConfig fromPath(
    String catalogPath, {
    List<CatalogTransformer<CatalogComponent, CatalogFunction>> transformers =
        const [],
    A2uiProtocolVersion? protocolVersion,
    String? catalogId,
  }) => CatalogConfig<CatalogComponent, CatalogFunction>(
    FileSystemCatalogProvider(
      catalogPath,
      protocolVersion: protocolVersion,
      catalogId: catalogId,
    ).load(),
    transformers: transformers,
  );

  /// The catalog after applying every configured transformer in order.
  Catalog<C, F> get transformedCatalog {
    Catalog<C, F> current = catalog;
    for (final CatalogTransformer<C, F> transformer in transformers) {
      current = transformer.transform(current);
    }
    return current;
  }
}
