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
 * Read-only access to a SQLite file with `node:sqlite`.
 *
 * User SQL runs in a short-lived worker thread so a runaway query can be
 * stopped: the worker opens its own connection with `readOnly: true`,
 * `PRAGMA query_only = ON` and an authorizer that only allows reads, streams
 * at most `maxRows + 1` rows, and is terminated when it exceeds the timeout.
 * Trusted schema queries (`listTables`) use a separate read-only connection.
 */

import {DatabaseSync} from 'node:sqlite';
import {Worker} from 'node:worker_threads';

import {
  type Cell,
  type Column,
  inferColumnType,
  type QueryResult,
  type Row,
  toCell,
} from './query_result.js';
import {assertReadOnlySelect} from './sql_guard.js';

/** Default maximum number of rows a query returns. */
export const DEFAULT_MAX_ROWS = 500;

/** Default query timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 5_000;

/** Limits applied to one query. */
export interface QueryOptions {
  /** Maximum number of rows to return. Optional (default: 500). */
  readonly maxRows?: number;
  /** Time after which the query is stopped, in milliseconds. Optional (default: 5000). */
  readonly timeoutMs?: number;
}

/** A query that failed in SQLite, timed out, or was rejected by the guard. */
export class QueryError extends Error {
  override readonly name = 'QueryError';
}

/** A column of a table, as `PRAGMA table_info` reports it. */
export interface TableColumn {
  readonly name: string;
  readonly type: string;
  readonly primaryKey: boolean;
}

/** A foreign key of a table: its `column` references `table.toColumn`. */
export interface ForeignKey {
  readonly column: string;
  readonly table: string;
  readonly toColumn: string;
}

/** A table of the database with its columns, foreign keys and row count. */
export interface TableInfo {
  readonly name: string;
  readonly columns: readonly TableColumn[];
  readonly foreignKeys: readonly ForeignKey[];
  readonly rowCount: number;
}

/** Message the query worker posts back. */
type WorkerReply =
  | {
      readonly ok: true;
      readonly names: string[];
      readonly declaredTypes: Array<string | null>;
      readonly rows: unknown[][];
      readonly truncated: boolean;
    }
  | {readonly ok: false; readonly message: string};

/** Data the query worker receives. */
interface WorkerInput {
  readonly path: string;
  readonly sql: string;
  readonly maxRows: number;
}

/**
 * Body of the query worker. It runs from its source text, so it must not
 * reference anything outside its own scope.
 */
function queryWorkerMain(): void {
  const {parentPort, workerData} = process.getBuiltinModule(
    'node:worker_threads',
  ) as typeof import('node:worker_threads');
  const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
  const {path, sql, maxRows} = workerData as WorkerInput;
  const c = sqlite.constants;
  const allowed = new Set([c.SQLITE_SELECT, c.SQLITE_READ, c.SQLITE_FUNCTION, c.SQLITE_RECURSIVE]);
  let db: import('node:sqlite').DatabaseSync | undefined;
  try {
    db = new sqlite.DatabaseSync(path, {readOnly: true});
    db.exec('PRAGMA query_only = ON');
    db.setAuthorizer(action => (allowed.has(action) ? c.SQLITE_OK : c.SQLITE_DENY));
    const statement = db.prepare(sql);
    statement.setReturnArrays(true);
    const columns = statement.columns();
    const rows: unknown[][] = [];
    let truncated = false;
    for (const row of statement.iterate()) {
      if (rows.length === maxRows) {
        truncated = true;
        break;
      }
      rows.push(row as unknown as unknown[]);
    }
    parentPort!.postMessage({
      ok: true,
      names: columns.map(column => column.name),
      declaredTypes: columns.map(column => column.type),
      rows,
      truncated,
    });
  } catch (error) {
    parentPort!.postMessage({ok: false, message: (error as Error).message});
  } finally {
    db?.close();
  }
}

/** Gives duplicate column names a numeric suffix so each row key is unique. */
function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map(name => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}_${count + 1}`;
  });
}

/** Builds a {@link QueryResult} from the worker's raw reply. */
export function toQueryResult(
  sql: string,
  rawNames: readonly string[],
  declaredTypes: ReadonlyArray<string | null>,
  rawRows: ReadonlyArray<readonly unknown[]>,
  truncated: boolean,
): QueryResult {
  const names = uniqueNames(rawNames);
  const cells: Cell[][] = rawRows.map(row => row.map(toCell));
  const columns: Column[] = names.map((name, index) => ({
    name,
    type: inferColumnType(
      name,
      cells.map(row => row[index] ?? null),
      declaredTypes[index] ?? null,
    ),
  }));
  const rows: Row[] = cells.map(row =>
    Object.fromEntries(names.map((name, index) => [name, row[index] ?? null])),
  );
  return {sql, columns, rows, truncated};
}

/** A SQLite database opened read-only. */
export class ReadOnlyDatabase {
  private readonly schemaDb: DatabaseSync;
  private readonly distinctCounts = new Map<string, number>();

  /** Opens the SQLite file at `path` read-only; throws when it does not exist. */
  constructor(readonly path: string) {
    this.schemaDb = new DatabaseSync(path, {readOnly: true});
    this.schemaDb.exec('PRAGMA query_only = ON');
  }

  /** Lists the user tables with their columns, foreign keys and row counts. */
  listTables(): TableInfo[] {
    const names = this.schemaDb
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map(row => String(row['name']));
    return names.map(name => {
      const quoted = `"${name.replaceAll('"', '""')}"`;
      const columns = this.schemaDb
        .prepare('SELECT name, type, pk FROM pragma_table_info(?)')
        .all(name)
        .map(row => ({
          name: String(row['name']),
          type: String(row['type'] ?? ''),
          primaryKey: Number(row['pk']) > 0,
        }));
      const foreignKeys = this.schemaDb
        .prepare('SELECT "from", "table", "to" FROM pragma_foreign_key_list(?)')
        .all(name)
        .map(row => ({
          column: String(row['from']),
          table: String(row['table']),
          toColumn: String(row['to'] ?? ''),
        }));
      const count = this.schemaDb.prepare(`SELECT count(*) AS n FROM ${quoted}`).get();
      return {name, columns, foreignKeys, rowCount: Number(count?.['n'] ?? 0)};
    });
  }

  /**
   * Returns the number of distinct non-null values of `table.column`. Only
   * call it with names from {@link listTables}; they are quoted, not bound.
   */
  distinctCount(table: string, column: string): number {
    const key = `${table}.${column}`;
    const cached = this.distinctCounts.get(key);
    if (cached !== undefined) return cached;
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
    const row = this.schemaDb
      .prepare(`SELECT count(DISTINCT ${quote(column)}) AS n FROM ${quote(table)}`)
      .get();
    const count = Number(row?.['n'] ?? 0);
    this.distinctCounts.set(key, count);
    return count;
  }

  /**
   * Runs a single read-only `SELECT` or `WITH` statement and returns at most
   * `maxRows` rows. Rejects with {@link QueryError} when the guard rejects the
   * SQL, SQLite reports an error, or the query exceeds the timeout.
   */
  async query(sql: string, options: QueryOptions = {}): Promise<QueryResult> {
    let checked: string;
    try {
      checked = assertReadOnlySelect(sql);
    } catch (error) {
      throw new QueryError((error as Error).message);
    }
    const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const input: WorkerInput = {path: this.path, sql: checked, maxRows};
    const reply = await new Promise<WorkerReply>((resolve, reject) => {
      const worker = new Worker(`(${queryWorkerMain.toString()})()`, {
        eval: true,
        workerData: input,
      });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new QueryError(`The query took longer than ${timeoutMs} ms and was stopped.`));
      }, timeoutMs);
      worker.once('message', (message: WorkerReply) => {
        clearTimeout(timer);
        void worker.terminate();
        resolve(message);
      });
      worker.once('error', (error: Error) => {
        clearTimeout(timer);
        reject(new QueryError(error.message));
      });
    });
    if (!reply.ok) throw new QueryError(reply.message);
    return toQueryResult(checked, reply.names, reply.declaredTypes, reply.rows, reply.truncated);
  }

  /** Closes the schema connection. Query workers close their own connections. */
  close(): void {
    this.schemaDb.close();
  }
}
