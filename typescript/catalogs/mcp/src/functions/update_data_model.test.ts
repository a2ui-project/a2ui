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
import {UpdateDataModelApi, UpdateDataModelImplementation} from './update_data_model.js';

const catalog = new Catalog<never>(
  'https://a2ui.org/test/updateDataModel',
  '1.0',
  [],
  [UpdateDataModelImplementation],
);

const call = (args: Record<string, unknown>, model: DataModel, path = '/') =>
  catalog.invoker('updateDataModel', args, new DataContext(model, path));

describe('updateDataModel', () => {
  it('has the metadata the catalog schema publishes', () => {
    assert.strictEqual(UpdateDataModelApi.name, 'updateDataModel');
    assert.strictEqual(UpdateDataModelApi.returnType, 'any');
  });

  it('writes several paths from one call and leaves the rest alone', () => {
    const model = new DataModel({untouched: 'kept'});

    call({updates: {'/title': 'Home', '/entries': [{name: 'notes.md'}], '/count': 1}}, model);

    assert.deepStrictEqual(model.get('/'), {
      untouched: 'kept',
      title: 'Home',
      entries: [{name: 'notes.md'}],
      count: 1,
    });
  });

  it('resolves a relative path against the row scope the call was made from', () => {
    const model = new DataModel({rows: [{name: 'notes.md'}, {name: 'todo.txt'}]});

    call({updates: {selected: true, '/lastTouched': 'notes.md'}}, model, '/rows/0');

    assert.deepStrictEqual(model.get('/'), {
      rows: [{name: 'notes.md', selected: true}, {name: 'todo.txt'}],
      lastTouched: 'notes.md',
    });
  });

  it('rejects null or undefined updates at validation, writing nothing', () => {
    const model = new DataModel({kept: 'original'});

    for (const updates of [null, undefined]) {
      assert.throws(
        () => call({updates}, model),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.strictEqual(error.expression, 'updateDataModel');
          assert.ok(error.message.startsWith("Validation failed for function 'updateDataModel'"));
          return true;
        },
      );
    }

    assert.deepStrictEqual(model.get('/'), {kept: 'original'});
  });

  const nonObjectUpdates: ReadonlyArray<readonly [string, unknown]> = [
    ['array', [{'/title': 'Home'}]],
    ['string', '/title'],
    ['number', 42],
  ];

  for (const [label, updates] of nonObjectUpdates) {
    it(`throws naming the type when updates is ${label}`, () => {
      const model = new DataModel({kept: 'original'});

      assert.throws(
        () => call({updates}, model),
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

  const forbiddenKeys: ReadonlyArray<readonly [string, string]> = [
    ['/__proto__/polluted', '__proto__'],
    ['/constructor/prototype/polluted', 'constructor'],
    ['/safe/prototype', 'prototype'],
    ['__proto__/polluted', '__proto__'],
  ];

  for (const [key, segment] of forbiddenKeys) {
    it(`throws naming the key when it contains the segment '${segment}' (${key})`, () => {
      const model = new DataModel({kept: 'original'});

      assert.throws(
        () => call({updates: {'/written': 'first', [key]: 'bad'}}, model),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.strictEqual(error.expression, 'updateDataModel');
          assert.strictEqual(
            error.message,
            `updateDataModel rejected the key '${key}': the segment '${segment}' is not allowed.`,
          );
          return true;
        },
      );
      assert.deepStrictEqual(model.get('/'), {kept: 'original'});
      assert.strictEqual(({} as {polluted?: unknown}).polluted, undefined);
    });
  }

  it('throws on an empty key and writes nothing', () => {
    const model = new DataModel({kept: 'original'});

    assert.throws(
      () => call({updates: {'/written': 'first', '': 'bad'}}, model),
      (error: unknown) => {
        assert.ok(error instanceof A2uiExpressionError);
        assert.strictEqual(error.expression, 'updateDataModel');
        assert.strictEqual(
          error.message,
          'updateDataModel rejected an empty key: every key must be a data model path.',
        );
        return true;
      },
    );
    assert.deepStrictEqual(model.get('/'), {kept: 'original'});
  });

  it('stores a copy of an object, so the stored value is detached from the source', () => {
    const entry = {name: 'notes.md', tags: ['a']};
    const model = new DataModel({});

    call({updates: {'/entry': entry}}, model);
    entry.tags.push('b');

    assert.deepStrictEqual(model.get('/entry'), {name: 'notes.md', tags: ['a']});
  });

  it('writes a Date nested in updates as is, without flattening it to a record', () => {
    const model = new DataModel({});
    const when = new Date('2026-10-13T00:00:00Z');

    call({updates: {'/when': when, '/meta': {when}}}, model);

    assert.ok(model.get('/when') instanceof Date);
    assert.strictEqual((model.get('/when') as Date).toISOString(), when.toISOString());
    assert.ok((model.get('/meta') as {when: unknown}).when instanceof Date);
  });

  it('stays synchronous when updates is not pending', () => {
    const model = new DataModel({});
    const result = call({updates: {'/settled': 'yes'}}, model);
    assert.strictEqual(typeof (result as {then?: unknown} | null)?.then, 'undefined');
    assert.strictEqual(result, undefined);
    assert.strictEqual(model.get('/settled'), 'yes');
  });

  it('returns a promise when updates is pending', async () => {
    const model = new DataModel({});
    const result = call({updates: Promise.resolve({'/settled': 'yes'})}, model);
    assert.strictEqual(typeof (result as {then?: unknown}).then, 'function');
    assert.strictEqual(await result, undefined);
    assert.strictEqual(model.get('/settled'), 'yes');
  });

  it('propagates a rejected argument and writes nothing', async () => {
    const model = new DataModel({kept: 'original'});
    const result = call({updates: Promise.reject(new Error('the tool call failed'))}, model);
    await assert.rejects(async () => await result, /the tool call failed/);
    assert.deepStrictEqual(model.get('/'), {kept: 'original'});
  });
});
