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

/// The protocol version [catalogs] target, which is the version of every
/// message a format prompts for, reads and writes with them.
///
/// A catalog that declares no version predates the field, which v1.0 added,
/// so it targets v0.9.
///
/// Throws [A2uiCatalogError] if [catalogs] is empty, since nothing then
/// states a version, or if they target different versions, since a payload is
/// written against one.
A2uiProtocolVersion catalogsProtocolVersion(List<CatalogApi> catalogs) {
  if (catalogs.isEmpty) {
    throw A2uiCatalogError('No catalog states a protocol version.');
  }
  final Set<A2uiProtocolVersion> versions = {
    for (final CatalogApi catalog in catalogs)
      catalog.protocolVersion ?? A2uiProtocolVersion.v0_9,
  };
  if (versions.length > 1) {
    throw A2uiCatalogError(
      'The catalogs target different protocol versions: '
      '${versions.map((v) => v.semverValue).toList()..sort()}.',
    );
  }
  return versions.single;
}

/// Checks that no two of [catalogs] share an id.
///
/// A format binds each catalog by its id: a surface or a component names its
/// catalog by id, so with two catalogs of one id it could not say which.
///
/// Throws [A2uiCatalogError] naming the first id that repeats.
void checkDistinctIds(List<CatalogApi> catalogs) {
  final ids = <String>{};
  for (final catalog in catalogs) {
    if (!ids.add(catalog.id)) {
      throw A2uiCatalogError(
        "Catalog '${catalog.id}' is bound twice, so its id cannot say which "
        'of the two it names.',
        catalogId: catalog.id,
      );
    }
  }
}
