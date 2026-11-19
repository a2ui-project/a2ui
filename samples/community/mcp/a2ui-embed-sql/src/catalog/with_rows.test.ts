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

import {describe, expect, it} from 'vitest';

import {MessageProcessor} from '@a2ui/web_core/v1_0';

import {SQL_CATALOG_ID, sqlCatalog} from './index.js';
import {withRows} from './with_rows.js';

describe('withRows', () => {
  it('sets data.values from the rows, keeping the rest of the spec', () => {
    const spec = {mark: 'bar', data: {values: [{stale: true}]}};
    expect(withRows(spec, [{a: 1}, {a: 2}, 'x'])).toEqual({
      mark: 'bar',
      data: {values: [{a: 1}, {a: 2}]},
    });
    expect(withRows(spec, [{a: 1}, {a: 2}], 1)).toEqual({mark: 'bar', data: {values: [{a: 1}]}});
    expect(withRows(undefined, undefined)).toEqual({data: {values: []}});
  });

  it('is a function of the sample catalog', () => {
    expect(sqlCatalog.functions.has('withRows')).toBe(true);
    // The processor accepts a surface that uses it.
    const processor = new MessageProcessor([sqlCatalog]);
    processor.processMessages([
      {version: '1.0', createSurface: {surfaceId: 's', catalogId: SQL_CATALOG_ID}},
    ] as never);
    expect(processor.model.getSurface('s')).toBeDefined();
  });
});
