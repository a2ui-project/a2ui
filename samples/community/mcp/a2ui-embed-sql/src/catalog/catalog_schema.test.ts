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

import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {SQL_CATALOG_ID, sqlCatalog} from './index.js';

const schemaFile = fileURLToPath(new URL('./catalog_schema.json', import.meta.url));

describe('sqlCatalog', () => {
  it('has the basic components plus DataTable and VegaChart', () => {
    expect(sqlCatalog.id).toBe(SQL_CATALOG_ID);
    expect(sqlCatalog.protocolVersion).toBe('1.0');
    expect([...sqlCatalog.components.keys()]).toEqual(
      expect.arrayContaining([
        'Text',
        'Column',
        'Row',
        'Card',
        'Tabs',
        'Button',
        'DataTable',
        'VegaChart',
      ]),
    );
    expect(sqlCatalog.functions.has('formatNumber')).toBe(true);
  });

  it('matches the committed catalog_schema.json (run `yarn generate:schema` to update)', () => {
    const generated = sqlCatalog.validationSchema;
    if (process.env['UPDATE_SCHEMA']) {
      writeFileSync(schemaFile, `${JSON.stringify(generated, null, 2)}\n`);
    }
    expect(JSON.parse(readFileSync(schemaFile, 'utf8'))).toEqual(generated);
  });

  it('declares DataTable with rows required and VegaChart with spec required', () => {
    const components = sqlCatalog.validationSchema['components'] as Record<
      string,
      {required: string[]}
    >;
    expect(components['DataTable']?.required).toEqual(expect.arrayContaining(['rows']));
    expect(components['VegaChart']?.required).toEqual(expect.arrayContaining(['spec']));
  });
});
