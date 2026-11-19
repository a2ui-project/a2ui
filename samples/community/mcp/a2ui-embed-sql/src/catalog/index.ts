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
 * The sample catalog: every basic catalog component and function, plus the
 * custom `DataTable`, the `VegaChart` from `@a2ui/catalog-vegachart`, and the
 * `withRows` function that feeds a chart the table's rows.
 */

import {A2uiVegaChartV1} from '@a2ui/catalog-vegachart/v1';
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import {Catalog} from '@a2ui/web_core/v1_0';
import type {WebComponentImplementation} from '@a2ui/web_core/universal';

import {SQL_CATALOG_ID} from './catalog_id.js';
import {A2uiDataTable} from './data_table.js';
import {WithRowsImplementation} from './with_rows.js';

export {SQL_CATALOG_ID} from './catalog_id.js';
export {A2uiDataTable, A2uiDataTableElement, DataTableApi} from './data_table.js';
export {withRows, WithRowsApi, WithRowsImplementation} from './with_rows.js';

/** The A2UI v1.0 catalog the SQL sample renders with. */
export const sqlCatalog = new Catalog<WebComponentImplementation>(
  SQL_CATALOG_ID,
  '1.0',
  [...basicCatalog.components.values(), A2uiDataTable, A2uiVegaChartV1],
  [...basicCatalog.functions.values(), WithRowsImplementation],
  {
    themeSchema: basicCatalog.themeSchema,
    schemaUri: 'https://json-schema.org/draft/2020-12/schema',
    schemaId: SQL_CATALOG_ID,
    title: 'A2UI SQL Sample Catalog',
    description:
      'The basic catalog plus a sortable DataTable and a Vega-Lite VegaChart, for read-only SQL results.',
  },
);
