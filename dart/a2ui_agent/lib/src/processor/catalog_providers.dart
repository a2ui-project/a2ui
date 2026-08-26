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

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';

/// Loads a catalog definition from some backing store.
///
/// There is deliberately no bundled provider: nothing needs to ship with the
/// SDK, because the catalogs an agent supports are either read from disk,
/// supplied in memory, or sent inline by the renderer.
abstract class CatalogProvider<C extends ComponentApi, F extends FunctionApi> {
  const CatalogProvider();

  /// Loads and returns the catalog.
  Catalog<C, F> load();
}

/// Loads a catalog definition from a JSON file on the local filesystem.
class FileSystemCatalogProvider
    extends CatalogProvider<CatalogComponent, CatalogFunction> {
  /// The path to the catalog JSON file.
  final String path;

  /// The protocol version the loaded catalog is expected to declare.
  final A2uiProtocolVersion? protocolVersion;

  /// The catalog id the loaded catalog is expected to declare.
  final String? catalogId;

  const FileSystemCatalogProvider(
    this.path, {
    this.protocolVersion,
    this.catalogId,
  });

  /// Reads and parses the catalog file.
  ///
  /// Throws [A2uiCatalogError] if the file is missing or is not a JSON object,
  /// or if [catalogId] conflicts with the document. Throws
  /// [A2uiValidationError] if the document declares an unsupported protocol
  /// version, or one conflicting with [protocolVersion].
  @override
  Catalog<CatalogComponent, CatalogFunction> load() {
    final file = File(path);
    if (!file.existsSync()) {
      throw A2uiCatalogError('Catalog file not found: $path');
    }
    final Object? decoded;
    try {
      decoded = jsonDecode(file.readAsStringSync());
    } on FormatException catch (e) {
      throw A2uiCatalogError(
        'Catalog file $path is not valid JSON: ${e.message}',
      );
    }
    if (decoded is! Map<String, Object?>) {
      throw A2uiCatalogError('Catalog file $path must contain a JSON object.');
    }
    return Catalog.fromJson(
      decoded,
      expectedProtocolVersion: protocolVersion,
      expectedCatalogId: catalogId,
    );
  }
}

/// Loads a catalog definition from an in-memory schema map.
class InMemoryCatalogProvider
    extends CatalogProvider<CatalogComponent, CatalogFunction> {
  /// The raw catalog schema.
  final Map<String, Object?> catalog;

  /// The protocol version the catalog is expected to declare.
  final A2uiProtocolVersion? protocolVersion;

  /// The catalog id the catalog is expected to declare.
  final String? catalogId;

  const InMemoryCatalogProvider(
    this.catalog, {
    this.protocolVersion,
    this.catalogId,
  });

  /// Parses the in-memory schema.
  ///
  /// Throws [A2uiCatalogError] if the schema is malformed or if [catalogId]
  /// conflicts with it, and [A2uiValidationError] if it declares an
  /// unsupported protocol version or one conflicting with [protocolVersion].
  @override
  Catalog<CatalogComponent, CatalogFunction> load() => Catalog.fromJson(
    catalog,
    expectedProtocolVersion: protocolVersion,
    expectedCatalogId: catalogId,
  );
}
