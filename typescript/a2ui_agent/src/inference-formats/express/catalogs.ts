/*
 * Copyright 2024 Google LLC
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
import {CatalogApi, compareSemVer} from '../../internal/web-core.js';
import {toWireProtocolVersion} from '../../utils/protocol-version.js';
import {CatalogSchemaHelper} from './schema-helper.js';

/**
 * Normalizes the catalogs argument of the Express classes, which accept either one
 * catalog or a list of them.
 *
 * @param catalogs One catalog or a non-empty list of catalogs.
 * @returns The catalogs as a list.
 * @throws A2uiCatalogError if the list is empty.
 */
export function toCatalogList(catalogs: CatalogApi | CatalogApi[]): CatalogApi[] {
  const list = Array.isArray(catalogs) ? catalogs : [catalogs];
  if (list.length === 0) {
    throw new A2uiCatalogError('Express requires at least one catalog.');
  }
  return list;
}

/**
 * Returns the release line (`major.minor`) of a wire protocol version, so that patch
 * releases such as `v0.9.1` compare equal to `v0.9`.
 */
function versionLine(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}

/**
 * Checks that all catalogs share one protocol release line and have unique IDs,
 * and that multi-catalog configurations target v1.0 or later.
 *
 * @param catalogs The active catalogs (non-empty).
 * @returns The first catalog's wire protocol version.
 * @throws A2uiCatalogError if catalog IDs are duplicated, versions span release lines,
 *     or multiple catalogs are used below v1.0.
 */
export function checkMixedCatalogs(catalogs: CatalogApi[]): string {
  if (catalogs.length === 0) {
    throw new A2uiCatalogError('Express requires at least one catalog.');
  }
  const version = toWireProtocolVersion(catalogs[0].protocolVersion);
  const line = versionLine(version);
  const seenIds = new Set<string>();
  for (const catalog of catalogs) {
    if (seenIds.has(catalog.id)) {
      throw new A2uiCatalogError(`Duplicate catalog ID: '${catalog.id}'`);
    }
    seenIds.add(catalog.id);
    const other = toWireProtocolVersion(catalog.protocolVersion);
    if (versionLine(other) !== line) {
      throw new A2uiCatalogError(
        `Express catalogs must share one protocol version, but '${catalogs[0].id}' is '${version}' and '${catalog.id}' is '${other}'.`,
      );
    }
  }
  if (catalogs.length > 1 && compareSemVer(line, '1.0.0') < 0) {
    throw new A2uiCatalogError(
      `Several catalogs need A2UI v1.0 or later, where components and function calls carry their own catalogId, but got '${line}'.`,
    );
  }
  return version;
}

/**
 * Returns the wire protocol version Express should emit for a set of catalogs.
 *
 * An Express block compiles to messages of a single version, so all catalogs must
 * belong to one release line (`v0.9` and `v0.9.1` do; `v0.9` and `v1.0` don't). A
 * requested version must be on that line too. Crossing lines would produce, for
 * example, a v1.0 `createSurface` that names a v0.9 catalog.
 *
 * @param catalogs The active catalogs (non-empty).
 * @param requested An explicitly requested version, if any.
 * @returns The requested version, or the first catalog's version.
 * @throws A2uiCatalogError if the catalogs, or the requested version, span release lines.
 */
export function resolveExpressVersion(catalogs: CatalogApi[], requested?: string): string {
  const version = checkMixedCatalogs(catalogs);
  if (!requested) {
    return version;
  }
  const target = toWireProtocolVersion(requested);
  if (versionLine(target) !== versionLine(version)) {
    throw new A2uiCatalogError(
      `Requested protocol version '${requested}' does not match catalog version '${version}'`,
    );
  }
  return target;
}

/**
 * Returns the catalogId to put on `createSurface`, or `undefined` when several catalogs are active.
 *
 * With one active catalog, the surface is bound to it on `createSurface` and its
 * components need no `catalogId`. With several, the surface is not bound to one
 * catalog; components and function calls carry their own `catalogId`.
 */
export function surfaceCatalogId(catalogs: CatalogApi[]): string | undefined {
  return catalogs.length === 1 ? catalogs[0].id : undefined;
}

/**
 * Returns the catalog IDs (in catalog order) whose helper defines the component or function `name`.
 */
export function catalogsDefining(
  helpers: ReadonlyMap<string, CatalogSchemaHelper>,
  kind: 'component' | 'function',
  name: string,
): string[] {
  const result: string[] = [];
  for (const [cid, helper] of helpers.entries()) {
    const defs = kind === 'component' ? helper.components : helper.functions;
    if (defs.has(name)) {
      result.push(cid);
    }
  }
  return result;
}

/**
 * Builds one schema helper per catalog, keyed by catalog id.
 *
 * @param catalogs The active catalogs.
 * @param version The protocol version the helpers read the schemas for.
 * @returns The helpers, in catalog order.
 */
export function buildSchemaHelpers(
  catalogs: CatalogApi[],
  version: string,
): Map<string, CatalogSchemaHelper> {
  return new Map(catalogs.map(catalog => [catalog.id, new CatalogSchemaHelper(catalog, version)]));
}
