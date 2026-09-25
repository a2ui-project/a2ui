/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Catalog handling shared by the Express compiler, decompiler, parser and format.
 */

import {A2uiCatalogError} from '../../errors.js';
import {SchemaCatalog} from '../../types.js';
import {toWireProtocolVersion} from '../../utils/protocol_version.js';
import {CatalogSchemaHelper} from './schema_helper.js';

/**
 * Normalizes the catalogs argument of the Express classes, which accept either one
 * catalog or a list of them.
 *
 * @param catalogs One catalog or a non-empty list of catalogs.
 * @returns The catalogs as a list.
 * @throws A2uiCatalogError if the list is empty.
 */
export function toCatalogList(catalogs: SchemaCatalog | SchemaCatalog[]): SchemaCatalog[] {
  const list = Array.isArray(catalogs) ? catalogs : [catalogs];
  if (list.length === 0) {
    throw new A2uiCatalogError('Express requires at least one catalog.');
  }
  return list;
}

/**
 * Returns the wire protocol version Express should emit for a set of catalogs.
 *
 * All catalogs must share one protocol version, because an Express block compiles to
 * messages of a single version. A requested version must match it.
 *
 * @param catalogs The active catalogs (non-empty).
 * @param requested An explicitly requested version, if any.
 * @returns The protocol version shared by the catalogs.
 * @throws A2uiCatalogError if the catalogs disagree or the requested version differs.
 */
export function resolveExpressVersion(catalogs: SchemaCatalog[], requested?: string): string {
  const version = toWireProtocolVersion(catalogs[0].protocolVersion);
  for (const catalog of catalogs) {
    const other = toWireProtocolVersion(catalog.protocolVersion);
    if (other !== version) {
      throw new A2uiCatalogError(
        `Express catalogs must share one protocol version, but '${catalogs[0].id}' is '${version}' and '${catalog.id}' is '${other}'.`,
      );
    }
  }
  if (requested && requested !== version) {
    throw new A2uiCatalogError(
      `Requested protocol version '${requested}' does not match catalog version '${version}'`,
    );
  }
  return version;
}

/**
 * Builds one schema helper per catalog, keyed by catalog id.
 *
 * @param catalogs The active catalogs.
 * @param version The protocol version the helpers read the schemas for.
 * @returns The helpers, in catalog order.
 */
export function buildSchemaHelpers(
  catalogs: SchemaCatalog[],
  version: string,
): Map<string, CatalogSchemaHelper> {
  return new Map(catalogs.map(catalog => [catalog.id, new CatalogSchemaHelper(catalog, version)]));
}
