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

/** The schema browser `list_tables` renders: tables and columns in sortable tables. */

import type {TableInfo} from '../db/database.js';
import {type A2uiComponent, type A2uiView, bind} from './messages.js';

/**
 * Composes the schema browser: a "Tables" tab and a "Columns" tab, each a
 * `DataTable`. Selecting a row in either writes it to `/selected`.
 */
export function composeTablesView(tables: readonly TableInfo[]): A2uiView {
  const components: A2uiComponent[] = [
    {id: 'root', component: 'Column', children: ['title', 'tabs', 'footer']},
    {id: 'title', component: 'Text', text: bind('/title')},
    {
      id: 'tabs',
      component: 'Tabs',
      tabs: [
        {title: 'Tables', child: 'tables'},
        {title: 'Columns', child: 'columns'},
      ],
    },
    {
      id: 'tables',
      component: 'DataTable',
      rows: bind('/tables/rows'),
      columns: bind('/tables/columns'),
      selected: bind('/selected'),
    },
    {
      id: 'columns',
      component: 'DataTable',
      rows: bind('/columns/rows'),
      columns: bind('/columns/columns'),
      selected: bind('/selected'),
    },
    {id: 'footer', component: 'Text', text: bind('/footer'), variant: 'caption'},
  ];
  const totalColumns = tables.reduce((sum, table) => sum + table.columns.length, 0);
  const dataModel = {
    title: 'Database schema',
    selected: null,
    footer: `${tables.length} tables · ${totalColumns} columns`,
    tables: {
      columns: [
        {key: 'table', label: 'Table', type: 'string'},
        {key: 'rows', label: 'Rows', type: 'number'},
        {key: 'columns', label: 'Columns', type: 'string'},
      ],
      rows: tables.map(table => ({
        table: table.name,
        rows: table.rowCount,
        columns: table.columns.map(column => column.name).join(', '),
      })),
    },
    columns: {
      columns: [
        {key: 'table', label: 'Table', type: 'string'},
        {key: 'column', label: 'Column', type: 'string'},
        {key: 'type', label: 'Type', type: 'string'},
        {key: 'key', label: 'Key', type: 'string'},
      ],
      rows: tables.flatMap(table =>
        table.columns.map(column => ({
          table: table.name,
          column: column.name,
          type: column.type,
          key: column.primaryKey ? 'primary' : '',
        })),
      ),
    },
  };
  return {components, dataModel};
}
