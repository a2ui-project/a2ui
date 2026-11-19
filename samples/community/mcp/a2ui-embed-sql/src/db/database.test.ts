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

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {QueryError, ReadOnlyDatabase} from './database.js';

let dir: string;
let path: string;
let db: ReadOnlyDatabase;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'a2ui-embed-sql-'));
  path = join(dir, 'test.sqlite');
  const writable = new DatabaseSync(path);
  writable.exec(`
    CREATE TABLE Genre (GenreId INTEGER PRIMARY KEY, Name NVARCHAR(120));
    CREATE TABLE Sale (SaleId INTEGER PRIMARY KEY, GenreId INTEGER REFERENCES Genre (GenreId), SaleDate DATETIME, Amount NUMERIC(10,2));
    INSERT INTO Genre VALUES (1, 'Rock'), (2, 'Jazz'), (3, 'Latin');
  `);
  const insert = writable.prepare('INSERT INTO Sale VALUES (?, ?, ?, ?)');
  for (let i = 1; i <= 30; i++)
    insert.run(i, (i % 3) + 1, `2009-01-${String(i).padStart(2, '0')} 00:00:00`, i * 1.5);
  writable.close();
  db = new ReadOnlyDatabase(path);
});

afterAll(() => {
  db.close();
  rmSync(dir, {recursive: true, force: true});
});

describe('ReadOnlyDatabase', () => {
  it('returns typed columns and rows', async () => {
    const result = await db.query(
      'SELECT g.Name AS Genre, SUM(s.Amount) AS Total, MIN(s.SaleDate) AS First FROM Sale s JOIN Genre g USING (GenreId) GROUP BY g.Name ORDER BY Total DESC',
    );
    expect(result.columns).toEqual([
      {name: 'Genre', type: 'string'},
      {name: 'Total', type: 'number'},
      {name: 'First', type: 'date'},
    ]);
    expect(result.rows).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  it('caps rows and reports truncation', async () => {
    const result = await db.query('SELECT * FROM Sale', {maxRows: 10});
    expect(result.rows).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it('suffixes duplicate column names', async () => {
    const result = await db.query('SELECT 1 AS a, 2 AS a');
    expect(result.columns.map(column => column.name)).toEqual(['a', 'a_2']);
    expect(result.rows[0]).toEqual({a: 1, a_2: 2});
  });

  it('stops queries that exceed the timeout', async () => {
    const endless =
      'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT max(i) FROM n';
    await expect(db.query(endless, {timeoutMs: 300})).rejects.toThrow(/longer than 300 ms/);
  });

  it('rejects writes in the guard', async () => {
    await expect(db.query('DELETE FROM Sale')).rejects.toBeInstanceOf(QueryError);
  });

  it('denies reads of pragmas and extension loading in the authorizer', async () => {
    await expect(db.query("SELECT * FROM pragma_table_info('Sale')")).rejects.toThrow(QueryError);
    await expect(db.query("SELECT load_extension('x')")).rejects.toThrow(QueryError);
  });

  it('reports SQLite errors as QueryError', async () => {
    await expect(db.query('SELECT nope FROM Sale')).rejects.toThrow(/no such column/);
  });

  it('lists tables with columns, foreign keys and row counts', () => {
    expect(db.listTables()).toEqual([
      {
        name: 'Genre',
        rowCount: 3,
        columns: [
          {name: 'GenreId', type: 'INTEGER', primaryKey: true},
          {name: 'Name', type: 'NVARCHAR(120)', primaryKey: false},
        ],
        foreignKeys: [],
      },
      {
        name: 'Sale',
        rowCount: 30,
        columns: [
          {name: 'SaleId', type: 'INTEGER', primaryKey: true},
          {name: 'GenreId', type: 'INTEGER', primaryKey: false},
          {name: 'SaleDate', type: 'DATETIME', primaryKey: false},
          {name: 'Amount', type: 'NUMERIC(10,2)', primaryKey: false},
        ],
        foreignKeys: [{column: 'GenreId', table: 'Genre', toColumn: 'GenreId'}],
      },
    ]);
    expect(db.distinctCount('Sale', 'GenreId')).toBe(3);
  });

  it('cannot write even through a connection-level statement', () => {
    const raw = new DatabaseSync(path, {readOnly: true});
    expect(() => raw.exec("INSERT INTO Genre VALUES (9, 'x')")).toThrow(/readonly/);
    raw.close();
  });
});
