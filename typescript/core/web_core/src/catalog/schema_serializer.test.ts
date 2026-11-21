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
import {isDeepStrictEqual} from 'node:util';

import {A2uiCatalogError, A2uiValidationError} from '../errors.js';
import {MessageProcessor, STRICT_VALIDATION} from '../processing/message-processor.js';
import {
  v08BasicCatalog,
  v09BasicCatalog,
  v1BasicCatalog as v10BasicCatalog,
} from '../test/basic_catalogs.js';
import {JsonComponentApi, JsonFunctionApi, loadedDefinition} from './json_entries.js';
import {generateValidationSchema} from './schema_generator.js';
import {DEFAULT_PROTOCOL_VERSION} from './from-json.js';
import {
  Catalog,
  createFunctionImplementation,
  type ComponentApi,
  type FunctionApi,
} from './types.js';
import {testValidator} from '../test/validator.js';
import {accepts, jsonFixture} from '../test/schema.js';

function readRepoJson(relativePath: string): Record<string, any> {
  return JSON.parse(readFileSync(resolve(process.cwd(), '../../..', relativePath), 'utf-8'));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolvePointer(root: Record<string, unknown>, pointer: string): unknown {
  if (!pointer || pointer === '/') return root;
  return pointer
    .replace(/^\//, '')
    .split('/')
    .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((cur, seg) => (isPlainRecord(cur) ? cur[seg] : undefined), root);
}

/**
 * Evaluates a JSON value against a JSON Schema 2020-12 subset, tracking
 * evaluated object properties across `$ref`, `allOf`, `oneOf`, `anyOf`, and
 * `unevaluatedProperties`.
 */
function evaluateJsonSchema(
  value: unknown,
  schema: unknown,
  docName: string,
  docs: Readonly<Record<string, Record<string, unknown>>>,
): {valid: boolean; evaluatedProps: Set<string>} {
  const fail = {valid: false, evaluatedProps: new Set<string>()};
  if (typeof schema === 'boolean') {
    if (!schema) return fail;
    return {
      valid: true,
      evaluatedProps: isPlainRecord(value) ? new Set(Object.keys(value)) : new Set(),
    };
  }
  if (!isPlainRecord(schema)) return fail;

  if (typeof schema.type === 'string') {
    const ok =
      (schema.type === 'object' && isPlainRecord(value)) ||
      (schema.type === 'string' && typeof value === 'string') ||
      (schema.type === 'number' && typeof value === 'number') ||
      (schema.type === 'integer' && typeof value === 'number' && Number.isInteger(value)) ||
      (schema.type === 'boolean' && typeof value === 'boolean') ||
      (schema.type === 'array' && Array.isArray(value)) ||
      (schema.type === 'null' && value === null);
    if (!ok) return fail;
  }
  if (Object.hasOwn(schema, 'const') && !isDeepStrictEqual(value, schema.const)) return fail;
  if (Array.isArray(schema.enum) && !schema.enum.some(entry => isDeepStrictEqual(value, entry))) {
    return fail;
  }

  const evaluatedProps = new Set<string>();
  const localEvaluated = new Set<string>();

  if (isPlainRecord(value)) {
    if (Array.isArray(schema.required)) {
      for (const reqKey of schema.required) {
        if (typeof reqKey === 'string' && !Object.hasOwn(value, reqKey)) return fail;
      }
    }
    if (isPlainRecord(schema.properties)) {
      for (const [propKey, propSchema] of Object.entries(schema.properties)) {
        if (Object.hasOwn(value, propKey)) {
          if (!evaluateJsonSchema(value[propKey], propSchema, docName, docs).valid) return fail;
          localEvaluated.add(propKey);
          evaluatedProps.add(propKey);
        }
      }
    }
    if (isPlainRecord(schema.patternProperties)) {
      for (const [pattern, patSchema] of Object.entries(schema.patternProperties)) {
        const regex = new RegExp(pattern, 'u');
        for (const propKey of Object.keys(value)) {
          if (regex.test(propKey)) {
            if (!evaluateJsonSchema(value[propKey], patSchema, docName, docs).valid) return fail;
            localEvaluated.add(propKey);
            evaluatedProps.add(propKey);
          }
        }
      }
    }
    if (
      Object.hasOwn(schema, 'additionalProperties') &&
      schema.additionalProperties !== undefined
    ) {
      for (const propKey of Object.keys(value)) {
        if (!localEvaluated.has(propKey)) {
          if (
            !evaluateJsonSchema(value[propKey], schema.additionalProperties, docName, docs).valid
          ) {
            return fail;
          }
          evaluatedProps.add(propKey);
        }
      }
    }
  }

  if (Array.isArray(value) && schema.items !== undefined) {
    for (const item of value) {
      if (!evaluateJsonSchema(item, schema.items, docName, docs).valid) return fail;
    }
  }

  if (typeof schema.$ref === 'string') {
    const hashIdx = schema.$ref.indexOf('#');
    const refDoc = hashIdx === -1 ? schema.$ref : schema.$ref.slice(0, hashIdx);
    const pointer = hashIdx === -1 ? '' : schema.$ref.slice(hashIdx + 1);
    const targetDocName = refDoc || docName;
    const targetRoot = docs[targetDocName];
    if (!targetRoot) throw new Error(`Unknown schema document: ${targetDocName}`);
    const targetSchema = resolvePointer(targetRoot, pointer);
    if (targetSchema === undefined) {
      throw new Error(`Unresolved $ref: ${schema.$ref} in ${targetDocName}`);
    }
    const refResult = evaluateJsonSchema(value, targetSchema, targetDocName, docs);
    if (!refResult.valid) return fail;
    for (const p of refResult.evaluatedProps) evaluatedProps.add(p);
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      const subResult = evaluateJsonSchema(value, sub, docName, docs);
      if (!subResult.valid) return fail;
      for (const p of subResult.evaluatedProps) evaluatedProps.add(p);
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf
      .map(sub => evaluateJsonSchema(value, sub, docName, docs))
      .filter(r => r.valid);
    if (matches.length !== 1) return fail;
    for (const p of matches[0].evaluatedProps) evaluatedProps.add(p);
  }
  if (Array.isArray(schema.anyOf)) {
    const matches = schema.anyOf
      .map(sub => evaluateJsonSchema(value, sub, docName, docs))
      .filter(r => r.valid);
    if (matches.length === 0) return fail;
    for (const m of matches) {
      for (const p of m.evaluatedProps) evaluatedProps.add(p);
    }
  }
  if (Object.hasOwn(schema, 'not') && schema.not !== undefined) {
    if (evaluateJsonSchema(value, schema.not, docName, docs).valid) return fail;
  }

  if (
    isPlainRecord(value) &&
    Object.hasOwn(schema, 'unevaluatedProperties') &&
    schema.unevaluatedProperties !== undefined
  ) {
    for (const propKey of Object.keys(value)) {
      if (!evaluatedProps.has(propKey)) {
        if (
          !evaluateJsonSchema(value[propKey], schema.unevaluatedProperties, docName, docs).valid
        ) {
          return fail;
        }
        evaluatedProps.add(propKey);
      }
    }
  }

  return {valid: true, evaluatedProps};
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
  'catalogs/vegachart/v0_9/catalog.json',
  'catalogs/vegachart/v1/catalog.json',
  'catalogs/basic/v0_9/catalog.json',
  'catalogs/minimal/v0_9/catalog.json',
  'catalogs/basic/v0_9_1/catalog.json',
];

describe('Catalog.toJson', () => {
  for (const catalogPath of PUBLISHED_CATALOGS) {
    it(`returns ${catalogPath} unchanged after fromJson`, () => {
      const document = readRepoJson(catalogPath);
      const out = Catalog.fromJson(document, undefined, undefined, {
        validator: testValidator,
      }).toJson();
      assert.deepStrictEqual(out, document);
      assert.deepStrictEqual(
        Catalog.fromJson(out, undefined, undefined, {validator: testValidator}).toJson(),
        out,
      );
    });
  }

  it('returns a fresh copy on every call', () => {
    const document = readRepoJson('catalogs/basic/v1/catalog.json');
    const catalog = Catalog.fromJson(document, undefined, undefined, {validator: testValidator});
    const first = catalog.toJson();
    (first.components as Record<string, any>).Text.type = 'mutated';
    delete (first.$defs as Record<string, unknown>).anyComponent;
    assert.deepStrictEqual(catalog.toJson(), document);
  });

  it('assembles the document once per catalog', () => {
    let reads = 0;
    const labelSchema = jsonFixture({
      'type': 'object',
      'properties': {},
      'additionalProperties': false,
    });
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
    const document = readRepoJson('catalogs/basic/v0_9/catalog.json');
    const loaded = Catalog.fromJson(document, undefined, undefined, {validator: testValidator});
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
    const catalog = Catalog.fromJson(document, undefined, undefined, {validator: testValidator});
    assert.strictEqual(catalog.declaresComponents, false);
    assert.deepStrictEqual(catalog.toJson(), document);
  });

  it('returns a v0.9 document without components unchanged', () => {
    const document = readRepoJson('catalogs/basic/v0_9/catalog.json');
    delete document.components;
    delete document.$defs.anyComponent;
    delete document.$defs.CatalogComponentCommon;
    const catalog = Catalog.fromJson(document, undefined, undefined, {validator: testValidator});
    assert.strictEqual(catalog.declaresComponents, false);
    assert.deepStrictEqual(catalog.toJson(), document);
  });

  it('writes components when the document declares none but the catalog has some', () => {
    const loaded = Catalog.fromJson(
      {
        catalogId: 'https://example.com/functions-only',
        protocolVersion: '1.0',
        functions: {f: {returnType: 'string'}},
      },
      undefined,
      undefined,
      {validator: testValidator},
    );
    const label: ComponentApi = {
      name: 'Label',
      schema: jsonFixture({
        'type': 'object',
        'properties': {'text': {'type': 'string'}},
        'required': ['text'],
        'additionalProperties': false,
      }),
    };
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
    assert.deepStrictEqual(
      Catalog.fromJson(document, '1.0', undefined, {validator: testValidator}).toJson(),
      document,
    );
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
    assert.deepStrictEqual(
      Catalog.fromJson(document, undefined, undefined, {validator: testValidator}).toJson(),
      document,
    );
  });

  for (const [label, builtin, catalogPath] of [
    ['v0.8', v08BasicCatalog, 'specification/v0_8/json/standard_catalog_definition.json'],
    ['v0.9', v09BasicCatalog, 'catalogs/basic/v0_9/catalog.json'],
    ['1.0', v10BasicCatalog, 'catalogs/basic/v1/catalog.json'],
  ] as const) {
    it(`returns the published document for the built-in ${label} basic catalog`, () => {
      assert.deepStrictEqual(builtin.toJson(), readRepoJson(catalogPath));
    });
  }

  it('emits catalogId only when the source declared it', () => {
    const document = {
      components: {Label: {type: 'object', properties: {component: {const: 'Label'}}}},
    };
    const catalog = Catalog.fromJson(document, '1.0', 'https://example.com/injected', {
      validator: testValidator,
    });
    assert.strictEqual(catalog.id, 'https://example.com/injected');
    assert.deepStrictEqual(catalog.toJson(), document);

    const declared = {catalogId: 'https://example.com/declared', ...document};
    const overridden = Catalog.fromJson(declared, '1.0', 'https://example.com/other', {
      validator: testValidator,
    });
    assert.strictEqual(overridden.id, 'https://example.com/other');
    assert.strictEqual(overridden.toJson().catalogId, 'https://example.com/other');
  });

  it('writes the basic entries, with the definitions they reference, in another code-defined catalog', () => {
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

  it('omits unevaluatedProperties: false and catchall subschemas on v1.0 code-defined components while keeping v0.9 closed and passthrough open', () => {
    const DefaultComp: ComponentApi = {
      name: 'DefaultComp',
      schema: jsonFixture({
        'type': 'object',
        'properties': {'label': {'type': 'string'}, 'weight': {'type': 'number'}},
        'required': ['label'],
        'additionalProperties': false,
      }),
    };
    const StrictComp: ComponentApi = {
      name: 'StrictComp',
      schema: jsonFixture({
        'type': 'object',
        'properties': {'label': {'type': 'string'}},
        'required': ['label'],
        'additionalProperties': false,
      }),
    };
    const OpenComp: ComponentApi = {
      name: 'OpenComp',
      schema: jsonFixture({
        'type': 'object',
        'properties': {'label': {'type': 'string'}},
        'required': ['label'],
        'additionalProperties': true,
      }),
    };
    const CatchallComp: ComponentApi = {
      name: 'CatchallComp',
      schema: jsonFixture({
        'type': 'object',
        'properties': {'label': {'type': 'string'}},
        'required': ['label'],
        'additionalProperties': {'type': 'number'},
      }),
    };

    const v10Doc = new Catalog('https://example.com/v10-closure', '1.0', [
      DefaultComp,
      StrictComp,
      OpenComp,
      CatchallComp,
    ]).toJson();
    const v10Comps = v10Doc.components as Record<string, Record<string, unknown>>;
    assert.strictEqual(Object.hasOwn(v10Comps.DefaultComp, 'unevaluatedProperties'), false);
    assert.strictEqual(Object.hasOwn(v10Comps.StrictComp, 'unevaluatedProperties'), false);
    assert.strictEqual(v10Comps.OpenComp.unevaluatedProperties, true);
    assert.strictEqual(Object.hasOwn(v10Comps.CatchallComp, 'unevaluatedProperties'), false);

    const v09Doc = new Catalog('https://example.com/v09-closure', '0.9', [
      DefaultComp,
      StrictComp,
      OpenComp,
      CatchallComp,
    ]).toJson();
    const v09Comps = v09Doc.components as Record<string, Record<string, unknown>>;
    assert.strictEqual(v09Comps.DefaultComp.unevaluatedProperties, false);
    assert.strictEqual(v09Comps.StrictComp.unevaluatedProperties, false);
    assert.strictEqual(v09Comps.OpenComp.unevaluatedProperties, true);
    assert.deepStrictEqual(v09Comps.CatchallComp.unevaluatedProperties, {type: 'number'});
  });

  it('serializes code-defined functions in the call shape of the protocol version', () => {
    const fn = createFunctionImplementation(
      {
        name: 'launch',
        returnType: 'void',
        schema: jsonFixture({
          'type': 'object',
          'properties': {'url': {'type': 'string'}},
          'required': ['url'],
          'additionalProperties': false,
        }),
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
    const out = new Catalog('https://example.com/meta', '1.0', [], [], {
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
    const loaded = Catalog.fromJson(document, undefined, undefined, {validator: testValidator});
    const rewritten: ComponentApi = {
      name: 'Text',
      schema: jsonFixture({
        'type': 'object',
        'properties': {'text': {'$ref': 'common_types.json#/$defs/DynamicString'}},
        'required': ['text'],
        'additionalProperties': false,
      }),
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
    const document = readRepoJson('catalogs/basic/v0_9/catalog.json');
    const loaded = Catalog.fromJson(document, undefined, undefined, {validator: testValidator});
    const derived = loaded.withEntries([], []);
    const defs = derived.toJson().$defs as Record<string, unknown>;
    assert.ok(!('CatalogComponentCommon' in defs), 'orphaned mixin is dropped');
    assert.ok('theme' in defs, 'a definition the source never referenced is kept');
  });
});

describe('Catalog.validationSchema', () => {
  it('is the bundled schema that catalogSchema still returns', () => {
    const catalog = Catalog.fromJson(
      readRepoJson('catalogs/basic/v1/catalog.json'),
      undefined,
      undefined,
      {validator: testValidator},
    );
    const schema = catalog.validationSchema;
    assert.deepStrictEqual(catalog.catalogSchema, schema);
    const defs = schema.$defs as Record<string, unknown>;
    assert.ok('DynamicString' in defs, 'common types are bundled');
    for (const ref of collectRefs(schema.components)) {
      assert.ok(ref.startsWith('#'), `reference '${ref}' is localized`);
    }
  });

  it('is unaffected by toJson', () => {
    const catalog = Catalog.fromJson(
      readRepoJson('catalogs/basic/v1/catalog.json'),
      undefined,
      undefined,
      {validator: testValidator},
    );
    const before = JSON.stringify(catalog.validationSchema);
    catalog.toJson();
    assert.strictEqual(JSON.stringify(catalog.validationSchema), before);
  });
});

describe('union export', () => {
  const OVERLAPPING_BRANCHES = [{type: 'string', enum: ['md', 'lg']}, {type: 'string'}];

  /** Whether the catalog's `Box` component accepts `radius`. */
  function acceptsRadius(
    catalog: {readonly components: ReadonlyMap<string, ComponentApi>},
    radius: unknown,
  ): boolean {
    return accepts(catalog.components.get('Box')!.schema, {radius});
  }

  /** The `radius` property of the `Box` component in a catalog document. */
  function radiusSchema(document: Record<string, any>): Record<string, unknown> {
    return document.components.Box.properties.radius;
  }

  /** A catalog document with a `Box` whose `radius` is the given union. */
  function boxDocument(version: string, radius: Record<string, unknown>): Record<string, any> {
    return {
      catalogId: 'https://example.org/catalog.json',
      protocolVersion: version,
      components: {
        Box: {
          type: 'object',
          properties: {component: {const: 'Box'}, radius},
          required: ['component', 'radius'],
          unevaluatedProperties: false,
        },
      },
      $defs: {
        anyComponent: {
          oneOf: [{$ref: '#/components/Box'}],
          discriminator: {propertyName: 'component'},
        },
        anyFunction: {not: {}},
      },
    };
  }

  for (const version of ['v0.9', '1.0']) {
    it(`exports z.union as anyOf and keeps its accepted values on reload in ${version}`, () => {
      const schema = jsonFixture({
        'type': 'object',
        'properties': {
          'radius': {'anyOf': [{'type': 'string', 'enum': ['md', 'lg']}, {'type': 'string'}]},
        },
        'required': ['radius'],
        'additionalProperties': false,
      });
      const original = new Catalog('https://example.org/catalog.json', version, [
        {name: 'Box', schema},
      ]);
      const document = original.toJson();
      assert.deepStrictEqual(radiusSchema(document), {anyOf: OVERLAPPING_BRANCHES});

      const reloaded = Catalog.fromJson(document, undefined, undefined, {validator: testValidator});
      for (const catalog of [original, reloaded]) {
        assert.strictEqual(acceptsRadius(catalog, 'md'), true);
        assert.strictEqual(acceptsRadius(catalog, '12px'), true);
        assert.strictEqual(acceptsRadius(catalog, false), false);
      }
      const validation = original.validationSchema.components as Record<string, any>;
      assert.deepStrictEqual(validation.Box.properties.radius, {anyOf: OVERLAPPING_BRANCHES});
    });

    it(`keeps an authored oneOf exclusive and writes it back as oneOf in ${version}`, () => {
      const document = boxDocument(version, {oneOf: OVERLAPPING_BRANCHES});
      const loaded = Catalog.fromJson(document, undefined, undefined, {validator: testValidator});
      assert.strictEqual(acceptsRadius(loaded, 'md'), false, 'md matches both branches');
      assert.strictEqual(acceptsRadius(loaded, '12px'), true);
      assert.strictEqual(acceptsRadius(loaded, false), false);
      assert.deepStrictEqual(radiusSchema(loaded.toJson()), {oneOf: OVERLAPPING_BRANCHES});
      assert.deepStrictEqual(
        Catalog.fromJson(loaded.toJson(), undefined, undefined, {
          validator: testValidator,
        }).toJson(),
        loaded.toJson(),
      );

      // A catalog defined in code from the loaded schema keeps it exclusive.
      const reused = new Catalog('https://example.org/reused.json', version, [
        {name: 'Box', schema: loaded.components.get('Box')!.schema},
      ]);
      assert.deepStrictEqual(radiusSchema(reused.toJson()), {oneOf: OVERLAPPING_BRANCHES});
      const validation = reused.validationSchema.components as Record<string, any>;
      assert.deepStrictEqual(validation.Box.properties.radius, {oneOf: OVERLAPPING_BRANCHES});
      const reloaded = Catalog.fromJson(reused.toJson(), undefined, undefined, {
        validator: testValidator,
      });
      assert.strictEqual(acceptsRadius(reloaded, 'md'), false);
      assert.strictEqual(acceptsRadius(reloaded, '12px'), true);
    });

    it(`keeps an authored anyOf inclusive in ${version}`, () => {
      const document = boxDocument(version, {anyOf: OVERLAPPING_BRANCHES});
      const loaded = Catalog.fromJson(document, undefined, undefined, {validator: testValidator});
      assert.strictEqual(acceptsRadius(loaded, 'md'), true);
      assert.deepStrictEqual(radiusSchema(loaded.toJson()), {anyOf: OVERLAPPING_BRANCHES});
    });

    it(`keeps a loaded oneOf with a description and default exclusive when reused in ${version}`, () => {
      const radius = {
        oneOf: OVERLAPPING_BRANCHES,
        description: 'The corner radius.',
        default: '12px',
      };
      const loaded = Catalog.fromJson(boxDocument(version, radius), undefined, undefined, {
        validator: testValidator,
      });
      assert.strictEqual(acceptsRadius(loaded, 'md'), false);
      assert.strictEqual(acceptsRadius(loaded, '12px'), true);

      const reused = new Catalog('https://example.org/reused.json', version, [
        {name: 'Box', schema: loaded.components.get('Box')!.schema},
      ]);
      assert.deepStrictEqual(radiusSchema(reused.toJson()), radius);
      const validation = reused.validationSchema.components as Record<string, any>;
      assert.deepStrictEqual(validation.Box.properties.radius, radius);
    });
  }
});

describe('Catalog.fromJson', () => {
  it('lets a protocolVersion argument take precedence over the declared one', () => {
    const document = {
      catalogId: 'https://example.com/versioned',
      protocolVersion: '1.0',
      components: {},
      $defs: {anyComponent: {not: {}}, anyFunction: {not: {}}},
    };
    const overridden = Catalog.fromJson(document, '0.9', undefined, {validator: testValidator});
    assert.strictEqual(overridden.protocolVersion, '0.9');
    assert.strictEqual(overridden.declaredProtocolVersion, '1.0');
    assert.deepStrictEqual(overridden.toJson(), document);

    const declared = Catalog.fromJson(document, undefined, undefined, {validator: testValidator});
    assert.strictEqual(declared.protocolVersion, '1.0');

    const {protocolVersion: _version, ...undeclared} = document;
    assert.strictEqual(
      Catalog.fromJson(undeclared, '0.9', undefined, {validator: testValidator}).protocolVersion,
      '0.9',
    );
    assert.strictEqual(
      Catalog.fromJson(undeclared, undefined, undefined, {validator: testValidator})
        .protocolVersion,
      DEFAULT_PROTOCOL_VERSION,
    );
  });

  it('captures document metadata and authored entries', () => {
    const document = readRepoJson('catalogs/basic/v1/catalog.json');
    const catalog = Catalog.fromJson(document, undefined, undefined, {validator: testValidator});
    assert.strictEqual(catalog.schemaUri, document.$schema);
    assert.strictEqual(catalog.schemaId, document.$id);
    assert.strictEqual(catalog.title, document.title);
    assert.strictEqual(catalog.description, document.description);
    assert.strictEqual(catalog.declaredProtocolVersion, '1.0');
    assert.strictEqual(catalog.declaresCatalogId, true);
    assert.strictEqual(catalog.functionsLayout, 'map');
    // The unions list exactly the entries, so they are computed, not kept.
    assert.deepStrictEqual(catalog.unions, {anyComponent: true, anyFunction: true});
    assert.deepStrictEqual(catalog.defs, {Weight: document.$defs.Weight});
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

  it('compiles the schema of a loaded entry from its definition once', () => {
    const catalog = Catalog.fromJson(
      readRepoJson('catalogs/basic/v1/catalog.json'),
      undefined,
      undefined,
      {validator: testValidator},
    );
    const text = catalog.components.get('Text')!;
    const schema = text.schema;
    assert.strictEqual(text.schema, schema, 'the derived schema is cached');
    assert.ok(accepts(schema, {text: 'hi'}));
    assert.ok(!accepts(schema, {text: 'hi', unknown: 1}));
    assert.ok(!Object.keys(text).includes('jsonSchema'), 'the definition is not an own property');
  });

  it('keeps the named $defs and other top-level keys as model fields', () => {
    const document = readRepoJson('catalogs/basic/v0_9/catalog.json');
    const catalog = Catalog.fromJson(document, undefined, undefined, {validator: testValidator});
    assert.deepStrictEqual(Object.keys(catalog.defs!), ['CatalogComponentCommon', 'theme']);
    assert.strictEqual(catalog.declaredProtocolVersion, null);

    const v08 = Catalog.fromJson(
      readRepoJson('specification/v0_8/json/standard_catalog_definition.json'),
      '0.8',
      'https://example.com/v08',
      {validator: testValidator},
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
    const catalog = Catalog.fromJson(document, undefined, undefined, {validator: testValidator});
    assert.deepStrictEqual(catalog.unions, {anyComponent: false, anyFunction: false});
    assert.deepStrictEqual(catalog.defs, document.$defs);
    assert.deepStrictEqual(catalog.extensionFields, {extensions: document.extensions});
    assert.deepStrictEqual(catalog.toJson(), document);
  });

  it('sets declaredProtocolVersion to null when the document omits it', () => {
    const catalog = Catalog.fromJson(
      readRepoJson('catalogs/basic/v0_9/catalog.json'),
      undefined,
      undefined,
      {validator: testValidator},
    );
    assert.strictEqual(catalog.declaredProtocolVersion, null);
    assert.strictEqual(catalog.protocolVersion, '0.9');
  });

  it('rejects a document without a catalog ID', () => {
    assert.throws(
      () => Catalog.fromJson({components: {}}, undefined, undefined, {validator: testValidator}),
      /Catalog ID/,
    );
  });

  it('does not share objects with its input', () => {
    const document = readRepoJson('catalogs/basic/v1/catalog.json');
    const catalog = Catalog.fromJson(document, undefined, undefined, {validator: testValidator});
    const json = JSON.stringify(catalog.toJson());
    const text = catalog.components.get('Text')!;
    const textSchemaResult = accepts(text.schema, {
      text: 'hi',
      variant: 'h1',
    });
    document.components.Text.properties.variant.enum = ['mutated'];
    document.components.Text.description = 'mutated';
    document.functions.openUrl.description = 'mutated';
    document.$defs.anyComponent = {not: {}};
    document.catalogId = 'mutated';
    const fresh = Catalog.fromJson(
      readRepoJson('catalogs/basic/v1/catalog.json'),
      undefined,
      undefined,
      {validator: testValidator},
    );
    assert.strictEqual(JSON.stringify(catalog.toJson()), json);
    assert.deepStrictEqual(catalog.validationSchema, fresh.validationSchema);
    assert.strictEqual(accepts(text.schema, {text: 'hi', variant: 'h1'}), textSchemaResult);
  });

  it('leaves the definitions unchanged when building validationSchema', () => {
    const catalog = Catalog.fromJson(
      readRepoJson('catalogs/basic/v0_9/catalog.json'),
      undefined,
      undefined,
      {validator: testValidator},
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
      {
        name: 'now',
        returnType: 'string',
        schema: jsonFixture({
          'type': 'object',
          'properties': {'format': {'type': 'string'}},
          'additionalProperties': false,
        }),
      },
      () => '',
    );
    for (const version of ['0.9', '1.0']) {
      const codeCatalog = new Catalog(`https://example.com/now/${version}`, version, [], [fn]);
      const out = codeCatalog.toJson();
      const call = (out.functions as Record<string, any>).now;
      assert.ok(!call.required.includes('args'), `args is optional in ${version}`);
      // The document declares the version the code-defined catalog only implies.
      const {protocolVersion, ...reloaded} = Catalog.fromJson(out, version, undefined, {
        validator: testValidator,
      }).validationSchema;
      assert.strictEqual(protocolVersion, version);
      assert.deepStrictEqual(reloaded, codeCatalog.validationSchema);
    }
  });

  it('round-trips v1.0 code-defined components through toJson without rejecting ComponentCommon fields', () => {
    const Banner: ComponentApi = {
      name: 'Banner',
      schema: jsonFixture({
        'type': 'object',
        'properties': {
          'text': {'$ref': 'common_types.json#/$defs/DynamicString'},
          'weight': {'type': 'number'},
        },
        'required': ['text'],
        'additionalProperties': false,
      }),
    };
    const StrictBanner: ComponentApi = {
      name: 'StrictBanner',
      schema: jsonFixture({
        'type': 'object',
        'properties': {
          'text': {'$ref': 'common_types.json#/$defs/DynamicString'},
          'weight': {'type': 'number'},
        },
        'required': ['text'],
        'additionalProperties': false,
      }),
    };
    const OpenBanner: ComponentApi = {
      name: 'OpenBanner',
      schema: jsonFixture({
        'type': 'object',
        'properties': {'text': {'type': 'string'}},
        'required': ['text'],
        'additionalProperties': true,
      }),
    };
    const CatchallBanner: ComponentApi = {
      name: 'CatchallBanner',
      schema: jsonFixture({
        'type': 'object',
        'properties': {
          'text': {'$ref': 'common_types.json#/$defs/DynamicString'},
          'weight': {'type': 'number'},
        },
        'required': ['text'],
        'additionalProperties': {'type': 'number'},
      }),
    };

    const originalCatalog = new Catalog('https://example.com/v10-roundtrip.json', '1.0', [
      Banner,
      StrictBanner,
      OpenBanner,
      CatchallBanner,
    ]);
    const serializedDoc = originalCatalog.toJson();
    const roundTripped = Catalog.fromJson(serializedDoc, undefined, undefined, {
      validator: testValidator,
    });

    const {protocolVersion, ...reloadedValidation} = roundTripped.validationSchema;
    assert.strictEqual(protocolVersion, '1.0');
    assert.deepStrictEqual(reloadedValidation, originalCatalog.validationSchema);

    const basePayload = {
      'id': 'root',
      '@catalogId': roundTripped.id,
      '@accessibility': {
        label: 'Welcome banner',
        description: 'Primary surface greeting',
        live: 'polite',
      },
      '@metadata': {extensions: {vendor_ext: {featured: true}}},
      'text': 'Hello world',
      'weight': 2,
    };

    // 1. Validate against official v1.0 protocol schemas (agent_to_renderer.json#/$defs/Component).
    const agentToRenderer = readRepoJson('specification/v1_0/json/agent_to_renderer.json');
    const commonTypes = readRepoJson('specification/v1_0/json/common_types.json');
    for (const catalogDoc of [serializedDoc, roundTripped.toJson()]) {
      const protocolDocs = {
        'agent_to_renderer.json': agentToRenderer,
        'common_types.json': commonTypes,
        'catalog.json': catalogDoc,
      };
      const componentWireSchema = agentToRenderer.$defs.Component;
      for (const closedType of ['Banner', 'StrictBanner', 'CatchallBanner'] as const) {
        assert.strictEqual(
          evaluateJsonSchema(
            {...basePayload, component: closedType},
            componentWireSchema,
            'agent_to_renderer.json',
            protocolDocs,
          ).valid,
          true,
        );
        assert.strictEqual(
          evaluateJsonSchema(
            {...basePayload, component: closedType, undeclared: 'nope'},
            componentWireSchema,
            'agent_to_renderer.json',
            protocolDocs,
          ).valid,
          false,
        );
      }
      assert.strictEqual(
        evaluateJsonSchema(
          {
            'id': 'root',
            'component': 'OpenBanner',
            '@catalogId': roundTripped.id,
            '@accessibility': basePayload['@accessibility'],
            '@metadata': basePayload['@metadata'],
            'text': 'Hello world',
            'customExtra': 42,
          },
          componentWireSchema,
          'agent_to_renderer.json',
          protocolDocs,
        ).valid,
        true,
      );
    }

    // 2. Validate against originalCatalog.validationSchema, roundTripped.validationSchema,
    //    and generateValidationSchema().
    const bundledEnvelopeSchema = {
      type: 'object',
      allOf: [{$ref: 'common_types.json#/$defs/ComponentCommon'}, {$ref: '#/$defs/anyComponent'}],
      unevaluatedProperties: false,
    };
    for (const validationSchema of [
      originalCatalog.validationSchema,
      roundTripped.validationSchema,
    ]) {
      const validationDocs = {
        'validation.json': validationSchema,
        'common_types.json': commonTypes,
      };
      assert.strictEqual(
        evaluateJsonSchema(
          {...basePayload, component: 'Banner'},
          {$ref: '#/$defs/anyComponent'},
          'validation.json',
          validationDocs,
        ).valid,
        true,
      );
      for (const closedType of ['Banner', 'StrictBanner', 'CatchallBanner'] as const) {
        assert.strictEqual(
          evaluateJsonSchema(
            {...basePayload, component: closedType},
            bundledEnvelopeSchema,
            'validation.json',
            validationDocs,
          ).valid,
          true,
        );
        assert.strictEqual(
          evaluateJsonSchema(
            {...basePayload, component: closedType, undeclared: 'nope'},
            bundledEnvelopeSchema,
            'validation.json',
            validationDocs,
          ).valid,
          false,
        );
      }
    }
    const envelopeWrapped = generateValidationSchema(roundTripped, {
      componentEnvelopeRef: 'common_types.json#/$defs/ComponentCommon',
    });
    const wrappedComponents = envelopeWrapped.components as Record<string, unknown>;
    assert.strictEqual(
      evaluateJsonSchema(
        {...basePayload, component: 'Banner'},
        wrappedComponents.Banner,
        'wrapped.json',
        {'wrapped.json': envelopeWrapped, 'common_types.json': commonTypes},
      ).valid,
      true,
    );

    // 3. Validate runtime processing via MessageProcessor with STRICT_VALIDATION.
    const processor = new MessageProcessor([roundTripped as Catalog<ComponentApi>], undefined, {
      validator: testValidator,
      validationConfig: STRICT_VALIDATION,
    });
    processor.processMessages({
      version: '1.0',
      createSurface: {surfaceId: 's1', catalogId: roundTripped.id},
    });
    for (const closedType of ['Banner', 'StrictBanner', 'CatchallBanner'] as const) {
      processor.processMessages({
        version: '1.0',
        updateComponents: {
          surfaceId: 's1',
          components: [{...basePayload, component: closedType}],
        },
      });
      assert.strictEqual(
        processor.model.getSurface('s1')?.componentsModel.get('root')?.type,
        closedType,
      );

      assert.throws(
        () =>
          processor.processMessages({
            version: '1.0',
            updateComponents: {
              surfaceId: 's1',
              components: [{...basePayload, component: closedType, undeclared: 'nope'}],
            },
          }),
        A2uiValidationError,
      );
    }

    processor.processMessages({
      version: '1.0',
      updateComponents: {
        surfaceId: 's1',
        components: [
          {
            'id': 'root',
            'component': 'OpenBanner',
            '@catalogId': roundTripped.id,
            '@accessibility': basePayload['@accessibility'],
            '@metadata': basePayload['@metadata'],
            'text': 'Hello world',
            'customExtra': 42,
          },
        ],
      },
    });
    assert.strictEqual(
      processor.model.getSurface('s1')?.componentsModel.get('root')?.type,
      'OpenBanner',
    );
  });

  it('is what the deprecated fromSchema returns', () => {
    const document = readRepoJson('catalogs/mcp/catalog.json');
    assert.deepStrictEqual(
      Catalog.fromSchema(document, undefined, {validator: testValidator}).toJson(),
      document,
    );
  });
});

describe('composite catalogs', () => {
  const Custom: ComponentApi = {
    name: 'Custom',
    schema: jsonFixture({
      'type': 'object',
      'properties': {'label': {'type': 'string'}},
      'required': ['label'],
      'additionalProperties': false,
    }),
  };

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
        // The entries are written as their document defines them, with the
        // definitions of their document they reference, in any catalog.
        const published = basic.toJson();
        const text = (doc.components as Record<string, any>).Text;
        const publishedText = (published.components as Record<string, unknown>).Text;
        assert.deepStrictEqual(text, publishedText);
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

        const reloaded = Catalog.fromJson(doc, version, undefined, {validator: testValidator});
        assert.ok(
          accepts(reloaded.components.get('Text')!.schema, {
            text: 'hi',
            weight: 1,
          }),
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
  it('keeps the definition its document declares on each built-in entry', () => {
    for (const [builtin, catalogPath] of [
      [v09BasicCatalog, 'catalogs/basic/v0_9/catalog.json'],
      [v10BasicCatalog, 'catalogs/basic/v1/catalog.json'],
    ] as const) {
      const entry = builtin.components.get('Text')!;
      // A Web Component implementation of the loaded API, not the API itself.
      assert.ok(!(entry instanceof JsonComponentApi));
      assert.strictEqual(entry.tagName, 'a2ui-basic-text');
      assert.deepStrictEqual(loadedDefinition(entry), readRepoJson(catalogPath).components.Text);
    }
  });

  it('serializes an entry copied with a new schema from that schema', () => {
    const changed = {
      ...v10BasicCatalog.components.get('Text')!,
      schema: jsonFixture({
        'type': 'object',
        'properties': {'text': {'type': 'string'}, 'extra': {'type': 'number'}},
        'required': ['text', 'extra'],
        'additionalProperties': false,
      }),
    };
    const loadedText = Catalog.fromJson(
      readRepoJson('catalogs/basic/v1/catalog.json'),
      undefined,
      undefined,
      {validator: testValidator},
    ).components.get('Text')!;
    const changedLoaded = {
      ...loadedText,
      schema: jsonFixture({
        'type': 'object',
        'properties': {'text': {'type': 'string'}, 'extra': {'type': 'number'}},
        'required': ['text', 'extra'],
        'additionalProperties': false,
      }),
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
    const loaded = Catalog.fromJson(document, undefined, undefined, {validator: testValidator});
    const loadedText = loaded.components.get('Text')!;
    const reused = new Catalog('https://example.com/reused', '1.0', [loadedText], [], {
      defs: loaded.defs,
    });
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
    const catalog = Catalog.fromJson(
      readRepoJson('catalogs/basic/v1/catalog.json'),
      undefined,
      undefined,
      {validator: testValidator},
    );
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
      (text as unknown as Record<string, unknown>).schema = jsonFixture({
        'type': 'object',
        'properties': {},
        'additionalProperties': false,
      });
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

describe('Catalog.derive', () => {
  const basic = Catalog.fromJson(
    readRepoJson('catalogs/basic/v1/catalog.json'),
    undefined,
    undefined,
    {validator: testValidator},
  );
  const label: ComponentApi = {
    name: 'Label',
    schema: jsonFixture({
      'type': 'object',
      'properties': {'text': {'type': 'string'}},
      'required': ['text'],
      'additionalProperties': false,
    }),
  };

  it('keeps the named entries and adds new ones under the new ID', () => {
    const derived = basic.derive({
      catalogId: 'https://example.com/chat',
      components: ['Text', 'Button', label],
      functions: ['openUrl'],
    });

    assert.strictEqual(derived.id, 'https://example.com/chat');
    assert.strictEqual(derived.protocolVersion, basic.protocolVersion);
    assert.deepStrictEqual([...derived.components.keys()], ['Text', 'Button', 'Label']);
    assert.strictEqual(derived.components.get('Text'), basic.components.get('Text'));
    assert.strictEqual(derived.components.get('Label'), label);
    assert.deepStrictEqual([...derived.functions.keys()], ['openUrl']);
    assert.strictEqual(derived.themeSchema, basic.themeSchema);
    const out = derived.toJson();
    assert.strictEqual(out.catalogId, 'https://example.com/chat');
    assert.deepStrictEqual(Object.keys(out.components as object), ['Text', 'Button', 'Label']);
  });

  it("drops the source's $id, title, description and instructions", () => {
    const out = basic.derive({catalogId: 'https://example.com/chat'}).toJson();

    assert.strictEqual(out.$schema, basic.schemaUri);
    assert.ok(!('$id' in out));
    assert.ok(!('title' in out));
    assert.ok(!('description' in out));
    assert.ok(!('instructions' in out));
  });

  it('takes the instructions it is given', () => {
    const derived = basic.derive({
      catalogId: 'https://example.com/chat',
      instructions: 'Be brief.',
    });

    assert.strictEqual(derived.instructions, 'Be brief.');
    assert.strictEqual(derived.toJson().instructions, 'Be brief.');
  });

  it('keeps every entry of a kind it is given no list for', () => {
    const derived = basic.derive({catalogId: 'https://example.com/chat'});

    assert.deepStrictEqual([...derived.components.keys()], [...basic.components.keys()]);
    assert.deepStrictEqual([...derived.functions.keys()], [...basic.functions.keys()]);
  });

  it("replaces the source's entry with a new entry of the same name", () => {
    const text: ComponentApi = {
      name: 'Text',
      schema: jsonFixture({
        'type': 'object',
        'properties': {'text': {'type': 'string'}},
        'required': ['text'],
        'additionalProperties': false,
      }),
    };

    const derived = basic.derive({
      catalogId: 'https://example.com/chat',
      components: [text],
    });

    assert.strictEqual(derived.components.get('Text'), text);
  });

  it('throws for a name the source has no entry of', () => {
    assert.throws(
      () => basic.derive({catalogId: 'https://example.com/chat', components: ['Nope']}),
      (e: unknown) =>
        e instanceof A2uiCatalogError &&
        e.message.includes("has no component 'Nope'") &&
        e.message.includes('https://example.com/chat'),
    );
    assert.throws(
      () => basic.derive({catalogId: 'https://example.com/chat', functions: ['nope']}),
      (e: unknown) => e instanceof A2uiCatalogError && e.message.includes("has no function 'nope'"),
    );
  });

  it('drops authored $defs that only left-out entries referenced', () => {
    const loaded = Catalog.fromJson(
      readRepoJson('catalogs/basic/v0_9/catalog.json'),
      undefined,
      undefined,
      {validator: testValidator},
    );

    const derived = loaded.derive({catalogId: 'https://example.com/chat', components: []});

    const defs = derived.toJson().$defs as Record<string, unknown>;
    assert.ok(!('CatalogComponentCommon' in defs));
    assert.ok('theme' in defs);
  });
});
