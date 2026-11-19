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
import {
  dimensionColumns,
  groupedColumns,
  groupedDimensions,
  isLookupTable,
  MAX_BREAKDOWNS,
  pickBreakdowns,
  reachableTables,
  referencedTables,
} from './breakdowns.js';

const key = (name: string) => ({name, type: 'INTEGER', primaryKey: true});
const text = (name: string) => ({name, type: 'NVARCHAR(120)', primaryKey: false});
const ref = (name: string) => ({name, type: 'INTEGER', primaryKey: false});
const fk = (column: string, table: string) => ({column, table, toColumn: column});

/** A slice of Chinook: invoice lines reach genres, media types and artists through tracks. */
const TABLES: TableInfo[] = [
  {
    name: 'Customer',
    rowCount: 59,
    columns: [key('CustomerId'), text('FirstName'), text('Country'), text('City'), text('Email')],
    foreignKeys: [],
  },
  {
    name: 'Invoice',
    rowCount: 412,
    columns: [key('InvoiceId'), ref('CustomerId'), text('BillingCountry')],
    foreignKeys: [fk('CustomerId', 'Customer')],
  },
  {
    name: 'InvoiceLine',
    rowCount: 2240,
    columns: [key('InvoiceLineId'), ref('InvoiceId'), ref('TrackId')],
    foreignKeys: [fk('InvoiceId', 'Invoice'), fk('TrackId', 'Track')],
  },
  {
    name: 'Track',
    rowCount: 3503,
    columns: [key('TrackId'), text('Name'), ref('AlbumId'), ref('GenreId'), ref('MediaTypeId')],
    foreignKeys: [fk('AlbumId', 'Album'), fk('GenreId', 'Genre'), fk('MediaTypeId', 'MediaType')],
  },
  {
    name: 'Album',
    rowCount: 347,
    columns: [key('AlbumId'), text('Title'), ref('ArtistId')],
    foreignKeys: [fk('ArtistId', 'Artist')],
  },
  {name: 'Artist', rowCount: 275, columns: [key('ArtistId'), text('Name')], foreignKeys: []},
  {name: 'Genre', rowCount: 25, columns: [key('GenreId'), text('Name')], foreignKeys: []},
  {name: 'MediaType', rowCount: 5, columns: [key('MediaTypeId'), text('Name')], foreignKeys: []},
];

const byName = (name: string) => TABLES.find(table => table.name === name)!;

describe('breakdowns', () => {
  it('finds the tables a query mentions', () => {
    const sql = 'SELECT c.Country, SUM(i.Total) FROM invoice i JOIN Customer c USING (CustomerId)';
    expect(referencedTables(sql, TABLES).map(t => t.name)).toEqual(['Customer', 'Invoice']);
  });

  it('follows foreign keys to the referenced tables, up to two hops', () => {
    const reached = reachableTables([byName('Track')], TABLES).map(
      ({table, hops}) => `${table.name}:${hops}`,
    );
    expect(reached).toEqual(['Track:0', 'Album:1', 'Genre:1', 'MediaType:1', 'Artist:2']);
    expect(reachableTables([byName('Artist')], TABLES).map(({table}) => table.name)).toEqual([
      'Artist',
    ]);
  });

  it('keeps text columns that can group rows', () => {
    expect(dimensionColumns(TABLES.slice(0, 2))).toEqual([
      {table: 'Customer', column: 'Country'},
      {table: 'Customer', column: 'City'},
      {table: 'Invoice', column: 'BillingCountry'},
    ]);
  });

  it('recognizes lookup tables', () => {
    expect(TABLES.filter(isLookupTable).map(table => table.name)).toEqual([
      'Artist',
      'Genre',
      'MediaType',
    ]);
  });

  it('resolves grouped dimensions through aliases and output names', () => {
    expect(
      groupedDimensions(
        'SELECT g.Name AS genre, SUM(il.UnitPrice) AS revenue FROM InvoiceLine il JOIN Track t ON t.TrackId = il.TrackId JOIN Genre AS g ON g.GenreId = t.GenreId GROUP BY genre',
        'genre',
        TABLES,
      ),
    ).toEqual(new Set(['genre.name']));
    expect(
      groupedDimensions(
        'SELECT Country, COUNT(*) FROM Customer GROUP BY Country',
        'Country',
        TABLES,
      ),
    ).toEqual(new Set(['customer.country']));
  });

  it('prefers lookup tables, then nearer tables, then fewer distinct values', () => {
    expect(
      pickBreakdowns(
        [
          {name: 'Track.Name', distinctValues: 3503},
          {name: 'Invoice.BillingCountry', distinctValues: 24, hops: 1},
          {name: 'Album.Title', distinctValues: 347, hops: 1},
          {name: 'MediaType.Name', distinctValues: 5, hops: 1, lookup: true},
          {name: 'Customer.Country', distinctValues: 24, hops: 2},
          {name: 'Artist.Name', distinctValues: 275, hops: 2, lookup: true},
          {name: 'Genre.Name', distinctValues: 25, lookup: true},
        ],
        new Set(['genre.name']),
      ),
    ).toEqual(['MediaType.Name', 'Artist.Name', 'Invoice.BillingCountry']);
  });

  it('skips dimensions named like a grouped one and keeps one per table', () => {
    expect(
      pickBreakdowns(
        [
          {name: 'Customer.City', distinctValues: 53},
          {name: 'Customer.State', distinctValues: 25},
          {name: 'Invoice.BillingCountry', distinctValues: 24},
          {name: 'Customer.Company', distinctValues: 1},
        ],
        new Set(['customer.country']),
      ),
    ).toEqual(['Customer.State']);
  });

  it('reads the bare column names of the GROUP BY clause', () => {
    expect(
      groupedColumns('SELECT g.Name AS Genre, SUM(x) FROM t GROUP BY g.Name ORDER BY 2 DESC'),
    ).toEqual(['Name']);
    expect(groupedColumns('SELECT 1 FROM t GROUP BY "Country", c.City HAVING 1 LIMIT 3')).toEqual([
      'Country',
      'City',
    ]);
    expect(groupedColumns('SELECT 1 FROM t GROUP BY 1')).toEqual([]);
    expect(groupedColumns('SELECT 1 FROM t')).toEqual([]);
  });

  it('returns at most MAX_BREAKDOWNS dimensions', () => {
    const candidates = Array.from({length: 10}, (_, i) => ({name: `T${i}.c`, distinctValues: 5}));
    expect(pickBreakdowns(candidates, new Set(['x.y']))).toHaveLength(MAX_BREAKDOWNS);
  });
});
