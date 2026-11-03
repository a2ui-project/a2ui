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

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  MAX_REGEX_PATTERN_CODE_POINTS,
  MAX_REGEX_VALUE_CODE_POINTS,
  RegexSyntaxError,
  analyzeRegex,
  chars,
  checkRegexSafety,
  complementRanges,
  countCodePoints,
  first,
  hasUnbounded,
  normalizeRanges,
  nullable,
  parseRegexSubset,
  rangesOverlap,
  unwrap,
} from './regex_subset.js';

describe('regex_subset', () => {
  it('exposes standard pattern and value length constants', () => {
    assert.strictEqual(MAX_REGEX_PATTERN_CODE_POINTS, 256);
    assert.strictEqual(MAX_REGEX_VALUE_CODE_POINTS, 4096);
  });

  describe('grammar acceptance', () => {
    const validPatterns = [
      '',
      'abc',
      '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$',
      '^(?:cat|dog)s?$',
      '^(?=.*[A-Z])(?=.*\\d)[A-Za-z\\d]{8,}$',
      '^(?!.*\\s).+$',
      '^\\d{3}-\\d{4}$',
      '^[\\x20-\\x7E\\u00A0-\\u00FF]+$',
      '^\\u{1F600}+$',
      '\\bword\\b',
      '\\Binner\\B',
      '[\\b]',
      '\\0',
      '[\\0-\\x1F]',
      '[-a-z]',
      '[a-z-]',
      '[^0-9]',
      'a*?b+?c??d{1,3}?e{2,}?',
      '\\t\\n\\v\\f\\r',
      '\\^\\$\\\\\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\/\\-',
    ];

    for (const pattern of validPatterns) {
      it(`accepts valid dialect pattern: ${JSON.stringify(pattern)}`, () => {
        const res = analyzeRegex(pattern);
        assert.strictEqual(res.ok, true, `Expected ${pattern} to be accepted`);
      });
    }
  });

  describe('UNSUPPORTED_SYNTAX rejections', () => {
    const unsupportedPatterns = [
      '(a)\\1',
      '(a)(b)\\2',
      '\\k<id>',
      '(?<=a)b',
      '(?<!a)b',
      '(?<id>\\w+)',
      '(?i)abc',
      '(?m)^abc$',
      '\\p{L}',
      '\\P{N}',
      '\\cA',
      '\\01',
      '\\1',
      '\\a',
      '[a&&b]',
      '[a--b]',
      '[[a-z]]',
      '[\\B]',
      'a{',
      'a{invalid}',
      'a{1,x}',
      '{',
      '}',
      ']',
      '^*',
      '$+',
      '\\b?',
      '(?=a)+',
      '(?!a)*',
      'a++',
      'a*+',
      '\\uD800',
      '\\u{DFFF}',
      '\uD800',
      '\uDC00',
    ];

    for (const pattern of unsupportedPatterns) {
      it(`rejects ${JSON.stringify(pattern)} with UNSUPPORTED_SYNTAX`, () => {
        const res = analyzeRegex(pattern);
        assert.strictEqual(res.ok, false);
        if (!res.ok) {
          assert.strictEqual(res.reason, 'UNSUPPORTED_SYNTAX');
        }
      });
    }
  });

  describe('SYNTAX rejections', () => {
    const syntaxErrorPatterns = [
      '[invalid(',
      '(unclosed',
      '(?:unclosed',
      'abc)',
      '[z-a]',
      '[\\d-z]',
      'a{5,2}',
      '*abc',
      '+abc',
      '?abc',
      'abc\\',
      '\\xGG',
      '\\u123G',
      '\\u{}',
      '\\u{110000}',
    ];

    for (const pattern of syntaxErrorPatterns) {
      it(`rejects malformed pattern ${JSON.stringify(pattern)} with SYNTAX`, () => {
        const res = analyzeRegex(pattern);
        assert.strictEqual(res.ok, false);
        if (!res.ok) {
          assert.strictEqual(res.reason, 'SYNTAX');
        }
        assert.throws(() => parseRegexSubset(pattern), RegexSyntaxError);
      });
    }
  });

  describe('Rule 1: PATTERN_TOO_LONG (256 code points)', () => {
    it('accepts a 256-code-point ASCII pattern and rejects 257', () => {
      assert.strictEqual(analyzeRegex('a'.repeat(256)).ok, true);
      const tooLong = analyzeRegex('a'.repeat(257));
      assert.strictEqual(tooLong.ok, false);
      if (!tooLong.ok) {
        assert.strictEqual(tooLong.reason, 'PATTERN_TOO_LONG');
      }
    });

    it('counts astral characters by code point rather than UTF-16 code unit', () => {
      const emoji256 = '😀'.repeat(256);
      assert.strictEqual(emoji256.length, 512);
      assert.strictEqual(countCodePoints(emoji256), 256);
      assert.strictEqual(analyzeRegex(emoji256).ok, true);

      const emoji257 = '😀'.repeat(257);
      const res = analyzeRegex(emoji257);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.reason, 'PATTERN_TOO_LONG');
      }
    });
  });

  describe('Rule 2: NESTED_QUANTIFIER', () => {
    const rejected = [
      '(a+)+',
      '(a*)*',
      '(a+)*',
      '(a*){2,5}',
      '(?:a+){2}',
      '([a-z]*)*',
      '(a|b+)+',
      '((?:a+))+',
      '(\\d+){2,}',
    ];
    for (const pattern of rejected) {
      it(`rejects ${pattern} with NESTED_QUANTIFIER`, () => {
        const res = analyzeRegex(pattern);
        assert.strictEqual(res.ok, false);
        if (!res.ok) {
          assert.strictEqual(res.reason, 'NESTED_QUANTIFIER');
        }
      });
    }

    const accepted = ['(?:ab+)?c', '(a+){0,1}', '(\\d{1,3}){1,4}', '(a{1,2})+'];
    for (const pattern of accepted) {
      it(`accepts ${pattern}`, () => {
        const res = analyzeRegex(pattern);
        assert.strictEqual(res.ok, true);
      });
    }
  });

  describe('Rule 3: OVERLAPPING_ALTERNATION', () => {
    const rejected = ['(a|ab)+', '(a|ab)*c', '(\\d|[0-5])+', '(\\w|\\d)+', '([a-m]|[g-z])*'];
    for (const pattern of rejected) {
      it(`rejects ${pattern} with OVERLAPPING_ALTERNATION`, () => {
        const res = analyzeRegex(pattern);
        assert.strictEqual(res.ok, false);
        if (!res.ok) {
          assert.strictEqual(res.reason, 'OVERLAPPING_ALTERNATION');
        }
      });
    }

    const accepted = ['(a|b)*c', '(cat|dog)+', '(a|ab)', '(a|ab)?', '(\\d|[a-f])+'];
    for (const pattern of accepted) {
      it(`accepts ${pattern}`, () => {
        const res = analyzeRegex(pattern);
        assert.strictEqual(res.ok, true);
      });
    }
  });

  describe('Rule 4: ADJACENT_OVERLAP', () => {
    const rejected = [
      '\\d+\\d+',
      '.*.*',
      '\\d+\\s*\\d+',
      '\\w+\\d+',
      'a+a+',
      '.*a?.*',
      '\\s*.*',
      '(\\d+)(\\d+)',
      '\\d+\\b\\d+',
    ];
    for (const pattern of rejected) {
      it(`rejects ${pattern} with ADJACENT_OVERLAP`, () => {
        const res = analyzeRegex(pattern);
        assert.strictEqual(res.ok, false);
        if (!res.ok) {
          assert.strictEqual(res.reason, 'ADJACENT_OVERLAP');
        }
      });
    }

    const accepted = [
      '\\w+\\s+\\w+',
      '^[a-z]+@[a-z]+\\.com$',
      '^(?=.*\\d).{8,}$',
      '\\d+-\\d+',
      '[a-z]+\\d+',
    ];
    for (const pattern of accepted) {
      it(`accepts ${pattern}`, () => {
        const res = analyzeRegex(pattern);
        assert.strictEqual(res.ok, true);
      });
    }
  });

  describe('analysis helpers', () => {
    it('computes nullable, first, chars, unwrap, and hasUnbounded accurately', () => {
      const tree = parseRegexSubset('((?:a?b)+)(?=\\d+)');
      assert.strictEqual(nullable(tree), false);
      assert.deepStrictEqual(first(tree), [{start: 0x61, end: 0x62}]);
      // Lookahead is excluded from chars()
      assert.deepStrictEqual(chars(tree), [{start: 0x61, end: 0x62}]);
      assert.strictEqual(hasUnbounded(tree), true);

      const grouped = parseRegexSubset('(((a)))');
      assert.strictEqual(unwrap(grouped).kind, 'charSet');
      assert.strictEqual(checkRegexSafety('a', grouped), null);
    });

    it('normalizes and complements ranges while excluding surrogates', () => {
      const merged = normalizeRanges([
        {start: 10, end: 5},
        {start: 0xd7fe, end: 0xe001},
        {start: 1, end: 3},
        {start: 4, end: 6},
      ]);
      assert.deepStrictEqual(merged, [
        {start: 1, end: 6},
        {start: 0xd7fe, end: 0xd7ff},
        {start: 0xe000, end: 0xe001},
      ]);

      const comp = complementRanges([{start: 0, end: 0x10ffff}]);
      assert.deepStrictEqual(comp, []);
      assert.strictEqual(rangesOverlap([{start: 1, end: 5}], [{start: 5, end: 9}]), true);
      assert.strictEqual(rangesOverlap([{start: 1, end: 4}], [{start: 5, end: 9}]), false);
    });
  });
});
