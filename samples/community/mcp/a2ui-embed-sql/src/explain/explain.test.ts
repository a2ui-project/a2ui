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

import {CHART_CONFIG} from '../compose/query_view.js';
import {CATALOG_SCHEMA, validator} from '../compose/test_fixtures.js';
import {QueryError} from '../db/database.js';
import type {QueryResult} from '../db/query_result.js';
import {
  explain,
  type ExplainDependencies,
  markComposedRefresh,
  NO_MODEL_MESSAGE,
} from './explain.js';
import type {JsonModel, JsonRequest} from './json_model.js';
import {describeCatalog, layoutSystem} from './prompts.js';

const RESULT: QueryResult = {
  sql: 'SELECT Genre, Revenue FROM x',
  columns: [
    {name: 'Genre', type: 'string'},
    {name: 'Revenue', type: 'number'},
  ],
  rows: [
    {Genre: 'Rock', Revenue: 826.65},
    {Genre: 'Latin', Revenue: 382.14},
  ],
  truncated: false,
};

/** A model that returns canned answers in order and records the requests. */
class FakeModel implements JsonModel {
  readonly requests: JsonRequest[] = [];
  constructor(private readonly answers: unknown[]) {}
  async generateJson(request: JsonRequest): Promise<unknown> {
    this.requests.push(request);
    return this.answers.shift();
  }
}

function deps(
  model: JsonModel | undefined,
  query = async (_sql: string) => RESULT,
): ExplainDependencies {
  return {db: {query}, model, schema: 'Genre(...)', catalogSchema: CATALOG_SCHEMA, validator};
}

const VALID_LAYOUT = {
  components: [
    {id: 'root', component: 'Column', children: ['title', 'chart', 'refresh']},
    {id: 'title', component: 'Text', text: {'@path': '/title'}},
    {
      id: 'chart',
      component: 'VegaChart',
      spec: {'@call': 'withRows', args: {spec: {'@path': '/chart'}, rows: {'@path': '/rows'}}},
    },
    {id: 'refresh_label', component: 'Text', text: 'Refresh'},
    {
      id: 'refresh',
      component: 'Button',
      child: 'refresh_label',
      action: {event: {name: 'refresh', context: {sql: {'@path': '/query/sql'}}}},
    },
  ],
  chart: {
    mark: 'bar',
    encoding: {x: {field: 'Genre', type: 'nominal'}, y: {field: 'Revenue', type: 'quantitative'}},
  },
};

describe('explain', () => {
  it('returns a clear text error without a model', async () => {
    expect(await explain('anything', deps(undefined))).toEqual({ok: false, text: NO_MODEL_MESSAGE});
  });

  it('uses a valid model layout whose chart reads the rows from /rows', async () => {
    const model = new FakeModel([{sql: RESULT.sql, title: 'Revenue by genre'}, VALID_LAYOUT]);
    const outcome = await explain('Revenue by genre?', deps(model));
    if (!outcome.ok) throw new Error(outcome.text);
    expect(outcome.layoutSource).toBe('model');
    // Same components, with the refresh marked as composed.
    expect(outcome.view.components).toEqual(markComposedRefresh(VALID_LAYOUT.components));
    expect(JSON.stringify(outcome.view.components)).toContain('"layout":"composed"');
    expect(outcome.view.dataModel['chart']).toEqual({
      config: CHART_CONFIG,
      ...VALID_LAYOUT.chart,
    });
    expect(outcome.view.dataModel['title']).toBe('Revenue by genre');
    expect(outcome.text).toContain('Query returned 2 rows');
    expect(outcome.text).toContain(`SQL: ${RESULT.sql}`);
    expect(model.requests[1]?.system).toContain('DataTable');
    expect(model.requests[1]?.system).toContain('never use Markdown');
    // The summary describes the composed view, not the default layout.
    expect(outcome.text).toContain('Shown to the user as a bar chart.');
    expect(outcome.text).not.toContain('sortable table');
  });

  it('marks only refresh events as composed', () => {
    const marked = markComposedRefresh([
      {id: 'r', component: 'Button', child: 'l', action: {event: {name: 'refresh', context: {}}}},
      {id: 'b', component: 'Button', child: 'l', action: {event: {name: 'breakdown'}}},
    ]);
    expect(marked[0]).toMatchObject({action: {event: {context: {layout: 'composed'}}}});
    expect(marked[1]).toEqual({
      id: 'b',
      component: 'Button',
      child: 'l',
      action: {event: {name: 'breakdown'}},
    });
  });

  it.each([
    ['an unknown component', {components: [{id: 'root', component: 'Marquee'}]}],
    [
      'a binding outside the data model',
      {components: [{id: 'root', component: 'Text', text: {'@path': '/secret'}}]},
    ],
    [
      'an unknown event',
      {
        components: [
          {id: 'root', component: 'Button', child: 'l', action: {event: {name: 'drop_table'}}},
          {id: 'l', component: 'Text', text: 'x'},
        ],
      },
    ],
    ['an answer that is not a layout', 'not json'],
  ])('falls back to the deterministic view for %s', async (_, layout) => {
    const outcome = await explain('q', deps(new FakeModel([{sql: RESULT.sql}, layout])));
    if (!outcome.ok) throw new Error(outcome.text);
    expect(outcome.layoutSource).toBe('fallback');
    expect(outcome.layoutErrors.length).toBeGreaterThan(0);
    expect(outcome.view.components.find(c => c.id === 'tabs')).toBeDefined();
    expect(outcome.text).toContain('default layout was used');
  });

  it('retries once with the SQL error', async () => {
    let calls = 0;
    const query = async (sql: string) => {
      calls++;
      if (sql === 'bad') throw new QueryError('no such column: x');
      return RESULT;
    };
    const model = new FakeModel([{sql: 'bad'}, {sql: RESULT.sql}, VALID_LAYOUT]);
    const outcome = await explain('q', deps(model, query));
    expect(outcome.ok).toBe(true);
    expect(calls).toBe(2);
    expect(model.requests[1]?.prompt).toContain('no such column: x');
  });

  it('returns a text error when the SQL keeps failing', async () => {
    const query = async () => {
      throw new QueryError('no such table: y');
    };
    const outcome = await explain('q', deps(new FakeModel([{sql: 'a'}, {sql: 'b'}]), query));
    expect(outcome).toEqual({
      ok: false,
      text: 'explain could not answer the question: no such table: y',
    });
  });
});

describe('layout prompt', () => {
  it('describes the layout components from the catalog schema', () => {
    const description = describeCatalog(CATALOG_SCHEMA);
    expect(description).toContain('DataTable: A table of rows');
    expect(description).toContain('  - rows: DynamicValue');
    expect(description).toContain('  - spec: DynamicValue');
    expect(description).not.toContain('TextField');
  });

  it('includes a few-shot example that validates against the catalog', () => {
    const system = layoutSystem(CATALOG_SCHEMA);
    const example = JSON.parse(system.slice(system.lastIndexOf('\n') + 1)) as {
      components: unknown[];
    };
    const report = validator.validate([
      {version: '1.0', createSurface: {surfaceId: 's', catalogId: CATALOG_SCHEMA['catalogId']}},
      {version: '1.0', updateComponents: {surfaceId: 's', components: example.components}},
    ]);
    expect(report.errors).toEqual([]);
  });
});
