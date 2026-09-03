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
import {isSafeRegex} from './safe_regex.js';

describe('isSafeRegex (CWE-1333 ReDoS Safety)', () => {
  describe('Catastrophic Backtracking Patterns (Unsafe)', () => {
    it('blocks nested plus quantifiers', () => {
      assert.strictEqual(isSafeRegex('(a+)+b'), false);
      assert.strictEqual(isSafeRegex('(a+)+'), false);
      assert.strictEqual(isSafeRegex('((a+)+)+'), false);
      assert.strictEqual(isSafeRegex('(\\d+)+'), false);
      assert.strictEqual(isSafeRegex('([a-z]+)+'), false);
    });

    it('blocks nested star quantifiers', () => {
      assert.strictEqual(isSafeRegex('(a*)*b'), false);
      assert.strictEqual(isSafeRegex('(a*)*'), false);
      assert.strictEqual(isSafeRegex('([a-zA-Z]+)*$'), false);
      assert.strictEqual(isSafeRegex('(?:[0-9]+)+'), false);
    });

    it('blocks bounded nested quantifiers that cause exponential growth', () => {
      assert.strictEqual(isSafeRegex('(a{1,}){2,}'), false);
      assert.strictEqual(isSafeRegex('(a+){2,}'), false);
      assert.strictEqual(isSafeRegex('(a{2,})+'), false);
    });

    it('blocks overlapping alternations in quantified groups', () => {
      assert.strictEqual(isSafeRegex('(a|aa)+$'), false);
      assert.strictEqual(isSafeRegex('(a|a+)+$'), false);
      assert.strictEqual(isSafeRegex('(\\d|\\w)+'), false);
      assert.strictEqual(isSafeRegex('(a|b|ab)+$'), false);
    });

    it('blocks adjacent overlapping quantifiers inside quantified groups', () => {
      assert.strictEqual(isSafeRegex('(x+x+)+y'), false);
      assert.strictEqual(isSafeRegex('(\\d+\\d+)+'), false);
    });

    it('blocks wildcard dot overlap patterns', () => {
      assert.strictEqual(isSafeRegex('(a|.)+'), false);
      assert.strictEqual(isSafeRegex('(a|.)+$'), false);
      assert.strictEqual(isSafeRegex('(.|a)+'), false);
      assert.strictEqual(isSafeRegex('(.*)+'), false);
      assert.strictEqual(isSafeRegex('(.+)+'), false);
    });

    it('blocks repeated non-disjoint prefixes and suffixes', () => {
      assert.strictEqual(isSafeRegex('(aa+)*'), false);
      assert.strictEqual(isSafeRegex('(a+a)*'), false);
      assert.strictEqual(isSafeRegex('(1\\d+)*'), false);
    });

    it('blocks invalid regex syntax safely without crashing', () => {
      assert.strictEqual(isSafeRegex('['), false);
      assert.strictEqual(isSafeRegex('(?'), false);
      assert.strictEqual(isSafeRegex('*abc'), false);
      assert.strictEqual(isSafeRegex('a{2,1}'), false); // numbers out of order
      assert.strictEqual(isSafeRegex('a{invalid}'), true); // safely parsed as literal without crash
    });
  });

  describe('Legitimate Form Validation Patterns (Safe)', () => {
    it('allows simple and alphanumeric patterns', () => {
      assert.strictEqual(isSafeRegex('^[a-z]+$'), true);
      assert.strictEqual(isSafeRegex('^[0-9]+$'), true);
      assert.strictEqual(isSafeRegex('^[a-zA-Z0-9_]+$'), true);
      assert.strictEqual(isSafeRegex('^[a-zA-Z0-9_-]{3,16}$'), true);
      assert.strictEqual(isSafeRegex('^[a-fA-F0-9]{32}$'), true);
    });

    it('allows standard email and URL patterns', () => {
      assert.strictEqual(isSafeRegex('^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'), true);
      assert.strictEqual(isSafeRegex('^https?://[^\\s/$.?#].[^\\s]*$'), true);
    });

    it('allows phone and postal code patterns', () => {
      assert.strictEqual(isSafeRegex('^\\+?[1-9]\\d{1,14}$'), true);
      assert.strictEqual(isSafeRegex('^\\d{5}$'), true);
      assert.strictEqual(isSafeRegex('^\\d{5}(-\\d{4})?$'), true);
    });

    it('allows date and time patterns', () => {
      assert.strictEqual(isSafeRegex('^\\d{4}-\\d{2}-\\d{2}$'), true);
      assert.strictEqual(isSafeRegex('^\\d{2}:\\d{2}(:\\d{2})?$'), true);
    });

    it('allows hex color codes', () => {
      assert.strictEqual(isSafeRegex('^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$'), true);
    });

    it('allows UUID pattern', () => {
      assert.strictEqual(
        isSafeRegex(
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
        ),
        true,
      );
    });

    it('allows disjoint delimited lists', () => {
      assert.strictEqual(isSafeRegex('^[a-z]+(,[a-z]+)*$'), true);
      assert.strictEqual(isSafeRegex('^(\\d{1,3}\\.){3}\\d{1,3}$'), true);
      assert.strictEqual(isSafeRegex('^\\d+(\\.\\d+)?$'), true);
      assert.strictEqual(isSafeRegex('^\\$\\d+(\\.\\d{2})?$'), true);
    });

    it('handles empty or nullish safely', () => {
      assert.strictEqual(isSafeRegex(''), true);
      assert.strictEqual(isSafeRegex(null as any), true);
      assert.strictEqual(isSafeRegex(undefined as any), true);
    });
  });
});
