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

import {CatalogConfig, InMemoryCatalogProvider} from '../../src/index.js';
import * as path from 'path';
import {SchemaCatalog, ProtocolVersion} from '../../src/types.js';
import {CatalogTransformer} from '../../src/catalog_transformers/base.js';
import {Catalog} from '../../src/internal/web_core.js';
import {CONFORMANCE_ROOT} from './loader.js';

export async function createCatalogConfig(
  catalogData: Record<string, unknown>,
): Promise<CatalogConfig> {
  const rawVersion = (catalogData.protocolVersion as string) || 'v1.0';
  const version = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`;

  const catalogSchema = (catalogData.catalogSchema || {}) as Record<string, unknown>;
  const name = (catalogData.name as string) || 'test_catalog';

  const provider = new InMemoryCatalogProvider(
    {
      $id: name,
      components: catalogSchema.components || {},
      functions: catalogSchema.functions || {},
    },
    version as ProtocolVersion,
    name,
  );

  const catalog = await provider.load();
  return new CatalogConfig(catalog);
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
