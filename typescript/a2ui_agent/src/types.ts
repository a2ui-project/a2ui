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

import * as fs from 'fs';
import {Catalog, ComponentApi, FunctionApi, ProtocolVersion} from './internal/web_core.js';
import {A2uiCatalogError} from './errors.js';
import {toWireProtocolVersion} from './utils/protocol_version.js';
import {getBasicCatalogPath} from './utils/catalog_path.js';

export type {ProtocolVersion} from './internal/web_core.js';

/**
 * A schema-only parameterization of the A2UI Catalog.
 *
 * An agent never executes catalog functions, so it only needs their signatures.
 * This type aliases `Catalog<ComponentApi, FunctionApi>` to reflect that.
 */
export type SchemaCatalog = Catalog<ComponentApi, FunctionApi>;

const _basicCatalogMemoMap = new Map<string, SchemaCatalog>();

/**
 * Returns the basic catalog for a protocol version as a `SchemaCatalog`.
 *
 * The catalog instance is built once per protocol version and memoized for reuse.
 *
 * @remarks
 * Built from the catalog JSON that `@a2ui/web_core` ships, rather than from its compiled
 * component constants, because the JSON is the only source that carries the catalog
 * `instructions`.
 *
 * @param protocolVersion The protocol version to load. Defaults to `'v1.0'`.
 * @returns The memoized basic catalog.
 * @throws {A2uiCatalogError} If no catalog ships for the version, or loading fails.
 */
export function basicCatalog(protocolVersion: ProtocolVersion = 'v1.0'): SchemaCatalog {
  const version = toWireProtocolVersion(protocolVersion);

  const memoized = _basicCatalogMemoMap.get(version);
  if (memoized) {
    return memoized;
  }

  const catalogPath = getBasicCatalogPath(version);

  let content: string;
  try {
    content = fs.readFileSync(catalogPath, 'utf8');
  } catch (e: unknown) {
    throw new A2uiCatalogError(
      `Failed to read basic catalog file at ${catalogPath}: ${(e as Error).message}`,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch (e: unknown) {
    throw new A2uiCatalogError(
      `Failed to parse JSON in basic catalog file at ${catalogPath}: ${(e as Error).message}`,
    );
  }

  // The JSON spells the version without the `v` prefix, and the v0.9 catalog omits it
  // altogether, so the requested version is what gets stamped on the catalog. Guard against
  // loading the wrong file by rejecting a JSON that names a different version.
  const declared = parsed.protocolVersion;
  if (typeof declared === 'string' && toWireProtocolVersion(declared) !== version) {
    throw new A2uiCatalogError(
      `Basic catalog at ${catalogPath} declares protocol version '${declared}', expected '${version}'.`,
    );
  }
  parsed.protocolVersion = version;

  let catalog: SchemaCatalog;
  try {
    catalog = Catalog.fromSchema(parsed);
  } catch (e: unknown) {
    throw new A2uiCatalogError(
      `Failed to build basic catalog from schema at ${catalogPath}: ${(e as Error).message}`,
    );
  }

  _basicCatalogMemoMap.set(version, catalog);
  return catalog;
}
