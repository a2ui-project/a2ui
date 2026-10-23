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

import {describe, it} from 'node:test';
import * as assert from 'node:assert';
import {A2uiExpressionError} from '@a2ui/web_core/v1_0';
import {compileSafeRegex, mapTextValue} from './regex_support.js';

describe('compileSafeRegex', () => {
  it('compiles a pattern with the requested flags', () => {
    const compiled = compileSafeRegex('^(\\w+)\\.(\\w+)$', 'test');
    assert.deepStrictEqual(compiled.exec('notes.md')?.slice(1), ['notes', 'md']);
    assert.strictEqual(compileSafeRegex('a', 'test', 'g').flags, 'g');
  });

  it('returns the same instance for the same source and flags, and distinct ones per flags', () => {
    const first = compileSafeRegex('cached', 'test');
    assert.strictEqual(compileSafeRegex('cached', 'test'), first);
    assert.notStrictEqual(compileSafeRegex('cached', 'test', 'g'), first);
  });

  it('accepts lookarounds and backreferences, which pass the safety check', () => {
    assert.strictEqual(compileSafeRegex('(?<=\\[)\\w+(?=\\])', 'test').test('[DIR]'), true);
    assert.strictEqual(compileSafeRegex('(\\w)\\1', 'test').test('book'), true);
  });

  const rejected: ReadonlyArray<readonly [string, string]> = [
    ['an unbalanced group', '(abc'],
    ['nested quantifiers that backtrack catastrophically', '(a+)+$'],
    ['an RE2 inline flag', '(?i)dir'],
  ];

  for (const [label, source] of rejected) {
    it(`rejects ${label} with an A2uiExpressionError naming the function`, () => {
      assert.throws(
        () => compileSafeRegex(source, 'regexCapture'),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.strictEqual(error.expression, 'regexCapture');
          assert.ok(error.message.includes(source));
          return true;
        },
      );
    });
  }

  it('reads RE2 Unicode and POSIX classes as JavaScript does, not as classes', () => {
    // Without the `u` flag, `\p` is a literal `p`, and `[[:alpha:]]` is the character class
    // `[[:alpha:]` followed by a literal `]`. Payloads written for RE2 need JavaScript syntax.
    assert.strictEqual(compileSafeRegex('^\\pL+$', 'test').test('pLLL'), true);
    assert.strictEqual(compileSafeRegex('^\\pL+$', 'test').test('abc'), false);
    assert.strictEqual(compileSafeRegex('^[[:alpha:]]+$', 'test').test('a]'), true);
    assert.strictEqual(compileSafeRegex('^[[:alpha:]]+$', 'test').test('xyz'), false);
  });

  it('reports invalid flags', () => {
    assert.throws(
      () => compileSafeRegex('a', 'test', 'q'),
      (error: unknown) => {
        assert.ok(error instanceof A2uiExpressionError);
        assert.ok(error.details instanceof SyntaxError);
        return true;
      },
    );
  });

  it('evicts the oldest entry once the cache is full', () => {
    const first = compileSafeRegex('evict_0', 'test');
    for (let i = 1; i <= 100; i++) {
      compileSafeRegex(`evict_${i}`, 'test');
    }
    assert.notStrictEqual(compileSafeRegex('evict_0', 'test'), first);
  });
});

describe('mapTextValue', () => {
  it('applies the function to a single string', () => {
    assert.strictEqual(
      mapTextValue('abc', item => item.toUpperCase()),
      'ABC',
    );
  });

  it('maps the function over an array, converting each element to text', () => {
    assert.deepStrictEqual(
      mapTextValue(['a', 1, null, undefined, true], item => item + '!'),
      ['a!', '1!', '!', '!', 'true!'],
    );
  });

  it('reads null and undefined as the empty string', () => {
    assert.strictEqual(
      mapTextValue(null, item => item.length),
      0,
    );
    assert.strictEqual(
      mapTextValue(undefined, item => item.length),
      0,
    );
  });
});
