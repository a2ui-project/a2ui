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
import {z} from 'zod';
import {
  Catalog,
  DataContext,
  DataModel,
  createFunctionImplementation,
  type ComponentApi,
} from '@a2ui/web_core/v0_9';
import {
  isDataBinding,
  isDynamicExpression,
  isFunctionCall,
  resolveDynamicRecord,
  resolveDynamicValueDeep,
} from './dynamic-values.js';

/** A catalog exposing `shout`, used to exercise function call resolution. */
const testCatalog = new Catalog<ComponentApi>(
  'https://example.com/test-catalog.json',
  [],
  [
    createFunctionImplementation(
      {
        name: 'shout',
        returnType: 'string' as const,
        schema: z.object({text: z.string()}),
      },
      args => `${args.text}!`,
    ),
  ],
);

function createContext(data: Record<string, unknown> = {}): DataContext {
  const surface = {
    dataModel: new DataModel(data),
    catalog: {invoker: testCatalog.invoker},
    dispatchError: () => {},
  } as any;
  return new DataContext(surface, '/');
}

describe('dynamic-values', () => {
  describe('isDataBinding', () => {
    it('accepts an object whose only key is a string path', () => {
      assert.strictEqual(isDataBinding({path: '/user/name'}), true);
    });

    it('rejects objects carrying keys beyond path', () => {
      // DataBinding sets additionalProperties: false, so this is literal data.
      assert.strictEqual(isDataBinding({path: '/docs', recursive: true}), false);
    });

    it('rejects non-string paths, arrays, and primitives', () => {
      assert.strictEqual(isDataBinding({path: 5}), false);
      assert.strictEqual(isDataBinding([{path: '/a'}]), false);
      assert.strictEqual(isDataBinding('/user/name'), false);
      assert.strictEqual(isDataBinding(null), false);
    });
  });

  describe('isFunctionCall', () => {
    it('accepts a string call with or without args', () => {
      assert.strictEqual(isFunctionCall({call: 'shout', args: {text: 'hi'}}), true);
      // FunctionCall requires only `call` in the spec.
      assert.strictEqual(isFunctionCall({call: 'shout'}), true);
    });

    it('rejects malformed call, args, and returnType fields', () => {
      assert.strictEqual(isFunctionCall({call: 5}), false);
      assert.strictEqual(isFunctionCall({call: 'shout', args: 'not-an-object'}), false);
      assert.strictEqual(isFunctionCall({call: 'shout', returnType: 7}), false);
    });
  });

  describe('isDynamicExpression', () => {
    it('covers both bindings and calls but not literals', () => {
      assert.strictEqual(isDynamicExpression({path: '/a'}), true);
      assert.strictEqual(isDynamicExpression({call: 'shout', args: {}}), true);
      assert.strictEqual(isDynamicExpression({label: 'literal'}), false);
      assert.strictEqual(isDynamicExpression(['a', 'b']), false);
      assert.strictEqual(isDynamicExpression(42), false);
    });
  });

  describe('resolveDynamicValueDeep', () => {
    it('returns literals untouched', () => {
      const context = createContext();
      assert.strictEqual(resolveDynamicValueDeep('text', context), 'text');
      assert.strictEqual(resolveDynamicValueDeep(7, context), 7);
      assert.strictEqual(resolveDynamicValueDeep(null, context), null);
      assert.strictEqual(resolveDynamicValueDeep(undefined, context), undefined);
    });

    it('resolves bindings nested inside literal objects and arrays', () => {
      const context = createContext({city: 'Paris', tags: ['a', 'b']});

      assert.deepStrictEqual(
        resolveDynamicValueDeep(
          {
            where: {city: {path: '/city'}},
            items: [{path: '/tags'}, 'literal'],
          },
          context,
        ),
        {
          where: {city: 'Paris'},
          items: [['a', 'b'], 'literal'],
        },
      );
    });

    it('preserves literal objects that merely contain a path property', () => {
      const context = createContext({docs: 'SHOULD_NOT_RESOLVE'});
      const filter = {path: '/docs', recursive: true};

      assert.deepStrictEqual(resolveDynamicValueDeep(filter, context), filter);
    });

    it('invokes function calls, defaulting omitted args', () => {
      const context = createContext({name: 'ada'});

      assert.strictEqual(
        resolveDynamicValueDeep({call: 'shout', args: {text: {path: '/name'}}}, context),
        'ada!',
      );
      // `args` is optional in the spec; resolution must not throw without it.
      assert.strictEqual(resolveDynamicValueDeep({call: 'shout'}, context), undefined);
    });
  });

  describe('resolveDynamicRecord', () => {
    it('resolves each entry independently', () => {
      const context = createContext({city: 'Paris'});

      assert.deepStrictEqual(
        resolveDynamicRecord({city: {path: '/city'}, unit: 'metric'}, context),
        {city: 'Paris', unit: 'metric'},
      );
    });

    it('does not treat a record with path or call keys as an expression', () => {
      const context = createContext({path: 'SHOULD_NOT_RESOLVE'});

      assert.deepStrictEqual(
        resolveDynamicRecord({path: '/tmp/notes.txt', call: 'transcribe'}, context),
        {path: '/tmp/notes.txt', call: 'transcribe'},
      );
    });

    it('returns an empty object for an empty record', () => {
      assert.deepStrictEqual(resolveDynamicRecord({}, createContext()), {});
    });
  });
});
