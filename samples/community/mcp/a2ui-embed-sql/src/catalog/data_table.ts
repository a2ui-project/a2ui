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
 * The `DataTable` component: a table of rows bound from the data model that
 * the user can sort by clicking a column header and, when `selected` is bound,
 * select a row of. Sorting is local to the element and needs no server round
 * trip; selecting writes the row to the data model.
 */

import {css, html, nothing, type PropertyValues} from 'lit';
import {z} from 'zod';

import {
  A2uiLitElement,
  type ComponentApi,
  DynamicStringSchema,
  DynamicValueSchema,
  spec,
} from '@a2ui/web_core/v1_0';

import {type SortDirection, sortRows} from './sorting.js';

/** Component API of `DataTable`. */
export const DataTableApi = {
  name: 'DataTable',
  schema: spec(
    z
      .object({
        rows: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|The rows: an array of objects keyed by column key. Bind it to the data model, for example {"@path": "/rows"}.',
        ),
        columns: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Optional array of column descriptors {"key": string, "label"?: string, "type"?: "number" | "string" | "date"}. Defaults to the keys of the first row.',
        ).optional(),
        caption: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional caption announced with the table.',
        ).optional(),
        selected: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Optional binding the row the user selects is written to, for example {"@path": "/selected"}, where the data model initially holds null. Rows can be selected only while it resolves to a value other than undefined.',
        ).optional(),
      })
      .describe(
        'A table of rows. The user can sort it by clicking a column header, and select a row when selected is bound.',
      )
      .strict(),
    {mixins: [], required: ['rows']},
  ),
} satisfies ComponentApi;

/** A column of a `DataTable`, as resolved from its `columns` property. */
export interface DataTableColumn {
  readonly key: string;
  readonly label: string;
  readonly type: 'number' | 'string' | 'date';
}

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns the rows of a resolved `rows` property, dropping entries that are not objects. */
export function toRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRow) : [];
}

/**
 * Returns the columns of a resolved `columns` property, or the keys of the
 * first row when `columns` is missing or has no valid entry.
 */
export function toColumns(value: unknown, rows: readonly Row[]): DataTableColumn[] {
  const declared = Array.isArray(value)
    ? value.filter(isRow).flatMap((entry): DataTableColumn[] => {
        const key = entry['key'];
        if (typeof key !== 'string') return [];
        const label = typeof entry['label'] === 'string' ? entry['label'] : key;
        const type = entry['type'];
        return [{key, label, type: type === 'number' || type === 'date' ? type : 'string'}];
      })
    : [];
  if (declared.length > 0) return declared;
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).map(key => ({
    key,
    label: key,
    type: typeof first[key] === 'number' ? 'number' : 'string',
  }));
}

/** Whether `a` and `b` are rows with the same keys and values. */
export function sameRow(a: unknown, b: unknown): boolean {
  if (!isRow(a) || !isRow(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.is(a[key], b[key]));
}

/**
 * Decimal places for a number column: none when every value is an integer,
 * two otherwise, so a column's numbers line up.
 */
export function columnDecimals(rows: readonly Row[], key: string): number {
  return rows.some(row => typeof row[key] === 'number' && !Number.isInteger(row[key])) ? 2 : 0;
}

/** Formats a cell for display; numbers use the locale's grouping and `decimals` places. */
export function formatCell(value: unknown, column: DataTableColumn, decimals = 0): string {
  if (value === null || value === undefined) return '';
  if (column.type === 'number' && typeof value === 'number') {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return String(value);
}

/** `DataTable` element: a universal (Web Component) implementation built with Lit. */
export class A2uiDataTableElement extends A2uiLitElement<typeof DataTableApi> {
  static readonly tagName = 'a2ui-sql-data-table';

  static override properties = {
    sortKey: {state: true},
    sortDirection: {state: true},
  };

  /**
   * The table can be customized with these CSS custom properties:
   *
   * - `--a2ui-data-table-max-height`: maximum height before the body scrolls. Defaults to `360px`.
   * - `--a2ui-data-table-header-background`: header background. Defaults to `var(--a2ui-color-surface, #f8f9fa)`.
   * - `--a2ui-data-table-border`: row separator. Defaults to `1px solid var(--a2ui-color-border, #e0e0e0)`.
   * - `--a2ui-data-table-selected-background`: background of the selected row. Defaults to `var(--a2ui-color-secondary, #e8f0fe)`.
   */
  static override styles = css`
    :host {
      display: block;
      width: 100%;
    }
    .a2ui-data-table-scroll {
      max-height: var(--a2ui-data-table-max-height, 360px);
      overflow: auto;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font: inherit;
      font-variant-numeric: tabular-nums;
    }
    th,
    td {
      padding: var(--a2ui-spacing-xs, 4px) var(--a2ui-spacing-s, 8px);
      border-bottom: var(--a2ui-data-table-border, 1px solid var(--a2ui-color-border, #e0e0e0));
      text-align: start;
      white-space: nowrap;
    }
    th {
      position: sticky;
      top: 0;
      padding: 0;
      background: var(--a2ui-data-table-header-background, var(--a2ui-color-surface, #f8f9fa));
    }
    th button {
      all: unset;
      box-sizing: border-box;
      width: 100%;
      padding: var(--a2ui-spacing-xs, 4px) var(--a2ui-spacing-s, 8px);
      cursor: pointer;
      font-weight: 600;
    }
    th button:focus-visible {
      outline: 2px solid var(--a2ui-color-primary, #1a73e8);
    }
    .a2ui-data-table-number {
      text-align: end;
    }
    tr.a2ui-data-table-selectable {
      cursor: pointer;
    }
    tr.a2ui-data-table-selectable:focus-visible {
      outline: 2px solid var(--a2ui-color-primary, #1a73e8);
      outline-offset: -2px;
    }
    tr[aria-selected='true'] td {
      background: var(--a2ui-data-table-selected-background, var(--a2ui-color-secondary, #e8f0fe));
    }
  `;

  protected override readonly api = DataTableApi;

  /** Key of the column the rows are sorted by, or `undefined` for the original order. */
  declare sortKey: string | undefined;
  /** Direction of the current sort. */
  declare sortDirection: SortDirection;

  constructor() {
    super();
    this.sortKey = undefined;
    this.sortDirection = 'ascending';
  }

  override willUpdate(changedProperties: PropertyValues): void {
    super.willUpdate(changedProperties);
    const props = this.controller?.props;
    if (this.sortKey === undefined || !props) return;
    const rows = toRows(props.rows);
    const columns = toColumns(props.columns, rows);
    if (!columns.some(column => column.key === this.sortKey)) this.sortKey = undefined;
  }

  /** Sorts by `key`, toggling the direction when it is already the sort column. */
  toggleSort(key: string): void {
    if (this.sortKey === key) {
      this.sortDirection = this.sortDirection === 'ascending' ? 'descending' : 'ascending';
    } else {
      this.sortKey = key;
      this.sortDirection = 'ascending';
    }
  }

  /** Writes `row` to the `selected` binding, when there is one. */
  selectRow(row: Row): void {
    this.controller?.props?.setSelected?.(row);
  }

  private onRowKeydown(event: KeyboardEvent, row: Row): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.selectRow(row);
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const rows = toRows(props.rows);
    const columns = toColumns(props.columns, rows);
    const sorted =
      this.sortKey === undefined ? rows : sortRows(rows, this.sortKey, this.sortDirection);
    const caption = typeof props.caption === 'string' ? props.caption : undefined;
    // Display only: sorting compares the raw values.
    const decimals = new Map(
      columns
        .filter(column => column.type === 'number')
        .map(column => [column.key, columnDecimals(rows, column.key)]),
    );
    // Every dynamic property gets a setter, so a missing `selected` is told
    // apart by its value: a binding to a path that holds null, or a row.
    const selectable = props.selected !== undefined;
    return html`
      <div class="a2ui-data-table-scroll">
        <table role=${selectable ? 'grid' : nothing}>
          ${caption
            ? html`<caption>
                ${caption}
              </caption>`
            : nothing}
          <thead>
            <tr>
              ${columns.map(column => {
                const active = this.sortKey === column.key;
                return html`
                  <th
                    scope="col"
                    aria-sort=${active ? this.sortDirection : 'none'}
                    class=${column.type === 'number' ? 'a2ui-data-table-number' : ''}
                  >
                    <button type="button" @click=${() => this.toggleSort(column.key)}>
                      ${column.label}${active
                        ? this.sortDirection === 'ascending'
                          ? ' ▲'
                          : ' ▼'
                        : ''}
                    </button>
                  </th>
                `;
              })}
            </tr>
          </thead>
          <tbody>
            ${sorted.map(
              row => html`
                <tr
                  class=${selectable ? 'a2ui-data-table-selectable' : ''}
                  tabindex=${selectable ? 0 : nothing}
                  aria-selected=${selectable ? String(sameRow(row, props.selected)) : nothing}
                  @click=${selectable ? () => this.selectRow(row) : nothing}
                  @keydown=${selectable
                    ? (event: KeyboardEvent) => this.onRowKeydown(event, row)
                    : nothing}
                >
                  ${columns.map(
                    column => html`
                      <td class=${column.type === 'number' ? 'a2ui-data-table-number' : ''}>
                        ${formatCell(row[column.key], column, decimals.get(column.key))}
                      </td>
                    `,
                  )}
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    `;
  }
}

/** `DataTable` web component implementation for the sample catalog. */
export const A2uiDataTable = {
  ...DataTableApi,
  tagName: A2uiDataTableElement.tagName,
  element: A2uiDataTableElement,
};
