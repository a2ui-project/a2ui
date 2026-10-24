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
import {A2uiExpressionError, Catalog, DataContext, DataModel} from '@a2ui/web_core/v1_0';
import {ParseJsonApi, ParseJsonImplementation} from './parse_json.js';

const catalog = new Catalog<never>(
  'https://a2ui.org/test/parseJson',
  '1.0',
  [],
  [ParseJsonImplementation],
);

const call = (args: Record<string, unknown>) =>
  catalog.invoker('parseJson', args, new DataContext(new DataModel({}), '/'));

describe('parseJson', () => {
  it('has the metadata the catalog schema publishes', () => {
    assert.strictEqual(ParseJsonApi.name, 'parseJson');
    assert.strictEqual(ParseJsonApi.returnType, 'any');
  });

  it('parses an object, an array and a scalar', () => {
    assert.deepStrictEqual(call({value: '{"entries":[{"name":"notes.md"}]}'}), {
      entries: [{name: 'notes.md'}],
    });
    assert.deepStrictEqual(call({value: '[1, 2]'}), [1, 2]);
    assert.strictEqual(call({value: '"text"'}), 'text');
    assert.strictEqual(call({value: 'null'}), null);
  });

  const nonStrings: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['array', ['{}']],
    ['object', {already: 'parsed'}],
  ];

  for (const [label, value] of nonStrings) {
    it(`rejects a ${label} value at validation`, () => {
      assert.throws(
        () => call({value}),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.strictEqual(error.expression, 'parseJson');
          assert.ok(error.message.startsWith("Validation failed for function 'parseJson'"));
          return true;
        },
      );
    });
  }

  it('wraps a syntax error in an A2uiExpressionError that keeps the cause as details', () => {
    assert.throws(
      () => call({value: '{"open":'}),
      (error: unknown) => {
        assert.ok(error instanceof A2uiExpressionError);
        assert.strictEqual(error.expression, 'parseJson');
        assert.ok(error.message.startsWith('parseJson could not parse the value: '));
        assert.ok(error.details instanceof SyntaxError);
        return true;
      },
    );
  });

  it('stays synchronous when the value is not pending', () => {
    const result = call({value: '{"a":1}'});
    assert.strictEqual(typeof (result as {then?: unknown} | null)?.then, 'undefined');
    assert.deepStrictEqual(result, {a: 1});
  });

  it('returns a promise when the value is pending', async () => {
    const result = call({value: Promise.resolve('{"a":1}')});
    assert.strictEqual(typeof (result as {then?: unknown}).then, 'function');
    assert.deepStrictEqual(await result, {a: 1});
  });

  it('propagates a rejected argument', async () => {
    const result = call({value: Promise.reject(new Error('the tool call failed'))});
    await assert.rejects(async () => await result, /the tool call failed/);
  });
});
