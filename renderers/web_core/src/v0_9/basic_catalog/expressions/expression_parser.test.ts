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
import {ExpressionParser} from './expression_parser.js';

describe('ExpressionParser', () => {
  let parser: ExpressionParser;

  beforeEach(() => {
    parser = new ExpressionParser();
  });

  it('parses literal strings unchanged', () => {
    assert.deepStrictEqual(parser.parse('hello world'), ['hello world']);
  });

  it('parses simple interpolation', () => {
    assert.deepStrictEqual(parser.parse('hello ${foo}'), ['hello ', {path: 'foo'}]);
  });

  it('parses number interpolation', () => {
    assert.deepStrictEqual(parser.parse('number is ${num}'), ['number is ', {path: 'num'}]);
  });

  it('parses nested interpolation', () => {
    // Nested interpolations don't evaluate immediately, they parse into paths of paths, but currently parser doesn't do deep AST for 'val is ${${nested}}' properly if it's not a function.
    // Wait, the parser extracts content. Let's see what `val is ${${nested}}` parses to:
    // It extracts `${nested}` and parses it. That evaluates to `{ path: "${nested}" }` or something.
    // Actually, `parseExpression("${nested}")` will recursively call `parseExpression("nested")` and return `{ path: "nested" }`.
    assert.deepStrictEqual(parser.parse('val is ${${nested}}'), ['val is ', {path: 'nested'}]);
  });

  it('handles escaped interpolation', () => {
    assert.deepStrictEqual(parser.parse('escaped \\${foo}'), ['escaped ', '${', 'foo}']);
  });

  it('parses function calls', () => {
    assert.deepStrictEqual(parser.parse('sum is ${add(a: 10, b: 20)}'), [
      'sum is ',
      {call: 'add', args: {a: 10, b: 20}, returnType: 'any'},
    ]);
  });

  it('parses function calls with string literals', () => {
    assert.deepStrictEqual(parser.parse('case is ${upper(text: "hello")}'), [
      'case is ',
      {call: 'upper', args: {text: 'hello'}, returnType: 'any'},
    ]);
  });

  it('parses keywords', () => {
    assert.deepStrictEqual(parser.parse('${true} ${false} ${null}'), [true, ' ', false, ' ']);
  });

  it('returns error on max depth exceeded', () => {
    assert.throws(() => {
      parser.parse('depth', 11);
    }, /Max recursion depth reached/);
  });

  it('handles deep recursion gracefully', () => {
    assert.deepStrictEqual(parser.parse('${${"hello"}}'), ['hello']);
  });

  describe('nesting depth', () => {
    // ExpressionParser.MAX_DEPTH is private, so these mirror its value of 10.
    const MAX_DEPTH = 10;

    // '${f(a: f(a: ... 1 ...))}'. The interpolation is itself a level, so this
    // nests `calls + 1` deep.
    const nestedCalls = (calls: number) => `\${${'f(a: '.repeat(calls)}1${')'.repeat(calls)}}`;

    // '${${ ... x ... }}', nesting `depth` levels deep.
    const nestedInterpolations = (depth: number) => `${'${'.repeat(depth)}x${'}'.repeat(depth)}`;

    it('accepts nesting up to the maximum depth', () => {
      assert.doesNotThrow(() => parser.parse(nestedCalls(MAX_DEPTH - 1)));
      assert.doesNotThrow(() => parser.parse(nestedInterpolations(MAX_DEPTH)));
    });

    it('rejects function arguments one level past the maximum depth', () => {
      assert.throws(() => {
        parser.parse(nestedCalls(MAX_DEPTH));
      }, /Max recursion depth reached/);
    });

    it('rejects interpolations one level past the maximum depth', () => {
      assert.throws(() => {
        parser.parse(nestedInterpolations(MAX_DEPTH + 1));
      }, /Max recursion depth reached/);
    });

    it('rejects pathological nesting instead of overflowing the stack', () => {
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
  });

  it('returns error on unclosed interpolation', () => {
    assert.throws(() => {
      parser.parse('hello ${world');
    }, /Unclosed interpolation/);
  });

  it('returns error on invalid function syntax', () => {
    // Missing closing parenthesis
    assert.throws(() => {
      parser.parse('${add(a: 1, b: 2}');
    }, /Expected '\)'/);
  });

  it('returns error on unexpected characters at end', () => {
    // Extra garbage after valid expression inside interpolation
    assert.throws(() => {
      parser.parse('${true false}');
    }, /Unexpected characters/);
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

  it('handles string literals with escaped characters', () => {
    assert.deepStrictEqual(
      parser.parseExpression("'line1\\nline2\\t\\r\\'\\\\x'"),
      "line1\nline2\t\r'\\x",
    );
  });

  it('handles parsing paths with special characters', () => {
    assert.deepStrictEqual(parser.parseExpression('my-path.with_underscores'), {
      path: 'my-path.with_underscores',
    });
  });

  it('returns error on missing colon in function args', () => {
    assert.throws(() => {
      parser.parseExpression('add(a 10, b: 20)');
    }, /Expected ':'/);
  });
});
