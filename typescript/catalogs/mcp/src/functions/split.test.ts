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
import {Catalog, DataContext, DataModel} from '@a2ui/web_core/v0_9';
import {SplitImplementation} from './split.js';

const catalog = new Catalog<any>('https://a2ui.org/test/split', [], [SplitImplementation]);

const call = (args: Record<string, unknown>) =>
  catalog.invoker(
    'split',
    args,
    new DataContext(
      {dataModel: new DataModel({}), catalog: {invoker: catalog.invoker}} as any,
      '/',
    ),
  );

describe('split', () => {
  it('splits a string on a separator', () => {
    assert.deepStrictEqual(call({value: 'a,b,c', separator: ','}), ['a', 'b', 'c']);
  });

  it('splits into characters when the separator is empty', () => {
    assert.deepStrictEqual(call({value: 'abc', separator: ''}), ['a', 'b', 'c']);
  });

  it('splits each element of an array, giving an array of arrays', () => {
    assert.deepStrictEqual(call({value: ['a:1', 'b:2'], separator: ':'}), [
      ['a', '1'],
      ['b', '2'],
    ]);
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
