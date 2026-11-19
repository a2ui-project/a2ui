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

/** Client-side row sorting used by the `DataTable` component. */

/** Sort direction of a `DataTable` column. */
export type SortDirection = 'ascending' | 'descending';

/**
 * Compares two cell values: `null` and `undefined` sort last, numbers
 * numerically, everything else as locale-aware strings with numeric collation.
 */
export function compareCells(a: unknown, b: unknown): number {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing || bMissing) return Number(aMissing) - Number(bMissing);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, {numeric: true});
}

/**
 * Returns a sorted copy of `rows` by `key`. Missing values stay last in both
 * directions, and ties keep their original order.
 */
export function sortRows<Row extends Record<string, unknown>>(
  rows: readonly Row[],
  key: string,
  direction: SortDirection,
): Row[] {
  const sign = direction === 'ascending' ? 1 : -1;
  return rows
    .map((row, index) => ({row, index}))
    .sort((x, y) => {
      const a = x.row[key];
      const b = y.row[key];
      const aMissing = a === null || a === undefined;
      const bMissing = b === null || b === undefined;
      if (aMissing || bMissing) return Number(aMissing) - Number(bMissing) || x.index - y.index;
      return sign * compareCells(a, b) || x.index - y.index;
    })
    .map(({row}) => row);
}
