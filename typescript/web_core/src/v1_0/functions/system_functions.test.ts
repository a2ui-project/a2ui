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

import {IndexApi, IndexImplementation, SYSTEM_FUNCTIONS} from './system_functions.js';
import {DataContext} from '../../rendering/data-context.js';
import {A2uiValidationError} from '../../errors.js';

/** Builds a context that reports the given data path and no iteration index. */
function contextAtPath(path: string): DataContext {
  return {path} as unknown as DataContext;
}

/** Builds a context that reports an iteration index directly, as a node does. */
function contextWithIndex(index: number): DataContext {
  return {path: '/', getIndex: () => index} as unknown as DataContext;
}

describe('@index system function', () => {
  it('is the only function in the v1.0 system set', () => {
    assert.deepStrictEqual(
      SYSTEM_FUNCTIONS.map(f => f.name),
      ['@index'],
    );
    assert.strictEqual(IndexApi.name, '@index');
    assert.strictEqual(IndexApi.returnType, 'number');
    assert.strictEqual(IndexApi.allowedCallers, 'rendererOnly');
  });

  it('prefers the index the context reports directly', () => {
    assert.strictEqual(IndexImplementation.execute({}, contextWithIndex(4)), 4);
  });

  it('falls back to the trailing numeric segment of the data path', () => {
    assert.strictEqual(IndexImplementation.execute({}, contextAtPath('/items/2')), 2);
    assert.strictEqual(IndexImplementation.execute({}, contextAtPath('/items/2/name')), 2);
  });

  it('applies a numeric offset', () => {
    assert.strictEqual(IndexImplementation.execute({offset: 1}, contextWithIndex(4)), 5);
    assert.strictEqual(IndexImplementation.execute({offset: -1}, contextAtPath('/items/2')), 1);
  });

  it('ignores a non-finite offset', () => {
    assert.strictEqual(IndexImplementation.execute({offset: Number.NaN}, contextWithIndex(4)), 4);
  });

  it('rejects evaluation outside a collection template', () => {
    // A default of 0 would render a payload error as a plausible first row,
    // so the absence of an iteration scope has to be reported.
    for (const ctx of [contextAtPath('/'), contextAtPath('/items/name'), contextAtPath('')]) {
      assert.throws(
        () => IndexImplementation.execute({}, ctx),
        (err: unknown) =>
          err instanceof A2uiValidationError && /collection template/.test(err.message),
      );
    }
  });

  it('rejects a context that reports a non-numeric index', () => {
    const badContext = {
      path: '/',
      getIndex: () => Number.NaN,
    } as unknown as DataContext;
    assert.throws(() => IndexImplementation.execute({}, badContext), A2uiValidationError);
  });
});
