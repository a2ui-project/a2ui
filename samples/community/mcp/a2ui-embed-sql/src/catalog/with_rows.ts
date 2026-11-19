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
 * The `withRows` function: fills a Vega-Lite spec's inline data from data
 * model rows, so a chart and a table can bind to the same rows instead of the
 * chart carrying its own copy in the spec.
 */

import {z} from 'zod';

import {
  createFunctionImplementation,
  DynamicNumberSchema,
  DynamicValueSchema,
  spec,
} from '@a2ui/web_core/v1_0';

/** Function API of `withRows`. */
export const WithRowsApi = {
  name: 'withRows' as const,
  returnType: 'object' as const,
  description:
    'Returns a Vega-Lite spec with data.values set to rows (or their first limit rows), so a VegaChart can read the same rows as a DataTable.',
  schema: spec(
    z
      .object({
        spec: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|A Vega-Lite spec without data, for example {"@path": "/chart"}.',
        ),
        rows: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|The rows: an array of objects, for example {"@path": "/rows"}.',
        ),
        limit: DynamicNumberSchema.describe(
          'REF:#/$defs/DynamicNumber|Optional. Most rows the chart uses. Defaults to every row.',
        ).optional(),
      })
      .strict(),
    {closure: 'unevaluatedProperties'},
  ),
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns `chartSpec` with `data.values` set to the leading `limit` entries of `rows`. */
export function withRows(
  chartSpec: unknown,
  rows: unknown,
  limit?: number,
): Record<string, unknown> {
  const values = Array.isArray(rows) ? rows.filter(isObject) : [];
  const capped = limit === undefined ? values : values.slice(0, Math.max(0, limit));
  return {...(isObject(chartSpec) ? chartSpec : {}), data: {values: capped}};
}

/** `withRows` implementation for the sample catalog. */
export const WithRowsImplementation = createFunctionImplementation(WithRowsApi, args =>
  withRows(args.spec, args.rows, typeof args.limit === 'number' ? args.limit : undefined),
);
