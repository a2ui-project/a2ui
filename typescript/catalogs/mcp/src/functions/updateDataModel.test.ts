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
import {
  A2uiExpressionError,
  Catalog,
  DataContext,
  DataModel,
  createFunctionImplementation,
  type FunctionImplementation,
} from '@a2ui/web_core/v0_9';
import {z} from 'zod';
import {DATA_FUNCTIONS} from '../index.js';

const AsyncSourceImplementation: FunctionImplementation = createFunctionImplementation(
  {
    name: 'asyncSource',
    returnType: 'any',
    schema: z.object({value: z.any()}),
  } as const,
  async args => {
    await Promise.resolve();
    return args['value'];
  },
);

const catalog = new Catalog<any>(
  'https://a2ui.org/test/updateDataModel',
  [],
  [...DATA_FUNCTIONS, AsyncSourceImplementation],
);

const createTestDataContext = (
  model: DataModel,
  path = '/',
  onError: (error: unknown) => void = () => {},
) => {
  const mockSurface = {
    dataModel: model,
    catalog: {invoker: catalog.invoker},
    dispatchError: onError,
  } as any;
  return new DataContext(mockSurface, path);
};

describe('updateDataModel', () => {
  it('writes several paths from one call and leaves the rest alone', () => {
    const model = new DataModel({untouched: 'kept'});

    catalog.invoker(
      'updateDataModel',
      {updates: {'/title': 'Home', '/entries': [{name: 'notes.md'}], '/count': 1}},
      createTestDataContext(model),
    );

    assert.deepStrictEqual(model.get('/'), {
      untouched: 'kept',
      title: 'Home',
      entries: [{name: 'notes.md'}],
      count: 1,
    });
  });

  it('resolves a relative path against the row scope the call was made from', () => {
    const model = new DataModel({rows: [{name: 'notes.md'}, {name: 'todo.txt'}]});

    catalog.invoker(
      'updateDataModel',
      {updates: {selected: true, '/lastTouched': 'notes.md'}},
      createTestDataContext(model, '/rows/0'),
    );

    assert.deepStrictEqual(model.get('/'), {
      rows: [{name: 'notes.md', selected: true}, {name: 'todo.txt'}],
      lastTouched: 'notes.md',
    });
  });

  it('writes nothing when updates is null or undefined', () => {
    const model = new DataModel({kept: 'original'});
    const context = createTestDataContext(model);

    catalog.invoker('updateDataModel', {updates: null}, context);
    catalog.invoker('updateDataModel', {updates: undefined}, context);

    assert.deepStrictEqual(model.get('/'), {kept: 'original'});
  });

  const nonObjectUpdates: ReadonlyArray<readonly [string, unknown]> = [
    ['an array', [{'/title': 'Home'}]],
    ['a string', '/title'],
    ['a number', 42],
  ];

  for (const [label, updates] of nonObjectUpdates) {
    it(`throws naming the type when updates is ${label}`, () => {
      const model = new DataModel({kept: 'original'});

      assert.throws(
        () => catalog.invoker('updateDataModel', {updates}, createTestDataContext(model)),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.strictEqual(error.expression, 'updateDataModel');
          assert.strictEqual(
            error.message,
            `updateDataModel expects an object of data model paths, got ${label}.`,
          );
          return true;
        },
      );
      assert.deepStrictEqual(model.get('/'), {kept: 'original'});
    });
  }

  it('stays synchronous when no argument is pending', () => {
    const model = new DataModel({});
    const result = catalog.invoker(
      'updateDataModel',
      {updates: {'/settled': 'yes'}},
      createTestDataContext(model),
    );
    assert.strictEqual(typeof (result as {then?: unknown} | null)?.then, 'undefined');
    assert.strictEqual(result, undefined);
    assert.strictEqual(model.get('/settled'), 'yes');
  });

  it('returns a promise when an argument is pending', async () => {
    const model = new DataModel({});
    const result = catalog.invoker(
      'updateDataModel',
      {updates: Promise.resolve({'/settled': 'yes'})},
      createTestDataContext(model),
    );
    assert.strictEqual(typeof (result as {then?: unknown}).then, 'function');
    assert.strictEqual(await result, undefined);
    assert.strictEqual(model.get('/settled'), 'yes');
  });

  it('deeply clones values using structuredClone so modifications do not affect original objects', () => {
    const originalEntry = {name: 'notes.md'};
    const model = new DataModel({});

    catalog.invoker(
      'updateDataModel',
      {updates: {'/entry': originalEntry}},
      createTestDataContext(model),
    );

    const stored = model.get('/entry') as {name: string};
    assert.deepStrictEqual(stored, originalEntry);
    assert.notStrictEqual(stored, originalEntry);
  });

  it('propagates a rejected argument', async () => {
    const model = new DataModel({});
    const result = catalog.invoker(
      'updateDataModel',
      {updates: Promise.reject(new Error('the tool call failed'))},
      createTestDataContext(model),
    );
    await assert.rejects(async () => await result, /the tool call failed/);
    assert.deepStrictEqual(model.get('/'), {});
  });

  describe('composition through the data context', () => {
    it('carries an async tool result through split, capture, and query into the model', async () => {
      const listing = [
        '/home/wren/notes.md\t2048',
        '/home/wren/todo.txt\t91',
        'total 2 files',
      ].join('\n');

      const model = new DataModel({});
      const dispatched: unknown[] = [];
      const context = createTestDataContext(model, '/', error => dispatched.push(error));

      const result = context.resolveDynamicValue({
        call: 'updateDataModel',
        args: {
          updates: {
            call: 'jmespath',
            args: {
              expression:
                '[?@ != null] | {"/files": [*].{path: [0], size: to_number([1])}, "/count": length(@)}',
              data: {
                call: 'regexCapture',
                args: {
                  value: {
                    call: 'split',
                    args: {
                      value: {call: 'asyncSource', args: {value: listing}},
                      separator: '\n',
                    },
                  },
                  pattern: '^(\\S+)\\t(\\d+)$',
                },
              },
            },
          },
        },
      } as any);

      assert.deepStrictEqual(model.get('/'), {});
      await result;

      assert.deepStrictEqual(model.get('/'), {
        files: [
          {path: '/home/wren/notes.md', size: 2048},
          {path: '/home/wren/todo.txt', size: 91},
        ],
        count: 2,
      });
      assert.deepStrictEqual(dispatched, []);
    });

    it('sends a nested failure to the surface instead of throwing it', () => {
      const model = new DataModel({});
      const dispatched: Array<{message: string}> = [];
      const context = createTestDataContext(model, '/', error =>
        dispatched.push(error as {message: string}),
      );

      const result = context.resolveDynamicValue({
        call: 'updateDataModel',
        args: {updates: {call: 'jmespath', args: {expression: 'entries[', data: {}}}},
      } as any);

      assert.strictEqual(result, undefined);
      assert.deepStrictEqual(model.get('/'), {});
      assert.strictEqual(dispatched.length, 1);
      assert.match(dispatched[0].message, /in JMESPath expression: entries\[/);
    });
  });
});
