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
import {fileURLToPath} from 'url';
import {describe, it, expect} from 'vitest';
import {AgentToRendererMessage, Catalog} from '../../../../src/internal/web_core.js';
import {basicCatalog, SchemaCatalog} from '../../../../src/types.js';
import {registerCatalogDocument} from '../../../../src/utils/catalog_document.js';
import {ExpressDecompiler} from '../../../../src/inference_formats/express/decompiler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

interface ParityCase {
  name: string;
  catalog: 'basic_v1_0' | 'basic_v0_9' | 'simplified' | 'custom' | 'forms';
  messages: AgentToRendererMessage[];
  expectedNotation: string;
}

describe('ExpressDecompiler', () => {
  const loadedCatalogs = new Map<string, {catalog: SchemaCatalog; version: string}>();

  function getCatalogInfo(catalogKey: string): {catalog: SchemaCatalog; version: string} {
    if (loadedCatalogs.has(catalogKey)) {
      return loadedCatalogs.get(catalogKey)!;
    }

    if (catalogKey === 'basic_v1_0') {
      const info = {catalog: basicCatalog('v1.0'), version: 'v1.0'};
      loadedCatalogs.set(catalogKey, info);
      return info;
    }

    if (catalogKey === 'basic_v0_9') {
      const info = {catalog: basicCatalog('v0.9'), version: 'v0.9'};
      loadedCatalogs.set(catalogKey, info);
      return info;
    }

    const fixtureFile =
      catalogKey === 'simplified'
        ? 'simplified_catalog_v1_0.json'
        : catalogKey === 'custom'
          ? 'custom_catalog_v1_0.json'
          : 'forms_catalog_v1_0.json';

    const schemaPath = path.join(FIXTURES_DIR, fixtureFile);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const cat = Catalog.fromSchema(schema);
    registerCatalogDocument(cat, schema);
    const info = {catalog: cat, version: 'v1.0'};
    loadedCatalogs.set(catalogKey, info);
    return info;
  }

  describe('1. Parity corpus (31 cases against Python oracle)', () => {
    const casesPath = path.join(FIXTURES_DIR, 'decompiler_parity_cases.json');
    const cases: ParityCase[] = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

    const overridesPath = path.join(FIXTURES_DIR, 'conformance_overrides.json');
    const overridesAll = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
    const overrides = overridesAll['decompiler_parity_cases.json'] || {};

    it('every override names a case in decompiler_parity_cases.json', () => {
      const names = new Set(cases.map(c => c.name));
      for (const name of Object.keys(overrides)) {
        expect(names.has(name), `override '${name}' matches no case`).toBe(true);
      }
    });

    it(`contains at least 27 cases (found ${cases.length})`, () => {
      expect(cases.length).toBeGreaterThanOrEqual(27);
    });

    for (const c of cases) {
      it(`matches oracle for ${c.name}`, () => {
        const {catalog, version} = getCatalogInfo(c.catalog);
        const decompiler = new ExpressDecompiler(catalog, version);
        const actual = decompiler.decompile(c.messages);

        const override = overrides[c.name];
        const expected = override ? override.expected : c.expectedNotation;

        expect(actual).toBe(expected);
      });
    }
  });

  describe('2. wrapDecompiledBlocks', () => {
    it('wraps blocks in sentinel tags', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler(catalog, version);
      const blocks = ['surface("s1")', 'root = Text("Hello")'];
      const wrapped = decompiler.wrapDecompiledBlocks(blocks);
      expect(wrapped).toBe('<a2ui>\nsurface("s1")\nroot = Text("Hello")\n</a2ui>');
    });

    it('joins multiple blocks with newlines inside sentinel tags', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler(catalog, version);
      const blocks = ['surface("s1")', 'root = Text("Hello")', '$/key = 42'];
      const wrapped = decompiler.wrapDecompiledBlocks(blocks);
      expect(wrapped).toBe('<a2ui>\nsurface("s1")\nroot = Text("Hello")\n$/key = 42\n</a2ui>');
    });
  });

  describe('3. Single message input and edge cases', () => {
    it('accepts a single message object instead of array', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler(catalog, version);
      const msg: AgentToRendererMessage = {
        version: 'v1.0',
        deleteSurface: {
          surfaceId: 's1',
        },
      } as AgentToRendererMessage;
      const actual = decompiler.decompile(msg);
      expect(actual).toBe('deleteSurface("s1")');
    });

    it('returns empty string for empty message list', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler(catalog, version);
      expect(decompiler.decompile([])).toBe('');
    });

    it('supports useKeywordArgs = true', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler(catalog, version);
      const msg: AgentToRendererMessage = {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: 'conformance/simplified',
          components: [
            {
              id: 'root',
              component: 'Text',
              text: 'Hello',
            },
          ],
        },
      } as AgentToRendererMessage;
      const actual = decompiler.decompile(msg, true);
      expect(actual).toBe('surface("s1")\nroot = Text(text="Hello")');
    });
  });
});
