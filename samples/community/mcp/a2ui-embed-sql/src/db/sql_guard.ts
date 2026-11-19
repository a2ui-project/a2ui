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
 * Syntactic check that a SQL string is a single read-only `SELECT` or `WITH`
 * statement. This is defense in depth: the database is opened read-only with
 * `PRAGMA query_only = ON` and an authorizer that only allows reads, which is
 * the real guarantee.
 */

/** A SQL string the guard rejected, with a message the model can act on. */
export class SqlGuardError extends Error {
  override readonly name = 'SqlGuardError';
}

/** Keywords that start or embed a statement that is not a plain read. */
const FORBIDDEN_KEYWORDS = new Set([
  'ALTER',
  'ANALYZE',
  'ATTACH',
  'BEGIN',
  'COMMIT',
  'CREATE',
  'DELETE',
  'DETACH',
  'DROP',
  'END',
  'INSERT',
  'PRAGMA',
  'REINDEX',
  'RELEASE',
  'ROLLBACK',
  'SAVEPOINT',
  'TRANSACTION',
  'UPDATE',
  'UPSERT',
  'VACUUM',
]);

/** Maximum accepted SQL length, in characters. */
export const MAX_SQL_LENGTH = 10_000;

interface Token {
  /** Upper-cased bare word, or the punctuation character. */
  readonly text: string;
  readonly kind: 'word' | 'punct';
}

/**
 * Splits SQL into bare words and punctuation, skipping comments, string
 * literals and quoted identifiers, so keywords inside them are ignored.
 */
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end + 1;
    } else if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) throw new SqlGuardError('Unterminated block comment.');
      i = end + 2;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      i = skipQuoted(sql, i, ch);
      tokens.push({text: 'LITERAL', kind: 'punct'});
    } else if (ch === '[') {
      const end = sql.indexOf(']', i + 1);
      if (end === -1) throw new SqlGuardError('Unterminated [identifier].');
      i = end + 1;
      tokens.push({text: 'LITERAL', kind: 'punct'});
    } else if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j]!)) j++;
      tokens.push({text: sql.slice(i, j).toUpperCase(), kind: 'word'});
      i = j;
    } else if (/\s/.test(ch)) {
      i++;
    } else {
      tokens.push({text: ch, kind: 'punct'});
      i++;
    }
  }
  return tokens;
}

/** Returns the index after a quoted run starting at `start`; doubled quotes escape. */
function skipQuoted(sql: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  throw new SqlGuardError('Unterminated quoted string or identifier.');
}

/**
 * Returns the SQL without trailing semicolons and whitespace when it is a
 * single `SELECT` or `WITH` statement, and throws {@link SqlGuardError}
 * otherwise.
 */
export function assertReadOnlySelect(sql: string): string {
  const trimmed = sql.trim().replace(/;\s*$/, '').trim();
  if (trimmed.length === 0) throw new SqlGuardError('The SQL is empty.');
  if (trimmed.length > MAX_SQL_LENGTH) {
    throw new SqlGuardError(`The SQL is longer than ${MAX_SQL_LENGTH} characters.`);
  }
  const tokens = tokenize(trimmed);
  const first = tokens[0];
  if (!first || first.kind !== 'word' || (first.text !== 'SELECT' && first.text !== 'WITH')) {
    throw new SqlGuardError('Only a single SELECT or WITH statement is allowed.');
  }
  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t]!;
    if (token.kind === 'punct' && token.text === ';') {
      throw new SqlGuardError('Only one statement is allowed; remove the extra ";".');
    }
    if (token.kind !== 'word') continue;
    // REPLACE is also a scalar function, so only the statement form is rejected.
    const isReplaceStatement = token.text === 'REPLACE' && tokens[t + 1]?.text !== '(';
    if (FORBIDDEN_KEYWORDS.has(token.text) || isReplaceStatement) {
      throw new SqlGuardError(`"${token.text}" is not allowed; the database is read-only.`);
    }
  }
  return trimmed;
}
