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

import {assertReadOnlySelect, MAX_SQL_LENGTH, SqlGuardError} from './sql_guard.js';

describe('assertReadOnlySelect', () => {
  it.each([
    'SELECT 1',
    'select Name from Artist',
    'WITH t AS (SELECT 1 AS a) SELECT a FROM t',
    "SELECT replace(Name, 'a', 'b') FROM Artist",
    "SELECT 'DROP TABLE x; DELETE' AS s",
    'SELECT "update" FROM t',
    'SELECT [insert] FROM t',
    'SELECT 1 -- DELETE FROM t\n',
    'SELECT /* ; DROP */ 1',
  ])('accepts %s', sql => {
    expect(() => assertReadOnlySelect(sql)).not.toThrow();
  });

  it('strips trailing semicolons and whitespace', () => {
    expect(assertReadOnlySelect('  SELECT 1 ;  ')).toBe('SELECT 1');
  });

  it.each([
    ['', /empty/],
    ['DELETE FROM Artist', /Only a single SELECT/],
    ['PRAGMA table_info(Artist)', /Only a single SELECT/],
    ['SELECT 1; SELECT 2', /Only one statement/],
    ['SELECT 1; DROP TABLE Artist', /Only one statement/],
    ['WITH t AS (SELECT 1) DELETE FROM Artist', /"DELETE" is not allowed/],
    ['WITH t AS (SELECT 1) INSERT INTO Artist SELECT * FROM t', /"INSERT" is not allowed/],
    ['WITH t AS (SELECT 1) REPLACE INTO Artist VALUES (1)', /"REPLACE" is not allowed/],
    ["SELECT 1 FROM t WHERE x = 'unterminated", /Unterminated/],
    ['SELECT /* open', /Unterminated block comment/],
    ["ATTACH DATABASE 'x' AS y", /Only a single SELECT/],
  ])('rejects %j', (sql, message) => {
    expect(() => assertReadOnlySelect(sql)).toThrow(message);
  });

  it('rejects SQL longer than the limit with a SqlGuardError', () => {
    const sql = `SELECT '${'x'.repeat(MAX_SQL_LENGTH)}'`;
    expect(() => assertReadOnlySelect(sql)).toThrow(SqlGuardError);
  });
});
