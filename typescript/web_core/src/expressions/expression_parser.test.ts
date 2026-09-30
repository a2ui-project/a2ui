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
import {
  ExpressionParser,
  MAX_EXPRESSION_TEMPLATE_LENGTH,
  MAX_EXPRESSION_PARTS,
} from './expression_parser.js';

describe('ExpressionParser', () => {
  let parser: ExpressionParser;

  beforeEach(() => {
    parser = new ExpressionParser();
  });

  it('handles escaped interpolation', () => {
    assert.deepStrictEqual(parser.parse('escaped \\${foo}'), ['escaped ', '${', 'foo}']);
  });

  it('returns error on max depth exceeded', () => {
    assert.throws(() => {
      parser.parse('depth', ExpressionParser.MAX_DEPTH + 1);
    }, /Max recursion depth reached/);
  });

  it('rejects pathological nesting instead of overflowing the stack', () => {
    const nestedCalls = (calls: number) => `\${${'f(a: '.repeat(calls)}1${')'.repeat(calls)}}`;
    const nestedInterpolations = (depth: number) => `${'${'.repeat(depth)}x${'}'.repeat(depth)}`;
    // Deep enough to exhaust the stack while the guard was unreachable. Asserted on the
    // error kind rather than its message, so that any earlier bound on the input (a length
    // cap, say) still satisfies the point: a pathological template is rejected with a
    // protocol error rather than collapsing the runtime.
    const expressionError = {name: 'A2uiExpressionError', code: 'EXPRESSION_ERROR'};
    assert.throws(() => {
      parser.parse(nestedCalls(50000));
    }, expressionError);
    assert.throws(() => {
      parser.parse(nestedInterpolations(50000));
    }, expressionError);
  });

  it('handles empty identifiers', () => {
    assert.deepStrictEqual(parser.parse('${()}'), [{call: '', args: {}, returnType: 'any'}]);
    assert.deepStrictEqual(parser.parseExpression(''), '');
    assert.deepStrictEqual(parser.parseExpression('()'), {
      call: '',
      args: {},
      returnType: 'any',
    });
  });

  it('rejects template string exceeding MAX_EXPRESSION_TEMPLATE_LENGTH (Issue #2389)', () => {
    assert.strictEqual(MAX_EXPRESSION_TEMPLATE_LENGTH, 10000);
    const oversizedTemplate = 'a'.repeat(MAX_EXPRESSION_TEMPLATE_LENGTH + 1);
    assert.throws(() => {
      parser.parse(oversizedTemplate);
    }, /exceeds maximum limit/);
  });

  it('rejects expression exceeding MAX_EXPRESSION_PARTS limit (Issue #2389)', () => {
    assert.strictEqual(MAX_EXPRESSION_PARTS, 1000);
    const manyParts = '${x}'.repeat(MAX_EXPRESSION_PARTS + 1);
    assert.throws(() => {
      parser.parse(manyParts);
    }, /parts count exceeds maximum limit/);
  });
});
