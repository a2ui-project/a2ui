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
import {createSurfaceMessages} from './messages.js';
import {composeTablesView} from './tables_view.js';
import {validator} from './test_fixtures.js';

const TABLES: TableInfo[] = [
  {
    name: 'Genre',
    rowCount: 25,
    foreignKeys: [],
    columns: [
      {name: 'GenreId', type: 'INTEGER', primaryKey: true},
      {name: 'Name', type: 'NVARCHAR(120)', primaryKey: false},
    ],
  },
];

describe('composeTablesView', () => {
  it('renders tables and columns as sortable tables in tabs', () => {
    const view = composeTablesView(TABLES);
    expect(validator.validate(createSurfaceMessages('schema', view)).errors).toEqual([]);
    expect(view.dataModel['tables']).toMatchObject({
      rows: [{table: 'Genre', rows: 25, columns: 'GenreId, Name'}],
    });
    expect(view.dataModel['columns']).toMatchObject({
      rows: [
        {table: 'Genre', column: 'GenreId', type: 'INTEGER', key: 'primary'},
        {table: 'Genre', column: 'Name', type: 'NVARCHAR(120)', key: ''},
      ],
    });
    expect(view.dataModel['footer']).toBe('1 tables · 2 columns');
    expect(JSON.stringify(view.components)).not.toContain('Genre');
  });
});
