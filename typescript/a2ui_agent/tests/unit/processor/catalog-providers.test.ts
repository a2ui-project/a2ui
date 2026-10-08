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

import {describe, expect, it} from 'vitest';

import {A2uiCatalogError} from '../../../src/errors.js';
import {
  FileSystemCatalogProvider,
  InMemoryCatalogProvider,
} from '../../../src/processor/catalog-providers.js';
import {conformancePath} from '../../conformance/suite-helpers.js';

describe('Catalog Providers', () => {
  describe('InMemoryCatalogProvider', () => {
    const validSchema = {
      catalogId: 'test_catalog',
      protocolVersion: '1.0',
      components: {},
      functions: {},
    };

    it('loads successfully when metadata matches exactly', () => {
      const provider = new InMemoryCatalogProvider(validSchema, 'v1.0', 'test_catalog');
      const catalog = provider.load();
      expect(catalog.id).toBe('test_catalog');
      // The catalog reports the version in the wire form, whatever the document spells.
      expect(catalog.protocolVersion).toBe('v1.0');
    });

    it('fills in the id and version a document leaves out', () => {
      const provider = new InMemoryCatalogProvider({components: {}}, 'v0.9', 'provided');
      const catalog = provider.load();
      expect(catalog.id).toBe('provided');
      expect(catalog.protocolVersion).toBe('v0.9');
    });

    it('does not treat $id as the catalog id', () => {
      const provider = new InMemoryCatalogProvider(
        {$id: 'https://example.com/catalog.json', components: {}},
        'v1.0',
      );
      expect(() => provider.load()).toThrow(A2uiCatalogError);
    });

    it('throws A2uiCatalogError when nothing states a protocol version', () => {
      const provider = new InMemoryCatalogProvider({catalogId: 'no_version', components: {}});
      expect(() => provider.load()).toThrow(A2uiCatalogError);
    });

    it('loads successfully when protocolVersion is passed as 1.0 without v', () => {
      // Testing explicit string coercion behavior
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider = new InMemoryCatalogProvider(validSchema, '1.0' as any, 'test_catalog');
      const catalog = provider.load();
      expect(catalog.id).toBe('test_catalog');
    });

    it('throws A2uiCatalogError on catalog ID mismatch', () => {
      const provider = new InMemoryCatalogProvider(validSchema, 'v1.0', 'wrong_id');
      expect(() => provider.load()).toThrow(A2uiCatalogError);
    });

    it('throws A2uiCatalogError on protocol version mismatch', () => {
      // Testing explicit string coercion behavior
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider = new InMemoryCatalogProvider(validSchema, 'v0.9' as any, 'test_catalog');
      expect(() => provider.load()).toThrow(A2uiCatalogError);
    });
  });

  describe('FileSystemCatalogProvider', () => {
    it('loads successfully from file', () => {
      const provider = new FileSystemCatalogProvider(
        conformancePath('test_data/catalogs/simplified_catalog_v1_0.json'),
        'v1.0',
        'conformance/simplified',
      );
      const catalog = provider.load();
      expect(catalog.id).toBe('conformance/simplified');
    });

    it('throws A2uiCatalogError if file read fails', () => {
      const provider = new FileSystemCatalogProvider(
        conformancePath('test_data/catalogs/catalog_not_here.json'),
      );
      expect(() => provider.load()).toThrow(A2uiCatalogError);
    });

    it('throws A2uiCatalogError if JSON parsing fails', () => {
      const provider = new FileSystemCatalogProvider(
        conformancePath('test_data/catalogs/catalog_malformed.json'),
      );
      expect(() => provider.load()).toThrow(A2uiCatalogError);
    });
  });
});
