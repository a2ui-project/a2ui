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

/** End-to-end domain tests against the Chinook database; skipped until `yarn fetch-data` has run. */

import {existsSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {validator} from './compose/test_fixtures.js';
import {QueryError} from './db/database.js';
import {createSqlTools, databasePath} from './app.js';

const hasData = existsSync(databasePath());

describe.skipIf(!hasData)('SqlTools on Chinook', () => {
  const tools = createSqlTools({...process.env, GEMINI_API_KEY: ''});

  it('lists the 11 Chinook tables', () => {
    const output = tools.listTables();
    expect(output.text).toMatch(/^The database has 11 tables:/);
    expect(output.text).toContain('- Invoice (412 rows)');
    expect(validator.validate(output.a2ui).errors).toEqual([]);
  });

  it('charts revenue by genre with breakdown buttons', async () => {
    const output = await tools.query({
      sql: 'SELECT g.Name AS Genre, ROUND(SUM(il.UnitPrice * il.Quantity), 2) AS Revenue FROM InvoiceLine il JOIN Track t ON t.TrackId = il.TrackId JOIN Genre g ON g.GenreId = t.GenreId GROUP BY g.Name ORDER BY Revenue DESC LIMIT 10',
      title: 'Top genres',
    });
    expect(validator.validate(output.a2ui).errors).toEqual([]);
    expect(output.text).toContain('Shown to the user as a bar chart with a table tab.');
    expect(output.text).toContain('Rock | 826.65');
    expect(JSON.stringify(output.a2ui)).not.toContain('Genre.Name');
  });

  it('offers breakdowns by other dimensions of the referenced tables', async () => {
    const output = await tools.query({
      sql: 'SELECT c.Country, SUM(i.Total) AS Revenue FROM Invoice i JOIN Customer c ON c.CustomerId = i.CustomerId GROUP BY c.Country ORDER BY Revenue DESC',
    });
    expect(validator.validate(output.a2ui).errors).toEqual([]);
    const components = JSON.stringify(output.a2ui);
    expect(components).toContain('"name":"breakdown"');
    expect(components).toContain('"metric":"Revenue"');
    expect(components).not.toContain('"dimension":"Customer.Country"');
  });

  it('draws a line chart for monthly revenue', async () => {
    const output = await tools.query({
      sql: "SELECT strftime('%Y-%m', InvoiceDate) AS Month, SUM(Total) AS Revenue FROM Invoice GROUP BY Month ORDER BY Month",
    });
    expect(output.text).toContain('line chart');
    expect(validator.validate(output.a2ui).errors).toEqual([]);
  });

  it('shows a KPI for a single number', async () => {
    const output = await tools.query({sql: 'SELECT COUNT(*) AS Customers FROM Customer'});
    expect(output.text).toContain('Customers = 59');
  });

  it('refreshes in place on the same surface', async () => {
    const output = await tools.refresh(
      {sql: 'SELECT Name FROM Artist ORDER BY Name LIMIT 3'},
      'surface-1',
    );
    expect(output.a2ui.map(message => Object.keys(message).find(key => key !== 'version'))).toEqual(
      ['updateComponents', 'updateDataModel'],
    );
    expect(JSON.stringify(output.a2ui)).toContain('"surfaceId":"surface-1"');
  });

  it('refreshes a composed view by updating only its data', async () => {
    const output = await tools.refresh(
      {sql: 'SELECT Name FROM Artist ORDER BY Name LIMIT 3', layout: 'composed'},
      'surface-1',
    );
    const updates = output.a2ui.map(message => {
      if (!('updateDataModel' in message)) throw new Error('expected data updates only');
      return message.updateDataModel.path;
    });
    expect(updates).toEqual(['/footer', '/rows', '/columns', '/selected']);
    expect(output.text).toContain('keeps the layout explain designed');
    expect(validator.validate(output.a2ui).errors).toEqual([]);
  });

  it('rejects writes', async () => {
    await expect(tools.query({sql: 'DELETE FROM Artist'})).rejects.toBeInstanceOf(QueryError);
  });

  it('explains without a key with a text error and no UI', async () => {
    const output = await tools.explain('How many artists?');
    expect(output).toEqual({text: expect.stringContaining('GEMINI_API_KEY'), a2ui: []});
  });
});
