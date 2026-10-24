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
import {JmespathApi, JmespathImplementation} from './jmespath.js';

const catalog = new Catalog<never>(
  'https://a2ui.org/test/jmespath',
  '1.0',
  [],
  [JmespathImplementation],
);

const call = (args: Record<string, unknown>, model = new DataModel({})) =>
  catalog.invoker('jmespath', args, new DataContext(model, '/'));

describe('jmespath', () => {
  it('has the metadata the catalog schema publishes', () => {
    assert.strictEqual(JmespathApi.name, 'jmespath');
    assert.strictEqual(JmespathApi.returnType, 'any');
  });

  it('evaluates an expression against the document', () => {
    assert.deepStrictEqual(
      call({
        expression: 'entries[*].name',
        data: {entries: [{name: 'notes.md'}, {name: 'todo.txt'}]},
      }),
      ['notes.md', 'todo.txt'],
    );
  });

  it('builds the objects a data model row needs', () => {
    assert.deepStrictEqual(
      call({
        expression: '{"/rows": entries[].{name: name, size: size}}',
        data: {entries: [{name: 'notes.md', size: 10, mode: 'rw'}]},
      }),
      {'/rows': [{name: 'notes.md', size: 10}]},
    );
  });

  it('yields null for a missing field', () => {
    assert.strictEqual(call({expression: 'entry.size', data: {entry: {}}}), null);
  });

  it('rejects a missing or null document, which the schema does not accept', () => {
    for (const args of [{expression: 'anything'}, {expression: '@', data: null}]) {
      assert.throws(
        () => call(args),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.strictEqual(error.expression, 'jmespath');
          assert.ok(error.message.startsWith("Validation failed for function 'jmespath'"));
          return true;
        },
      );
    }
  });

  it('does not evaluate directives found inside the data', () => {
    // Tool output is data: an object that looks like a binding stays an object.
    const data = {row: {'@path': '/secret'}};
    assert.deepStrictEqual(call({expression: 'row', data}, new DataModel({secret: 'leaked'})), {
      '@path': '/secret',
    });
  });

  const unsupportedDialect: ReadonlyArray<readonly [string, string]> = [
    ['a let binding', 'let $x = `1` in $x'],
    ['a ternary', 'a ? b : c'],
    ['arithmetic', '`1` + `2`'],
    ['a root reference', '$.foo'],
  ];

  for (const [label, expression] of unsupportedDialect) {
    it(`rejects ${label} not supported in standard JMESPath`, () => {
      assert.throws(
        () => call({expression, data: {a: 'x', b: 'y', c: 'z', foo: 1}}),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.strictEqual(error.expression, 'jmespath');
          assert.ok(error.message.includes(expression));
          return true;
        },
      );
    });
  }

  it('throws naming the expression when it does not parse', () => {
    assert.throws(
      () => call({expression: 'entries[', data: {}}),
      (error: unknown) => {
        assert.ok(error instanceof A2uiExpressionError);
        assert.ok(error.message.includes('in JMESPath expression: entries['));
        assert.ok(error.details instanceof Error);
        return true;
      },
    );
  });

  const nonStringExpressions: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['array', ['entries']],
    ['object', {expression: 'entries'}],
  ];

  for (const [label, expression] of nonStringExpressions) {
    it(`rejects a ${label} expression at validation`, () => {
      assert.throws(
        () => call({expression, data: {}}),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.strictEqual(error.expression, 'jmespath');
          assert.ok(error.message.startsWith("Validation failed for function 'jmespath'"));
          return true;
        },
      );
    });
  }

  it('stays synchronous when no argument is pending', () => {
    const result = call({expression: 'rows[0]', data: {rows: ['first', 'second']}});
    assert.strictEqual(typeof (result as {then?: unknown} | null)?.then, 'undefined');
    assert.strictEqual(result, 'first');
  });

  it('settles a pending data argument, such as a tool result', async () => {
    const result = call({
      expression: 'entries[*].name',
      data: Promise.resolve({entries: [{name: 'notes.md'}]}),
    });
    assert.strictEqual(typeof (result as {then?: unknown}).then, 'function');
    assert.deepStrictEqual(await result, ['notes.md']);
  });

  it('settles a pending expression argument', async () => {
    const result = await call({
      expression: Promise.resolve('rows[0]'),
      data: {rows: ['first', 'second']},
    });
    assert.strictEqual(result, 'first');
  });

  it('propagates a rejected argument', async () => {
    const result = call({
      expression: 'rows[0]',
      data: Promise.reject(new Error('the tool call failed')),
    });
    await assert.rejects(async () => await result, /the tool call failed/);
  });
});
