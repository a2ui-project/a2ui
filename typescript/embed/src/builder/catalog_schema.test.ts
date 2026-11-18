/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {Catalog} from '@a2ui/web_core';
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';

import {CatalogSchemaFileSchema, CONTRACT_VERSION} from '../contract/index.js';
import {createCatalogSchemaFile} from './catalog_schema.js';

const emptyCatalog = (id: string, protocolVersion: string) =>
  new Catalog(id, protocolVersion, [], []);

describe('createCatalogSchemaFile', () => {
  it('keys each catalog validation schema by catalog ID', () => {
    const custom = emptyCatalog('https://example.com/catalogs/custom.json', '1.0');

    const file = createCatalogSchemaFile([basicCatalog, custom]);

    assert.equal(CatalogSchemaFileSchema.safeParse(file).success, true);
    assert.equal(file.contractVersion, CONTRACT_VERSION);
    assert.deepEqual(file.catalogs, {
      [basicCatalog.id]: basicCatalog.validationSchema,
      [custom.id]: custom.validationSchema,
    });
  });

  it('accepts a later v1 minor version', () => {
    const file = createCatalogSchemaFile([emptyCatalog('https://example.com/c.json', '1.1')]);

    assert.deepEqual(Object.keys(file.catalogs), ['https://example.com/c.json']);
  });

  it('rejects a catalog for another major version', () => {
    assert.throws(
      () => createCatalogSchemaFile([emptyCatalog('https://example.com/old.json', '0.9')]),
      /Catalog "https:\/\/example\.com\/old\.json" targets A2UI 0\.9; @a2ui\/embed renders A2UI v1\.x catalogs only\./,
    );
  });

  it('rejects two catalogs with the same ID', () => {
    const first = emptyCatalog('https://example.com/c.json', '1.0');
    const second = emptyCatalog('https://example.com/c.json', '1.0');

    assert.throws(
      () => createCatalogSchemaFile([first, second]),
      /Two catalogs share the ID "https:\/\/example\.com\/c\.json"/,
    );
  });
});
