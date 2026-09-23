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
import {A2uiExpressionError, Catalog, DataContext, DataModel} from '@a2ui/web_core/v0_9';
import {JmespathImplementation} from './jmespath.js';

const catalog = new Catalog<any>('https://a2ui.org/test/jmespath', [], [JmespathImplementation]);

const createContext = (model = new DataModel({})) =>
  new DataContext({dataModel: model, catalog: {invoker: catalog.invoker}} as any, '/');

const call = (args: Record<string, unknown>, model = new DataModel({})) =>
  catalog.invoker('jmespath', args, createContext(model));

describe('jmespath', () => {
  it('evaluates an expression against the document', () => {
    assert.deepStrictEqual(
      call({
        expression: 'entries[*].name',
        data: {entries: [{name: 'notes.md'}, {name: 'todo.txt'}]},
      }),
      ['notes.md', 'todo.txt'],
    );
  });

  it('yields null for a missing field', () => {
    assert.strictEqual(call({expression: 'entry.size', data: {entry: {}}}), null);
  });

  it('reads null when no document is supplied', () => {
    assert.strictEqual(call({expression: 'anything'}), null);
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
        return true;
      },
    );
  });

  it('throws naming the type when the expression is not a string', () => {
    assert.throws(
      () => call({expression: 42, data: {}}),
      (error: unknown) => {
        assert.ok(error instanceof A2uiExpressionError);
        assert.strictEqual(error.message, 'jmespath expects a string expression, got a number.');
        return true;
      },
    );
  });

  it('follows a binding that resolves to another binding to reach the expression', () => {
    const model = new DataModel({
      row: {expression: {path: '/expressions/count'}},
      expressions: {count: 'length(items)'},
    });

    const result = call({expression: {path: '/row/expression'}, data: {items: [1, 2, 3]}}, model);
    assert.strictEqual(result, 3);
  });

  it('stays synchronous when no argument is pending', () => {
    const result = call({expression: 'rows[0]', data: {rows: ['first', 'second']}});
    assert.strictEqual(typeof (result as {then?: unknown} | null)?.then, 'undefined');
    assert.strictEqual(result, 'first');
  });

  it('returns a promise when an argument is pending', async () => {
    const result = call({
      expression: 'rows[0]',
      data: Promise.resolve({rows: ['first', 'second']}),
    });
    assert.strictEqual(typeof (result as {then?: unknown}).then, 'function');
    assert.strictEqual(await result, 'first');
  });

  it('settles a pending argument alongside a settled one', async () => {
    const result = await call({
      expression: 'entries[*].name',
      data: Promise.resolve({entries: [{name: 'notes.md'}]}),
    });
    assert.deepStrictEqual(result, ['notes.md']);
  });

  it('settles an asynchronous expression argument', async () => {
    const result = call({
      expression: Promise.resolve('rows[0]'),
      data: {rows: ['first', 'second']},
    });
    assert.strictEqual(typeof (result as {then?: unknown}).then, 'function');
    assert.strictEqual(await result, 'first');
  });

  it('propagates a rejected argument', async () => {
    const result = call({
      expression: 'rows[0]',
      data: Promise.reject(new Error('the tool call failed')),
    });
    await assert.rejects(async () => await result, /the tool call failed/);
  });
});
