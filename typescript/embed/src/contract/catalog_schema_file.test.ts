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
import {CatalogSchemaFileSchema} from './catalog_schema_file.js';

describe('CatalogSchemaFileSchema', () => {
  it('parses a file with catalog schemas keyed by catalog ID', () => {
    const file = {
      contractVersion: '1.0',
      catalogs: {
        'https://a2ui.org/specification/v1_0/basic_catalog.json': {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
        },
      },
    };
    assert.deepEqual(CatalogSchemaFileSchema.parse(file), file);
  });

  for (const [label, file] of [
    ['a missing contractVersion', {catalogs: {}}],
    ['missing catalogs', {contractVersion: '1.0'}],
    ['a catalog schema that is not an object', {contractVersion: '1.0', catalogs: {id: 'x'}}],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.equal(CatalogSchemaFileSchema.safeParse(file).success, false);
    });
  }
});
