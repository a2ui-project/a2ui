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
/// There is deliberately no bundled provider: an agent's catalogs come from
/// disk, from memory, or inline from the renderer.
///
/// A provider parses a catalog document, so it always yields a schema-only
/// [SchemaCatalog]; binding executable functions or widgets to a catalog is a
/// renderer's job.
abstract class CatalogProvider {
  const CatalogProvider();

  /// Loads and returns the catalog.
  SchemaCatalog load();
}

/// Checks the `protocolVersion` a catalog document declares.
///
/// A catalog document is version-agnostic to `a2ui_core`, which ignores the
/// field rather than checking it, so the gate lives here: this SDK implements
/// v0.9 only, and refuses to register a catalog written for anything else.
///
/// A document that declares no version is accepted and takes [expected], or
/// v0.9 when the caller named none.
///
/// Throws [A2uiValidationError] if the declared version is one this SDK does
/// not implement, or conflicts with [expected].
void _checkProtocolVersion(
  Map<String, Object?> document,
  A2uiProtocolVersion? expected,
) {
  final Object? declared = document['protocolVersion'];
  if (declared == null) return;
  final A2uiProtocolVersion version = A2uiProtocolVersion.fromJson(
    declared,
    details: document,
  );
  if (expected != null && version != expected) {
    throw A2uiValidationError(
      "Catalog protocol version mismatch: expected '${expected.jsonValue}' "
      "but the document declares '${version.jsonValue}'.",
      details: document,
    );
  }
}

/// Loads a catalog definition from a JSON file on the local filesystem.
class FileSystemCatalogProvider extends CatalogProvider {
  /// The path to the catalog JSON file.
  final String path;

  /// The protocol version the loaded catalog is expected to declare.
  ///
  /// A catalog document need not declare one; this constrains it when it does.
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
  /// Throws [A2uiCatalogError] if the file is missing, is not a JSON object,
  /// or conflicts with [catalogId], and [A2uiValidationError] if the version it
  /// declares is unsupported or conflicts with [protocolVersion].
  @override
  SchemaCatalog load() {
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
    _checkProtocolVersion(decoded, protocolVersion);
    return Catalog.fromJson(decoded, expectedCatalogId: catalogId);
  }
}

/// Loads a catalog definition from an in-memory schema map.
class InMemoryCatalogProvider extends CatalogProvider {
  /// The raw catalog schema.
  final Map<String, Object?> catalog;

  /// The protocol version the catalog is expected to declare.
  ///
  /// A catalog document need not declare one; this constrains it when it does.
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
  /// Throws [A2uiCatalogError] if the schema is malformed or conflicts with
  /// [catalogId], and [A2uiValidationError] if the version it declares is
  /// unsupported or conflicts with [protocolVersion].
  @override
  SchemaCatalog load() {
    _checkProtocolVersion(catalog, protocolVersion);
    return Catalog.fromJson(catalog, expectedCatalogId: catalogId);
  }
}
