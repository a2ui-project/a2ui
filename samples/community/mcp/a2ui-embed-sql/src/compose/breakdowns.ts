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
 * Picks the dimensions a result offers as "Break down by …" buttons. The
 * candidates are text columns of the tables the query mentions and of the
 * tables they reach through foreign keys, so a result grouped by genre can be
 * broken down by media type or artist. Only the server picks them: the
 * follow-up text always comes from the server's template.
 */

import type {TableInfo} from '../db/database.js';

/** Most "Break down by …" buttons a view shows. */
export const MAX_BREAKDOWNS = 3;

/** Most foreign key hops from a table the query mentions to a candidate's table. */
export const MAX_JOIN_HOPS = 2;

/** Most distinct values a dimension may have. */
export const MAX_DISTINCT_VALUES = 500;

/** A text column that could group a metric. */
export interface DimensionCandidate {
  /** `Table.Column`. */
  readonly name: string;
  readonly distinctValues: number;
  /** Foreign key hops from a table the query mentions. Optional (default: 0). */
  readonly hops?: number;
  /** Whether the column belongs to a lookup table, such as `Genre`. Optional (default: false). */
  readonly lookup?: boolean;
}

/** A table the query can reach, with the foreign key hops it takes. */
export interface ReachableTable {
  readonly table: TableInfo;
  readonly hops: number;
}

/** Column names that identify rows or hold free text, never useful to group by. */
const NOT_A_DIMENSION =
  /(^|_)(id|email|phone|fax|address|postal ?code|password|first ?name|last ?name|composer)$|^(.*Id|Email|Phone|Fax|Address|PostalCode|FirstName|LastName|Composer)$/;

const IDENTIFIER = '["`\\[]?([A-Za-z_][A-Za-z0-9_]*)["`\\]]?';

/** Words that can follow a table name in a FROM or JOIN clause without being its alias. */
const NOT_AN_ALIAS = new Set([
  'on',
  'using',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'cross',
  'natural',
  'outer',
  'where',
  'group',
  'order',
  'limit',
  'having',
  'window',
  'union',
]);

/** Returns the tables whose names appear as words in `sql`. */
export function referencedTables(sql: string, tables: readonly TableInfo[]): TableInfo[] {
  const words = new Set(sql.match(/[A-Za-z_][A-Za-z0-9_]*/g)?.map(word => word.toLowerCase()));
  return tables.filter(table => words.has(table.name.toLowerCase()));
}

/**
 * Returns the tables reachable from `start` by following foreign keys from
 * the referencing table to the referenced one, at most `maxHops` away. Those
 * joins are many-to-one, so they never duplicate the rows of a result.
 */
export function reachableTables(
  start: readonly TableInfo[],
  tables: readonly TableInfo[],
  maxHops = MAX_JOIN_HOPS,
): ReachableTable[] {
  const byName = new Map(tables.map(table => [table.name.toLowerCase(), table]));
  const reached = new Map<string, ReachableTable>();
  let frontier = start.map(table => ({table, hops: 0}));
  for (const entry of frontier) reached.set(entry.table.name.toLowerCase(), entry);
  while (frontier.length > 0) {
    const next: ReachableTable[] = [];
    for (const {table, hops} of frontier) {
      if (hops >= maxHops) continue;
      for (const key of table.foreignKeys) {
        const target = byName.get(key.table.toLowerCase());
        if (!target || reached.has(target.name.toLowerCase())) continue;
        const entry = {table: target, hops: hops + 1};
        reached.set(target.name.toLowerCase(), entry);
        next.push(entry);
      }
    }
    frontier = next;
  }
  return [...reached.values()];
}

/** Returns the text columns of `tables` that could be dimensions, as `Table.Column`. */
export function dimensionColumns(
  tables: readonly TableInfo[],
): Array<{table: string; column: string}> {
  return tables.flatMap(table =>
    table.columns
      .filter(
        column =>
          !column.primaryKey &&
          /CHAR|TEXT|CLOB/i.test(column.type) &&
          !NOT_A_DIMENSION.test(column.name),
      )
      .map(column => ({table: table.name, column: column.name})),
  );
}

/** Whether `table` is a lookup table: no foreign keys and a single column besides its key. */
export function isLookupTable(table: TableInfo): boolean {
  return (
    table.foreignKeys.length === 0 &&
    table.columns.filter(column => !column.primaryKey).length === 1
  );
}

/**
 * Returns the bare column names in the query's `GROUP BY` clause, such as
 * `Name` for `GROUP BY g.Name`.
 */
export function groupedColumns(sql: string): string[] {
  return groupedTerms(sql).map(term => term.column);
}

/** A column reference, such as `g.Name`, with its qualifier when it has one. */
interface ColumnTerm {
  readonly qualifier?: string;
  readonly column: string;
}

/** Returns the column references of the query's `GROUP BY` clause. */
function groupedTerms(sql: string): ColumnTerm[] {
  const clause =
    /\bGROUP\s+BY\s+([\s\S]*?)(?=\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|\bWINDOW\b|\)|$)/i.exec(sql);
  if (!clause?.[1]) return [];
  return clause[1].split(',').flatMap((term): ColumnTerm[] => {
    const parts = term
      .trim()
      .split('.')
      .map(part => part.replace(/^["`[]|["`\]]$/g, ''));
    const column = parts.pop() ?? '';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) return [];
    return [{qualifier: parts.pop(), column}];
  });
}

/** Maps the table names and aliases of the FROM and JOIN clauses to table names. */
function tableAliases(sql: string, tables: readonly TableInfo[]): Map<string, string> {
  const names = new Map(tables.map(table => [table.name.toLowerCase(), table.name]));
  const aliases = new Map<string, string>();
  const pattern = new RegExp(
    `\\b(?:FROM|JOIN)\\s+${IDENTIFIER}(?:\\s+(?:AS\\s+)?([A-Za-z_][A-Za-z0-9_]*))?`,
    'gi',
  );
  for (const match of sql.matchAll(pattern)) {
    const table = names.get((match[1] ?? '').toLowerCase());
    if (!table) continue;
    aliases.set(table.toLowerCase(), table);
    const alias = match[2]?.toLowerCase();
    if (alias && !NOT_AN_ALIAS.has(alias)) aliases.set(alias, table);
  }
  return aliases;
}

/** Maps output names such as `genre` in `g.Name AS genre` to their column reference. */
function outputNames(sql: string): Map<string, ColumnTerm> {
  const outputs = new Map<string, ColumnTerm>();
  const pattern = new RegExp(`${IDENTIFIER}\\.${IDENTIFIER}\\s+AS\\s+${IDENTIFIER}`, 'gi');
  for (const match of sql.matchAll(pattern)) {
    if (match[1] && match[2] && match[3]) {
      outputs.set(match[3].toLowerCase(), {qualifier: match[1], column: match[2]});
    }
  }
  return outputs;
}

/**
 * Returns the dimensions a result is already grouped by, as lowercase
 * `table.column`: the GROUP BY columns and the label column, resolved through
 * table aliases and output names. An unqualified name matches that column in
 * every table the query mentions.
 */
export function groupedDimensions(
  sql: string,
  labelColumn: string | undefined,
  tables: readonly TableInfo[],
): Set<string> {
  const aliases = tableAliases(sql, tables);
  const outputs = outputNames(sql);
  const mentioned = referencedTables(sql, tables);
  const grouped = new Set<string>();
  const add = (term: ColumnTerm) => {
    const resolved = term.qualifier ? term : (outputs.get(term.column.toLowerCase()) ?? term);
    const table = resolved.qualifier ? aliases.get(resolved.qualifier.toLowerCase()) : undefined;
    if (table) {
      grouped.add(`${table}.${resolved.column}`.toLowerCase());
      return;
    }
    for (const candidate of mentioned) {
      if (candidate.columns.some(c => c.name.toLowerCase() === resolved.column.toLowerCase())) {
        grouped.add(`${candidate.name}.${resolved.column}`.toLowerCase());
      }
    }
  };
  groupedTerms(sql).forEach(add);
  if (labelColumn) add({column: labelColumn});
  return grouped;
}

/**
 * Picks at most {@link MAX_BREAKDOWNS} dimensions: candidates with 2 to
 * {@link MAX_DISTINCT_VALUES} distinct values that the result is not already
 * grouped by (nor a prefixed variant of one, such as `BillingCountry` for
 * `Country`), one per table. Lookup tables come first, then nearer tables,
 * then fewer distinct values.
 */
export function pickBreakdowns(
  candidates: readonly DimensionCandidate[],
  grouped: ReadonlySet<string>,
): string[] {
  const groupedColumnNames = [...grouped].map(name => name.split('.').pop() ?? name);
  const best = new Map<string, DimensionCandidate>();
  for (const candidate of candidates) {
    const name = candidate.name.toLowerCase();
    const [table = '', column = ''] = name.split('.');
    if (candidate.distinctValues < 2 || candidate.distinctValues > MAX_DISTINCT_VALUES) continue;
    const prefixed = groupedColumnNames.some(
      groupedColumn => column !== groupedColumn && column.endsWith(groupedColumn),
    );
    if (grouped.has(name) || prefixed) {
      continue;
    }
    const current = best.get(table);
    if (!current || candidate.distinctValues < current.distinctValues) best.set(table, candidate);
  }
  return [...best.values()]
    .sort(
      (a, b) =>
        Number(b.lookup ?? false) - Number(a.lookup ?? false) ||
        (a.hops ?? 0) - (b.hops ?? 0) ||
        a.distinctValues - b.distinctValues ||
        a.name.localeCompare(b.name),
    )
    .slice(0, MAX_BREAKDOWNS)
    .map(candidate => candidate.name);
}
