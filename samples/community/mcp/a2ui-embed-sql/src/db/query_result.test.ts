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

import {inferColumnType, toCell} from './query_result.js';

describe('inferColumnType', () => {
  it('infers numbers, dates and strings from values', () => {
    expect(inferColumnType('Total', [1, 2.5, null])).toBe('number');
    expect(inferColumnType('InvoiceDate', ['2009-01-01 00:00:00', '2009-01-02 00:00:00'])).toBe(
      'date',
    );
    expect(inferColumnType('Month', ['2009-01', '2009-02'])).toBe('date');
    expect(inferColumnType('Name', ['Rock', '2009-01'])).toBe('string');
  });

  it('treats year-like integers and strings as dates only in year or month columns', () => {
    expect(inferColumnType('Year', [2009, 2010])).toBe('date');
    expect(inferColumnType('InvoiceYear', ['2009', '2010'])).toBe('date');
    expect(inferColumnType('TrackCount', [2009, 2010])).toBe('number');
    expect(inferColumnType('Code', ['2009'])).toBe('string');
  });

  it('falls back to the declared type when every value is null', () => {
    expect(inferColumnType('d', [null], 'DATETIME')).toBe('date');
    expect(inferColumnType('n', [null], 'NUMERIC(10,2)')).toBe('number');
    expect(inferColumnType('s', [null], null)).toBe('string');
  });
});

describe('toCell', () => {
  it('converts SQLite values to JSON-safe cells', () => {
    expect(toCell(undefined)).toBeNull();
    expect(toCell(3n)).toBe(3);
    expect(toCell(2n ** 60n)).toBe('1152921504606846976');
    expect(toCell(new Uint8Array(4))).toBe('<blob 4 bytes>');
    expect(toCell('x')).toBe('x');
  });
});
