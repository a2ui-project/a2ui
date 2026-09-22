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

import {describe, it, expect, vi, afterEach} from 'vitest';
import * as fs from 'fs';
import {CatalogConfig} from '../../../src/processor/catalog_config.js';
import {CatalogTransformer} from '../../../src/catalog_transformers/base.js';
import {Catalog} from '../../../src/internal/web_core.js';

describe('CatalogConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseCatalog = new Catalog('base', [], []);

  it('transformedCatalog applies transformers in order', () => {
    const log: string[] = [];
    const t1: CatalogTransformer = {
      transform: () => {
        log.push('t1');
        return new Catalog('t1_applied', [], []);
      },
    };
    const t2: CatalogTransformer = {
      transform: () => {
        log.push('t2');
        return new Catalog('t2_applied', [], []);
      },
    };

    const config = new CatalogConfig(baseCatalog, [t1, t2]);
    const result = config.transformedCatalog;

    expect(result.id).toBe('t2_applied');
    expect(log).toEqual(['t1', 't2']);
  });

  it('transformedCatalog is memoized', () => {
    let callCount = 0;
    const t1: CatalogTransformer = {
      transform: () => {
        callCount++;
        return new Catalog('t1_applied', [], []);
      },
    };

    const config = new CatalogConfig(baseCatalog, [t1]);
    const first = config.transformedCatalog;
    const second = config.transformedCatalog;

    expect(first).toBe(second);
    expect(callCount).toBe(1);
  });

  it('fromPath loads catalog and creates config', async () => {
    const validSchemaStr = JSON.stringify({
      catalogId: 'fs_catalog',
      components: {},
      functions: {},
    });
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(validSchemaStr);

    const config = await CatalogConfig.fromPath('dummy.json');
    expect(config.catalog.id).toBe('fs_catalog');
    expect(config.transformedCatalog).toBe(config.catalog);
  });
});
