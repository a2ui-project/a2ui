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

import {applyDefaults} from './defaults.js';
import type {SchemaDoc} from './nav.js';
import type {JsonSchema} from './types.js';

const docOf = (root: JsonSchema, defs: Record<string, JsonSchema> = {}): SchemaDoc => ({
  root,
  defs,
});

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

describe('applyDefaults', () => {
  const nested: JsonSchema = {
    type: 'object',
    properties: {
      a: {type: 'object', properties: {b: {type: 'string', default: 'x'}}},
    },
  };

  it('fills a nested default on a copy and leaves the frozen input unchanged', () => {
    const input = deepFreeze({a: {}});
    const result = applyDefaults(input, nested, docOf(nested));
    assert.deepStrictEqual(result, {a: {b: 'x'}});
    assert.deepStrictEqual(input, {a: {}});
    assert.notStrictEqual(result, input);
  });

  it('does not overwrite a value that is present', () => {
    const input = deepFreeze({a: {b: 'given'}});
    assert.strictEqual(applyDefaults(input, nested, docOf(nested)), input);
  });

  it('returns the input itself when there is nothing to fill', () => {
    const schema: JsonSchema = {type: 'object', properties: {a: {type: 'string'}}};
    const input = deepFreeze({a: 'v', extra: {deep: true}});
    assert.strictEqual(applyDefaults(input, schema, docOf(schema)), input);
  });

  it('shares the untouched branches of the input', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        filled: {type: 'object', properties: {n: {type: 'number', default: 1}}},
        kept: {type: 'object', properties: {s: {type: 'string'}}},
      },
    };
    const input = deepFreeze({filled: {}, kept: {s: 'v'}});
    const result = applyDefaults(input, schema, docOf(schema)) as typeof input;
    assert.deepStrictEqual(result, {filled: {n: 1}, kept: {s: 'v'}});
    assert.strictEqual(result.kept, input.kept);
  });

  it('fills only optional properties', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {req: {type: 'string', default: 'r'}, opt: {type: 'string', default: 'o'}},
      required: ['req'],
    };
    assert.deepStrictEqual(applyDefaults({}, schema, docOf(schema)), {opt: 'o'});
  });

  it('copies an object default so the schema stays unshared', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {style: {type: 'object', default: {color: 'red'}}},
    };
    const result = applyDefaults({}, schema, docOf(schema)) as {style: {color: string}};
    assert.deepStrictEqual(result, {style: {color: 'red'}});
    result.style.color = 'blue';
    assert.deepStrictEqual(
      (schema as {properties: {style: {default: unknown}}}).properties.style.default,
      {color: 'red'},
    );
  });

  it('reads defaults through $ref, allOf and cross-document references', () => {
    const common: JsonSchema = {
      $defs: {Mixin: {type: 'object', properties: {live: {type: 'string', default: 'off'}}}},
    };
    const root: JsonSchema = {
      $defs: {Local: {type: 'object', properties: {size: {type: 'number', default: 3}}}},
      allOf: [{$ref: 'common.json#/$defs/Mixin'}, {$ref: '#/$defs/Local'}],
    };
    assert.deepStrictEqual(applyDefaults({}, root, docOf(root, {'common.json': common})), {
      live: 'off',
      size: 3,
    });
  });

  it('takes a default written beside a $ref', () => {
    const root: JsonSchema = {
      $defs: {Flag: {type: 'boolean'}},
      type: 'object',
      properties: {on: {$ref: '#/$defs/Flag', default: true}},
    };
    assert.deepStrictEqual(applyDefaults({}, root, docOf(root)), {on: true});
  });

  it('fills defaults in every array item', () => {
    const schema: JsonSchema = {
      type: 'array',
      items: {type: 'object', properties: {k: {type: 'string', default: 'd'}}},
    };
    const input = deepFreeze([{k: 'a'}, {}]);
    const result = applyDefaults(input, schema, docOf(schema)) as unknown[];
    assert.deepStrictEqual(result, [{k: 'a'}, {k: 'd'}]);
    assert.strictEqual(result[0], input[0]);
  });

  describe('oneOf', () => {
    const schema: JsonSchema = {
      oneOf: [
        {
          type: 'object',
          properties: {kind: {const: 'a'}, size: {type: 'number', default: 1}},
          required: ['kind'],
        },
        {
          type: 'object',
          properties: {kind: {const: 'b'}, label: {type: 'string', default: 'B'}},
          required: ['kind'],
        },
      ],
    };

    it('fills the defaults of the branch whose const matches', () => {
      assert.deepStrictEqual(applyDefaults({kind: 'b'}, schema, docOf(schema)), {
        kind: 'b',
        label: 'B',
      });
      assert.deepStrictEqual(applyDefaults({kind: 'a'}, schema, docOf(schema)), {
        kind: 'a',
        size: 1,
      });
    });

    it('fills nothing when no branch matches', () => {
      const input = {kind: 'c'};
      assert.strictEqual(applyDefaults(input, schema, docOf(schema)), input);
    });

    it('fills nothing when branches have no discriminator', () => {
      const ambiguous: JsonSchema = {
        oneOf: [
          {type: 'object', properties: {x: {type: 'string', default: 'x'}}},
          {type: 'object', properties: {y: {type: 'string', default: 'y'}}},
        ],
      };
      const input = {};
      assert.strictEqual(applyDefaults(input, ambiguous, docOf(ambiguous)), input);
    });
  });

  it('leaves primitives and mismatched shapes alone', () => {
    assert.strictEqual(applyDefaults('s', nested, docOf(nested)), 's');
    assert.strictEqual(applyDefaults(null, nested, docOf(nested)), null);
    const arr = [1];
    assert.strictEqual(applyDefaults(arr, nested, docOf(nested)), arr);
  });
});
