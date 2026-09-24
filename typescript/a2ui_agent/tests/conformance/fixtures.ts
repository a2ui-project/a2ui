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
import {CatalogConfig, InMemoryCatalogProvider} from '../../src/index.js';
import * as path from 'path';
import {SchemaCatalog, ProtocolVersion} from '../../src/types.js';
import {CatalogTransformer} from '../../src/catalog_transformers/base.js';
import {Catalog} from '../../src/internal/web_core.js';
import {toWireProtocolVersion} from '../../src/utils/protocol_version.js';
import {CONFORMANCE_ROOT} from './loader.js';

export async function createCatalogConfig(
  catalogData: Record<string, unknown>,
): Promise<CatalogConfig> {
  const version = toWireProtocolVersion(catalogData.protocolVersion as string | undefined);

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
  return new CatalogConfig(await provider.load());
}

export async function createFileCatalogConfig(
  relPath: string,
  modifiers: string[] = [],
): Promise<CatalogConfig> {
  const fullPath = path.resolve(CONFORMANCE_ROOT, relPath);
  const transformers: CatalogTransformer[] = [];
  if (modifiers.includes('remove_strict_validation')) {
    transformers.push(new RemoveStrictValidationTransformer());
  }
  return await CatalogConfig.fromPath(fullPath, transformers);
}

/**
 * TEMPORARY: RemoveStrictValidationTransformer
 * TODO(web_core) Implement common schema modifiers in web_core
 * Removal steps:
 * 1. Wait for @a2ui/web_core to export `RemoveStrictValidationTransformer`.
 * 2. Delete this class.
 * 3. Import `RemoveStrictValidationTransformer` from `../../src/internal/web_core.js`.
 */
export class RemoveStrictValidationTransformer implements CatalogTransformer {
  transform(catalog: SchemaCatalog): SchemaCatalog {
    const newComponents = Array.from(catalog.components.values()).map(c => {
      const newC = {...c};
      // Safely access .passthrough() from Zod 3.x schema objects avoiding `any`
      // If this method doesn't exist in a future zod version, it will break tests loudly,
      // which is the preferred behavior so tests don't silently become no-ops.
      interface ZodObjectLike {
        passthrough(): unknown;
      }
      if (newC.schema && 'passthrough' in newC.schema) {
        newC.schema = (newC.schema as unknown as ZodObjectLike).passthrough() as typeof newC.schema;
      }
      return newC;
    });

    const functions = Array.from(catalog.functions.values());
    return new Catalog(
      catalog.id,
      newComponents,
      functions,
      catalog.themeSchema,
      catalog.instructions,
      catalog.protocolVersion,
    );
  }
}
