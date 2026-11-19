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

import type {TableInfo} from '../db/database.js';
import {chooseLayout, fitRows, MAX_BARS} from './query_view.js';
import {describeComposedView, summarizeResult, summarizeTables} from './summary.js';
import {BY_GENRE, DETAIL, result, SINGLE_NUMBER} from './test_fixtures.js';

describe('summarizeResult', () => {
  it('summarizes a KPI as name = value', () => {
    expect(summarizeResult(SINGLE_NUMBER, chooseLayout(SINGLE_NUMBER))).toBe(
      'Query returned 1 row with columns: Revenue (number).\nRevenue = 2328.6\nShown to the user as KPI cards.',
    );
  });

  it('lists totals, the rows and the view for grouped results', () => {
    expect(summarizeResult(BY_GENRE, chooseLayout(BY_GENRE))).toBe(
      [
        'Query returned 3 rows with columns: Genre (string), Revenue (number).',
        'Totals over returned rows: Revenue: sum 1470.15, min 261.36, max 826.65.',
        'Rows:',
        'Genre | Revenue',
        'Rock | 826.65',
        'Latin | 382.14',
        'Metal | 261.36',
        'Shown to the user as a bar chart with a table tab.',
      ].join('\n'),
    );
  });

  it('truncates rows and long cells and reports truncation', () => {
    const rows = Array.from({length: 25}, (_, i) => ({
      Name: `${'x'.repeat(100)}${i}`,
      Composer: null,
      Milliseconds: i,
    }));
    const text = summarizeResult(
      result(DETAIL.columns as never, rows, true),
      {kind: 'table'},
      {maxRows: 3, maxCellLength: 10},
    );
    expect(text).toContain('25 rows (truncated; more rows exist)');
    expect(text).toContain('First 3 rows:');
    expect(text).toContain('xxxxxxxxx… | NULL | 0');
    expect(text).toContain('(22 more rows not listed)');
    expect(text.split('\n')).toHaveLength(9);
  });

  it('says how many rows the view shows when it leaves rows out', () => {
    const rows = Array.from({length: 500}, (_, i) => ({
      Name: `Track number ${i}`,
      Composer: 'Someone',
      Milliseconds: i,
    }));
    const big = result(DETAIL.columns as never, rows, true);
    const shown = fitRows(rows).length;
    expect(shown).toBeLessThan(500);
    expect(summarizeResult(big, {kind: 'table'})).toContain(
      `Shown to the user as a sortable table. The view shows the first ${shown} of 500 rows.`,
    );
  });

  it('says how many rows a bar chart draws when it caps the bars', () => {
    const rows = Array.from({length: MAX_BARS + 10}, (_, i) => ({Genre: `g${i}`, Revenue: i}));
    const big = result(BY_GENRE.columns as never, rows);
    expect(summarizeResult(big, chooseLayout(big))).toContain(
      `Shown to the user as a bar chart with a table tab. The chart shows the first ${MAX_BARS} rows as bars.`,
    );
    expect(summarizeResult(big, chooseLayout(big), {viewRows: 20})).toContain(
      'The view shows the first 20 of 60 rows.',
    );
  });

  it('describes a composed view from the components it uses', () => {
    const tabs = [{component: 'Tabs'}, {component: 'VegaChart'}, {component: 'DataTable'}];
    expect(describeComposedView(tabs, {mark: {type: 'bar'}}, 10, 10)).toBe(
      'Shown to the user as a bar chart with a table tab.',
    );
    expect(describeComposedView([{component: 'VegaChart'}], {mark: 'line'}, 10, 10)).toBe(
      'Shown to the user as a line chart.',
    );
    expect(describeComposedView([{component: 'DataTable'}], undefined, 500, 28)).toBe(
      'Shown to the user as a sortable table. The view shows the first 28 of 500 rows.',
    );
    expect(describeComposedView([{component: 'Card'}, {component: 'Text'}], undefined, 1, 1)).toBe(
      'Shown to the user as cards.',
    );
    expect(
      summarizeResult(BY_GENRE, {kind: 'table'}, {viewDescription: 'Shown to the user as X.'}),
    ).toMatch(/Shown to the user as X\.$/);
  });

  it('summarizes an empty result', () => {
    expect(summarizeResult(result(DETAIL.columns as never, []), {kind: 'table'})).toBe(
      'Query returned 0 rows with columns: Name (string), Composer (string), Milliseconds (number).\nShown to the user as a sortable table.',
    );
  });
});

describe('summarizeTables', () => {
  it('lists tables with row counts and columns', () => {
    const tables: TableInfo[] = [
      {
        name: 'Artist',
        rowCount: 275,
        foreignKeys: [],
        columns: [
          {name: 'ArtistId', type: 'INTEGER', primaryKey: true},
          {name: 'Name', type: 'NVARCHAR(120)', primaryKey: false},
        ],
      },
    ];
    expect(summarizeTables(tables)).toBe(
      'The database has 1 tables:\n- Artist (275 rows): ArtistId (PK) INTEGER, Name NVARCHAR(120)\nShown to the user as a schema browser with Tables and Columns tabs.',
    );
  });
});
