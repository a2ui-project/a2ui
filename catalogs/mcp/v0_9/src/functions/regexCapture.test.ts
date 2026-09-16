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
import {JmespathImplementation} from './jmespath.js';
import {RegexCaptureImplementation} from './regexCapture.js';

const catalog = new Catalog<any>(
  'https://a2ui.org/test/regexCapture',
  [],
  [RegexCaptureImplementation, JmespathImplementation],
);

const call = (name: string, args: Record<string, unknown>) =>
  catalog.invoker(
    name,
    args,
    new DataContext(
      {dataModel: new DataModel({}), catalog: {invoker: catalog.invoker}} as any,
      '/',
    ),
  );

describe('regexCapture', () => {
  it('returns the capture groups of the first match', () => {
    assert.deepStrictEqual(
      call('regexCapture', {value: 'notes.md 2048', pattern: '^(\\S+) (\\d+)$'}),
      ['notes.md', '2048'],
    );
  });

  it('returns null when the pattern does not match', () => {
    assert.strictEqual(call('regexCapture', {value: 'prose', pattern: '^(\\d+)$'}), null);
  });

  it('reads a group that did not participate as an empty string', () => {
    assert.deepStrictEqual(call('regexCapture', {value: 'a', pattern: '(a)(b)?'}), ['a', '']);
  });

  it('leaves null in place for a non-matching element, which an expression filters out', () => {
    const rows = call('regexCapture', {
      value: ['notes.md 2048', 'not a data line', 'todo.txt 91'],
      pattern: '^(\\S+) (\\d+)$',
    });

    assert.deepStrictEqual(rows, [['notes.md', '2048'], null, ['todo.txt', '91']]);
    assert.deepStrictEqual(call('jmespath', {expression: 'rows[?@ != null]', data: {rows}}), [
      ['notes.md', '2048'],
      ['todo.txt', '91'],
    ]);
  });

  it('stays synchronous when no argument is pending', () => {
    const result = call('regexCapture', {value: 'notes.md', pattern: '^(\\w+)\\.(\\w+)$'});
    assert.strictEqual(typeof (result as {then?: unknown} | null)?.then, 'undefined');
    assert.deepStrictEqual(result, ['notes', 'md']);
  });

  it('returns a promise when an argument is pending', async () => {
    const result = call('regexCapture', {
      value: Promise.resolve('notes.md'),
      pattern: '^(\\w+)\\.(\\w+)$',
    });
    assert.strictEqual(typeof (result as {then?: unknown}).then, 'function');
    assert.deepStrictEqual(await result, ['notes', 'md']);
  });

  it('handles compiling more than 100 distinct patterns by evicting older entries', () => {
    for (let i = 0; i < 120; i++) {
      const result = call('regexCapture', {
        value: `val_${i}`,
        pattern: `^val_(${i})$`,
      });
      assert.deepStrictEqual(result, [String(i)]);
    }
  });

  it('propagates a rejected argument', async () => {
    const result = call('regexCapture', {
      value: Promise.reject(new Error('the tool call failed')),
      pattern: '^(\\w+)\\.(\\w+)$',
    });
    await assert.rejects(async () => await result, /the tool call failed/);
  });
});
