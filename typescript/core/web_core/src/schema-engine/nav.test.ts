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
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, it} from 'node:test';
import {A2uiConfigurationError} from '../errors.js';
import {
  arrayItems,
  deref,
  objectProperties,
  refKind,
  unionOptions,
  unwrapField,
  type SchemaDoc,
} from './nav.js';
import type {JsonSchema} from './types.js';

function load(rel: string): Record<string, any> {
  return JSON.parse(readFileSync(resolve(process.cwd(), '../../..', rel), 'utf-8'));
}

const catalog = load('catalogs/basic/v1/catalog.json');
const common = load('specification/v1_0/json/common_types.json');
const doc: SchemaDoc = {root: catalog, defs: {'common_types.json': common}};
const empty = (root: JsonSchema = {}): SchemaDoc => ({root, defs: {}});

describe('refKind', () => {
  it('names the $defs target of a cross-document $ref', () => {
    assert.strictEqual(refKind(catalog.components.Text.properties.text, doc), 'DynamicString');
    assert.strictEqual(refKind(catalog.components.Column.properties.children, doc), 'ChildList');
  });
  it('parses legacy REF: description markers', () => {
    assert.strictEqual(refKind({description: 'REF:#/$defs/DynamicString|x'}, empty()), 'DynamicString');
    assert.strictEqual(
      refKind({description: 'REF:common_types.json#/$defs/ChildList'}, empty()),
      'ChildList',
    );
  });
  it('is undefined for plain nodes', () => {
    assert.strictEqual(refKind({type: 'string', description: 'hi'}, empty()), undefined);
  });
});

describe('deref', () => {
  it('follows local pointers, decoding ~1, ~0 and percent escapes', () => {
    const d = empty({
      $defs: {'a/b': {type: 'string'}, 'c~d': {type: 'number'}, 'e f': {type: 'boolean'}},
    });
    assert.deepStrictEqual(deref({$ref: '#/$defs/a~1b'}, d).node, {type: 'string'});
    assert.deepStrictEqual(deref({$ref: '#/$defs/c~0d'}, d).node, {type: 'number'});
    assert.deepStrictEqual(deref({$ref: '#/$defs/e%20f'}, d).node, {type: 'boolean'});
  });
  it('follows chains and reports the last $defs name', () => {
    const d = empty({$defs: {A: {$ref: '#/$defs/B'}, B: {type: 'string'}}});
    assert.deepStrictEqual(deref({$ref: '#/$defs/A'}, d), {
      node: {type: 'string'},
      refName: 'B',
      doc: d,
    });
  });
  it('resolves cross-document and bare document refs', () => {
    const r = deref({$ref: 'common_types.json#/$defs/DynamicString'}, doc);
    assert.strictEqual(r.refName, 'DynamicString');
    assert.ok(typeof r.node === 'object' && r.node !== null);
    assert.strictEqual(deref({$ref: 'common_types.json'}, doc).node, common);
  });
  it('resolves local refs inside the followed document', () => {
    const d: SchemaDoc = {
      root: {},
      defs: {'x.json': {$defs: {A: {$ref: '#/$defs/B'}, B: {type: 'string'}}}},
    };
    assert.deepStrictEqual(deref({$ref: 'x.json#/$defs/A'}, d).node, {type: 'string'});
  });
  it('returns non-ref nodes unchanged', () => {
    const n = {type: 'string'};
    assert.deepStrictEqual(deref(n, empty()), {node: n, doc: empty()});
    assert.strictEqual(deref(true, empty()).node, true);
  });
  it('throws A2uiConfigurationError on cycles and unresolved refs', () => {
    const d = empty({$defs: {A: {$ref: '#/$defs/B'}, B: {$ref: '#/$defs/A'}}});
    assert.throws(() => deref({$ref: '#/$defs/A'}, d), A2uiConfigurationError);
    assert.throws(() => deref({$ref: '#/$defs/Nope'}, d), A2uiConfigurationError);
    assert.throws(() => deref({$ref: 'missing.json#/$defs/A'}, d), A2uiConfigurationError);
  });
});

describe('unwrapField', () => {
  it('strips anyOf nullable and reads default', () => {
    const r = unwrapField({anyOf: [{type: 'string'}, {type: 'null'}], default: 'a'}, empty(), false);
    assert.deepStrictEqual(r, {
      node: {type: 'string', default: 'a'},
      optional: true,
      nullable: true,
      default: 'a',
      description: undefined,
      refName: undefined,
    });
  });
  it('strips oneOf nullable and type-array nullable', () => {
    const a = unwrapField({oneOf: [{$ref: '#/$defs/S'}, {type: 'null'}]}, empty({$defs: {S: {type: 'string'}}}), true);
    assert.strictEqual(a.nullable, true);
    assert.strictEqual(a.optional, false);
    assert.strictEqual(a.refName, 'S');
    const b = unwrapField({type: ['string', 'null'], description: 'd'}, empty(), true);
    assert.deepStrictEqual(b.node, {type: 'string', description: 'd'});
    assert.strictEqual(b.nullable, true);
    assert.strictEqual(b.description, 'd');
  });
  it('keeps the remaining union when several members survive', () => {
    const r = unwrapField({anyOf: [{type: 'string'}, {type: 'number'}, {type: 'null'}]}, empty(), true);
    assert.deepStrictEqual(r.node, {anyOf: [{type: 'string'}, {type: 'number'}]});
    assert.strictEqual(r.nullable, true);
  });
  it('derefs and prefers the referring node description', () => {
    const r = unwrapField(catalog.components.Text.properties.text, doc, true);
    assert.strictEqual(r.refName, 'DynamicString');
    assert.strictEqual(r.nullable, false);
    assert.match(r.description ?? '', /^The text content/);
  });
});

describe('unionOptions / arrayItems', () => {
  it('returns anyOf or oneOf members', () => {
    assert.deepStrictEqual(unionOptions({anyOf: [{type: 'string'}]}, empty()), [{type: 'string'}]);
    assert.deepStrictEqual(unionOptions({oneOf: [{type: 'number'}]}, empty()), [{type: 'number'}]);
    assert.strictEqual(unionOptions({type: 'string'}, empty()), undefined);
  });
  it('sees through refs', () => {
    const opts = unionOptions({$ref: 'common_types.json#/$defs/ChildList'}, doc);
    assert.ok(Array.isArray(opts) && opts.length > 0);
    const items = arrayItems({type: 'array', items: {type: 'string'}}, empty());
    assert.deepStrictEqual(items, {type: 'string'});
    assert.strictEqual(arrayItems({type: 'string'}, empty()), undefined);
  });
});

describe('objectProperties', () => {
  it('reads properties, required and additionalProperties', () => {
    const r = objectProperties(
      {type: 'object', properties: {a: {type: 'string'}}, required: ['a'], additionalProperties: false},
      empty(),
    );
    assert.deepStrictEqual(r, {
      properties: {a: {type: 'string'}},
      required: new Set(['a']),
      additional: false,
    });
  });
  it('merges allOf parts and unions required', () => {
    const d = empty({$defs: {Base: {properties: {id: {type: 'string'}}, required: ['id']}}});
    const r = objectProperties(
      {
        allOf: [{$ref: '#/$defs/Base'}, {properties: {x: {type: 'number'}}, required: ['x']}],
        properties: {y: {type: 'boolean'}},
      },
      d,
    );
    assert.deepStrictEqual(Object.keys(r!.properties).sort(), ['id', 'x', 'y']);
    assert.deepStrictEqual([...r!.required].sort(), ['id', 'x']);
    assert.strictEqual(r!.additional, undefined);
  });
  it('works on a real catalog component and is undefined for non-objects', () => {
    const r = objectProperties(catalog.components.Text, doc);
    assert.ok(r && 'text' in r.properties && r.required.has('text'));
    assert.strictEqual(objectProperties({type: 'string'}, empty()), undefined);
  });
});
