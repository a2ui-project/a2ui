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
import {A2uiText as V10Text} from '../catalogs/basic/v1/components/index.js';
import {basicCatalog as v08BasicCatalog} from '../v0_8/basic_catalog/catalog.js';
import {basicCatalog as v09BasicCatalog} from '../v0_9/basic_catalog/catalog.js';
import {A2uiText as V09Text} from '../v0_9/basic_catalog/components/index.js';
import {JsonComponentApi, JsonFunctionApi} from './json_entries.js';
import {DEFAULT_PROTOCOL_VERSION} from './schema_loader.js';
import {spec, specDef} from './spec_annotations.js';
import {
  Catalog,
  createFunctionImplementation,
  type ComponentApi,
  type FunctionApi,
} from './types.js';

function readRepoJson(relativePath: string): Record<string, any> {
  return JSON.parse(readFileSync(resolve(process.cwd(), '../../..', relativePath), 'utf-8'));
}

/**
 * Returns a copy of an entry whose schema carries no specification
 * annotation, so that the catalog generates its definition from Zod.
 */
function plain<E extends ComponentApi | FunctionApi>(entry: E): E {
  return {...entry, schema: entry.schema.describe(entry.schema.description as string)};
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

  it('assembles the document once per catalog', () => {
    let reads = 0;
    const labelSchema = z.object({});
    const counted: ComponentApi = {
      name: 'Label',
      get schema() {
        reads++;
        return labelSchema;
      },
    };
    const catalog = new Catalog('https://example.com/cached', '1.0', [counted]);
    const first = catalog.toJson();
    const readsAfterFirst = reads;
    assert.ok(readsAfterFirst > 0);
    const second = catalog.toJson();
    assert.strictEqual(reads, readsAfterFirst, 'the second call does not read the model again');
    assert.notStrictEqual(first, second);
    assert.deepStrictEqual(first, second);
  });

  it('keeps the document-level fields in a catalog derived with withEntries', () => {
    const document = readRepoJson('specification/v0_9/catalogs/basic/catalog.json');
    const loaded = Catalog.fromJson(document);
    const derived = loaded.withEntries([...loaded.components.values()], []);
    const out = derived.toJson();
    const {functions: _functions, $defs: outDefs, ...outFields} = out;
    const {functions: _f, $defs: documentDefs, ...documentFields} = document;
    assert.deepStrictEqual(outFields, documentFields);
    assert.deepStrictEqual(out.functions, {});
    assert.deepStrictEqual((outDefs as Record<string, unknown>).anyFunction, {not: {}});
    assert.deepStrictEqual((outDefs as Record<string, unknown>).theme, documentDefs.theme);
    assert.strictEqual(derived.themeSchema, loaded.themeSchema);
  });

  it('returns a v1.0 document without components unchanged', () => {
    const document = {
      catalogId: 'https://example.com/functions-only',
      protocolVersion: '1.0',
      functions: {f: {returnType: 'string'}},
      $defs: {anyComponent: {not: {}}, anyFunction: {oneOf: [{$ref: '#/functions/f'}]}},
    };
    const catalog = Catalog.fromJson(document);
    assert.strictEqual(catalog.declaresComponents, false);
    assert.deepStrictEqual(catalog.toJson(), document);
  });

  it('returns a v0.9 document without components unchanged', () => {
    const document = readRepoJson('specification/v0_9/catalogs/basic/catalog.json');
    delete document.components;
    delete document.$defs.anyComponent;
    delete document.$defs.CatalogComponentCommon;
    const catalog = Catalog.fromJson(document);
    assert.strictEqual(catalog.declaresComponents, false);
    assert.deepStrictEqual(catalog.toJson(), document);
  });

  it('writes components when the document declares none but the catalog has some', () => {
    const loaded = Catalog.fromJson({
      catalogId: 'https://example.com/functions-only',
      protocolVersion: '1.0',
      functions: {f: {returnType: 'string'}},
    });
    const label: ComponentApi = {name: 'Label', schema: z.object({text: z.string()})};
    const derived = loaded.withEntries([label], [...loaded.functions.values()]);
    assert.strictEqual(derived.declaresComponents, false);
    assert.deepStrictEqual(Object.keys(derived.toJson().components as object), ['Label']);
    assert.ok(!('components' in loaded.withEntries([], []).toJson()));
  });

  it('writes an empty components map for a catalog defined in code', () => {
    const catalog = new Catalog('https://example.com/empty', '1.0');
    assert.strictEqual(catalog.declaresComponents, true);
    assert.deepStrictEqual(catalog.toJson().components, {});
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

  for (const [label, builtin, catalogPath] of [
    ['v0.8', v08BasicCatalog, 'specification/v0_8/json/standard_catalog_definition.json'],
    ['v0.9', v09BasicCatalog, 'specification/v0_9/catalogs/basic/catalog.json'],
    ['v1.0', v10BasicCatalog, 'catalogs/basic/v1/catalog.json'],
  ] as const) {
    it(`returns the published document for the built-in ${label} basic catalog`, () => {
      assert.deepStrictEqual(builtin.toJson(), readRepoJson(catalogPath));
    });
  }

  it('emits catalogId only when the source declared it', () => {
    const document = {
      components: {Label: {type: 'object', properties: {component: {const: 'Label'}}}},
    };
    const catalog = Catalog.fromJson(document, '1.0', 'https://example.com/injected');
    assert.strictEqual(catalog.id, 'https://example.com/injected');
    assert.deepStrictEqual(catalog.toJson(), document);

    const declared = {catalogId: 'https://example.com/declared', ...document};
    const overridden = Catalog.fromJson(declared, '1.0', 'https://example.com/other');
    assert.strictEqual(overridden.id, 'https://example.com/other');
    assert.strictEqual(overridden.toJson().catalogId, 'https://example.com/other');
  });

  it('computes the definitions of the basic models in another code-defined catalog', () => {
    const published = readRepoJson('catalogs/basic/v1/catalog.json');
    const out = new Catalog(
      'https://example.com/reused',
      '1.0',
      [...v10BasicCatalog.components.values()],
      [...v10BasicCatalog.functions.values()],
    ).toJson();
    assert.deepStrictEqual(out.components, published.components);
    assert.deepStrictEqual(out.functions, published.functions);
    assert.deepStrictEqual(out.$defs, published.$defs);
  });

  it('serializes a code-defined v1.0 catalog unbundled, with both unions', () => {
    const codeDefined = new Catalog(
      v10BasicCatalog.id,
      '1.0',
      [...v10BasicCatalog.components.values()].map(plain),
      [...v10BasicCatalog.functions.values()].map(plain),
    );
    const out = codeDefined.toJson();
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

  it('serializes an entry without a definition from its model in a loaded catalog', () => {
    const document = readRepoJson('catalogs/basic/v1/catalog.json');
    const loaded = Catalog.fromJson(document);
    const rewritten: ComponentApi = {
      name: 'Text',
      schema: z.object({text: z.string().describe('REF:common_types.json#/$defs/DynamicString')}),
    };
    const derived = loaded.withEntries([rewritten, loaded.components.get('Image')!], []);
    const out = derived.toJson();
    assert.strictEqual(out.title, document.title);
    assert.strictEqual(out.instructions, document.instructions);
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
    const derived = loaded.withEntries([], []);
    const defs = derived.toJson().$defs as Record<string, unknown>;
    assert.ok(!('CatalogComponentCommon' in defs), 'orphaned mixin is dropped');
    assert.ok('theme' in defs, 'a definition the source never referenced is kept');
  });
});

describe('Catalog.validationSchema', () => {
  it('is the bundled schema that catalogSchema still returns', () => {
    const catalog = Catalog.fromJson(readRepoJson('catalogs/basic/v1/catalog.json'));
    const schema = catalog.validationSchema;
    assert.deepStrictEqual(catalog.catalogSchema, schema);
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
  it('lets a protocolVersion argument take precedence over the declared one', () => {
    const document = {
      catalogId: 'https://example.com/versioned',
      protocolVersion: '1.0',
      components: {},
      $defs: {anyComponent: {not: {}}, anyFunction: {not: {}}},
    };
    const overridden = Catalog.fromJson(document, '0.9');
    assert.strictEqual(overridden.protocolVersion, '0.9');
    assert.strictEqual(overridden.declaredProtocolVersion, '1.0');
    assert.deepStrictEqual(overridden.toJson(), document);

    const declared = Catalog.fromJson(document);
    assert.strictEqual(declared.protocolVersion, '1.0');

    const {protocolVersion: _version, ...undeclared} = document;
    assert.strictEqual(Catalog.fromJson(undeclared, '0.9').protocolVersion, '0.9');
    assert.strictEqual(Catalog.fromJson(undeclared).protocolVersion, DEFAULT_PROTOCOL_VERSION);
  });

  it('captures document metadata and authored entries', () => {
    const document = readRepoJson('catalogs/basic/v1/catalog.json');
    const catalog = Catalog.fromJson(document);
    assert.strictEqual(catalog.schemaUri, document.$schema);
    assert.strictEqual(catalog.schemaId, document.$id);
    assert.strictEqual(catalog.title, document.title);
    assert.strictEqual(catalog.description, document.description);
    assert.strictEqual(catalog.declaredProtocolVersion, '1.0');
    assert.strictEqual(catalog.declaresCatalogId, true);
    assert.strictEqual(catalog.functionsLayout, 'map');
    // The unions list exactly the entries, so they are computed, not kept.
    assert.deepStrictEqual(catalog.unions, {anyComponent: true, anyFunction: true});
    assert.deepStrictEqual(catalog.defs, {});
    assert.strictEqual(catalog.extensionFields, undefined);
    const checkBox = catalog.components.get('CheckBox');
    const openUrl = catalog.functions.get('openUrl');
    assert.ok(checkBox instanceof JsonComponentApi);
    assert.ok(openUrl instanceof JsonFunctionApi);
    assert.deepStrictEqual(checkBox.jsonSchema, document.components.CheckBox);
    assert.deepStrictEqual(openUrl.jsonSchema, document.functions.openUrl);
    assert.strictEqual(openUrl.returnType, 'void');
    assert.strictEqual(openUrl.requiresUserActivation, true);
    assert.strictEqual(openUrl.description, document.functions.openUrl.description);
  });

  it('derives the Zod schema of a loaded entry from its definition once, on first use', () => {
    const catalog = Catalog.fromJson(readRepoJson('catalogs/basic/v1/catalog.json'));
    const text = catalog.components.get('Text')!;
    const schema = text.schema;
    assert.strictEqual(text.schema, schema, 'the derived schema is cached');
    assert.ok(schema.safeParse({text: 'hi'}).success);
    assert.ok(!schema.safeParse({text: 'hi', unknown: 1}).success);
    assert.ok(!Object.keys(text).includes('jsonSchema'), 'the definition is not an own property');
  });

  it('keeps the named $defs and other top-level keys as model fields', () => {
    const document = readRepoJson('specification/v0_9/catalogs/basic/catalog.json');
    const catalog = Catalog.fromJson(document);
    assert.deepStrictEqual(Object.keys(catalog.defs!), ['CatalogComponentCommon', 'theme']);
    assert.strictEqual(catalog.declaredProtocolVersion, null);

    const v08 = Catalog.fromJson(
      readRepoJson('specification/v0_8/json/standard_catalog_definition.json'),
      '0.8',
      'https://example.com/v08',
    );
    assert.strictEqual(v08.declaresCatalogId, false);
    assert.deepStrictEqual(Object.keys(v08.extensionFields!), ['styles']);
    assert.deepStrictEqual(v08.unions, {anyComponent: false, anyFunction: false});
  });

  it('keeps a union that is not the computed one as written', () => {
    const document = {
      catalogId: 'https://example.com/reordered',
      extensions: {vendor: {flag: true}},
      components: {
        A: {type: 'object', properties: {component: {const: 'A'}}},
        B: {type: 'object', properties: {component: {const: 'B'}}},
      },
      $defs: {
        anyComponent: {
          oneOf: [{$ref: '#/components/B'}, {$ref: '#/components/A'}],
          discriminator: {propertyName: 'component'},
        },
      },
    };
    const catalog = Catalog.fromJson(document);
    assert.deepStrictEqual(catalog.unions, {anyComponent: false, anyFunction: false});
    assert.deepStrictEqual(catalog.defs, document.$defs);
    assert.deepStrictEqual(catalog.extensionFields, {extensions: document.extensions});
    assert.deepStrictEqual(catalog.toJson(), document);
  });

  it('sets declaredProtocolVersion to null when the document omits it', () => {
    const catalog = Catalog.fromJson(
      readRepoJson('specification/v0_9/catalogs/basic/catalog.json'),
    );
    assert.strictEqual(catalog.declaredProtocolVersion, null);
    assert.strictEqual(catalog.protocolVersion, '0.9');
  });

  it('rejects a document without a catalog ID', () => {
    assert.throws(() => Catalog.fromJson({components: {}}), /Catalog ID/);
  });

  it('does not share objects with its input', () => {
    const document = readRepoJson('catalogs/basic/v1/catalog.json');
    const catalog = Catalog.fromJson(document);
    const json = JSON.stringify(catalog.toJson());
    const text = catalog.components.get('Text')!;
    const textSchemaResult = text.schema.safeParse({text: 'hi', variant: 'h1'}).success;
    document.components.Text.properties.variant.enum = ['mutated'];
    document.components.Text.description = 'mutated';
    document.functions.openUrl.description = 'mutated';
    document.$defs.anyComponent = {not: {}};
    document.catalogId = 'mutated';
    const fresh = Catalog.fromJson(readRepoJson('catalogs/basic/v1/catalog.json'));
    assert.strictEqual(JSON.stringify(catalog.toJson()), json);
    assert.deepStrictEqual(catalog.validationSchema, fresh.validationSchema);
    assert.strictEqual(
      text.schema.safeParse({text: 'hi', variant: 'h1'}).success,
      textSchemaResult,
    );
  });

  it('leaves the definitions unchanged when building validationSchema', () => {
    const catalog = Catalog.fromJson(
      readRepoJson('specification/v0_9/catalogs/basic/catalog.json'),
    );
    const sources = (): string =>
      JSON.stringify([
        [...catalog.components.values()].map(c => (c as JsonComponentApi).jsonSchema),
        [...catalog.functions.values()].map(f => (f as JsonFunctionApi).jsonSchema),
        catalog.defs,
        catalog.extensionFields,
      ]);
    const before = sources();
    void catalog.validationSchema;
    catalog.toJson();
    assert.strictEqual(sources(), before);
  });

  it('round-trips a code-defined function without required args through toJson', () => {
    const fn = createFunctionImplementation(
      {name: 'now', returnType: 'string', schema: z.object({format: z.string().optional()})},
      () => '',
    );
    for (const version of ['0.9', '1.0']) {
      const codeCatalog = new Catalog(`https://example.com/now/${version}`, version, [], [fn]);
      const out = codeCatalog.toJson();
      const call = (out.functions as Record<string, any>).now;
      assert.ok(!call.required.includes('args'), `args is optional in ${version}`);
      // The document declares the version the code-defined catalog only implies.
      const {protocolVersion, ...reloaded} = Catalog.fromJson(out, version).validationSchema;
      assert.strictEqual(protocolVersion, version);
      assert.deepStrictEqual(reloaded, codeCatalog.validationSchema);
    }
  });

  it('is what the deprecated fromSchema returns', () => {
    const document = readRepoJson('catalogs/mcp/catalog.json');
    assert.deepStrictEqual(Catalog.fromSchema(document).toJson(), document);
  });
});

describe('composite catalogs', () => {
  const Custom: ComponentApi = {name: 'Custom', schema: z.object({label: z.string()}).strict()};

  for (const [version, basic] of [
    ['0.9', v09BasicCatalog],
    ['1.0', v10BasicCatalog],
  ] as const) {
    for (const withUri of [false, true]) {
      it(`resolves every reference of reused v${version} basic entries${withUri ? ' given their common types URI' : ''}`, () => {
        const composite = new Catalog(
          'https://example.com/composite',
          version,
          [...basic.components.values(), Custom],
          [...basic.functions.values()],
          withUri ? {commonTypesUri: basic.commonTypesUri} : undefined,
        );
        const doc = composite.toJson();
        for (const ref of collectRefs(doc)) {
          if (!ref.startsWith('#/')) continue;
          const target = ref
            .slice(2)
            .split('/')
            .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], doc);
          assert.ok(target !== undefined, `reference '${ref}' resolves in toJson`);
        }
        // The models compute their definitions, and the definitions of their
        // mixins, in any catalog of their version; common types references
        // are written against the catalog's common types URI.
        const published = basic.toJson();
        const text = (doc.components as Record<string, any>).Text;
        const publishedText = (published.components as Record<string, unknown>).Text;
        if (withUri || version === '1.0') {
          assert.deepStrictEqual(text, publishedText);
        } else {
          assert.strictEqual(text.allOf[0].$ref, 'common_types.json#/$defs/ComponentCommon');
        }
        if (version === '0.9') {
          assert.deepStrictEqual(
            (doc.$defs as Record<string, unknown>).CatalogComponentCommon,
            (published.$defs as Record<string, unknown>).CatalogComponentCommon,
          );
        }

        const validationText = (composite.validationSchema.components as Record<string, any>).Text;
        assert.ok('weight' in validationText.properties, 'validationSchema keeps weight');
        assert.deepStrictEqual(
          validationText,
          (basic.validationSchema.components as Record<string, unknown>).Text,
        );

        const reloaded = Catalog.fromJson(doc, version);
        const shape = (reloaded.components.get('Text')!.schema as z.AnyZodObject).shape;
        assert.ok('weight' in shape, 'fromJson(toJson()) keeps weight');
        assert.ok(
          reloaded.components.get('Text')!.schema.safeParse({text: 'hi', weight: 1}).success,
        );
      });
    }
  }

  it('drops a mixin definition when no remaining component composes it', () => {
    const derived = (v09BasicCatalog as Catalog<ComponentApi, FunctionApi>).withEntries(
      [Custom],
      [],
    );
    const defs = derived.toJson().$defs as Record<string, unknown>;
    assert.ok(!('CatalogComponentCommon' in defs));
    assert.ok('theme' in defs, 'the theme model is kept');
    assert.deepStrictEqual(defs.anyComponent, {
      oneOf: [{$ref: '#/components/Custom'}],
      discriminator: {propertyName: 'component'},
    });
  });
});

describe('entry definitions', () => {
  it('keeps no JSON definition on the built-in entries, which are generated models', () => {
    for (const [builtin, text] of [
      [v09BasicCatalog, V09Text],
      [v10BasicCatalog, V10Text],
    ] as const) {
      const entry = builtin.components.get('Text')!;
      assert.ok(!(entry instanceof JsonComponentApi));
      assert.ok(!('definition' in entry) && !('jsonSchema' in entry));
      assert.strictEqual(entry.schema, text.schema);
      assert.strictEqual(entry.tagName, text.tagName);
    }
  });

  it('serializes an entry copied with a new schema from that schema', () => {
    const changed = {
      ...v10BasicCatalog.components.get('Text')!,
      schema: z.object({text: z.string(), extra: z.number()}),
    };
    const loadedText = Catalog.fromJson(
      readRepoJson('catalogs/basic/v1/catalog.json'),
    ).components.get('Text')!;
    const changedLoaded = {
      ...loadedText,
      schema: z.object({text: z.string(), extra: z.number()}),
    };
    for (const entry of [changed, changedLoaded]) {
      const catalog = new Catalog('https://example.com/changed', '1.0', [entry]);
      const text = (catalog.toJson().components as Record<string, any>).Text;
      assert.deepStrictEqual(Object.keys(text.properties), ['component', 'text', 'extra']);
      const validation = (catalog.validationSchema.components as Record<string, any>).Text;
      assert.deepStrictEqual(Object.keys(validation.properties), [
        'id',
        'text',
        'extra',
        'component',
      ]);
    }
  });

  it('writes a loaded entry as its definition, and a spread copy from its schema', () => {
    const document = readRepoJson('catalogs/basic/v1/catalog.json');
    const loadedText = Catalog.fromJson(document).components.get('Text')!;
    const reused = new Catalog('https://example.com/reused', '1.0', [loadedText]);
    assert.deepStrictEqual(
      (reused.toJson().components as Record<string, unknown>).Text,
      document.components.Text,
    );
    // A spread copy keeps the derived schema but not the definition, so it
    // cannot write a definition that a changed field no longer matches.
    const copy = {...loadedText};
    assert.ok(!(copy instanceof JsonComponentApi));
    assert.strictEqual(copy.schema, loadedText.schema);
    const copied = new Catalog('https://example.com/copied', '1.0', [copy]);
    const text = (copied.toJson().components as Record<string, any>).Text;
    assert.deepStrictEqual(Object.keys(text.properties).sort(), [
      'component',
      'text',
      'variant',
      'weight',
    ]);
  });

  it('cannot be changed through the catalog', () => {
    const catalog = Catalog.fromJson(readRepoJson('catalogs/basic/v1/catalog.json'));
    const before = catalog.toJson();
    const text = catalog.components.get('Text') as JsonComponentApi;
    const openUrl = catalog.functions.get('openUrl') as JsonFunctionApi;
    assert.throws(() => {
      (text.jsonSchema as Record<string, unknown>).description = 'changed';
    }, TypeError);
    assert.throws(() => {
      (openUrl.jsonSchema as Record<string, unknown>).description = 'changed';
    }, TypeError);
    assert.throws(() => {
      (text as unknown as Record<string, unknown>).schema = z.object({});
    }, TypeError);
    assert.throws(() => {
      (catalog.defs as Record<string, unknown>).extra = {};
    }, TypeError);
    assert.deepStrictEqual(catalog.toJson(), before);
  });

  it('copies the defs and extension fields a caller passes to the constructor', () => {
    const defs = {Shared: {type: 'string'}};
    const extensionFields = {extensions: {flag: true}};
    const catalog = new Catalog('https://example.com/own', '0.9', [], [], {
      defs,
      extensionFields,
    });
    defs.Shared.type = 'number';
    extensionFields.extensions.flag = false;
    assert.deepStrictEqual(catalog.toJson().extensions, {flag: true});
    assert.deepStrictEqual(catalog.defs, {Shared: {type: 'string'}});
    assert.deepStrictEqual(catalog.toJson().$defs, {Shared: {type: 'string'}});
  });
});

describe('specification annotations', () => {
  const Common = specDef(
    'Common',
    z.object({weight: z.number().describe('The weight.').optional()}),
  );
  const Badge: ComponentApi = {
    name: 'Badge',
    schema: spec(
      z
        .object({
          ...Common.shape,
          label: z.string().describe('REF:#/$defs/DynamicString|The label.'),
          tone: spec(z.enum(['info', 'warn']).describe('The tone.'), {
            keywords: {deprecated: true},
          }),
          size: z.number().int().optional(),
        })
        .describe('A badge.')
        .strict(),
      {mixins: ['ComponentCommon', Common], required: ['tone', 'label']},
    ),
  };

  it('computes a v0.9 definition with allOf mixins and the catalog definitions they name', () => {
    const out = new Catalog('https://example.com/badges', '0.9', [Badge], [], {
      commonTypesUri: 'https://example.com/common_types.json',
    }).toJson();
    assert.deepStrictEqual((out.components as Record<string, unknown>).Badge, {
      type: 'object',
      allOf: [
        {$ref: 'https://example.com/common_types.json#/$defs/ComponentCommon'},
        {$ref: '#/$defs/Common'},
        {
          type: 'object',
          description: 'A badge.',
          properties: {
            component: {const: 'Badge'},
            label: {
              $ref: 'https://example.com/common_types.json#/$defs/DynamicString',
              description: 'The label.',
            },
            tone: {
              type: 'string',
              enum: ['info', 'warn'],
              description: 'The tone.',
              deprecated: true,
            },
            size: {type: 'integer'},
          },
          required: ['component', 'tone', 'label'],
        },
      ],
      unevaluatedProperties: false,
    });
    assert.deepStrictEqual((out.$defs as Record<string, unknown>).Common, {
      type: 'object',
      properties: {weight: {type: 'number', description: 'The weight.'}},
    });
  });

  it('computes a v1.0 definition without mixins as a flat object', () => {
    const out = new Catalog('https://example.com/badges', '1.0', [
      {...Badge, schema: spec(Badge.schema, {mixins: []})},
    ]).toJson();
    const badge = (out.components as Record<string, any>).Badge;
    assert.strictEqual(badge.description, 'A badge.');
    assert.strictEqual(badge.allOf, undefined);
    assert.deepStrictEqual(Object.keys(badge.properties), [
      'component',
      'weight',
      'label',
      'tone',
      'size',
    ]);
    assert.ok(!('Common' in (out.$defs as object)), 'no mixin, no definition');
  });

  it('does not change validation', () => {
    const annotated = spec(z.string(), {keywords: {format: 'uri'}});
    assert.ok(annotated.safeParse('not a uri').success);
    assert.ok(Badge.schema.safeParse({label: 'x', tone: 'info'}).success);
    assert.ok(!Badge.schema.safeParse({label: 'x', tone: 'other'}).success);
  });

  it('recomputes an out-of-order authored union when withEntries changes entries', () => {
    const reordered = Catalog.fromJson({
      catalogId: 'https://example.com/reordered',
      components: {
        Card: {type: 'object', properties: {component: {const: 'Card'}}},
        Label: {type: 'object', properties: {component: {const: 'Label'}}},
      },
      $defs: {
        anyComponent: {
          oneOf: [{$ref: '#/components/Label'}, {$ref: '#/components/Card'}],
          discriminator: {propertyName: 'component'},
        },
      },
    });
    const prunedReordered = reordered
      .withEntries([reordered.components.get('Label')!], [])
      .toJson();
    assert.deepStrictEqual((prunedReordered.$defs as Record<string, unknown>).anyComponent, {
      oneOf: [{$ref: '#/components/Label'}],
      discriminator: {propertyName: 'component'},
    });
  });

  it('uses commonTypesUri when serializing unannotated Zod REF markers', () => {
    const uri = 'https://a2ui.org/specification/v0_9/common_types.json';
    const comp: ComponentApi = {
      name: 'Label',
      schema: z.object({text: z.string().describe('REF:#/$defs/DynamicString')}),
    };
    const out = new Catalog('https://example.com/custom-uri', '0.9', [comp], [], {
      commonTypesUri: uri,
    }).toJson();
    assert.strictEqual(
      ((out.components as Record<string, any>).Label.properties.text as Record<string, unknown>)
        .$ref,
      `${uri}#/$defs/DynamicString`,
    );
  });

  it('preserves required keys omitted from a spec() required ordering hint', () => {
    const comp: ComponentApi = {
      name: 'Form',
      schema: spec(z.object({a: z.string(), b: z.string(), c: z.string()}).strict(), {
        mixins: [],
        required: ['b', 'a'],
      }),
    };
    const out = new Catalog('https://example.com/form', '1.0', [comp]).toJson();
    assert.deepStrictEqual((out.components as Record<string, any>).Form.required, [
      'component',
      'b',
      'a',
      'c',
    ]);
  });

  it('omits args from required on a spec()-annotated function without required arguments', () => {
    const fn = createFunctionImplementation(
      {
        name: 'now',
        returnType: 'string',
        schema: spec(z.object({format: z.string().optional()}).strict(), {
          closure: 'unevaluatedProperties',
        }),
      },
      () => '',
    );
    for (const version of ['0.9', '1.0']) {
      const cat = new Catalog(`https://example.com/spec-now/${version}`, version, [], [fn]);
      const docFn = (cat.toJson().functions as Record<string, any>).now;
      const valFn = (cat.validationSchema.functions as Record<string, any>).now;
      assert.ok(!docFn.required.includes('args'), `toJson omits args in ${version}`);
      assert.deepStrictEqual(docFn.required, valFn.required);
    }
  });
});

describe('built-in basic catalogs', () => {
  /**
   * Differences between a built-in catalog's Zod schemas and its
   * published document that are known and accepted, as `<label>:<entry>`.
   */
  const KNOWN_DIFFERENCES = new Set<string>([]);

  type Summary = Record<string, unknown>;

  /** The names, properties, required lists and function metadata of a validation schema. */
  function summarize(schema: Record<string, unknown>): {
    components: Record<string, Summary>;
    functions: Record<string, Summary>;
  } {
    const components: Record<string, Summary> = {};
    for (const [name, comp] of Object.entries((schema.components ?? {}) as Record<string, any>)) {
      components[name] = {
        properties: Object.keys(comp.properties ?? {}).sort(),
        required: [...(comp.required ?? [])].sort(),
      };
    }
    const functions: Record<string, Summary> = {};
    for (const [name, fn] of Object.entries((schema.functions ?? {}) as Record<string, any>)) {
      const args = fn.properties?.args ?? {};
      functions[name] = {
        returnType: fn.returnType ?? fn.properties?.returnType?.const,
        allowedCallers: fn.allowedCallers,
        requiresUserActivation: fn.requiresUserActivation,
        args: Object.keys(args.properties ?? {}).sort(),
        argsRequired: [...(args.required ?? [])].sort(),
      };
    }
    return {components, functions};
  }

  for (const [label, builtin] of [
    ['v0.8', v08BasicCatalog],
    ['v0.9', v09BasicCatalog],
    ['v1.0', v10BasicCatalog],
  ] as const) {
    it(`keeps the ${label} Zod schemas in line with the published document`, () => {
      // Copies of the entries without their annotations are generated from Zod.
      const fromZod = new Catalog(
        builtin.id,
        builtin.protocolVersion,
        [...builtin.components.values()].map(plain),
        [...builtin.functions.values()].map(plain),
        {themeSchema: builtin.themeSchema},
      );
      const published = summarize(builtin.validationSchema);
      const zod = summarize(fromZod.validationSchema);
      assert.deepStrictEqual(
        Object.keys(zod.components).sort(),
        Object.keys(published.components).sort(),
      );
      assert.deepStrictEqual(
        Object.keys(zod.functions).sort(),
        Object.keys(published.functions).sort(),
      );
      for (const section of ['components', 'functions'] as const) {
        for (const [name, expected] of Object.entries(published[section])) {
          if (KNOWN_DIFFERENCES.has(`${label}:${name}`)) continue;
          assert.deepStrictEqual(zod[section][name], expected, `${label} ${section} ${name}`);
        }
      }
    });
  }
});
