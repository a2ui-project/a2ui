/*
 * @license
 * Copyright 2026 Google LLC
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

import {catalogDocumentOptions, withSourceJson} from './source_document.js';
import type {ComponentApi, FunctionApi} from './types.js';

describe('catalogDocumentOptions', () => {
  it('reads the document metadata and copies the document', () => {
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
    assert.notStrictEqual(options.defs, document.$defs);
    assert.notStrictEqual(options.sourceDocument, document);
  });

  it('leaves out what the document omits', () => {
    const options = catalogDocumentOptions({catalogId: 'x', components: {}, title: 3});
    assert.strictEqual(options.title, undefined);
    assert.strictEqual(options.defs, undefined);
    assert.strictEqual(options.declaredProtocolVersion, undefined);
  });
});

describe('withSourceJson', () => {
  const label: ComponentApi = {name: 'Label', schema: z.object({})};
  const extra: ComponentApi = {name: 'Extra', schema: z.object({})};

  it('attaches each component definition as a copy', () => {
    const definition = {type: 'object', properties: {component: {const: 'Label'}}};
    const document = {components: {Label: definition}};
    const [withSource, without] = withSourceJson([label, extra], document, 'components');
    assert.deepStrictEqual(withSource.sourceJson, definition);
    assert.notStrictEqual(withSource.sourceJson, definition);
    assert.strictEqual(withSource.schema, label.schema);
    assert.strictEqual(label.sourceJson, undefined, 'the original entry is not mutated');
    assert.strictEqual(without, extra, 'an entry the document lacks is returned as is');
  });

  it('reads the list form of functions', () => {
    const shout: FunctionApi = {name: 'shout', returnType: 'string', schema: z.object({})};
    const definition = {name: 'shout', returnType: 'string', parameters: {type: 'object'}};
    const [entry] = withSourceJson([shout], {functions: [definition]}, 'functions');
    assert.deepStrictEqual(entry.sourceJson, definition);
  });
});
