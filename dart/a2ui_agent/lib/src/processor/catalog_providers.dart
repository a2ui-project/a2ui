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

/// Turns a catalog document into a catalog an agent can register.
///
/// The providers in this package take an optional catalog id and protocol
/// version. Each is both a default and an assertion: when the document
/// declares the same field, the two must agree or the load fails; when the
/// document declares nothing, the provider's value is used.
///
/// Neither has a fallback, so a load fails when nothing names the catalog or
/// states its version. Catalog documents before v1.0 declare no version, so a
/// provider loading a v0.9 document is given [A2uiProtocolVersion.v0_9].
abstract class CatalogProvider {
  const CatalogProvider();

  /// Loads the catalog.
  ///
  /// Throws [A2uiCatalogError] for every failure: a document that cannot be
  /// read or is not JSON, a declaration that conflicts with the provider's,
  /// a version other than v0.9, or an id or version that nothing states.
  SchemaCatalog load();
}

/// Loads a catalog from a JSON document on the file system.
class FileSystemCatalogProvider extends CatalogProvider {
  const FileSystemCatalogProvider(
    this.path, {
    this.protocolVersion,
    this.catalogId,
  });

  /// The path of the catalog document, absolute or relative to the working
  /// directory.
  final String path;

  /// The protocol version the document is written against.
  final A2uiProtocolVersion? protocolVersion;

  /// The id of the catalog.
  final String? catalogId;

  @override
  SchemaCatalog load() =>
      throw UnimplementedError('FileSystemCatalogProvider.load');
}

/// Loads a catalog from a decoded JSON document.
class InMemoryCatalogProvider extends CatalogProvider {
  const InMemoryCatalogProvider(
    this.catalog, {
    this.protocolVersion,
    this.catalogId,
  });

  /// The catalog document.
  final Map<String, Object?> catalog;

  /// The protocol version the document is written against.
  final A2uiProtocolVersion? protocolVersion;

  /// The id of the catalog.
  final String? catalogId;

  @override
  SchemaCatalog load() =>
      throw UnimplementedError('InMemoryCatalogProvider.load');
}
