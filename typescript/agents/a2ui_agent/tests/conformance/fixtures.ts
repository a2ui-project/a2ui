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
import * as path from 'path';

import {CatalogConfig, InMemoryCatalogProvider} from '../../src/index.js';
import {ProtocolVersion} from '../../src/types.js';
import {toWireProtocolVersion} from '../../src/utils/protocol-version.js';
import {CONFORMANCE_ROOT} from './loader.js';

export function createCatalogConfig(catalogData: Record<string, unknown>): CatalogConfig {
  // Legacy cases that state no version have always run as v1.0 here. The SDK has no default
  // version, so the harness states it.
  const version = toWireProtocolVersion(
    (catalogData.protocolVersion as string | undefined) ?? 'v1.0',
  );

  // Cases give the catalog either inline or as a path relative to the conformance root.
  let catalogSchema: Record<string, unknown>;
  if (typeof catalogData.catalogSchema === 'string') {
    catalogSchema = JSON.parse(
      fs.readFileSync(path.resolve(CONFORMANCE_ROOT, catalogData.catalogSchema), 'utf8'),
    ) as Record<string, unknown>;
  } else {
    catalogSchema = (catalogData.catalogSchema || {}) as Record<string, unknown>;
  }

  // Cases also declare `commonTypesSchema` and `s2cSchema`, pointing at simplified schemas
  // under `conformance/test_data/`. They are deliberately not threaded through. The SDK
  // validates envelopes against the zod schemas web_core generates from the protocol's own
  // JSON, selected by the catalog's protocol version. Honouring an arbitrary per-case JSON
  // Schema would need a general JSON Schema validator, which this SDK does not depend on.
  //
  // The outcome is the same for every case that exercises validation, because the real
  // v0.9 schema carries the constraints the simplified ones test: `catalogId` is required
  // on `createSurface`, `components` has `minItems: 1`, and unknown message keys are
  // rejected. A future case relying on a constraint only its simplified schema carries
  // would fail here, and that would be the signal to revisit this.

  const name =
    (catalogData.name as string) ||
    (catalogSchema.catalogId as string) ||
    (catalogSchema.$id as string) ||
    'test_catalog';

  // Spread the whole catalog schema rather than picking out components and functions. Cases
  // rely on sibling keys, notably `$defs.anyComponent`, which drives component filtering.
  const schemaToLoad: Record<string, unknown> = {
    $id: name,
    protocolVersion: version,
    ...catalogSchema,
    components: catalogSchema.components || {},
    functions: catalogSchema.functions || {},
  };

  const provider = new InMemoryCatalogProvider(schemaToLoad, version as ProtocolVersion, name);
  return new CatalogConfig(provider.load());
}

export function createFileCatalogConfig(relPath: string): CatalogConfig {
  const fullPath = path.resolve(CONFORMANCE_ROOT, relPath);
  // The legacy suite's catalog files state no protocol version. They used to load as v0.9
  // through web_core's default, and the SDK no longer has a default, so the harness states it
  // for files that give none. The Express suite's catalog files state their own version.
  const document = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as Record<string, unknown>;
  const fallbackVersion = document.protocolVersion === undefined ? 'v0.9' : undefined;
  return CatalogConfig.fromPath(fullPath, [], fallbackVersion);
}
