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

/** The shape of a query result and the column type inference composers rely on. */

/** A cell value after conversion from SQLite: blobs become a short description. */
export type Cell = string | number | null;

/** A result row keyed by column name. */
export type Row = Record<string, Cell>;

/** Inferred type of a result column. */
export type ColumnType = 'number' | 'string' | 'date';

/** A result column with its inferred type. */
export interface Column {
  readonly name: string;
  readonly type: ColumnType;
}

/** The rows a query returned, capped at the row limit. */
export interface QueryResult {
  /** The SQL that ran, after the guard normalized it. */
  readonly sql: string;
  readonly columns: readonly Column[];
  readonly rows: readonly Row[];
  /** True when the query returned more rows than the row limit. */
  readonly truncated: boolean;
}

/** Calendar dates and timestamps: `2009`, `2009-01`, `2009-01-03`, `2009-01-03 10:00:00`. */
const DATE_LIKE = /^\d{4}-\d{2}(-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?)?$/;

/** Declared SQLite types that hold dates. */
const DATE_DECLARED_TYPE = /DATE|TIME/i;

/** Column names that hold a year or month number, such as `year` or `InvoiceMonth`. */
const PERIOD_NAME = /(^|_|[a-z])(year|month)$/i;

/**
 * Infers a column type from its values, falling back to the declared SQLite
 * type when every value is null: `number` when every non-null value is a
 * number, `date` when every non-null value is a date-like string (or a
 * year-like integer in a column named like `year`), `string` otherwise.
 */
export function inferColumnType(
  name: string,
  values: readonly Cell[],
  declaredType: string | null = null,
): ColumnType {
  const present = values.filter((value): value is string | number => value !== null);
  if (present.length === 0) {
    if (declaredType && DATE_DECLARED_TYPE.test(declaredType)) return 'date';
    if (declaredType && /INT|REAL|NUM|DEC|FLOA|DOUB/i.test(declaredType)) return 'number';
    return 'string';
  }
  if (present.every(value => typeof value === 'number')) {
    const isYear = present.every(
      value => Number.isInteger(value) && value >= 1000 && value <= 9999,
    );
    return isYear && /year$/i.test(name) ? 'date' : 'number';
  }
  if (present.every(value => typeof value === 'string' && DATE_LIKE.test(value))) return 'date';
  if (
    PERIOD_NAME.test(name) &&
    present.every(value => typeof value === 'string' && /^\d{4}$/.test(value))
  ) {
    return 'date';
  }
  return 'string';
}

/** Converts a SQLite value to a {@link Cell}. */
export function toCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'bigint') {
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  }
  if (value instanceof Uint8Array) return `<blob ${value.byteLength} bytes>`;
  return String(value);
}
