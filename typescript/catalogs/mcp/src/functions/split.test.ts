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
import {SplitApi, SplitImplementation} from './split.js';

const catalog = new Catalog<never>('https://a2ui.org/test/split', '1.0', [], [SplitImplementation]);

const call = (args: Record<string, unknown>) =>
  catalog.invoker('split', args, new DataContext(new DataModel({}), '/'));

describe('split', () => {
  it('has the metadata the catalog schema publishes', () => {
    assert.strictEqual(SplitApi.name, 'split');
    assert.strictEqual(SplitApi.returnType, 'any');
  });

  it('splits a string on a separator', () => {
    assert.deepStrictEqual(call({value: 'a,b,c', separator: ','}), ['a', 'b', 'c']);
  });

  it('splits the lines of a tool text block', () => {
    assert.deepStrictEqual(call({value: '[DIR] src\n[FILE] README.md', separator: '\n'}), [
      '[DIR] src',
      '[FILE] README.md',
    ]);
  });

  it('splits into characters when the separator is empty', () => {
    assert.deepStrictEqual(call({value: 'abc', separator: ''}), ['a', 'b', 'c']);
  });

  it('rejects a null separator at validation', () => {
    assert.throws(
      () => call({value: 'ab', separator: null}),
      (error: unknown) => {
        assert.ok(error instanceof A2uiExpressionError);
        assert.strictEqual(error.expression, 'split');
        assert.ok(error.message.startsWith("Validation failed for function 'split'"));
        return true;
      },
    );
  });

  it('keeps surrogate pairs whole when splitting into characters', () => {
    assert.deepStrictEqual(call({value: 'a😀b', separator: ''}), ['a', '😀', 'b']);
    assert.deepStrictEqual(call({value: '😀', separator: ''}), ['😀']);
  });

  it('treats the separator as literal text, not as a pattern', () => {
    assert.deepStrictEqual(call({value: 'a.b', separator: '.'}), ['a', 'b']);
  });

  it('splits each element of an array, giving an array of arrays', () => {
    assert.deepStrictEqual(call({value: ['a:1', 'b:2'], separator: ':'}), [
      ['a', '1'],
      ['b', '2'],
    ]);
  });

  it('rejects a null value at validation', () => {
    assert.throws(
      () => call({value: null, separator: ','}),
      (error: unknown) => {
        assert.ok(error instanceof A2uiExpressionError);
        assert.strictEqual(error.expression, 'split');
        assert.ok(error.message.startsWith("Validation failed for function 'split'"));
        return true;
      },
    );
  });

  it('stays synchronous when no argument is pending', () => {
    const result = call({value: 'a,b', separator: ','});
    assert.strictEqual(typeof (result as {then?: unknown} | null)?.then, 'undefined');
    assert.deepStrictEqual(result, ['a', 'b']);
  });

  it('returns a promise when an argument is pending', async () => {
    const result = call({value: Promise.resolve('a,b'), separator: ','});
    assert.strictEqual(typeof (result as {then?: unknown}).then, 'function');
    assert.deepStrictEqual(await result, ['a', 'b']);
  });

  it('propagates a rejected argument', async () => {
    const result = call({value: Promise.reject(new Error('the tool call failed')), separator: ','});
    await assert.rejects(async () => await result, /the tool call failed/);
  });
});
