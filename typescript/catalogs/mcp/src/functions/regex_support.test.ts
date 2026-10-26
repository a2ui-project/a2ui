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
import {compileSafeRegex, isPortableRegex, mapTextValue} from './regex_support.js';

describe('isPortableRegex', () => {
  const nonPortable: ReadonlyArray<readonly [string, string]> = [
    ['a lookahead', 'a(?=b)'],
    ['a negative lookahead', 'a(?!b)'],
    ['a lookbehind', '(?<=a)b'],
    ['a negative lookbehind', '(?<!a)b'],
    ['a numbered backreference', '(\\w)\\1'],
    ['a high numbered backreference', '(a)(b)(c)(d)(e)(f)(g)(h)(i)\\9'],
    ['a named backreference', '(?<ch>\\w)\\k<ch>'],
  ];

  for (const [label, pattern] of nonPortable) {
    it(`rejects ${label}`, () => {
      assert.strictEqual(isPortableRegex(pattern), false);
    });
  }

  const portable: ReadonlyArray<readonly [string, string]> = [
    ['capture groups and anchors', '^Title: (.+)$'],
    ['a non-capturing group', '(?:DIR|FILE) (.+)'],
    ['a named capture group', '(?<name>\\w+)'],
    ['an escaped parenthesis before a question mark', '\\(?=x'],
    ['an escaped backslash before a digit', '\\\\1'],
    ['lookaround characters inside a character class', '[(?=]+'],
    ['a backreference-like escape inside a character class', '[\\1]'],
    ['an escaped closing bracket inside a character class', '[\\](?=]'],
  ];

  for (const [label, pattern] of portable) {
    it(`accepts ${label}`, () => {
      assert.strictEqual(isPortableRegex(pattern), true);
    });
  }
});

describe('compileSafeRegex', () => {
  it('compiles a pattern', () => {
    const compiled = compileSafeRegex('^(\\w+)\\.(\\w+)$', 'test');
    assert.deepStrictEqual(compiled.exec('notes.md')?.slice(1), ['notes', 'md']);
    assert.strictEqual(compiled.flags, '');
  });

  it('returns the same instance for the same source', () => {
    const first = compileSafeRegex('cached', 'test');
    assert.strictEqual(compileSafeRegex('cached', 'test'), first);
  });

  const rejected: ReadonlyArray<readonly [string, string]> = [
    ['a lookaround assertion', '(?<=\\[)\\w+(?=\\])'],
    ['a backreference', '(\\w)\\1'],
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
