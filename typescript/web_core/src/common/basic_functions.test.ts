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
import {
  coerceToString,
  validateRequired,
  validateRegex,
  validateLength,
  validateNumeric,
  validateEmail,
  executeAnd,
  executeOr,
  executeNot,
  executeFormatNumber,
  executeFormatCurrency,
  executeFormatDate,
  executePluralize,
  parseTimestamp,
} from './basic_functions.js';

describe('Common Basic Functions', () => {
  describe('coerceToString', () => {
    it('handles primitives, nulls and objects', () => {
      assert.strictEqual(coerceToString(null), '');
      assert.strictEqual(coerceToString(undefined), '');
      assert.strictEqual(coerceToString(123), '123');
      assert.strictEqual(coerceToString(true), 'true');
      assert.strictEqual(coerceToString({a: 1}), '{"a":1}');
      assert.strictEqual(coerceToString([1, 2]), '[1,2]');
    });
  });

  describe('Validation Helpers', () => {
    it('validateRequired', () => {
      assert.strictEqual(validateRequired('hello').valid, true);
      assert.strictEqual(validateRequired('').valid, false);
      assert.strictEqual(validateRequired(null).valid, false);
      assert.strictEqual(validateRequired(undefined).valid, false);
      assert.strictEqual(validateRequired([]).valid, false);
      assert.strictEqual(validateRequired([1]).valid, true);
    });

    it('validateRegex', () => {
      assert.strictEqual(validateRegex('abc', '^[a-z]+$').valid, true);
      assert.strictEqual(validateRegex('123', '^[a-z]+$').valid, false);
    });

    it('validateLength', () => {
      assert.strictEqual(validateLength('abc', 2, 5).valid, true);
      assert.strictEqual(validateLength('a', 2, 5).valid, false);
      assert.strictEqual(validateLength('abcdef', 2, 5).valid, false);
    });

    it('validateNumeric', () => {
      assert.strictEqual(validateNumeric(10, 5, 15).valid, true);
      assert.strictEqual(validateNumeric(2, 5, 15).valid, false);
      assert.strictEqual(validateNumeric(20, 5, 15).valid, false);
      assert.strictEqual(validateNumeric('not-a-number' as any).valid, false);
    });

    it('validateEmail', () => {
      assert.strictEqual(validateEmail('test@example.com').valid, true);
      assert.strictEqual(validateEmail('invalid-email').valid, false);
      assert.strictEqual(validateEmail(null).valid, false);
    });
  });

  describe('Logical Helpers', () => {
    it('executeAnd', () => {
      assert.strictEqual(executeAnd([true, true]), true);
      assert.strictEqual(executeAnd([true, false]), false);
      assert.strictEqual(executeAnd([]), true);
    });

    it('executeOr', () => {
      assert.strictEqual(executeOr([false, true]), true);
      assert.strictEqual(executeOr([false, false]), false);
      assert.strictEqual(executeOr([]), false);
    });

    it('executeNot', () => {
      assert.strictEqual(executeNot(true), false);
      assert.strictEqual(executeNot(false), true);
      assert.strictEqual(executeNot(0), true);
      assert.strictEqual(executeNot('text'), false);
    });
  });

  describe('Formatting Helpers', () => {
    it('executeFormatNumber', () => {
      assert.strictEqual(executeFormatNumber(1234.56, 1, true, 'en-US'), '1,234.6');
      assert.strictEqual(executeFormatNumber(NaN), '');
    });

    it('executeFormatCurrency', () => {
      assert.strictEqual(executeFormatCurrency(1234.5, 'USD', 2, true, 'en-US'), '$1,234.50');
      // Unknown currency code fallback
      assert.strictEqual(
        executeFormatCurrency(1234.56, 'INVALID-CURRENCY', 2, true, 'en-US'),
        'INVALID-CURRENCY 1,234.56',
      );
    });

    it('executeFormatDate', () => {
      assert.strictEqual(
        executeFormatDate('2025-01-01T12:00:00Z', 'yyyy-MM-dd', 'en-US'),
        '2025-01-01',
      );
      assert.strictEqual(
        executeFormatDate('2025-01-01T12:00:00Z', 'ISO', 'en-US'),
        '2025-01-01T12:00:00.000Z',
      );
      assert.strictEqual(executeFormatDate('invalid-date'), '');
    });

    it('parseTimestamp', () => {
      const parsed = parseTimestamp('2025-01-01T12:00:00+02:00');
      assert.ok(parsed);
      assert.strictEqual(parsed.instant.toISOString(), '2025-01-01T10:00:00.000Z');
    });

    it('executePluralize', () => {
      const forms = {zero: '', one: 'apple', other: 'apples'};
      assert.strictEqual(executePluralize(1, forms, 'en-US'), 'apple');
      assert.strictEqual(executePluralize(2, forms, 'en-US'), 'apples');
      // Zero explicitly preserved
      assert.strictEqual(executePluralize(0, forms, 'en-US'), '');
    });
  });
});
