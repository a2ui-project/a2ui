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

import {A2uiCatalogError, CatalogApi} from '../internal/web-core.js';
import {toWireProtocolVersion} from './protocol-version.js';

/**
 * Checks that catalogs target the same release line and returns it.
 *
 * @throws {A2uiCatalogError} If no catalogs are provided or they target different protocol versions.
 */
export function checkParserCatalogs(catalogs: CatalogApi[]): string {
  if (!catalogs || catalogs.length === 0) {
    throw new A2uiCatalogError('Parser requires at least one catalog.');
  }

  const seenCatalogIds = new Set<string>();
  const releaseLines = new Set<string>();
  for (const catalog of catalogs) {
    if (seenCatalogIds.has(catalog.id)) {
      throw new A2uiCatalogError(`Duplicate catalog ID '${catalog.id}' provided.`);
    }
    seenCatalogIds.add(catalog.id);
    const wireVersion = toWireProtocolVersion(catalog.protocolVersion || '1.0');
    let releaseLine = wireVersion;
    if (wireVersion === 'v0.9.1' || wireVersion === 'v0.9') {
      releaseLine = 'v0.9';
    }
    releaseLines.add(releaseLine);
  }

  if (releaseLines.size > 1) {
    throw new A2uiCatalogError(
      `The catalogs target incompatible protocol versions: ${Array.from(releaseLines).sort().join(', ')}.`,
    );
  }

  return toWireProtocolVersion(catalogs[0].protocolVersion || '1.0');
}
