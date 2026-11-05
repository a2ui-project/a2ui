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

import * as assert from 'node:assert';
import {describe, it} from 'node:test';
import {A2uiExpressionError} from '@a2ui/web_core/v1_0';
import {compileSafeRegex, mapTextValue} from './regex_support.js';

describe('compileSafeRegex', () => {
  it('compiles a pattern in Unicode mode', () => {
    const compiled = compileSafeRegex('^(\\w+)\\.(\\w+)$', 'test');
    assert.deepStrictEqual(compiled.exec('notes.md')?.slice(1), ['notes', 'md']);
    assert.strictEqual(compiled.flags, 'u');
  });

  it('supports lookahead assertions in the A2UI regex dialect', () => {
    const compiled = compileSafeRegex('^(?=.*\\d)(\\w+)$', 'test');
    assert.deepStrictEqual(compiled.exec('item42')?.slice(1), ['item42']);
    assert.strictEqual(compiled.exec('item'), null);
  });

  it('returns the same instance for the same source', () => {
    const first = compileSafeRegex('cached', 'test');
    assert.strictEqual(compileSafeRegex('cached', 'test'), first);
  });

  const rejected: ReadonlyArray<readonly [string, string]> = [
    ['a lookbehind assertion', '(?<=\\[)\\w+'],
    ['a negative lookbehind assertion', '(?<!a)b'],
    ['a backreference', '(\\w)\\1'],
    ['a named capture group', '(?<name>\\w+)'],
    ['a Unicode property escape', '\\p{L}+'],
    ['an unbalanced group', '(abc'],
    ['nested quantifiers that backtrack catastrophically', '(a+)+$'],
    ['an inline flag', '(?i)dir'],
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

  it('turns a non-string scalar into text before calling the function', () => {
    assert.strictEqual(
      mapTextValue(null, item => `[${item}]`),
      '[]',
    );
    assert.strictEqual(
      mapTextValue(42, item => `[${item}]`),
      '[42]',
    );
  });
});
