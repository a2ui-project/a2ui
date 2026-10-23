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
import {RegexReplaceApi, RegexReplaceImplementation} from './regex_replace.js';

const catalog = new Catalog<never>(
  'https://a2ui.org/test/regexReplace',
  '1.0',
  [],
  [RegexReplaceImplementation],
);

const call = (args: Record<string, unknown>) =>
  catalog.invoker('regexReplace', args, new DataContext(new DataModel({}), '/'));

describe('regexReplace', () => {
  it('has the metadata the catalog schema publishes', () => {
    assert.strictEqual(RegexReplaceApi.name, 'regexReplace');
    assert.strictEqual(RegexReplaceApi.returnType, 'any');
  });

  it('replaces every match, not only the first', () => {
    assert.strictEqual(call({value: 'a1b22c', pattern: '\\d+', replacement: '#'}), 'a#b#c');
  });

  it('treats the replacement as literal text, so $ sequences are not expanded', () => {
    assert.strictEqual(call({value: 'a1', pattern: '(\\d)', replacement: '[$1]'}), 'a[$1]');
    assert.strictEqual(call({value: 'a1', pattern: '\\d', replacement: '$&$$'}), 'a$&$$');
  });

  it('removes matches when the replacement is empty', () => {
    assert.strictEqual(call({value: '[DIR] src', pattern: '^\\[\\w+\\] ', replacement: ''}), 'src');
  });

  it('rejects a missing replacement at validation', () => {
    assert.throws(
      () => call({value: 'a-b', pattern: '-'}),
      (error: unknown) => {
        assert.ok(error instanceof A2uiExpressionError);
        assert.strictEqual(error.expression, 'regexReplace');
        assert.ok(error.message.startsWith("Validation failed for function 'regexReplace'"));
        return true;
      },
    );
  });

  it('rewrites each element of an array', () => {
    assert.deepStrictEqual(call({value: ['a1', 'b2'], pattern: '\\d', replacement: 'N'}), [
      'aN',
      'bN',
    ]);
  });

  it('replaces from the start of each string, whatever the cached pattern matched before', () => {
    const pattern = 'x';
    assert.strictEqual(call({value: 'axbx', pattern, replacement: '-'}), 'a-b-');
    assert.strictEqual(call({value: 'xa', pattern, replacement: '-'}), '-a');
  });

  it('throws an A2uiExpressionError for an invalid or unsafe pattern', () => {
    for (const pattern of ['(unbalanced', '(a+)+$']) {
      assert.throws(
        () => call({value: 'a', pattern, replacement: ''}),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.strictEqual(error.expression, 'regexReplace');
          return true;
        },
      );
    }
  });

  it('stays synchronous when no argument is pending', () => {
    const result = call({value: 'a1b2', pattern: '\\d', replacement: '#'});
    assert.strictEqual(typeof (result as {then?: unknown} | null)?.then, 'undefined');
    assert.strictEqual(result, 'a#b#');
  });

  it('returns a promise when an argument is pending', async () => {
    const result = call({value: Promise.resolve('a1b2'), pattern: '\\d', replacement: '#'});
    assert.strictEqual(typeof (result as {then?: unknown}).then, 'function');
    assert.strictEqual(await result, 'a#b#');
  });

  it('settles every pending argument against its own name', async () => {
    const result = await call({
      value: 'notes.md and todo.md',
      pattern: Promise.resolve('\\.md'),
      replacement: Promise.resolve('.txt'),
    });
    assert.strictEqual(result, 'notes.txt and todo.txt');
  });

  it('propagates a rejected argument', async () => {
    const result = call({
      value: Promise.reject(new Error('the tool call failed')),
      pattern: '\\d',
      replacement: '#',
    });
    await assert.rejects(async () => await result, /the tool call failed/);
  });
});
