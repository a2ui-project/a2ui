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

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {StandardSchemaV1} from '@standard-schema/spec';
import {z} from 'zod';

import {A2uiCatalogError, A2uiConfigurationError, A2uiValidationError} from '../errors.js';
import {MessageProcessor} from '../processing/message-processor.js';
import {DataContext} from '../resolution/data-context.js';
import {fromJsonSchema} from '../schema-engine/from-json-schema.js';
import type {CatalogSchema, JsonSchema} from '../schema-engine/types.js';
import {testValidator} from '../test/validator.js';
import V10CommonTypes from '../v1_0/schemas/common_types.json' with {type: 'json'};
import V10EnvelopeCatalog from '../v1_0/envelope_catalog.json' with {type: 'json'};
import {
  AgentFunction,
  Catalog,
  createFunctionImplementation,
  type ComponentApi,
  type InferredComponentApiSchemaType,
} from './types.js';

const CATALOG_ID = 'https://example.com/catalog-schema.json';

/** The documents a v1.0 schema's common types references resolve against. */
const V10_DEFS: Record<string, JsonSchema> = {
  'common_types.json': V10CommonTypes as JsonSchema,
  'catalog.json': V10EnvelopeCatalog as JsonSchema,
};

/** Compile-time check that `A` and `B` are the same type. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expectType = <T extends true>(_: T) => {};

/**
 * A hand-rolled `CatalogSchema`, with no schema library: `validate` maps the
 * value, and `jsonSchema` returns `json`.
 */
function handRolled<T>(
  json: JsonSchema,
  validate: (value: unknown) => StandardSchemaV1.Result<T> | Promise<StandardSchemaV1.Result<T>>,
): CatalogSchema<T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate,
      jsonSchema: {input: () => json as Record<string, unknown>, output: () => json as never},
    },
  };
}

const textJson = {
  type: 'object',
  properties: {text: {type: 'string'}},
  required: ['text'],
};

/** Upper-cases `text`, as a library transform would. */
const UpperText = handRolled<{text: string}>(textJson, value => {
  const text = (value as {text?: unknown}).text;
  if (typeof text !== 'string') {
    return {issues: [{message: 'text must be a string', path: ['text']}]};
  }
  return {value: {...(value as object), text: text.toUpperCase()}};
});

/** Builds a processor on a v1.0 catalog and creates surface `s`. */
function processorFor(catalog: Catalog<ComponentApi>): MessageProcessor<ComponentApi> {
  const proc = new MessageProcessor([catalog], undefined, {validator: testValidator});
  proc.processMessages([
    {version: '1.0', createSurface: {surfaceId: 's', catalogId: catalog.id}} as never,
  ]);
  return proc;
}

function update(proc: MessageProcessor<ComponentApi>, components: Record<string, unknown>[]) {
  proc.processMessages([{version: '1.0', updateComponents: {surfaceId: 's', components}} as never]);
}

function propsOf(proc: MessageProcessor<ComponentApi>, id: string): Record<string, unknown> {
  return proc.model.getSurface('s')!.componentsModel.get(id)!.properties;
}

describe('CatalogSchema catalogs', () => {
  it('gives a component the value its schema validated, not the raw input', () => {
    const catalog = new Catalog(CATALOG_ID, '1.0', [{name: 'Shout', schema: UpperText}]);
    const proc = processorFor(catalog);
    const message = {id: 'root', component: 'Shout', text: 'abc'};
    update(proc, [message]);
    assert.equal(propsOf(proc, 'root').text, 'ABC');
    assert.equal(message.text, 'abc', 'the message is not changed');
    proc.dispose();
  });

  it('gives a component the defaults its schema applies', () => {
    // Review focus 1: a library `.default()`, here hand-rolled.
    const Defaulted = handRolled(
      {type: 'object', properties: {variant: {type: 'string'}}},
      value => ({value: {variant: 'primary', ...(value as object)}}),
    );
    const proc = processorFor(new Catalog(CATALOG_ID, '1.0', [{name: 'Btn', schema: Defaulted}]));
    update(proc, [{id: 'root', component: 'Btn'}]);
    assert.equal(propsOf(proc, 'root').variant, 'primary');
    proc.dispose();
  });

  it('gives a component the value of a zod 3 transform through the adapter', () => {
    const schema = z.object({text: z.string().transform(t => t.trim())});
    const proc = processorFor(new Catalog(CATALOG_ID, '1.0', [{name: 'Trim', schema}]));
    update(proc, [{id: 'root', component: 'Trim', text: '  hi  '}]);
    assert.equal(propsOf(proc, 'root').text, 'hi');
    proc.dispose();
  });

  it('fills the JSON defaults of a fromJsonSchema component, on a copy', () => {
    const schema = fromJsonSchema(
      {
        type: 'object',
        properties: {
          style: {
            type: 'object',
            properties: {size: {type: 'number', default: 12}, bold: {type: 'boolean'}},
          },
        },
      },
      testValidator,
    );
    const proc = processorFor(new Catalog(CATALOG_ID, '1.0', [{name: 'Label', schema}]));
    const style = {bold: true};
    update(proc, [{id: 'root', component: 'Label', style}]);
    assert.deepEqual(propsOf(proc, 'root').style, {bold: true, size: 12});
    assert.deepEqual(style, {bold: true}, 'the message is not changed');
    proc.dispose();
  });

  it('rejects a component its schema rejects, in web_core words', () => {
    const schema = fromJsonSchema(textJson, testValidator);
    const proc = processorFor(new Catalog(CATALOG_ID, '1.0', [{name: 'Label', schema}]));
    assert.throws(
      () => update(proc, [{id: 'root', component: 'Label', text: 3}]),
      (err: unknown) =>
        err instanceof A2uiValidationError &&
        err.message === "Validation failed for component 'Label' (root): text: must be string" &&
        err.path === '/components/0/text',
    );
    proc.dispose();
  });

  it("rejects {path} without '@' on a v1.0 DynamicString prop, naming the prop", () => {
    // Review focus 3 on a component prop.
    const schema = fromJsonSchema(
      {
        // The engine resolves `common_types.json` against the schema's `$id`.
        $id: 'https://example.com/label.json',
        type: 'object',
        properties: {label: {$ref: 'common_types.json#/$defs/DynamicString'}},
      },
      testValidator,
      {defs: V10_DEFS},
    );
    const proc = processorFor(new Catalog(CATALOG_ID, '1.0', [{name: 'Label', schema}]));
    update(proc, [{id: 'ok', component: 'Label', label: {'@path': '/x'}}]);
    assert.throws(
      () => update(proc, [{id: 'root', component: 'Label', label: {path: '/x'}}]),
      (err: unknown) =>
        err instanceof A2uiValidationError &&
        /Validation failed for component 'Label' \(root\): label/.test(err.message),
    );
    proc.dispose();
  });

  it('validates a v0.9 theme against the surface catalog theme schema, keeping its defaults', () => {
    const theme = fromJsonSchema(
      {
        type: 'object',
        properties: {primaryColor: {type: 'string'}, font: {type: 'string', default: 'serif'}},
      },
      testValidator,
    );
    const catalog = new Catalog(CATALOG_ID, '0.9', [], [], {themeSchema: theme});
    const proc = new MessageProcessor([catalog], undefined, {validator: testValidator});
    const createSurface = (surfaceId: string, value: unknown) =>
      proc.processMessages([
        {version: 'v0.9', createSurface: {surfaceId, catalogId: CATALOG_ID, theme: value}} as never,
      ]);
    assert.throws(
      () => createSurface('bad', {primaryColor: 1}),
      (err: unknown) =>
        err instanceof A2uiValidationError &&
        /theme on surface 'bad': primaryColor: must be string/.test(err.message),
    );
    createSurface('good', {primaryColor: '#fff'});
    assert.deepEqual(proc.model.getSurface('good')!.theme, {primaryColor: '#fff', font: 'serif'});
    proc.dispose();
  });

  it('fails registration, naming the component, when the JSON conversion throws', () => {
    // Review focus 5.
    const unconvertible = handRolled({}, value => ({value}));
    (unconvertible['~standard'].jsonSchema as unknown as {input: () => never}).input = () => {
      throw new Error('z.custom() cannot be represented in JSON Schema');
    };
    assert.throws(
      () => new Catalog(CATALOG_ID, '1.0', [{name: 'Fancy', schema: unconvertible}]),
      (err: unknown) =>
        err instanceof A2uiConfigurationError &&
        err.message.includes("Component 'Fancy'") &&
        err.message.includes('z.custom() cannot be represented'),
    );
  });

  it('fails registration, naming the function, when its schema has no JSON Schema', () => {
    const noJson = {
      '~standard': {version: 1, vendor: 'test', validate: (v: unknown) => ({value: v})},
    };
    assert.throws(
      () =>
        new Catalog(
          CATALOG_ID,
          '1.0',
          [],
          [{name: 'calc', returnType: 'number', schema: noJson as never, execute: () => 1}],
        ),
      (err: unknown) =>
        err instanceof A2uiConfigurationError && err.message.includes("Function 'calc'"),
    );
  });

  it('rejects an asynchronous schema at registration', () => {
    const asyncSchema = handRolled(textJson, async value => ({value}));
    assert.throws(
      () => new Catalog(CATALOG_ID, '1.0', [{name: 'Slow', schema: asyncSchema}]),
      (err: unknown) =>
        err instanceof A2uiConfigurationError &&
        err.message.includes("Component 'Slow'") &&
        err.message.includes('synchronous'),
    );
  });

  it('runs a function with the arguments its schema validated', () => {
    const Args = handRolled<{name: string}>(
      {type: 'object', properties: {name: {type: 'string'}}, additionalProperties: false},
      value => ({value: {name: String((value as {name: unknown}).name).toUpperCase()}}),
    );
    const greet = createFunctionImplementation(
      {name: 'greet', returnType: 'string', schema: Args},
      args => `Hello ${args.name}`,
    );
    const catalog = new Catalog(CATALOG_ID, '1.0', [], [greet]);
    const proc = processorFor(catalog);
    const surface = proc.model.getSurface('s')!;
    const errors: unknown[] = [];
    surface.onError.subscribe(e => {
      errors.push(e);
    });
    const ctx = new DataContext(surface, '/');
    assert.equal(ctx.resolveDynamicValue({'@call': 'greet', args: {name: 'ada'}}), 'Hello ADA');
    // The JSON Schema closes the arguments.
    assert.equal(
      ctx.resolveDynamicValue({'@call': 'greet', args: {name: 'ada', extra: 1}}),
      undefined,
    );
    assert.equal(errors.length, 1);
    proc.dispose();
  });

  it('reads child references from the JSON Schema, with an unannotated child typed string', () => {
    const json = (properties: Record<string, JsonSchema>) =>
      fromJsonSchema({type: 'object', properties}, testValidator);
    const catalog = new Catalog(CATALOG_ID, '1.0', [
      {name: 'Typed', schema: json({child: {type: 'string'}})},
      {name: 'Untyped', schema: json({child: {}})},
      {
        name: 'Referenced',
        schema: fromJsonSchema(
          {
            $id: 'https://example.com/referenced.json',
            type: 'object',
            properties: {slot: {$ref: 'common_types.json#/$defs/ComponentId'}},
          },
          testValidator,
          {defs: V10_DEFS},
        ),
      },
    ]);
    const refs = catalog.componentRefMap;
    assert.deepEqual([...refs.Typed.singleRefs], ['child']);
    assert.equal(refs.Untyped.singleRefs.size, 0);
    assert.deepEqual([...refs.Referenced.singleRefs], ['slot']);
  });

  it('checks the parameter names of an agent function with a CatalogSchema', () => {
    const args = (properties: Record<string, JsonSchema>) =>
      fromJsonSchema({type: 'object', properties}, testValidator);
    const fetchRate = (schema: CatalogSchema) =>
      new AgentFunction({name: 'fetchRate', schema, handler: () => 1});
    const empty = new Catalog(CATALOG_ID, '1.0', [], []);
    const ok = empty.copyWith({agentFunctions: [fetchRate(args({base: {type: 'string'}}))]});
    assert.ok(ok.agentFunctions.has('fetchRate'));
    assert.throws(
      () => empty.copyWith({agentFunctions: [fetchRate(args({'target-currency': {}}))]}),
      (err: unknown) =>
        err instanceof A2uiCatalogError &&
        err.message.includes('Invalid UAX #31') &&
        err.message.includes("'target-currency'"),
    );
  });

  it('types props as the output of the schema', () => {
    const LabelApi = {
      name: 'Label',
      schema: fromJsonSchema<{text: string}>(textJson, testValidator),
    } satisfies ComponentApi;
    assert.equal(LabelApi.name, 'Label');
    type Props = InferredComponentApiSchemaType<typeof LabelApi>;
    expectType<Equal<Props['text'], string>>(true);
    expectType<Equal<StandardSchemaV1.InferOutput<typeof UpperText>, {text: string}>>(true);
  });
});
