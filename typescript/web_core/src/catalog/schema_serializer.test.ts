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

import {z} from 'zod';

import {basicCatalog as v10BasicCatalog} from '../catalogs/basic/v1/catalog.js';
import {Catalog, createFunctionImplementation, type ComponentApi} from './types.js';

function readRepoJson(relativePath: string): Record<string, any> {
  return JSON.parse(readFileSync(resolve(process.cwd(), '../..', relativePath), 'utf-8'));
}

function collectRefs(node: unknown, refs: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
  } else if (node && typeof node === 'object') {
    const ref = (node as Record<string, unknown>).$ref;
    if (typeof ref === 'string') refs.push(ref);
    for (const value of Object.values(node)) collectRefs(value, refs);
  }
  return refs;
}

const PUBLISHED_CATALOGS = [
  'catalogs/basic/v1/catalog.json',
  'catalogs/mcp/catalog.json',
  'specification/v0_9/catalogs/basic/catalog.json',
  'specification/v0_9/catalogs/minimal/catalog.json',
  'specification/v0_9_1/catalogs/basic/catalog.json',
];

describe('Catalog.toJson', () => {
  for (const catalogPath of PUBLISHED_CATALOGS) {
    it(`returns ${catalogPath} unchanged after fromJson`, () => {
      const document = readRepoJson(catalogPath);
      const out = Catalog.fromJson(document).toJson();
      assert.deepStrictEqual(out, document);
      assert.deepStrictEqual(Catalog.fromJson(out).toJson(), out);
    });
  }

  it('returns a fresh copy on every call', () => {
    const document = readRepoJson('catalogs/basic/v1/catalog.json');
    const catalog = Catalog.fromJson(document);
    const first = catalog.toJson();
    (first.components as Record<string, any>).Text.type = 'mutated';
    delete (first.$defs as Record<string, unknown>).anyComponent;
    assert.deepStrictEqual(catalog.toJson(), document);
  });

  it('does not add metadata, protocolVersion or $defs the document omits', () => {
    const document = {
      catalogId: 'https://example.com/plain',
      components: {
        Label: {
          type: 'object',
          properties: {
            component: {const: 'Label'},
            text: {$ref: 'common_types.json#/$defs/DynamicString'},
          },
          required: ['component', 'text'],
        },
      },
    };
    assert.deepStrictEqual(Catalog.fromJson(document, '1.0').toJson(), document);
  });

  it('keeps the list form of functions', () => {
    const document = {
      catalogId: 'https://example.com/list',
      components: {},
      functions: [
        {
          name: 'shout',
          returnType: 'string',
          parameters: {type: 'object', properties: {value: {type: 'string'}}},
        },
      ],
    };
    assert.deepStrictEqual(Catalog.fromJson(document).toJson(), document);
  });

  it('serializes a code-defined v1.0 catalog unbundled, with both unions', () => {
    const out = v10BasicCatalog.toJson();
    assert.strictEqual(out.catalogId, v10BasicCatalog.id);
    assert.strictEqual(out.protocolVersion, '1.0');
    assert.strictEqual(out.theme, undefined);
    assert.deepStrictEqual(Object.keys(out.$defs as object).sort(), [
      'anyComponent',
      'anyFunction',
    ]);
    const functions = out.functions as Record<string, any>;
    assert.ok(!('@index' in functions), 'system functions are not part of the document');
    assert.deepStrictEqual(functions.formatNumber.properties['@call'], {const: 'formatNumber'});
    assert.strictEqual(functions.formatNumber.returnType, 'string');
    for (const ref of collectRefs(out)) {
      assert.ok(
        ref.startsWith('common_types.json#/$defs/') ||
          ref.startsWith('#/components/') ||
          ref.startsWith('#/functions/'),
        `unexpected reference '${ref}'`,
      );
    }
    const text = (out.components as Record<string, any>).Text;
    assert.deepStrictEqual(text.properties.component, {const: 'Text'});
    assert.ok(text.required.includes('component'));
    assert.ok(!('id' in text.properties));
  });

  it('serializes code-defined functions in the call shape of the protocol version', () => {
    const fn = createFunctionImplementation(
      {
        name: 'launch',
        returnType: 'void',
        schema: z.object({url: z.string()}),
        allowedCallers: 'rendererOnly',
        requiresUserActivation: true,
        description: 'Launches a URL.',
      },
      () => undefined,
    );
    const v10 = new Catalog('https://example.com/v10', '1.0', [], [fn]).toJson();
    assert.deepStrictEqual((v10.functions as Record<string, unknown>).launch, {
      type: 'object',
      description: 'Launches a URL.',
      returnType: 'void',
      allowedCallers: 'rendererOnly',
      requiresUserActivation: true,
      properties: {
        '@call': {const: 'launch'},
        args: {
          type: 'object',
          properties: {url: {type: 'string'}},
          required: ['url'],
          unevaluatedProperties: false,
        },
      },
      required: ['@call', 'args'],
    });
    assert.deepStrictEqual(v10.$defs, {
      anyComponent: {not: {}},
      anyFunction: {oneOf: [{$ref: '#/functions/launch'}]},
    });

    const v09 = new Catalog('https://example.com/v09', '0.9', [], [fn]).toJson();
    const launch = (v09.functions as Record<string, any>).launch;
    assert.deepStrictEqual(launch.properties.call, {const: 'launch'});
    assert.deepStrictEqual(launch.properties.returnType, {const: 'void'});
    assert.deepStrictEqual(launch.required, ['call', 'args']);
  });

  it('emits metadata given to a code-defined catalog', () => {
    const out = new Catalog('https://example.com/meta', 'v1.0', [], [], {
      schemaUri: 'https://json-schema.org/draft/2020-12/schema',
      schemaId: 'https://example.com/meta.json',
      title: 'Meta',
      description: 'A catalog.',
      instructions: 'Be brief.',
    }).toJson();
    assert.strictEqual(out.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.strictEqual(out.$id, 'https://example.com/meta.json');
    assert.strictEqual(out.title, 'Meta');
    assert.strictEqual(out.description, 'A catalog.');
    assert.strictEqual(out.instructions, 'Be brief.');
    assert.strictEqual(out.protocolVersion, '1.0');
  });

  it('serializes an entry without a source from its model in a loaded catalog', () => {
    const document = readRepoJson('catalogs/basic/v1/catalog.json');
    const loaded = Catalog.fromJson(document);
    const rewritten: ComponentApi = {
      name: 'Text',
      schema: z.object({text: z.string().describe('REF:common_types.json#/$defs/DynamicString')}),
    };
    const derived = new Catalog(
      loaded.id,
      loaded.protocolVersion,
      [rewritten, loaded.components.get('Image')!],
      [],
      {
        schemaId: loaded.schemaId,
        declaredProtocolVersion: loaded.declaredProtocolVersion,
        defs: loaded.defs,
        sourceDocument: loaded.sourceDocument,
      },
    );
    const out = derived.toJson();
    const components = out.components as Record<string, any>;
    assert.deepStrictEqual(components.Image, document.components.Image);
    assert.deepStrictEqual(components.Text.properties.text, {
      $ref: 'common_types.json#/$defs/DynamicString',
    });
    assert.deepStrictEqual((out.$defs as Record<string, unknown>).anyComponent, {
      oneOf: [{$ref: '#/components/Text'}, {$ref: '#/components/Image'}],
      discriminator: {propertyName: 'component'},
    });
    assert.deepStrictEqual((out.$defs as Record<string, unknown>).anyFunction, {not: {}});
    assert.deepStrictEqual(out.functions, {});
  });

  it('drops authored $defs that only removed entries referenced', () => {
    const document = readRepoJson('specification/v0_9/catalogs/basic/catalog.json');
    const loaded = Catalog.fromJson(document);
    const derived = new Catalog(loaded.id, loaded.protocolVersion, [], [], {
      defs: loaded.defs,
      sourceDocument: loaded.sourceDocument,
    });
    const defs = derived.toJson().$defs as Record<string, unknown>;
    assert.ok(!('CatalogComponentCommon' in defs), 'orphaned mixin is dropped');
    assert.ok('theme' in defs, 'a definition the source never referenced is kept');
  });
});

describe('Catalog.validationSchema', () => {
  it('is the bundled schema that catalogSchema still returns', () => {
    const catalog = Catalog.fromJson(readRepoJson('catalogs/basic/v1/catalog.json'));
    const schema = catalog.validationSchema;
    assert.strictEqual(catalog.catalogSchema, schema);
    const defs = schema.$defs as Record<string, unknown>;
    assert.ok('DynamicString' in defs, 'common types are bundled');
    for (const ref of collectRefs(schema.components)) {
      assert.ok(ref.startsWith('#'), `reference '${ref}' is localized`);
    }
  });

  it('is unaffected by toJson', () => {
    const catalog = Catalog.fromJson(readRepoJson('catalogs/basic/v1/catalog.json'));
    const before = JSON.stringify(catalog.validationSchema);
    catalog.toJson();
    assert.strictEqual(JSON.stringify(catalog.validationSchema), before);
  });
});

describe('Catalog.fromJson', () => {
  it('captures document metadata and authored entries', () => {
    const document = readRepoJson('catalogs/basic/v1/catalog.json');
    const catalog = Catalog.fromJson(document);
    assert.strictEqual(catalog.schemaUri, document.$schema);
    assert.strictEqual(catalog.schemaId, document.$id);
    assert.strictEqual(catalog.title, document.title);
    assert.strictEqual(catalog.description, document.description);
    assert.strictEqual(catalog.declaredProtocolVersion, '1.0');
    assert.deepStrictEqual(catalog.defs, document.$defs);
    assert.deepStrictEqual(
      catalog.components.get('CheckBox')?.sourceJson,
      document.components.CheckBox,
    );
    assert.deepStrictEqual(
      catalog.functions.get('openUrl')?.sourceJson,
      document.functions.openUrl,
    );
  });

  it('leaves declaredProtocolVersion unset when the document omits it', () => {
    const catalog = Catalog.fromJson(
      readRepoJson('specification/v0_9/catalogs/basic/catalog.json'),
    );
    assert.strictEqual(catalog.declaredProtocolVersion, undefined);
    assert.strictEqual(catalog.protocolVersion, '0.9');
  });

  it('rejects a document without a catalog ID', () => {
    assert.throws(() => Catalog.fromJson({components: {}}), /Catalog ID/);
  });

  it('is what the deprecated fromSchema returns', () => {
    const document = readRepoJson('catalogs/mcp/catalog.json');
    assert.deepStrictEqual(Catalog.fromSchema(document).toJson(), document);
  });
});
