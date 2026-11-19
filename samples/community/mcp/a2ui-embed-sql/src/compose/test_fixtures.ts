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

/** Shared fixtures for the composer tests. */

import catalogSchema from '../catalog/catalog_schema.json' with {type: 'json'};
import type {Column, QueryResult, Row} from '../db/query_result.js';
import {MessageValidator} from './validate.js';

/** A validator for the committed sample catalog schema. */
export const validator = new MessageValidator(catalogSchema as Record<string, unknown>);

/** The committed catalog schema. */
export const CATALOG_SCHEMA = catalogSchema as Record<string, unknown>;

/** Builds a {@link QueryResult}. */
export function result(columns: Column[], rows: Row[], truncated = false): QueryResult {
  return {sql: 'SELECT ...', columns, rows, truncated};
}

/** One numeric cell. */
export const SINGLE_NUMBER = result([{name: 'Revenue', type: 'number'}], [{Revenue: 2328.6}]);

/** A label column and one metric. */
export const BY_GENRE = result(
  [
    {name: 'Genre', type: 'string'},
    {name: 'Revenue', type: 'number'},
  ],
  [
    {Genre: 'Rock', Revenue: 826.65},
    {Genre: 'Latin', Revenue: 382.14},
    {Genre: 'Metal', Revenue: 261.36},
  ],
);

/** A date column and two metrics. */
export const BY_MONTH = result(
  [
    {name: 'Month', type: 'date'},
    {name: 'Revenue', type: 'number'},
    {name: 'Invoices', type: 'number'},
  ],
  [
    {Month: '2009-01', Revenue: 35.64, Invoices: 6},
    {Month: '2009-02', Revenue: 37.62, Invoices: 7},
  ],
);

/** Rows with several text columns. */
export const DETAIL = result(
  [
    {name: 'Name', type: 'string'},
    {name: 'Composer', type: 'string'},
    {name: 'Milliseconds', type: 'number'},
  ],
  [
    {Name: 'For Those About To Rock', Composer: 'Angus Young', Milliseconds: 343719},
    {Name: 'Balls to the Wall', Composer: null, Milliseconds: 342562},
  ],
);
