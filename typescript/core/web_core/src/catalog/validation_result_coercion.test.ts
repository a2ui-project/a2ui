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
import {z} from 'zod';

import {DataContext} from '../resolution/data-context.js';
import {DataModel} from '../state/data-model.js';
import {DynamicBooleanSchema, DynamicStringSchema} from '../v1_0/schema/common-types.js';
import {Catalog, createFunctionImplementation} from './types.js';
import {
  coerceValidationResults,
  isDynamicBooleanSchema,
  validityOf,
} from './validation_result_coercion.js';

const INVALID = {valid: false, message: 'Required', code: 'required'};
const VALID = {valid: true};
const ctx = new DataContext(new DataModel({}), '/');

describe('validityOf', () => {
  it('reads the valid member of a ValidationResult object', () => {
    assert.strictEqual(validityOf(INVALID), false);
    assert.strictEqual(validityOf(VALID), true);
  });

  it('is undefined for anything that is not a ValidationResult', () => {
    assert.strictEqual(validityOf({valid: 'yes'}), undefined);
    assert.strictEqual(validityOf({other: true}), undefined);
    assert.strictEqual(validityOf([{valid: true}]), undefined);
    assert.strictEqual(validityOf(true), undefined);
    assert.strictEqual(validityOf(null), undefined);
  });
});

describe('isDynamicBooleanSchema', () => {
  it('recognizes the common DynamicBoolean schema, re-described or wrapped', () => {
    assert.ok(isDynamicBooleanSchema(DynamicBooleanSchema));
    assert.ok(isDynamicBooleanSchema(DynamicBooleanSchema.describe('REF:#/$defs/DynamicBoolean')));
    assert.ok(
      isDynamicBooleanSchema(
        DynamicBooleanSchema.describe('REF:#/$defs/DynamicBoolean|Whether to group.').optional(),
      ),
    );
    assert.ok(isDynamicBooleanSchema(DynamicBooleanSchema.default(true).describe('Grouping.')));
  });

  it('recognizes a DynamicBoolean loaded from a catalog document', () => {
    const catalog = Catalog.fromJson({
      catalogId: 'test',
      protocolVersion: '1.0',
      components: {},
      functions: {
        flag: {
          type: 'object',
          properties: {
            on: {
              $ref: 'common_types.json#/$defs/DynamicBoolean',
              description: 'The flag.',
            },
          },
          required: ['on'],
        },
      },
    });
    const schema = catalog.functions.get('flag')!.schema as z.ZodObject<z.ZodRawShape>;
    assert.ok(isDynamicBooleanSchema(schema.shape['on']));
  });

  it('does not match other common types or plain booleans', () => {
    assert.ok(!isDynamicBooleanSchema(DynamicStringSchema));
    assert.ok(!isDynamicBooleanSchema(z.boolean()));
    assert.ok(!isDynamicBooleanSchema(z.object({valid: z.boolean()})));
  });
});

describe('coerceValidationResults', () => {
  const schema = z.object({
    value: DynamicBooleanSchema,
    values: z.array(DynamicBooleanSchema).optional(),
    grouping: DynamicBooleanSchema.optional(),
    label: DynamicStringSchema.optional(),
    payload: z.any().optional(),
  });

  it('coerces a ValidationResult in every DynamicBoolean position', () => {
    assert.deepStrictEqual(
      coerceValidationResults(schema, {
        value: INVALID,
        values: [VALID, INVALID, true],
        grouping: VALID,
      }),
      {value: false, values: [true, false, true], grouping: true},
    );
  });

  it('leaves values that are not ValidationResults alone', () => {
    const args = {value: true, values: [false, true], label: 'x'};
    assert.strictEqual(coerceValidationResults(schema, args), args);
  });

  it('leaves a ValidationResult alone where the schema is not a DynamicBoolean', () => {
    const args = {value: true, payload: INVALID, label: INVALID};
    assert.strictEqual(coerceValidationResults(schema, args), args);
  });

  it('coerces a ValidationResult that is the whole value', () => {
    assert.strictEqual(coerceValidationResults(DynamicBooleanSchema, INVALID), false);
    assert.strictEqual(coerceValidationResults(DynamicStringSchema, INVALID), INVALID);
  });
});

describe('Catalog invoker DynamicBoolean coercion', () => {
  function catalogWithFlag(protocolVersion: string) {
    const seen: unknown[] = [];
    const flag = createFunctionImplementation(
      {
        name: 'flag',
        returnType: 'boolean',
        schema: z.object({
          on: DynamicBooleanSchema.describe('REF:#/$defs/DynamicBoolean|The flag.'),
          all: z.array(DynamicBooleanSchema).optional(),
        }),
      },
      args => {
        seen.push(args);
        return args.on;
      },
    );
    return {catalog: new Catalog('test', protocolVersion, [], [flag]), seen};
  }

  it('reads a ValidationResult argument by its validity from v1.0', () => {
    const {catalog, seen} = catalogWithFlag('1.0');
    assert.strictEqual(catalog.invoker('flag', {on: INVALID, all: [VALID, INVALID]}, ctx), false);
    assert.deepStrictEqual(seen, [{on: false, all: [true, false]}]);
  });

  it('still rejects an argument that is not a boolean or ValidationResult from v1.0', () => {
    const {catalog} = catalogWithFlag('1.0');
    assert.throws(
      () => catalog.invoker('flag', {on: {other: 1}}, ctx),
      (e: unknown) => e instanceof Error && /Validation failed for function 'flag'/.test(e.message),
    );
  });

  it('does not coerce before v1.0, whose validators return booleans', () => {
    const {catalog} = catalogWithFlag('0.9');
    assert.throws(
      () => catalog.invoker('flag', {on: INVALID}, ctx),
      (e: unknown) => e instanceof Error && /Validation failed for function 'flag'/.test(e.message),
    );
  });
});
