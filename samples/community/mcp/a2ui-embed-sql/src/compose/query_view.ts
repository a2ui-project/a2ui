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
 * Deterministic view composition for query results: picks a KPI, chart or
 * table layout from the result's shape. Data values only go into the data
 * model; components bind to them by path.
 */

import type {Column, QueryResult} from '../db/query_result.js';
import {
  type BreakdownContext,
  breakdownAction,
  QUERY_PATH,
  refreshAction,
  type Visualization,
} from './events.js';
import {type A2uiComponent, type A2uiView, bind} from './messages.js';

/** The layout {@link chooseLayout} picked. */
export type Layout =
  | {readonly kind: 'kpi'; readonly metrics: readonly Column[]}
  | {
      readonly kind: 'chart';
      readonly mark: 'bar' | 'line';
      readonly label: Column;
      readonly metrics: readonly Column[];
    }
  | {readonly kind: 'table'};

/** Most KPI cards shown for a single-row result. */
export const MAX_KPIS = 4;

/** Most bars a bar chart shows; the table tab keeps every row the view shows. */
export const MAX_BARS = 50;

/**
 * Neutral axis, grid and legend colors that read on light and dark host
 * themes (Vega's defaults draw near-white grid lines on a dark background).
 */
export const CHART_CONFIG = {
  background: null,
  view: {stroke: null},
  axis: {
    domainColor: '#8a8a8a',
    tickColor: '#8a8a8a',
    gridColor: 'rgba(138, 138, 138, 0.25)',
    labelColor: '#8a8a8a',
    titleColor: '#8a8a8a',
  },
  legend: {labelColor: '#8a8a8a', titleColor: '#8a8a8a'},
};

/**
 * Most bytes of row JSON a view puts in its data model. The app shares the
 * whole data model with the host model when the user selects a row, and
 * `@a2ui/embed` leaves out a data model above 16 KiB, so the rows (shown in
 * both the table and the chart) are kept well under half of that.
 */
export const ROW_BUDGET_BYTES = 5 * 1024;

/** Data model path a `DataTable` writes the row the user selects to. */
export const SELECTED_PATH = '/selected';

/** Returns the leading rows whose JSON fits in `budgetBytes`, and at least one row. */
export function fitRows<T>(rows: readonly T[], budgetBytes = ROW_BUDGET_BYTES): T[] {
  let used = 2;
  const kept: T[] = [];
  for (const row of rows) {
    used += Buffer.byteLength(JSON.stringify(row)) + 1;
    if (used > budgetBytes && kept.length > 0) break;
    kept.push(row);
  }
  return kept;
}

/** Options of {@link composeQueryView}. */
export interface QueryViewOptions {
  /** Visualization hint from the caller. Optional (default: 'auto'). */
  readonly visualization?: Visualization;
  /** Title shown above the view. Optional (default: 'Query result'). */
  readonly title?: string;
  /** Dimensions offered as "Break down by …" buttons on grouped results. Optional (default: none). */
  readonly breakdownDimensions?: readonly string[];
}

function isNumeric(column: Column): boolean {
  return column.type === 'number';
}

/** Returns the label column and metrics when the result is one label column plus numeric columns. */
function groupedShape(result: QueryResult): {label: Column; metrics: Column[]} | undefined {
  const [label, ...rest] = result.columns;
  if (!label || rest.length === 0 || !rest.every(isNumeric)) return undefined;
  if (isNumeric(label) && label.type !== 'date') return undefined;
  return {label, metrics: rest};
}

/** The single-row KPI metrics, when every column is numeric and there are at most {@link MAX_KPIS}. */
function kpiMetrics(result: QueryResult): Column[] | undefined {
  const columns = result.columns;
  if (result.rows.length !== 1 || columns.length === 0 || columns.length > MAX_KPIS) {
    return undefined;
  }
  return columns.every(isNumeric) ? [...columns] : undefined;
}

/**
 * Picks the layout for a result:
 *
 * - one row whose columns are all numeric (one to four): KPI cards;
 * - a label column followed by numeric columns, with at least two rows: a chart
 *   and a table in tabs, a line chart when the label is date-like and a bar chart
 *   otherwise;
 * - anything else: a table.
 *
 * A `visualization` hint wins when the result's shape supports it and is
 * ignored otherwise.
 */
export function chooseLayout(result: QueryResult, visualization: Visualization = 'auto'): Layout {
  const kpi = kpiMetrics(result);
  const grouped = groupedShape(result);
  const table: Layout = {kind: 'table'};
  switch (visualization) {
    case 'table':
      return table;
    case 'kpi':
      if (kpi) return {kind: 'kpi', metrics: kpi};
      break;
    case 'bar':
    case 'line':
      if (grouped && result.rows.length > 0) {
        return {kind: 'chart', mark: visualization, ...grouped};
      }
      break;
    case 'auto':
      break;
  }
  if (kpi) return {kind: 'kpi', metrics: kpi};
  if (grouped && result.rows.length >= 2) {
    return {kind: 'chart', mark: grouped.label.type === 'date' ? 'line' : 'bar', ...grouped};
  }
  return table;
}

/** Vega-Lite x-axis type for the label column of a chart. */
function xType(label: Column, mark: 'bar' | 'line'): 'temporal' | 'ordinal' | 'nominal' {
  if (label.type !== 'date') return mark === 'line' ? 'ordinal' : 'nominal';
  return label.name.match(/year$/i) ? 'ordinal' : 'temporal';
}

/**
 * Builds a simple Vega-Lite spec for a grouped result: one series per metric,
 * folded into a `metric`/`value` pair when there are several. It has no
 * `data`: the view fills it from the data model rows with `withRows`, so the
 * rows are stored once. It uses no expressions, so it renders under a strict
 * CSP.
 */
export function chartSpec(layout: Extract<Layout, {kind: 'chart'}>): Record<string, unknown> {
  const {label, metrics, mark} = layout;
  const x = {field: label.name, type: xType(label, mark), sort: null, title: label.name};
  const base = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    config: CHART_CONFIG,
    mark: {type: mark, tooltip: true, ...(mark === 'line' ? {point: true} : {})},
  };
  const [only] = metrics;
  if (metrics.length === 1 && only) {
    return {
      ...base,
      encoding: {x, y: {field: only.name, type: 'quantitative', title: only.name}},
    };
  }
  return {
    ...base,
    transform: [{fold: metrics.map(metric => metric.name), as: ['metric', 'value']}],
    encoding: {
      x,
      y: {field: 'value', type: 'quantitative', title: null},
      color: {field: 'metric', type: 'nominal', title: null},
      ...(mark === 'bar' ? {xOffset: {field: 'metric'}} : {}),
    },
  };
}

/**
 * Text of the caption under a view, such as "12 rows · 2 columns", given the
 * number of rows the view shows. Optional (default: every row).
 */
export function footerText(result: QueryResult, shownRows = result.rows.length): string {
  const rows = result.rows.length;
  let rowText = result.truncated
    ? `First ${rows} rows (more rows were not returned)`
    : `${rows} ${rows === 1 ? 'row' : 'rows'}`;
  if (shownRows < rows) rowText = `Showing ${shownRows} of ${rowText.toLowerCase()}`;
  const columns = result.columns.length;
  return `${rowText} · ${columns} ${columns === 1 ? 'column' : 'columns'}`;
}

/**
 * Readable label of a `Table.Column` dimension for its button: the table for
 * a lookup-style `Name` or `Title` column ("media type" for `MediaType.Name`),
 * the column otherwise ("billing country" for `Invoice.BillingCountry`).
 */
export function dimensionLabel(dimension: string): string {
  const [table = '', column = table] = dimension.split('.');
  const words = /^(Name|Title)$/i.test(column) ? table : column;
  return words
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase();
}

/**
 * The `spec` of a `VegaChart` that draws `/chart` with the rows at `/rows`
 * (the first `limit` of them), through the sample catalog's `withRows`.
 */
export function chartFromRows(limit?: number) {
  return {
    '@call': 'withRows',
    args: {spec: bind('/chart'), rows: bind('/rows'), ...(limit === undefined ? {} : {limit})},
  };
}

function text(id: string, path: string, variant?: 'caption'): A2uiComponent {
  return {id, component: 'Text', text: bind(path), ...(variant ? {variant} : {})};
}

function button(id: string, label: string, action: unknown, primary = false): A2uiComponent[] {
  return [
    {id: `${id}_label`, component: 'Text', text: label},
    {
      id,
      component: 'Button',
      child: `${id}_label`,
      action,
      ...(primary ? {variant: 'primary'} : {}),
    },
  ];
}

/**
 * Composes the view of a query result. See {@link chooseLayout} for the
 * layout rules. Every view has a title, a caption with the row count, a
 * Refresh button, and, for KPI and chart layouts, "Break down by …" buttons
 * for the given dimensions. The view shows the leading rows that fit in
 * {@link ROW_BUDGET_BYTES}; selecting a table row writes it to
 * {@link SELECTED_PATH}.
 */
export function composeQueryView(result: QueryResult, options: QueryViewOptions = {}): A2uiView {
  const visualization = options.visualization ?? 'auto';
  const title = options.title ?? 'Query result';
  const layout = chooseLayout(result, visualization);
  const shown = {...result, rows: fitRows(result.rows)};
  const components: A2uiComponent[] = [];
  const dataModel: Record<string, unknown> = {
    title,
    footer: footerText(result, shown.rows.length),
    rows: shown.rows,
    columns: result.columns.map(column => ({
      key: column.name,
      label: column.name,
      type: column.type,
    })),
    [QUERY_PATH.slice(1)]: {sql: result.sql, visualization, title},
    [SELECTED_PATH.slice(1)]: null,
  };

  const table: A2uiComponent = {
    id: 'table',
    component: 'DataTable',
    rows: bind('/rows'),
    columns: bind('/columns'),
    selected: bind(SELECTED_PATH),
  };

  let body: string;
  if (layout.kind === 'kpi') {
    const row = result.rows[0] ?? {};
    dataModel['kpis'] = layout.metrics.map(metric => ({
      label: metric.name,
      value: row[metric.name],
    }));
    const cards = layout.metrics.map((_, index) => `kpi_${index}`);
    components.push({id: 'kpis', component: 'Row', children: cards});
    layout.metrics.forEach((_, index) => {
      const id = `kpi_${index}`;
      components.push(
        {id, component: 'Card', child: `${id}_column`, weight: 1},
        {id: `${id}_column`, component: 'Column', children: [`${id}_label`, `${id}_value`]},
        text(`${id}_label`, `/kpis/${index}/label`, 'caption'),
        {
          id: `${id}_value`,
          component: 'Text',
          text: {'@call': 'formatNumber', args: {value: bind(`/kpis/${index}/value`)}},
        },
      );
    });
    body = 'kpis';
  } else if (layout.kind === 'chart') {
    dataModel['chart'] = chartSpec(layout);
    components.push(
      {
        id: 'tabs',
        component: 'Tabs',
        tabs: [
          {title: 'Chart', child: 'chart'},
          {title: 'Table', child: 'table'},
        ],
      },
      {
        id: 'chart',
        component: 'VegaChart',
        spec: chartFromRows(layout.mark === 'bar' ? MAX_BARS : undefined),
      },
      table,
    );
    body = 'tabs';
  } else {
    components.push(table);
    body = 'table';
  }

  const actionIds = ['refresh'];
  components.push(...button('refresh', 'Refresh', refreshAction()));
  const metric = layout.kind === 'table' ? undefined : layout.metrics[0];
  if (metric) {
    const label = layout.kind === 'chart' ? layout.label.name : undefined;
    const dimensions = (options.breakdownDimensions ?? []).filter(dimension => dimension !== label);
    dimensions.forEach((dimension, index) => {
      const id = `breakdown_${index}`;
      const context: BreakdownContext = {dimension, metric: metric.name};
      actionIds.push(id);
      components.push(
        ...button(id, `Break down by ${dimensionLabel(dimension)}`, breakdownAction(context)),
      );
    });
  }

  components.unshift(
    {id: 'root', component: 'Column', children: ['title', body, 'footer', 'actions']},
    text('title', '/title'),
    text('footer', '/footer', 'caption'),
    {id: 'actions', component: 'Row', children: actionIds},
  );
  return {components, dataModel};
}
