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

/** Prompts for `explain`: SQL generation, then layout composition. */

import type {Column, QueryResult} from '../db/query_result.js';
import {BREAKDOWN_EVENT, REFRESH_EVENT} from '../compose/events.js';
import {createSurfaceMessages} from '../compose/messages.js';
import {composeQueryView} from '../compose/query_view.js';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** System instruction for the SQL step. */
export const SQL_SYSTEM = `You write a single read-only SQLite SELECT (or WITH ... SELECT) statement that answers the user's question about the database described below.
Answer with JSON: {"sql": string, "title": string, "visualization": "auto" | "table" | "bar" | "line" | "kpi"}.
Rules: no semicolons; alias aggregates with readable names; put the label or date column first and numeric columns after it for grouped results; ORDER BY the main metric (or by date for time series); LIMIT detail queries to 100 rows.`;

/** Prompt for the SQL step. */
export function sqlPrompt(question: string, schema: string, previousError?: string): string {
  const retry = previousError
    ? `\n\nYour previous SQL failed with: ${previousError}\nWrite a corrected statement.`
    : '';
  return `Database schema:\n${schema}\n\nQuestion: ${question}${retry}`;
}

function refName(schema: JsonObject): string | undefined {
  const ref = schema['$ref'];
  return typeof ref === 'string' ? ref.split('/').pop() : undefined;
}

/** Describes one property of a component schema in a single line. */
function describeProperty(name: string, schema: unknown, required: boolean): string {
  if (!isObject(schema)) return `${name}`;
  const type =
    refName(schema) ??
    (Array.isArray(schema['enum'])
      ? schema['enum'].map(v => JSON.stringify(v)).join(' | ')
      : String(schema['type'] ?? 'any'));
  const description =
    typeof schema['description'] === 'string' ? ` — ${schema['description']}` : '';
  return `${name}${required ? '' : '?'}: ${type}${description}`;
}

/** Collects the properties of a component schema, following `allOf`. */
function componentProperties(schema: JsonObject): {properties: JsonObject; required: Set<string>} {
  const properties: JsonObject = {};
  const required = new Set<string>();
  const visit = (node: unknown) => {
    if (!isObject(node)) return;
    if (isObject(node['properties'])) Object.assign(properties, node['properties']);
    if (Array.isArray(node['required']))
      for (const key of node['required']) required.add(String(key));
    if (Array.isArray(node['allOf'])) node['allOf'].forEach(visit);
  };
  visit(schema);
  return {properties, required};
}

/** Components `explain` may use; media and input components make no sense for a query result. */
export const LAYOUT_COMPONENTS = [
  'Column',
  'Row',
  'Card',
  'Tabs',
  'Text',
  'Divider',
  'Button',
  'DataTable',
  'VegaChart',
];

/**
 * Describes the layout components of a catalog JSON schema, one block per
 * component with its properties, for the layout prompt.
 */
export function describeCatalog(catalogSchema: JsonObject, names = LAYOUT_COMPONENTS): string {
  const components = isObject(catalogSchema['components']) ? catalogSchema['components'] : {};
  const blocks: string[] = [];
  for (const name of names) {
    const schema = components[name];
    if (!isObject(schema)) continue;
    const {properties, required} = componentProperties(schema);
    const description =
      typeof schema['description'] === 'string' ? `: ${schema['description']}` : '';
    const lines = Object.entries(properties)
      .filter(([key]) => key !== 'id' && key !== 'component')
      .map(([key, value]) => `  - ${describeProperty(key, value, required.has(key))}`);
    blocks.push(`${name}${description}\n${lines.join('\n')}`);
  }
  return blocks.join('\n');
}

/** Columns of a canned grouped result used in the few-shot example. */
const EXAMPLE_COLUMNS: Column[] = [
  {name: 'Genre', type: 'string'},
  {name: 'Revenue', type: 'number'},
];

/** A few-shot example: a canned result and the components the deterministic composer gives it. */
export function fewShotExample(): string {
  const result: QueryResult = {
    sql: 'SELECT g.Name AS Genre, SUM(il.UnitPrice * il.Quantity) AS Revenue FROM ...',
    columns: EXAMPLE_COLUMNS,
    rows: [
      {Genre: 'Rock', Revenue: 826.65},
      {Genre: 'Latin', Revenue: 382.14},
    ],
    truncated: false,
  };
  const view = composeQueryView(result, {
    title: 'Revenue by genre',
    breakdownDimensions: ['Customer.Country'],
  });
  const update = createSurfaceMessages('example', view)[1];
  const components =
    isObject(update) && isObject(update['updateComponents'])
      ? update['updateComponents']['components']
      : [];
  return JSON.stringify({components});
}

/** System instruction for the layout step. */
export function layoutSystem(catalogSchema: JsonObject): string {
  return `You design an A2UI v1.0 layout for a SQL query result, using only these components:
${describeCatalog(catalogSchema)}

Answer with JSON: {"components": Component[], "chart"?: VegaLiteSpec}.
- Each component is a flat object {"id", "component", ...properties}; children are referenced by id; exactly one component has id "root".
- Text is plain text: never use Markdown (no #, **, _, lists or links) in Text components or labels.
- Never put result values in components. Bind them by path to the data model, which has:
  /title (string), /footer (string: row count), /rows (array of row objects), /columns (array of {key, label, type}), /chart (your Vega-Lite spec, without data), /query (the query, used by Refresh).
- For a chart, set "chart" to a Vega-Lite v5 spec WITHOUT "data" using bar or line marks and the result's column names, and add {"component": "VegaChart", "spec": {"@call": "withRows", "args": {"spec": {"@path": "/chart"}, "rows": {"@path": "/rows"}}}}, which draws the rows from /rows. Do not use expressions, "calculate" or "filter" transforms.
- DataTable: {"rows": {"@path": "/rows"}, "columns": {"@path": "/columns"}}.
- Buttons may only send the events "${REFRESH_EVENT}" (context {"sql": {"@path": "/query/sql"}, "visualization": {"@path": "/query/visualization"}, "title": {"@path": "/query/title"}}) or "${BREAKDOWN_EVENT}" (context {"dimension": "Table.Column", "metric": "<numeric column>"}).
- Always include a Refresh button.

Example for a revenue-by-genre result:
${fewShotExample()}`;
}

/** Prompt for the layout step: the question, the SQL, the column types and the first rows. */
export function layoutPrompt(question: string, result: QueryResult): string {
  const columns = result.columns.map(column => `${column.name} (${column.type})`).join(', ');
  const sample = JSON.stringify(result.rows.slice(0, 5));
  return `Question: ${question}\nSQL: ${result.sql}\nRow count: ${result.rows.length}${result.truncated ? ' (truncated)' : ''}\nColumns: ${columns}\nFirst rows: ${sample}`;
}
