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
import type {StandardSchemaV1} from '@standard-schema/spec';
import {A2uiConfigurationError} from '../errors.js';
import {
  fromJsonSchema,
  isJsonBackedSchema,
  jsonSchemaCursor,
  jsonSchemaDocuments,
  namedJsonSchema,
} from './from-json-schema.js';
import {toA2uiIssues} from './issues.js';
import type {CompiledValidator, JsonSchemaValidator} from './types.js';

const fakeValidator: JsonSchemaValidator = {
  compile: <T>(): CompiledValidator<T> =>
    ((v: unknown) =>
      typeof v === 'string'
        ? {success: true, data: v}
        : {
            success: false,
            issues: [{path: [], message: 'must be string', keyword: 'type'}],
          }) as CompiledValidator<T>,
};

describe('fromJsonSchema', () => {
  const schema = {type: 'string'};
  const cs = fromJsonSchema(schema, fakeValidator);

  it('reports the a2ui vendor', () => {
    assert.strictEqual(cs['~standard'].vendor, 'a2ui');
    assert.strictEqual(cs['~standard'].version, 1);
  });

  it('exposes the input schema as JSON Schema', () => {
    assert.deepStrictEqual(cs['~standard'].jsonSchema.input({target: 'draft-2020-12'}), schema);
    assert.deepStrictEqual(cs['~standard'].jsonSchema.output({target: 'draft-2020-12'}), schema);
  });

  it('validates successfully', () => {
    assert.deepStrictEqual(cs['~standard'].validate('x'), {value: 'x'});
  });

  it('returns standard issues on failure', () => {
    const r = cs['~standard'].validate(1) as {issues: {path: PropertyKey[]; message: string}[]};
    assert.deepStrictEqual(r.issues, [{message: 'must be string', path: []}]);
  });

  it('passes defs through to compile', () => {
    let seen: unknown;
    const v: JsonSchemaValidator = {
      compile: (_s, opts) => {
        seen = opts;
        return (() => ({success: true, data: null})) as never;
      },
    };
    fromJsonSchema({}, v, {defs: {'a.json': true}});
    assert.deepStrictEqual(seen, {defs: {'a.json': true}});
  });
});

describe('fromJsonSchema issues and defaults', () => {
  it('keeps the keyword and params of an issue for toA2uiIssues', () => {
    const v: JsonSchemaValidator = {
      compile: <T>() =>
        (() => ({
          success: false,
          issues: [{path: ['a'], message: 'm', keyword: 'enum', params: {allowedValues: [1, 2]}}],
        })) as CompiledValidator<T>,
    };
    const r = fromJsonSchema({}, v)['~standard'].validate(0) as StandardSchemaV1.FailureResult;
    assert.deepStrictEqual(toA2uiIssues(r.issues), [
      {path: ['a'], message: 'm', keyword: 'enum', params: {allowedValues: [1, 2]}},
    ]);
  });

  it('fills the schema defaults of a valid value, on a copy', () => {
    const accept: JsonSchemaValidator = {
      compile: <T>() =>
        ((value: unknown) => ({success: true, data: value})) as CompiledValidator<T>,
    };
    const schema = {type: 'object', properties: {size: {type: 'number', default: 12}}};
    const input = {};
    const r = fromJsonSchema(schema, accept)['~standard'].validate(input);
    assert.deepStrictEqual(r, {value: {size: 12}});
    assert.deepStrictEqual(input, {});
  });
});

describe('namedJsonSchema', () => {
  const failing: JsonSchemaValidator = {
    compile: () => {
      throw new Error("can't resolve reference x.json");
    },
  };

  it('compiles up front and names the schema when the engine fails', () => {
    assert.throws(
      () => namedJsonSchema({$ref: 'x.json'}, failing, undefined, "Component 'W' of catalog 'c'"),
      (err: unknown) =>
        err instanceof A2uiConfigurationError &&
        err.message ===
          "Component 'W' of catalog 'c': its JSON Schema could not be compiled: can't resolve reference x.json",
    );
  });

  it('records the documents and the cursor discovery reads', () => {
    const defs = {'common_types.json': {$defs: {}}};
    const cursor = {node: {type: 'string'}, doc: {root: {}, defs}};
    const schema = namedJsonSchema({type: 'string'}, fakeValidator, {defs}, 'Theme', cursor);
    assert.ok(isJsonBackedSchema(schema));
    assert.deepStrictEqual(jsonSchemaDocuments(schema), defs);
    assert.strictEqual(jsonSchemaCursor(schema), cursor);
    assert.deepStrictEqual(schema['~standard'].validate('ok'), {value: 'ok'});
  });
});

describe('fromJsonSchema opts.version', async () => {
  const {createAjvValidator} = await import('../test/validator.js');
  const {commonTypesDocument} = await import('./common-types.js');
  const schema = {$ref: 'common_types.json#/$defs/DynamicString'};

  it('adds the version common types to defs', () => {
    const s = fromJsonSchema(schema, createAjvValidator(), {version: 'v1.0'});
    const good = s['~standard'].validate({'@path': '/x'});
    assert.ok(!(good instanceof Promise) && !good.issues);
    const bad = s['~standard'].validate({path: '/x'});
    assert.ok(!(bad instanceof Promise) && bad.issues);
    assert.ok(jsonSchemaDocuments(s)!['common_types.json']);
  });

  it('keeps a caller supplied common_types.json', () => {
    const own = {$defs: {DynamicString: {type: 'string'}}};
    const s = fromJsonSchema(schema, createAjvValidator(), {
      version: 'v1.0',
      defs: {'common_types.json': own},
    });
    assert.strictEqual(jsonSchemaDocuments(s)!['common_types.json'], own);
  });

  it('commonTypesDocument is undefined for v0.8 and defined for v0.9 and v1.0', () => {
    assert.strictEqual(commonTypesDocument('v0.8'), undefined);
    assert.ok(commonTypesDocument('v0.9'));
    assert.ok(commonTypesDocument('v1.0'));
    assert.notStrictEqual(commonTypesDocument('v0.9'), commonTypesDocument('v1.0'));
  });
});
