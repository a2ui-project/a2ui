/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, it, beforeEach} from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import yaml from 'js-yaml';
import {ExpressionParser} from './expression_parser.js';
import {A2uiExpressionError} from '../../errors.js';

interface ConformanceCase {
  name: string;
  description?: string;
  input: string;
  expect?: unknown[];
  expect_error?: {category: string; message?: string};
}

/** Suite-level error categories mapped onto this SDK's error types. */
const CATEGORY_TO_ERROR: Record<string, new (...args: never[]) => Error> = {
  ParseError: A2uiExpressionError,
};

/** Walks up from this file until it finds the shared conformance suite. */
function findSuite(relPath: string): string {
  let dir = path.dirname(url.fileURLToPath(import.meta.url));
  while (dir !== path.parse(dir).root) {
    const candidate = path.join(dir, relPath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  throw new Error(`Could not find conformance suite ${relPath}`);
}

/**
 * Joins adjacent literal parts.
 *
 * A template fixes which values a parser produces, not how it happens to split
 * the literal text around them, so both are compared in joined form.
 */
function joinLiterals(parts: unknown[]): unknown[] {
  const joined: unknown[] = [];
  for (const part of parts) {
    const last = joined.length - 1;
    if (typeof part === 'string' && last >= 0 && typeof joined[last] === 'string') {
      joined[last] = (joined[last] as string) + part;
    } else {
      joined.push(part);
    }
  }
  return joined;
}

describe('expression parser conformance', () => {
  const suitePath = findSuite(path.join('conformance', 'core', 'expressions.yaml'));
  const cases = yaml.load(fs.readFileSync(suitePath, 'utf8')) as ConformanceCase[];

  let parser: ExpressionParser;

  beforeEach(() => {
    parser = new ExpressionParser();
  });

  for (const testCase of cases) {
    it(testCase.name, () => {
      if (testCase.expect_error) {
        const {category, message} = testCase.expect_error;
        const expectedError = CATEGORY_TO_ERROR[category] ?? A2uiExpressionError;
        assert.throws(
          () => parser.parse(testCase.input),
          (error: unknown) =>
            error instanceof expectedError &&
            new RegExp(message ?? '').test(String((error as Error).message)),
          `expected ${category} matching "${message}"`,
        );
        return;
      }

      assert.deepStrictEqual(joinLiterals(parser.parse(testCase.input)), testCase.expect);
    });
  }
});
