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

  it('serializes a code-defined v1.0 catalog unbundled, with both unions', () => {
    const stripSource = <E extends {sourceJson?: unknown}>(entry: E): E => {
      const {sourceJson: _sourceJson, ...rest} = entry;
      return rest as E;
    };
    const codeDefined = new Catalog(
      v10BasicCatalog.id,
      '1.0',
      [...v10BasicCatalog.components.values()].map(stripSource),
      [...v10BasicCatalog.functions.values()].map(stripSource),
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

  it('leaves sourceJson unchanged when building validationSchema', () => {
    const catalog = Catalog.fromJson(readRepoJson('catalogs/basic/v1/catalog.json'));
    const sources = (): string =>
      JSON.stringify([
        [...catalog.components.values()].map(c => c.sourceJson),
        [...catalog.functions.values()].map(f => f.sourceJson),
        catalog.defs,
        catalog.sourceDocument,
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
    it(`carries the definitions reused v${version} basic entries reference`, () => {
      const composite = new Catalog(
        'https://example.com/composite',
        version,
        [...basic.components.values(), Custom],
        [...basic.functions.values()],
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
      const published = basic.toJson();
      assert.deepStrictEqual(
        (doc.components as Record<string, unknown>).Text,
        (published.components as Record<string, unknown>).Text,
      );

      const text = (composite.validationSchema.components as Record<string, any>).Text;
      assert.ok('weight' in text.properties, 'validationSchema keeps weight');
      assert.deepStrictEqual(
        text,
        (basic.validationSchema.components as Record<string, unknown>).Text,
      );

      const reloaded = Catalog.fromJson(doc, version);
      const shape = (reloaded.components.get('Text')!.schema as z.AnyZodObject).shape;
      assert.ok('weight' in shape, 'fromJson(toJson()) keeps weight');
      assert.ok(reloaded.components.get('Text')!.schema.safeParse({text: 'hi', weight: 1}).success);
    });
  }
});

describe('entry sources', () => {
  it('keeps the identity of the built-in entries', () => {
    assert.strictEqual(v09BasicCatalog.components.get('Text'), V09Text);
    assert.strictEqual(v10BasicCatalog.components.get('Text'), V10Text);
  });

  it('serializes an entry copied with a new schema from that schema', () => {
    const changed = {
      ...v10BasicCatalog.components.get('Text')!,
      schema: z.object({text: z.string(), extra: z.number()}),
    };
    const loadedText = Catalog.fromJson(
      readRepoJson('catalogs/basic/v1/catalog.json'),
    ).components.get('Text')!;
    const changedLoaded = {...loadedText, schema: z.object({text: z.string(), extra: z.number()})};
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

  it('keeps the source of a loaded entry copied with its own schema', () => {
    const loadedText = Catalog.fromJson(
      readRepoJson('catalogs/basic/v1/catalog.json'),
    ).components.get('Text')!;
    const catalog = new Catalog('https://example.com/copied', '1.0', [{...loadedText}]);
    assert.deepStrictEqual(
      (catalog.toJson().components as Record<string, unknown>).Text,
      loadedText.sourceJson,
    );
  });

  it('cannot be changed through the catalog', () => {
    const catalog = Catalog.fromJson(readRepoJson('catalogs/basic/v1/catalog.json'));
    const before = catalog.toJson();
    assert.throws(() => {
      (catalog.sourceDocument as Record<string, unknown>).title = 'changed';
    }, TypeError);
    assert.throws(() => {
      (catalog.components.get('Text')!.sourceJson as Record<string, unknown>).description =
        'changed';
    }, TypeError);
    assert.throws(() => {
      (catalog.defs as Record<string, unknown>).extra = {};
    }, TypeError);
    assert.deepStrictEqual(catalog.toJson(), before);
  });

  it('copies the defs and source document a caller passes to the constructor', () => {
    const defs = {Shared: {type: 'string'}};
    const sourceDocument = {catalogId: 'https://example.com/own', components: {}, $defs: defs};
    const catalog = new Catalog('https://example.com/own', '0.9', [], [], {defs, sourceDocument});
    defs.Shared.type = 'number';
    assert.deepStrictEqual(catalog.defs, {Shared: {type: 'string'}});
    assert.deepStrictEqual(catalog.toJson().$defs, {Shared: {type: 'string'}});
  });
});

describe('built-in basic catalogs', () => {
  /**
   * Differences between a built-in catalog's hand-written Zod schemas and its
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
      // Copies of the entries carry no source, so they are built from Zod.
      const fromZod = new Catalog(
        builtin.id,
        builtin.protocolVersion,
        [...builtin.components.values()].map(entry => ({...entry})),
        [...builtin.functions.values()].map(entry => ({...entry})),
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
