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

// @vitest-environment jsdom

import {render} from 'lit';
import {beforeAll, describe, expect, it} from 'vitest';

import {ComponentContext, MessageProcessor, renderA2uiNode} from '@a2ui/web_core/v1_0';

import {
  A2uiDataTable,
  A2uiDataTableElement,
  columnDecimals,
  formatCell,
  sameRow,
  toColumns,
  toRows,
} from './data_table.js';
import {SQL_CATALOG_ID, sqlCatalog} from './index.js';

beforeAll(() => {
  if (!customElements.get(A2uiDataTableElement.tagName)) {
    customElements.define(A2uiDataTableElement.tagName, A2uiDataTableElement);
  }
});

describe('DataTable', () => {
  it('reads rows and declared columns, dropping invalid entries', () => {
    const rows = toRows([{a: 1}, 'x', null, {a: 2}]);
    expect(rows).toEqual([{a: 1}, {a: 2}]);
    expect(
      toColumns(
        [{key: 'a', label: 'A', type: 'number'}, {label: 'no key'}, {key: 'b', type: 'pie'}],
        rows,
      ),
    ).toEqual([
      {key: 'a', label: 'A', type: 'number'},
      {key: 'b', label: 'b', type: 'string'},
    ]);
  });

  it('derives columns from the first row when none are declared', () => {
    expect(toColumns(undefined, [{name: 'Rock', total: 3}])).toEqual([
      {key: 'name', label: 'name', type: 'string'},
      {key: 'total', label: 'total', type: 'number'},
    ]);
    expect(toColumns(undefined, [])).toEqual([]);
  });

  it('toggles the sort direction on the same column and resets it on another', () => {
    const element = new A2uiDataTableElement();
    expect(element.sortKey).toBeUndefined();
    element.toggleSort('total');
    expect([element.sortKey, element.sortDirection]).toEqual(['total', 'ascending']);
    element.toggleSort('total');
    expect(element.sortDirection).toBe('descending');
    element.toggleSort('name');
    expect([element.sortKey, element.sortDirection]).toEqual(['name', 'ascending']);
  });

  it('is a universal component implementation', () => {
    expect(A2uiDataTable).toMatchObject({name: 'DataTable', tagName: 'a2ui-sql-data-table'});
    expect(A2uiDataTable.element).toBe(A2uiDataTableElement);
  });

  it('renders bound rows and sorts them when a header is clicked', async () => {
    const processor = new MessageProcessor([sqlCatalog]);
    processor.processMessages([
      {version: '1.0', createSurface: {surfaceId: 's', catalogId: SQL_CATALOG_ID}},
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 's',
          components: [
            {
              id: 'root',
              component: 'DataTable',
              rows: {'@path': '/rows'},
              columns: {'@path': '/columns'},
            },
          ],
        },
      },
      {
        version: '1.0',
        updateDataModel: {
          surfaceId: 's',
          value: {
            rows: [
              {genre: 'Rock', total: 3},
              {genre: 'Jazz', total: 10},
            ],
            columns: [
              {key: 'genre', label: 'Genre'},
              {key: 'total', label: 'Total', type: 'number'},
            ],
          },
        },
      },
    ] as never);
    const surface = processor.model.getSurface('s')!;
    const container = document.createElement('div');
    document.body.append(container);
    render(renderA2uiNode(new ComponentContext(surface, 'root', '/'), sqlCatalog), container);
    const element = container.querySelector(A2uiDataTableElement.tagName) as A2uiDataTableElement;
    await element.updateComplete;
    const cells = () =>
      [...element.querySelectorAll('tbody td:first-child')].map(td => td.textContent?.trim());
    expect([...element.querySelectorAll('th')].map(th => th.textContent?.trim())).toEqual([
      'Genre',
      'Total',
    ]);
    expect(cells()).toEqual(['Rock', 'Jazz']);
    element.querySelector<HTMLButtonElement>('th button')!.click();
    await element.updateComplete;
    expect(cells()).toEqual(['Jazz', 'Rock']);
    expect(element.querySelector('th')!.getAttribute('aria-sort')).toBe('ascending');
    container.remove();
  });

  it('compares rows by keys and values', () => {
    expect(sameRow({a: 1, b: 'x'}, {b: 'x', a: 1})).toBe(true);
    expect(sameRow({a: 1}, {a: 1, b: 2})).toBe(false);
    expect(sameRow({a: 1}, undefined)).toBe(false);
  });

  it('writes the clicked or keyboard-selected row to the selected binding', async () => {
    const processor = new MessageProcessor([sqlCatalog]);
    processor.processMessages([
      {version: '1.0', createSurface: {surfaceId: 's', catalogId: SQL_CATALOG_ID}},
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 's',
          components: [
            {
              id: 'root',
              component: 'DataTable',
              rows: {'@path': '/rows'},
              selected: {'@path': '/selected'},
            },
          ],
        },
      },
      {
        version: '1.0',
        updateDataModel: {
          surfaceId: 's',
          value: {
            rows: [
              {genre: 'Rock', total: 3},
              {genre: 'Jazz', total: 10},
            ],
            selected: null,
          },
        },
      },
    ] as never);
    const surface = processor.model.getSurface('s')!;
    const container = document.createElement('div');
    document.body.append(container);
    render(renderA2uiNode(new ComponentContext(surface, 'root', '/'), sqlCatalog), container);
    const element = container.querySelector(A2uiDataTableElement.tagName) as A2uiDataTableElement;
    await element.updateComplete;
    const rows = () => [...element.querySelectorAll<HTMLTableRowElement>('tbody tr')];
    expect(element.querySelector('table')!.getAttribute('role')).toBe('grid');
    expect(rows().map(row => [row.tabIndex, row.getAttribute('aria-selected')])).toEqual([
      [0, 'false'],
      [0, 'false'],
    ]);

    rows()[1]!.click();
    await element.updateComplete;
    expect(surface.dataModel.get('/selected')).toEqual({genre: 'Jazz', total: 10});
    expect(rows().map(row => row.getAttribute('aria-selected'))).toEqual(['false', 'true']);

    rows()[0]!.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    await element.updateComplete;
    expect(surface.dataModel.get('/selected')).toEqual({genre: 'Rock', total: 3});
    container.remove();
  });

  it('leaves rows unselectable without a selected binding', async () => {
    const processor = new MessageProcessor([sqlCatalog]);
    processor.processMessages([
      {version: '1.0', createSurface: {surfaceId: 's', catalogId: SQL_CATALOG_ID}},
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 's',
          components: [{id: 'root', component: 'DataTable', rows: [{genre: 'Rock'}]}],
        },
      },
    ] as never);
    const container = document.createElement('div');
    document.body.append(container);
    render(
      renderA2uiNode(
        new ComponentContext(processor.model.getSurface('s')!, 'root', '/'),
        sqlCatalog,
      ),
      container,
    );
    const element = container.querySelector(A2uiDataTableElement.tagName) as A2uiDataTableElement;
    await element.updateComplete;
    const row = element.querySelector('tbody tr')!;
    expect([row.hasAttribute('tabindex'), row.hasAttribute('aria-selected')]).toEqual([
      false,
      false,
    ]);
    expect(element.querySelector('table')!.hasAttribute('role')).toBe(false);
    container.remove();
  });

  it('formats number columns with grouping and aligned decimals', () => {
    const column = {key: 'total', label: 'total', type: 'number'} as const;
    expect(columnDecimals([{total: 3}, {total: 1200}], 'total')).toBe(0);
    expect(columnDecimals([{total: 3}, {total: 79.2}], 'total')).toBe(2);
    expect(formatCell(79.2, column, 2)).toBe(
      (79.2).toLocaleString(undefined, {minimumFractionDigits: 2}),
    );
    expect(formatCell(1200, column, 0)).toBe((1200).toLocaleString());
    expect(formatCell('x', {...column, type: 'string'})).toBe('x');
    expect(formatCell(null, column)).toBe('');
  });
});
