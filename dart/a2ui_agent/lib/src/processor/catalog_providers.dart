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

import 'package:a2ui_core/a2ui_core.dart';

import 'text_file_stub.dart' if (dart.library.io) 'text_file_io.dart';

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
///
/// Reading a file needs `dart:io`, so on the web [load] throws
/// [A2uiCatalogError]; use an [InMemoryCatalogProvider] there.
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
  SchemaCatalog load() {
    final String text;
    try {
      text = readTextFile(path);
    } on Exception catch (e) {
      throw A2uiCatalogError(
        "Cannot read the catalog document '$path': $e",
        catalogId: catalogId,
      );
    }
    final Object? document;
    try {
      document = jsonDecode(text);
    } on FormatException catch (e) {
      throw A2uiCatalogError(
        "The catalog document '$path' is not JSON: ${e.message}",
        catalogId: catalogId,
      );
    }
    if (document is! Map<String, Object?>) {
      throw A2uiCatalogError(
        "The catalog document '$path' is not a JSON object.",
        catalogId: catalogId,
      );
    }
    return _load(
      document,
      protocolVersion: protocolVersion,
      catalogId: catalogId,
      source: "'$path'",
    );
  }
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
  SchemaCatalog load() => _load(
    catalog,
    protocolVersion: protocolVersion,
    catalogId: catalogId,
    source: 'The in-memory catalog document',
  );
}

/// Parses [document] after settling its id and protocol version with the
/// provider's [catalogId] and [protocolVersion].
///
/// [source] names the document in error messages.
SchemaCatalog _load(
  Map<String, Object?> document, {
  required A2uiProtocolVersion? protocolVersion,
  required String? catalogId,
  required String source,
}) {
  final String id = _settleId(document, catalogId, source);
  _checkVersion(document, protocolVersion, source, id);
  return Catalog.fromJson({...document, 'catalogId': id});
}

String _settleId(
  Map<String, Object?> document,
  String? catalogId,
  String source,
) {
  final Object? declared = document['catalogId'];
  if (declared != null && (declared is! String || declared.isEmpty)) {
    throw A2uiCatalogError(
      "$source declares a 'catalogId' that is not a non-empty string.",
      catalogId: catalogId,
    );
  }
  if (declared is String && catalogId != null && declared != catalogId) {
    throw A2uiCatalogError(
      "$source declares catalog id '$declared', but the provider was given "
      "'$catalogId'.",
      catalogId: declared,
    );
  }
  return declared as String? ??
      catalogId ??
      (throw A2uiCatalogError(
        "$source declares no 'catalogId' and the provider was given none, so "
        'nothing names the catalog.',
      ));
}

/// Checks that the document is written against v0.9, the only version this
/// SDK implements.
///
/// A document spells its version as the bare number, such as `0.9`; the
/// wire spelling `v0.9` is accepted too. v0.9.1 shares v0.9's schemas.
void _checkVersion(
  Map<String, Object?> document,
  A2uiProtocolVersion? protocolVersion,
  String source,
  String id,
) {
  final Object? declared = document['protocolVersion'];
  if (declared == null) {
    if (protocolVersion == null) {
      throw A2uiCatalogError(
        "$source declares no 'protocolVersion' and the provider was given "
        'none, so nothing states which protocol it is written against. Give '
        'the provider A2uiProtocolVersion.v0_9 to load a v0.9 document.',
        catalogId: id,
      );
    }
    return;
  }
  if (declared is! String) {
    throw A2uiCatalogError(
      "$source declares a 'protocolVersion' that is not a string.",
      catalogId: id,
    );
  }
  final String number = declared.startsWith('v')
      ? declared.substring(1)
      : declared;
  final A2uiProtocolVersion? version = switch (number) {
    '0.9' || '0.9.1' => A2uiProtocolVersion.v0_9,
    _ => null,
  };
  if (protocolVersion != null && version != protocolVersion) {
    throw A2uiCatalogError(
      "$source declares protocol version '$declared', but the provider was "
      "given '${protocolVersion.jsonValue}'.",
      catalogId: id,
    );
  }
  if (version == null) {
    throw A2uiCatalogError(
      "$source declares protocol version '$declared'; this SDK supports only "
      '${A2uiProtocolVersion.supportedVersions}.',
      catalogId: id,
    );
  }
}
