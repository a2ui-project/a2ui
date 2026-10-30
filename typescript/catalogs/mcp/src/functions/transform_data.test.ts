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
import {TransformDataApi, TransformDataImplementation} from './transform_data.js';

const catalog = new Catalog<never>(
  'https://a2ui.org/test/transform-data',
  '1.0',
  [],
  [TransformDataImplementation],
);

const call = (args: Record<string, unknown>, model = new DataModel({})) =>
  catalog.invoker('transformData', args, new DataContext(model, '/'));

describe('transformData', () => {
  it('has the metadata the catalog schema publishes', () => {
    assert.strictEqual(TransformDataApi.name, 'transformData');
    assert.strictEqual(TransformDataApi.returnType, 'any');
    assert.ok(TransformDataApi.description.includes('https://jmespath.org/specification.html'));
  });

  it('evaluates an expression against the document', () => {
    assert.deepStrictEqual(
      call({
        jmespath: 'entries[*].name',
        data: {entries: [{name: 'notes.md'}, {name: 'todo.txt'}]},
      }),
      ['notes.md', 'todo.txt'],
    );
  });

  it('builds the objects a data model row needs', () => {
    assert.deepStrictEqual(
      call({
        jmespath: '{"/rows": entries[].{name: name, size: size}}',
        data: {entries: [{name: 'notes.md', size: 10, mode: 'rw'}]},
      }),
      {'/rows': [{name: 'notes.md', size: 10}]},
    );
  });

  it('yields null for a missing field', () => {
    assert.strictEqual(call({jmespath: 'entry.size', data: {entry: {}}}), null);
  });

  it('rejects a missing or null document, which the schema does not accept', () => {
    for (const args of [{jmespath: 'anything'}, {jmespath: '@', data: null}]) {
      assert.throws(
        () => call(args),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.strictEqual(error.expression, 'transformData');
          assert.ok(error.message.startsWith("Validation failed for function 'transformData'"));
          return true;
        },
      );
    }
  });

  it('does not evaluate directives found inside the data', () => {
    // Tool output is data: an object that looks like a binding stays an object.
    const data = {row: {'@path': '/secret'}};
    assert.deepStrictEqual(call({jmespath: 'row', data}, new DataModel({secret: 'leaked'})), {
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
        () => call({jmespath: expression, data: {a: 'x', b: 'y', c: 'z', foo: 1}}),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.strictEqual(error.expression, 'transformData');
          assert.ok(error.message.includes(expression));
          return true;
        },
      );
    });
  }

  const unparsableExpressions: ReadonlyArray<readonly [string, string]> = [
    ['an unterminated bracket', 'entries['],
    ['an unterminated multiselect hash', '{a: b'],
    ['a slice with a non-numeric bound', '[0:a]'],
  ];

  for (const [label, expression] of unparsableExpressions) {
    it(`throws naming the expression for ${label} that does not parse`, () => {
      assert.throws(
        () => call({jmespath: expression, data: {}}),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.ok(error.message.startsWith(`Invalid JMESPath expression: ${expression}`));
          assert.ok(error.details instanceof Error);
          return true;
        },
      );
    });
  }

  const nonStringExpressions: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['array', ['entries']],
    ['object', {jmespath: 'entries'}],
  ];

  for (const [label, expression] of nonStringExpressions) {
    it(`rejects a ${label} expression at validation`, () => {
      assert.throws(
        () => call({jmespath: expression, data: {}}),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.strictEqual(error.expression, 'transformData');
          assert.ok(error.message.startsWith("Validation failed for function 'transformData'"));
          return true;
        },
      );
    });
  }

  it('reports an evaluation failure, such as a function given the wrong type', () => {
    assert.throws(
      () => call({jmespath: 'length(count)', data: {count: 3}}),
      (error: unknown) => {
        assert.ok(error instanceof A2uiExpressionError);
        assert.strictEqual(error.expression, 'transformData');
        assert.ok(error.message.startsWith('JMESPath expression length(count) failed: '));
        return true;
      },
    );
  });

  describe('JMESPath compliance cases', () => {
    // Taken from the official compliance suite (https://github.com/jmespath/jmespath.test),
    // so the function is checked against standard JMESPath rather than one library.
    const cases: ReadonlyArray<{
      readonly suite: string;
      readonly data: unknown;
      readonly jmespath: string;
      readonly result: unknown;
    }> = [
      {
        suite: 'wildcard',
        data: {foo: [{bar: 'one'}, {bar: 'two'}, {bar: 'three'}, {notbar: 'four'}]},
        jmespath: 'foo[*].bar',
        result: ['one', 'two', 'three'],
      },
      {
        suite: 'wildcard',
        data: {foo: {bar: {name: 'one'}, baz: {name: 'two'}}},
        jmespath: 'foo.*.name',
        result: ['one', 'two'],
      },
      {
        suite: 'filters',
        data: {foo: [{name: 'a'}, {name: 'b'}]},
        jmespath: "foo[?name == 'a']",
        result: [{name: 'a'}],
      },
      {
        suite: 'filters',
        data: {foo: [{age: 20}, {age: 25}, {age: 30}]},
        jmespath: 'foo[?age > `25`]',
        result: [{age: 30}],
      },
      {
        suite: 'multiselect',
        data: {foo: {bar: 'bar', baz: 'baz', qux: 'qux'}},
        jmespath: 'foo.{bar: bar, baz: baz}',
        result: {bar: 'bar', baz: 'baz'},
      },
      {
        suite: 'multiselect',
        data: {foo: {bar: 'bar', baz: 'baz', qux: 'qux'}},
        jmespath: 'foo.[bar, baz]',
        result: ['bar', 'baz'],
      },
      {
        suite: 'pipe',
        data: {foo: {bar: {baz: 'subkey'}, other: {baz: 'subkey'}}},
        jmespath: 'foo.*.baz | [0]',
        result: 'subkey',
      },
      {
        suite: 'pipe',
        data: {foo: [{bar: 'one'}, {bar: 'two'}]},
        jmespath: 'foo[*].bar | [1]',
        result: 'two',
      },
      {
        suite: 'functions',
        data: {strings: ['a', 'b', 'c']},
        jmespath: 'length(strings)',
        result: 3,
      },
      {suite: 'functions', data: {}, jmespath: "length('abc')", result: 3},
      {
        suite: 'functions',
        data: {strings: ['a', 'b', 'c']},
        jmespath: "join(', ', strings)",
        result: 'a, b, c',
      },
      {suite: 'functions', data: {}, jmespath: "to_string('foo')", result: 'foo'},
      {suite: 'functions', data: {}, jmespath: 'to_string(`1.2`)', result: '1.2'},
      {suite: 'functions', data: {}, jmespath: 'to_string(`[0, 1]`)', result: '[0,1]'},
    ];

    for (const {suite, data, jmespath, result} of cases) {
      it(`${suite}: ${jmespath}`, () => {
        assert.deepStrictEqual(call({jmespath, data}), result);
      });
    }
  });

  it('stays synchronous when no argument is pending', () => {
    const result = call({jmespath: 'rows[0]', data: {rows: ['first', 'second']}});
    assert.strictEqual(typeof (result as {then?: unknown} | null)?.then, 'undefined');
    assert.strictEqual(result, 'first');
  });

  it('settles a pending data argument, such as a tool result', async () => {
    const result = call({
      jmespath: 'entries[*].name',
      data: Promise.resolve({entries: [{name: 'notes.md'}]}),
    });
    assert.strictEqual(typeof (result as {then?: unknown}).then, 'function');
    assert.deepStrictEqual(await result, ['notes.md']);
  });

  it('settles a pending expression argument', async () => {
    const result = await call({
      jmespath: Promise.resolve('rows[0]'),
      data: {rows: ['first', 'second']},
    });
    assert.strictEqual(result, 'first');
  });

  it('propagates a rejected argument', async () => {
    const result = call({
      jmespath: 'rows[0]',
      data: Promise.reject(new Error('the tool call failed')),
    });
    await assert.rejects(async () => await result, /the tool call failed/);
  });
});
