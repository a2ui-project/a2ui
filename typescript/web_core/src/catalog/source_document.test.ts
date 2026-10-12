/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as assert from 'node:assert';
import {describe, it} from 'node:test';

import {z} from 'zod';

import {
  attachSourceJson,
  catalogDocumentOptions,
  definitionsWithEntrySources,
  entrySource,
  frozenJson,
} from './source_document.js';
import type {ComponentApi, FunctionApi} from './types.js';

describe('catalogDocumentOptions', () => {
  it('reads the document metadata into a frozen copy of the document', () => {
    const document = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/catalog.json',
      title: 'Example',
      description: 'An example.',
      protocolVersion: '1.0',
      instructions: 'Be brief.',
      catalogId: 'https://example.com/catalog',
      components: {},
      $defs: {Shared: {type: 'string'}},
    };
    const options = catalogDocumentOptions(document);
    assert.deepStrictEqual(options, {
      instructions: 'Be brief.',
      schemaUri: document.$schema,
      schemaId: document.$id,
      title: 'Example',
      description: 'An example.',
      declaredProtocolVersion: '1.0',
      defs: document.$defs,
      sourceDocument: document,
    });
    assert.notStrictEqual(options.sourceDocument, document);
    assert.strictEqual(options.defs, options.sourceDocument!.$defs);
    assert.ok(Object.isFrozen(options.defs!.Shared));
    assert.ok(!Object.isFrozen(document), 'the input is left alone');
  });

  it('leaves out what the document omits', () => {
    const options = catalogDocumentOptions({catalogId: 'x', components: {}, title: 3});
    assert.strictEqual(options.title, undefined);
    assert.strictEqual(options.defs, undefined);
    assert.strictEqual(options.declaredProtocolVersion, undefined);
  });
});

describe('frozenJson', () => {
  it('returns a frozen value as it is and copies anything else', () => {
    const value = {a: {b: 1}};
    const frozen = frozenJson(value);
    assert.notStrictEqual(frozen, value);
    assert.ok(Object.isFrozen(frozen.a));
    assert.strictEqual(frozenJson(frozen), frozen);
  });
});

describe('attachSourceJson', () => {
  const document = {
    components: {
      Label: {allOf: [{$ref: '#/$defs/Mixin'}, {properties: {component: {const: 'Label'}}}]},
    },
    functions: [{name: 'shout', returnType: 'string', parameters: {type: 'object'}}],
    $defs: {
      Mixin: {properties: {weight: {$ref: '#/$defs/Weight'}}},
      Weight: {type: 'number'},
      Unused: {type: 'string'},
      anyComponent: {oneOf: [{$ref: '#/components/Label'}]},
    },
  };

  it('attaches definitions without copying the entries', () => {
    const label: ComponentApi = {name: 'Label', schema: z.object({})};
    const extra: ComponentApi = {name: 'Extra', schema: z.object({})};
    const entries = [label, extra];
    assert.strictEqual(attachSourceJson(entries, document, 'components'), entries);
    assert.strictEqual(label.sourceJson, undefined, 'the entry is not modified');
    const source = entrySource(label)!;
    assert.deepStrictEqual(source.json, document.components.Label);
    assert.deepStrictEqual(source.defs, {
      Mixin: document.$defs.Mixin,
      Weight: document.$defs.Weight,
    });
    assert.ok(Object.isFrozen(source.json));
    assert.strictEqual(entrySource(extra), undefined);
  });

  it('reads the list form of functions', () => {
    const shout: FunctionApi = {name: 'shout', returnType: 'string', schema: z.object({})};
    attachSourceJson([shout], document, 'functions');
    assert.deepStrictEqual(entrySource(shout)!.json, document.functions[0]);
  });

  it('ignores the source of a copy with another schema', () => {
    const label: ComponentApi = {name: 'Label', schema: z.object({})};
    attachSourceJson([label], document, 'components');
    assert.strictEqual(entrySource({...label, schema: z.object({x: z.string()})}), undefined);
    assert.strictEqual(entrySource({...label}), undefined, 'a copy is not the attached entry');
  });

  it('merges the definitions entries reach into the catalog definitions', () => {
    const label: ComponentApi = {name: 'Label', schema: z.object({})};
    attachSourceJson([label], document, 'components');
    const own = {Weight: {type: 'integer'}};
    assert.deepStrictEqual(definitionsWithEntrySources(own, [label]), {
      Weight: {type: 'integer'},
      Mixin: document.$defs.Mixin,
    });
    assert.strictEqual(definitionsWithEntrySources(own, []), own);
  });
});

describe('entrySource', () => {
  it('uses a sourceJson that was set by hand', () => {
    const json = {type: 'object'};
    assert.deepStrictEqual(entrySource({name: 'X', schema: z.object({}), sourceJson: json}), {
      json,
      defs: {},
    });
  });
});
