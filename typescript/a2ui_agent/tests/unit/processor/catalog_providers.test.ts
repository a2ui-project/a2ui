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
import {
  InMemoryCatalogProvider,
  FileSystemCatalogProvider,
} from '../../../src/processor/catalog_providers.js';
import {A2uiCatalogError} from '../../../src/errors.js';

describe('Catalog Providers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('InMemoryCatalogProvider', () => {
    const validSchema = {
      catalogId: 'test_catalog',
      protocolVersion: '1.0',
      components: {},
      functions: {},
    };

    it('loads successfully when metadata matches exactly', async () => {
      const provider = new InMemoryCatalogProvider(validSchema, 'v1.0', 'test_catalog');
      const catalog = await provider.load();
      expect(catalog.id).toBe('test_catalog');
      // The parsed protocol version from schema keeps its original value
      expect(catalog.protocolVersion).toBe('1.0');
    });

    it('loads successfully when protocolVersion is passed as 1.0 without v', async () => {
      // Testing explicit string coercion behavior
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider = new InMemoryCatalogProvider(validSchema, '1.0' as any, 'test_catalog');
      const catalog = await provider.load();
      expect(catalog.id).toBe('test_catalog');
    });

    it('throws A2uiCatalogError on catalog ID mismatch', async () => {
      const provider = new InMemoryCatalogProvider(validSchema, 'v1.0', 'wrong_id');
      await expect(provider.load()).rejects.toThrow(A2uiCatalogError);
    });

    it('throws A2uiCatalogError on protocol version mismatch', async () => {
      // Testing explicit string coercion behavior
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider = new InMemoryCatalogProvider(validSchema, 'v0.9' as any, 'test_catalog');
      await expect(provider.load()).rejects.toThrow(A2uiCatalogError);
    });
  });

  describe('FileSystemCatalogProvider', () => {
    const validSchemaStr = JSON.stringify({
      catalogId: 'fs_catalog',
      protocolVersion: '1.0',
      components: {},
      functions: {},
    });

    it('loads successfully from file', async () => {
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue(validSchemaStr);
      const provider = new FileSystemCatalogProvider('dummy.json', 'v1.0', 'fs_catalog');
      const catalog = await provider.load();
      expect(catalog.id).toBe('fs_catalog');
    });

    it('throws A2uiCatalogError if file read fails', async () => {
      vi.spyOn(fs.promises, 'readFile').mockRejectedValue(new Error('ENOENT'));
      const provider = new FileSystemCatalogProvider('missing.json');
      await expect(provider.load()).rejects.toThrow(A2uiCatalogError);
    });

    it('throws A2uiCatalogError if JSON parsing fails', async () => {
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue('{ invalid json');
      const provider = new FileSystemCatalogProvider('dummy.json');
      await expect(provider.load()).rejects.toThrow(A2uiCatalogError);
    });
  });
});
