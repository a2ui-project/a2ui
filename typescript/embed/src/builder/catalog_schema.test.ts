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
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';

import {CatalogSchemaFileSchema, CONTRACT_VERSION} from '../contract/index.js';
import {A2uiValidator} from '../mcp/server/a2ui_validator.js';
import {createA2uiApp} from '../mcp/server/create_a2ui_app.js';
import {createCatalogSchemaFile} from './catalog_schema.js';

const emptyCatalog = (id: string, protocolVersion: string, instructions?: string) =>
  new Catalog(id, protocolVersion, [], [], instructions === undefined ? undefined : {instructions});

describe('createCatalogSchemaFile', () => {
  it('keys each catalog validation schema by catalog ID and preserves metadata', () => {
    const plain = emptyCatalog('https://example.com/catalogs/plain.json', '1.0');
    const guided = emptyCatalog(
      'https://example.com/catalogs/guided.json',
      '1.0',
      'Prefer compact summary cards.',
    );

    const file = createCatalogSchemaFile([basicCatalog, plain, guided]);

    assert.equal(CatalogSchemaFileSchema.safeParse(file).success, true);
    assert.equal(file.contractVersion, CONTRACT_VERSION);
    assert.deepEqual(file.catalogs, {
      [basicCatalog.id]: {
        ...basicCatalog.validationSchema,
        protocolVersion: basicCatalog.protocolVersion,
        ...(basicCatalog.instructions !== undefined
          ? {instructions: basicCatalog.instructions}
          : {}),
      },
      [plain.id]: {
        ...plain.validationSchema,
        protocolVersion: '1.0',
      },
      [guided.id]: {
        ...guided.validationSchema,
        protocolVersion: '1.0',
        instructions: 'Prefer compact summary cards.',
      },
    });
    assert.equal(Object.hasOwn(file.catalogs[plain.id], 'instructions'), false);
    assert.equal(file.catalogs[guided.id]['instructions'], 'Prefer compact summary cards.');
  });

  it('validates cleanly with A2uiValidator and createA2uiApp when metadata is preserved', () => {
    const custom = new Catalog(
      'https://example.com/catalogs/cards.json',
      '1.0',
      [{name: 'StatCard', schema: z.object({label: z.string(), value: z.string()})}],
      [],
      {instructions: 'Render KPI tiles with StatCard.'},
    );
    const catalogSchema = createCatalogSchemaFile([custom]);

    const validator = new A2uiValidator(catalogSchema);
    const validMessages = [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'stats',
          catalogId: custom.id,
          components: [{id: 'root', component: 'StatCard', label: 'Flights', value: '12'}],
        },
      },
    ];
    assert.deepEqual(validator.validate(validMessages), {ok: true, errors: []});

    const server = new McpServer({name: 'test-server', version: '1.0.0'});
    const app = createA2uiApp(server, {
      html: {text: '<!doctype html><title>Test</title>'},
      catalogSchema,
    });
    assert.deepEqual(app.validate(validMessages), {ok: true, errors: []});

    const invalidResult = app.validate([
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'stats',
          catalogId: custom.id,
          components: [{id: 'root', component: 'StatCard', label: 'Flights'}],
        },
      },
    ]);
    assert.equal(invalidResult.ok, false);
    assert.equal(invalidResult.errors[0].property, 'value');
  });

  it('accepts a later v1 minor version', () => {
    const file = createCatalogSchemaFile([emptyCatalog('https://example.com/c.json', '1.1')]);

    assert.deepEqual(Object.keys(file.catalogs), ['https://example.com/c.json']);
    assert.equal(file.catalogs['https://example.com/c.json']['protocolVersion'], '1.1');
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
