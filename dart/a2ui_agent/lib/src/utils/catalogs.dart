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
/// Catalogs of versions that share message shapes, such as v0.9 and v0.9.1,
/// mix: they target the earliest of their versions, whose messages each of
/// them accepts (see [isCatalogVersionCompatible]).
///
/// Throws [A2uiCatalogError] if [catalogs] is empty, since nothing then
/// states a version, or if they target versions whose messages differ, since
/// a payload is written against one.
A2uiProtocolVersion catalogsProtocolVersion(List<CatalogApi> catalogs) {
  if (catalogs.isEmpty) {
    throw A2uiCatalogError('No catalog states a protocol version.');
  }
  final List<A2uiProtocolVersion> versions = {
    for (final CatalogApi catalog in catalogs)
      catalog.protocolVersion ?? A2uiProtocolVersion.v0_9,
  }.toList()..sort();
  final A2uiProtocolVersion earliest = versions.first;
  if (!versions.every(
    (v) => isCatalogVersionCompatible(v.jsonValue, earliest.jsonValue),
  )) {
    throw A2uiCatalogError(
      'The catalogs target different protocol versions: '
      '${versions.map((v) => v.semverValue).toList()}.',
    );
  }
  return earliest;
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

/// Checks that [catalogs] have distinct ids and, if several catalogs are given,
/// that they target A2UI v1.0 or later.
///
/// In Express, when several catalogs are active, components and function calls
/// carry per-item `catalogId` fields, which requires A2UI v1.0 or later.
///
/// Throws [A2uiCatalogError] if any catalog id repeats, or if several catalogs
/// target a version before v1.0.
void checkMixedCatalogs(List<CatalogApi> catalogs) {
  checkDistinctIds(catalogs);
  if (catalogs.length > 1) {
    final A2uiProtocolVersion version = catalogsProtocolVersion(catalogs);
    if (!version.isAtLeast(A2uiProtocolVersion.v1_0)) {
      throw A2uiCatalogError(
        'Several catalogs need A2UI v1.0 or later, where components and '
        'function calls carry their own catalogId, but got '
        '${version.semverValue}.',
      );
    }
  }
}

/// The functions of [catalogs] the agent may ask the renderer to run with
/// `callRendererFunction`: those whose `allowedCallers` admits the agent, and
/// which need no user activation, which a call from the agent never has.
List<String> agentCallableFunctions(List<CatalogApi> catalogs) {
  final seen = <String>{};
  return [
    for (final CatalogApi catalog in catalogs)
      if ((catalog.protocolVersion ?? A2uiProtocolVersion.v0_9).isAtLeast(
        A2uiProtocolVersion.v1_0,
      ))
        for (final FunctionApi function in catalog.functions.values)
          if ((function.allowedCallers == AllowedCallers.agentOnly ||
                  function.allowedCallers == AllowedCallers.rendererOrAgent) &&
              !function.requiresUserActivation &&
              seen.add(function.name))
            function.name,
  ];
}
