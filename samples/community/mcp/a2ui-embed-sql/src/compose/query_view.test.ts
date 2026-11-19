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

import {SQL_CATALOG_ID} from '../catalog/catalog_id.js';
import type {A2uiComponent, A2uiView} from './messages.js';
import {createSurfaceMessages, updateSurfaceMessages} from './messages.js';
import {
  CHART_CONFIG,
  chartSpec,
  chooseLayout,
  composeQueryView,
  dimensionLabel,
  fitRows,
  footerText,
  MAX_BARS,
  ROW_BUDGET_BYTES,
} from './query_view.js';
import {BY_GENRE, BY_MONTH, DETAIL, result, SINGLE_NUMBER, validator} from './test_fixtures.js';

function component(view: A2uiView, id: string): A2uiComponent {
  const found = view.components.find(c => c.id === id);
  if (!found) throw new Error(`No component ${id}`);
  return found;
}

/** Every string literal in the components, to check no data value is inlined. */
function literals(view: A2uiView): string[] {
  return JSON.stringify(view.components).match(/"(?:[^"\\]|\\.)*"/g) ?? [];
}

function expectValid(view: A2uiView) {
  const report = validator.validate(createSurfaceMessages('s1', view));
  expect(report.errors).toEqual([]);
  expect(validator.validate(updateSurfaceMessages('s1', view)).ok).toBe(true);
}

describe('chooseLayout', () => {
  it('picks a KPI for a single numeric cell', () => {
    expect(chooseLayout(SINGLE_NUMBER).kind).toBe('kpi');
  });

  it('picks a bar chart for a label column plus numeric columns', () => {
    expect(chooseLayout(BY_GENRE)).toMatchObject({kind: 'chart', mark: 'bar'});
  });

  it('picks a line chart when the label column is date-like', () => {
    expect(chooseLayout(BY_MONTH)).toMatchObject({kind: 'chart', mark: 'line'});
  });

  it('picks a table otherwise', () => {
    expect(chooseLayout(DETAIL).kind).toBe('table');
    expect(chooseLayout(result([{name: 'Genre', type: 'string'}], [{Genre: 'Rock'}])).kind).toBe(
      'table',
    );
  });

  it('does not chart a single grouped row', () => {
    expect(chooseLayout(result(BY_GENRE.columns as never, [BY_GENRE.rows[0]!])).kind).toBe('table');
  });

  it('honours hints the shape supports and ignores the others', () => {
    expect(chooseLayout(BY_GENRE, 'table').kind).toBe('table');
    expect(chooseLayout(BY_GENRE, 'line')).toMatchObject({kind: 'chart', mark: 'line'});
    expect(chooseLayout(BY_MONTH, 'bar')).toMatchObject({kind: 'chart', mark: 'bar'});
    expect(chooseLayout(DETAIL, 'bar').kind).toBe('table');
    expect(chooseLayout(BY_GENRE, 'kpi')).toMatchObject({kind: 'chart'});
    expect(chooseLayout(SINGLE_NUMBER, 'table').kind).toBe('table');
  });
});

describe('composeQueryView', () => {
  it('composes KPI cards bound to the data model', () => {
    const view = composeQueryView(SINGLE_NUMBER, {title: 'Total revenue'});
    expectValid(view);
    expect(component(view, 'root')['children']).toEqual(['title', 'kpis', 'footer', 'actions']);
    expect(view.dataModel['kpis']).toEqual([{label: 'Revenue', value: 2328.6}]);
    expect(component(view, 'kpi_0_value')['text']).toEqual({
      '@call': 'formatNumber',
      args: {value: {'@path': '/kpis/0/value'}},
    });
    expect(view.dataModel['title']).toBe('Total revenue');
  });

  it('composes a chart and a table in tabs for grouped results', () => {
    const view = composeQueryView(BY_GENRE, {breakdownDimensions: ['Customer.Country']});
    expectValid(view);
    expect(component(view, 'tabs')['tabs']).toEqual([
      {title: 'Chart', child: 'chart'},
      {title: 'Table', child: 'table'},
    ]);
    expect(component(view, 'chart')['spec']).toEqual({
      '@call': 'withRows',
      args: {spec: {'@path': '/chart'}, rows: {'@path': '/rows'}, limit: MAX_BARS},
    });
    expect(component(view, 'table')).toMatchObject({
      rows: {'@path': '/rows'},
      columns: {'@path': '/columns'},
    });
    // The rows are stored once: the chart reads /rows through withRows.
    expect(view.dataModel['chart']).not.toHaveProperty('data');
    expect(view.dataModel['rows']).toEqual(BY_GENRE.rows);
    expect(component(view, 'table')).not.toHaveProperty('caption');
  });

  it('composes a table for other results', () => {
    const view = composeQueryView(DETAIL);
    expectValid(view);
    expect(component(view, 'root')['children']).toEqual(['title', 'table', 'footer', 'actions']);
    expect(view.dataModel['columns']).toEqual([
      {key: 'Name', label: 'Name', type: 'string'},
      {key: 'Composer', label: 'Composer', type: 'string'},
      {key: 'Milliseconds', label: 'Milliseconds', type: 'number'},
    ]);
  });

  it('composes a valid table for an empty result', () => {
    const view = composeQueryView(result(DETAIL.columns as never, []));
    expectValid(view);
    expect(view.dataModel['footer']).toBe('0 rows · 3 columns');
  });

  it('never puts data values in component properties', () => {
    for (const fixture of [SINGLE_NUMBER, BY_GENRE, BY_MONTH, DETAIL]) {
      const view = composeQueryView(fixture, {title: 'A title'});
      const inlined = literals(view);
      for (const row of fixture.rows) {
        for (const value of Object.values(row)) {
          if (typeof value === 'string') expect(inlined).not.toContain(JSON.stringify(value));
        }
      }
      expect(inlined).not.toContain('"A title"');
      expect(inlined).not.toContain('"SELECT ..."');
    }
  });

  it('adds a refresh button whose context is bound to the query', () => {
    const view = composeQueryView(DETAIL, {visualization: 'table', title: 'Tracks'});
    expect(component(view, 'refresh')['action']).toEqual({
      event: {
        name: 'refresh',
        context: {
          sql: {'@path': '/query/sql'},
          visualization: {'@path': '/query/visualization'},
          title: {'@path': '/query/title'},
        },
      },
    });
    expect(view.dataModel['query']).toEqual({
      sql: 'SELECT ...',
      visualization: 'table',
      title: 'Tracks',
    });
  });

  it('adds breakdown buttons for grouped results, skipping the label dimension', () => {
    const view = composeQueryView(BY_GENRE, {breakdownDimensions: ['Customer.Country', 'Genre']});
    expect(component(view, 'actions')['children']).toEqual(['refresh', 'breakdown_0']);
    expect(component(view, 'breakdown_0')['action']).toEqual({
      event: {name: 'breakdown', context: {dimension: 'Customer.Country', metric: 'Revenue'}},
    });
    expect(component(view, 'breakdown_0_label')['text']).toBe('Break down by country');
    const tableView = composeQueryView(DETAIL, {breakdownDimensions: ['Customer.Country']});
    expect(component(tableView, 'actions')['children']).toEqual(['refresh']);
  });

  it('uses the catalog ID in createSurface', () => {
    const [create] = createSurfaceMessages('s1', composeQueryView(DETAIL));
    expect(create).toEqual({
      version: '1.0',
      createSurface: {surfaceId: 's1', catalogId: SQL_CATALOG_ID, sendDataModel: true},
    });
  });
});

describe('chartSpec', () => {
  it('builds a single-series bar chart that keeps the SQL order', () => {
    const layout = chooseLayout(BY_GENRE);
    if (layout.kind !== 'chart') throw new Error('expected a chart');
    expect(chartSpec(layout)).toMatchObject({
      config: CHART_CONFIG,
      mark: {type: 'bar', tooltip: true},
      encoding: {
        x: {field: 'Genre', type: 'nominal', sort: null},
        y: {field: 'Revenue', type: 'quantitative'},
      },
    });
  });

  it('folds several metrics into a line chart with a temporal axis', () => {
    const layout = chooseLayout(BY_MONTH);
    if (layout.kind !== 'chart') throw new Error('expected a chart');
    const spec = chartSpec(layout);
    expect(spec['transform']).toEqual([{fold: ['Revenue', 'Invoices'], as: ['metric', 'value']}]);
    expect(spec).toMatchObject({encoding: {x: {type: 'temporal'}, color: {field: 'metric'}}});
  });

  it('caps the bars of bar charts only, and leaves the table complete', () => {
    const rows = Array.from({length: MAX_BARS + 10}, (_, i) => ({Genre: `g${i}`, Revenue: i}));
    const big = result(BY_GENRE.columns as never, rows);
    const view = composeQueryView(big);
    expect(component(view, 'chart')['spec']).toMatchObject({args: {limit: MAX_BARS}});
    expect(view.dataModel['rows']).toHaveLength(MAX_BARS + 10);
    const line = composeQueryView(BY_MONTH);
    expect(component(line, 'chart')['spec']).not.toHaveProperty('args.limit');
  });
});

describe('footerText', () => {
  it('reports row and column counts and truncation', () => {
    expect(footerText(SINGLE_NUMBER)).toBe('1 row · 1 column');
    expect(footerText(result(DETAIL.columns as never, DETAIL.rows as never, true))).toBe(
      'First 2 rows (more rows were not returned) · 3 columns',
    );
  });

  it('labels dimensions by table for lookup columns and by column otherwise', () => {
    expect(dimensionLabel('MediaType.Name')).toBe('media type');
    expect(dimensionLabel('Album.Title')).toBe('album');
    expect(dimensionLabel('Invoice.BillingCountry')).toBe('billing country');
  });

  it('keeps the rows that fit in the data model budget and says so in the footer', () => {
    const rows = Array.from({length: 400}, (_, i) => ({name: `Track ${i}`, total: i}));
    const kept = fitRows(rows);
    expect(kept.length).toBeGreaterThan(50);
    expect(kept.length).toBeLessThan(400);
    expect(Buffer.byteLength(JSON.stringify(kept))).toBeLessThanOrEqual(ROW_BUDGET_BYTES);
    const big = result(
      [
        {name: 'name', type: 'string'},
        {name: 'total', type: 'number'},
      ],
      rows,
    );
    const view = composeQueryView(big, {visualization: 'table'});
    expect(view.dataModel['rows']).toHaveLength(kept.length);
    expect(view.dataModel['footer']).toBe(`Showing ${kept.length} of 400 rows · 2 columns`);
    expect(fitRows([{huge: 'x'.repeat(10_000)}])).toHaveLength(1);
  });

  it('binds table selection to /selected, which starts as null', () => {
    const view = composeQueryView(DETAIL);
    expect(component(view, 'table')['selected']).toEqual({'@path': '/selected'});
    expect(view.dataModel['selected']).toBeNull();
  });
});
