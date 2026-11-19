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

/**
 * Text summaries the tools return as `content`, so the host model can answer
 * follow-up questions without seeing the A2UI payload.
 */

import type {TableInfo} from '../db/database.js';
import type {Cell, Column, QueryResult} from '../db/query_result.js';
import {fitRows, type Layout, MAX_BARS} from './query_view.js';

/** Limits of {@link summarizeResult}. */
export interface SummaryOptions {
  /** Rows listed in full. Optional (default: 10). */
  readonly maxRows?: number;
  /** Characters kept per cell before an ellipsis. Optional (default: 60). */
  readonly maxCellLength?: number;
  /** Rows the view shows. Optional (default: the rows that fit in the view's row budget). */
  readonly viewRows?: number;
  /**
   * How the view presents the result, such as "Shown to the user as a bar
   * chart with a table tab.". Optional (default: described from `layout`).
   */
  readonly viewDescription?: string;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function formatCell(value: Cell, maxLength: number): string {
  if (value === null) return 'NULL';
  const text = typeof value === 'number' ? formatNumber(value) : value.replace(/\s+/g, ' ');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/** Sum, minimum and maximum of a numeric column over the returned rows. */
function numericStats(result: QueryResult, column: Column): string | undefined {
  const values = result.rows
    .map(row => row[column.name])
    .filter((value): value is number => typeof value === 'number');
  if (values.length === 0) return undefined;
  const sum = values.reduce((a, b) => a + b, 0);
  return `${column.name}: sum ${formatNumber(sum)}, min ${formatNumber(Math.min(...values))}, max ${formatNumber(Math.max(...values))}`;
}

/** Says how many rows the view shows when it does not show every returned row. */
function rowsNote(returnedRows: number, viewRows: number): string {
  return viewRows < returnedRows
    ? ` The view shows the first ${viewRows} of ${returnedRows} rows.`
    : '';
}

/** The mark type of a Vega-Lite spec, such as `bar`, or `undefined`. */
function chartMark(chart: unknown): string | undefined {
  if (typeof chart !== 'object' || chart === null) return undefined;
  const mark = (chart as Record<string, unknown>)['mark'];
  if (typeof mark === 'string') return mark;
  if (typeof mark === 'object' && mark !== null) {
    const type = (mark as Record<string, unknown>)['type'];
    if (typeof type === 'string') return type;
  }
  return undefined;
}

/**
 * Describes a view from the component types it actually uses, such as a
 * layout `explain`'s model designed: "Shown to the user as a bar chart with a
 * table tab.", followed by the rows note.
 */
export function describeComposedView(
  components: ReadonlyArray<{readonly component: string}>,
  chart: unknown,
  returnedRows: number,
  viewRows: number,
): string {
  const types = new Set(components.map(component => component.component));
  const table = types.has('DataTable');
  const tabs = types.has('Tabs');
  let view: string;
  if (types.has('VegaChart')) {
    const mark = chartMark(chart);
    view = `a ${mark ? `${mark} ` : ''}chart`;
    if (table) view += tabs ? ' with a table tab' : ' and a sortable table';
  } else if (table) {
    view = 'a sortable table';
  } else if (types.has('Card')) {
    view = 'cards';
  } else {
    view = 'text';
  }
  return `Shown to the user as ${view}.${table || types.has('VegaChart') ? rowsNote(returnedRows, viewRows) : ''}`;
}

/**
 * Says how the view presents the result and, when it does not show every
 * returned row, how many it shows, so the model never claims the user sees
 * rows the view left out.
 */
function describeLayout(layout: Layout, returnedRows: number, viewRows: number): string {
  const tableRows = rowsNote(returnedRows, viewRows);
  switch (layout.kind) {
    case 'kpi':
      return 'Shown to the user as KPI cards.';
    case 'chart': {
      const bars = Math.min(viewRows, MAX_BARS);
      const chartRows =
        layout.mark === 'bar' && bars < viewRows
          ? ` The chart shows the first ${bars} rows as bars.`
          : '';
      return `Shown to the user as a ${layout.mark} chart with a table tab.${tableRows}${chartRows}`;
    }
    case 'table':
      return `Shown to the user as a sortable table.${tableRows}`;
  }
}

/**
 * Summarizes a query result: row and column counts, column types, totals of
 * numeric columns, the first rows as a pipe-separated table, and how the
 * view presents it.
 */
export function summarizeResult(
  result: QueryResult,
  layout: Layout,
  options: SummaryOptions = {},
): string {
  const maxRows = options.maxRows ?? 10;
  const maxCellLength = options.maxCellLength ?? 60;
  const {rows, columns} = result;
  const lines: string[] = [];
  const count = result.truncated
    ? `${rows.length} rows (truncated; more rows exist)`
    : `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`;
  lines.push(
    `Query returned ${count} with columns: ${columns.map(c => `${c.name} (${c.type})`).join(', ')}.`,
  );
  if (rows.length === 1 && layout.kind === 'kpi') {
    const row = rows[0]!;
    lines.push(
      columns.map(c => `${c.name} = ${formatCell(row[c.name] ?? null, maxCellLength)}`).join('; '),
    );
  } else if (rows.length > 0) {
    const stats = columns
      .filter(column => column.type === 'number')
      .map(column => numericStats(result, column))
      .filter((line): line is string => line !== undefined);
    if (stats.length > 0 && rows.length > 1)
      lines.push(`Totals over returned rows: ${stats.join('; ')}.`);
    const shown = rows.slice(0, maxRows);
    lines.push(shown.length === rows.length ? 'Rows:' : `First ${shown.length} rows:`);
    lines.push(columns.map(c => c.name).join(' | '));
    for (const row of shown) {
      lines.push(columns.map(c => formatCell(row[c.name] ?? null, maxCellLength)).join(' | '));
    }
    if (rows.length > shown.length)
      lines.push(`(${rows.length - shown.length} more rows not listed)`);
  }
  lines.push(
    options.viewDescription ??
      describeLayout(layout, rows.length, options.viewRows ?? fitRows(rows).length),
  );
  return lines.join('\n');
}

/** Summarizes the schema: every table with its row count and columns. */
export function summarizeTables(tables: readonly TableInfo[]): string {
  const lines = [`The database has ${tables.length} tables:`];
  for (const table of tables) {
    const columns = table.columns
      .map(column => `${column.name}${column.primaryKey ? ' (PK)' : ''} ${column.type}`.trim())
      .join(', ');
    lines.push(`- ${table.name} (${table.rowCount} rows): ${columns}`);
  }
  lines.push('Shown to the user as a schema browser with Tables and Columns tabs.');
  return lines.join('\n');
}
