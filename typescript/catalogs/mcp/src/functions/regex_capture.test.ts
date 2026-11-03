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
import {RegexCaptureApi, RegexCaptureImplementation} from './regex_capture.js';
import {TransformDataImplementation} from './transform_data.js';

const catalog = new Catalog<never>(
  'https://a2ui.org/test/regexCapture',
  '1.0',
  [],
  [RegexCaptureImplementation, TransformDataImplementation],
);

const call = (name: string, args: Record<string, unknown>) =>
  catalog.invoker(name, args, new DataContext(new DataModel({}), '/'));

describe('regexCapture', () => {
  it('has the metadata the catalog schema publishes', () => {
    assert.strictEqual(RegexCaptureApi.name, 'regexCapture');
    assert.strictEqual(RegexCaptureApi.returnType, 'any');
  });

  it('returns the capture groups of the first match', () => {
    assert.deepStrictEqual(
      call('regexCapture', {value: 'notes.md 2048', pattern: '^(\\S+) (\\d+)$'}),
      ['notes.md', '2048'],
    );
  });

  it('returns only the first match of a pattern that matches more than once', () => {
    assert.deepStrictEqual(call('regexCapture', {value: 'a1 b2', pattern: '(\\w)(\\d)'}), [
      'a',
      '1',
    ]);
  });

  it('returns null when the pattern does not match', () => {
    assert.strictEqual(call('regexCapture', {value: 'prose', pattern: '^(\\d+)$'}), null);
  });

  it('returns an empty array when the pattern matches but has no groups', () => {
    assert.deepStrictEqual(call('regexCapture', {value: 'abc', pattern: 'b'}), []);
  });

  it('reads a group that did not participate as an empty string', () => {
    assert.deepStrictEqual(call('regexCapture', {value: 'a', pattern: '(a)(b)?'}), ['a', '']);
  });

  it('turns directory listing lines into kind and name pairs', () => {
    assert.deepStrictEqual(
      call('regexCapture', {
        value: ['[DIR] src', '[FILE] README.md'],
        pattern: '^\\[(DIR|FILE)\\] (.+)$',
      }),
      [
        ['DIR', 'src'],
        ['FILE', 'README.md'],
      ],
    );
  });

  it('leaves null in place for a non-matching element, which an expression filters out', () => {
    const rows = call('regexCapture', {
      value: ['notes.md 2048', 'not a data line', 'todo.txt 91'],
      pattern: '^(\\S+) (\\d+)$',
    });

    assert.deepStrictEqual(rows, [['notes.md', '2048'], null, ['todo.txt', '91']]);
    assert.deepStrictEqual(call('transformData', {jmespath: 'rows[?@ != null]', data: {rows}}), [
      ['notes.md', '2048'],
      ['todo.txt', '91'],
    ]);
  });

  it('matches the same cached pattern again after a non-matching element', () => {
    const pattern = '^(\\d+)$';
    assert.deepStrictEqual(call('regexCapture', {value: ['1', 'x', '2'], pattern}), [
      ['1'],
      null,
      ['2'],
    ]);
  });

  it('throws an A2uiExpressionError for an invalid, unsafe or non-portable pattern', () => {
    for (const pattern of ['(unbalanced', '(a+)+$', '(?<=\\[)\\w+', '(\\w)\\1']) {
      assert.throws(
        () => call('regexCapture', {value: 'a', pattern}),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.strictEqual(error.expression, 'regexCapture');
          return true;
        },
      );
    }
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

  it('propagates a rejected argument', async () => {
    const result = call('regexCapture', {
      value: Promise.reject(new Error('the tool call failed')),
      pattern: '^(\\w+)\\.(\\w+)$',
    });
    await assert.rejects(async () => await result, /the tool call failed/);
  });
});
