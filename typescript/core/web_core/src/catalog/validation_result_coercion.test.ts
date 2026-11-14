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

import {ComponentContext} from '../resolution/component-context.js';
import {DataContext} from '../resolution/data-context.js';
import {GenericBinder} from '../resolution/generic-binder.js';
import {ComponentModel} from '../state/component-model.js';
import {DataModel} from '../state/data-model.js';
import {SurfaceModel} from '../state/surface-model.js';
import {DynamicBooleanSchema, DynamicStringSchema} from '../v1_0/schema/common-types.js';
import type {SchemaDoc} from '../schema-engine/nav.js';
import type {JsonSchema} from '../schema-engine/types.js';
import {toSchemaDoc} from '../schema-engine/zod-bridge.js';
import V10CommonTypes from '../v1_0/schemas/common_types.json' with {type: 'json'};
import {Catalog, ComponentApi, createFunctionImplementation} from './types.js';
import {
  coerceDynamicBoolean,
  coerceDynamicBooleans,
  coerceValidationResults,
  isDynamicBooleanSchema,
  validityOf,
} from './validation_result_coercion.js';

const INVALID = {valid: false, message: 'Required', code: 'required'};
const VALID = {valid: true};
const ctx = new DataContext(new DataModel({}), '/');

const DOC: SchemaDoc = {root: {}, defs: {'common_types.json': V10CommonTypes as JsonSchema}};
const commonRef = (name: string): JsonSchema => ({$ref: `common_types.json#/$defs/${name}`});

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
  it('recognizes a $ref to the common DynamicBoolean, described or not', () => {
    assert.ok(isDynamicBooleanSchema(commonRef('DynamicBoolean'), DOC));
    assert.ok(
      isDynamicBooleanSchema(
        {$ref: 'common_types.json#/$defs/DynamicBoolean', description: 'Whether to group.'},
        DOC,
      ),
    );
    assert.ok(
      isDynamicBooleanSchema(
        {$ref: 'common_types.json#/$defs/DynamicBoolean', default: true, description: 'Grouping.'},
        DOC,
      ),
    );
  });

  it('recognizes a nullable DynamicBoolean and a local alias of it', () => {
    assert.ok(isDynamicBooleanSchema({anyOf: [commonRef('DynamicBoolean'), {type: 'null'}]}, DOC));
    const root: JsonSchema = {$defs: {Flag: commonRef('DynamicBoolean')}};
    assert.ok(isDynamicBooleanSchema({$ref: '#/$defs/Flag'}, {root, defs: DOC.defs}));
  });

  it('recognizes a legacy REF: description marker', () => {
    assert.ok(isDynamicBooleanSchema({description: 'REF:#/$defs/DynamicBoolean|x'}, DOC));
    assert.ok(
      isDynamicBooleanSchema({description: 'REF:common_types.json#/$defs/DynamicBoolean'}, DOC),
    );
  });

  // ponytail: bridge until Task 8 — function schemas are still Zod at the call sites.
  it('recognizes a bridged Zod DynamicBoolean, re-described or wrapped', () => {
    const bridged = (schema: z.ZodTypeAny) => {
      const c = toSchemaDoc(schema, '1.0');
      return isDynamicBooleanSchema(c.node, c.doc);
    };
    assert.ok(bridged(DynamicBooleanSchema));
    assert.ok(bridged(DynamicBooleanSchema.describe('REF:#/$defs/DynamicBoolean')));
    assert.ok(
      bridged(
        DynamicBooleanSchema.describe('REF:#/$defs/DynamicBoolean|Whether to group.').optional(),
      ),
    );
    assert.ok(bridged(DynamicBooleanSchema.default(true).describe('Grouping.')));
    assert.ok(bridged(DynamicBooleanSchema.optional().describe('Whether to group.')));
    assert.ok(!bridged(DynamicStringSchema.optional().describe('Label.')));
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
    const {node, doc} = toSchemaDoc(catalog.functions.get('flag')!.schema, '1.0');
    assert.deepStrictEqual(coerceDynamicBooleans(node, doc, {on: 'TRUE'}), {on: true});
  });

  it('does not match other common types or plain booleans', () => {
    assert.ok(!isDynamicBooleanSchema(commonRef('DynamicString'), DOC));
    assert.ok(!isDynamicBooleanSchema({type: 'boolean'}, DOC));
    assert.ok(
      !isDynamicBooleanSchema({type: 'object', properties: {valid: {type: 'boolean'}}}, DOC),
    );
  });
});

describe('coerceDynamicBoolean', () => {
  it('returns booleans unchanged', () => {
    assert.strictEqual(coerceDynamicBoolean(true), true);
    assert.strictEqual(coerceDynamicBoolean(false), false);
  });

  it('coerces ValidationResult objects to their valid boolean', () => {
    assert.strictEqual(coerceDynamicBoolean(VALID), true);
    assert.strictEqual(coerceDynamicBoolean(INVALID), false);
  });

  it('coerces strings case-insensitively matching "true" to true and all other strings to false', () => {
    assert.strictEqual(coerceDynamicBoolean('true'), true);
    assert.strictEqual(coerceDynamicBoolean('TRUE'), true);
    assert.strictEqual(coerceDynamicBoolean('True'), true);
    assert.strictEqual(coerceDynamicBoolean('false'), false);
    assert.strictEqual(coerceDynamicBoolean('FALSE'), false);
    assert.strictEqual(coerceDynamicBoolean('False'), false);
    assert.strictEqual(coerceDynamicBoolean('yes'), false);
    assert.strictEqual(coerceDynamicBoolean('1'), false);
    assert.strictEqual(coerceDynamicBoolean('hello'), false);
    assert.strictEqual(coerceDynamicBoolean(''), false);
  });

  it('coerces numbers by value !== 0 with NaN as false', () => {
    assert.strictEqual(coerceDynamicBoolean(1), true);
    assert.strictEqual(coerceDynamicBoolean(-2), true);
    assert.strictEqual(coerceDynamicBoolean(0.5), true);
    assert.strictEqual(coerceDynamicBoolean(0), false);
    assert.strictEqual(coerceDynamicBoolean(-0), false);
    assert.strictEqual(coerceDynamicBoolean(NaN), false);
  });

  it('coerces null, undefined, other objects, and arrays to false', () => {
    assert.strictEqual(coerceDynamicBoolean(null), false);
    assert.strictEqual(coerceDynamicBoolean(undefined), false);
    assert.strictEqual(coerceDynamicBoolean({}), false);
    assert.strictEqual(coerceDynamicBoolean({other: 1}), false);
    assert.strictEqual(coerceDynamicBoolean({valid: 'yes'}), false);
    assert.strictEqual(coerceDynamicBoolean([]), false);
    assert.strictEqual(coerceDynamicBoolean([true]), false);
  });
});

describe('coerceValidationResults and coerceDynamicBooleans', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      value: commonRef('DynamicBoolean'),
      values: {type: 'array', items: commonRef('DynamicBoolean')},
      grouping: {$ref: 'common_types.json#/$defs/DynamicBoolean', description: 'Grouping.'},
      label: commonRef('DynamicString'),
      payload: {},
    },
    required: ['value'],
  };
  const doc: SchemaDoc = {root: schema, defs: DOC.defs};

  it('coerces a $ref DynamicBoolean string', () => {
    assert.deepStrictEqual(coerceDynamicBooleans(schema, doc, {value: 'TRUE'}), {value: true});
  });

  it('coerces DynamicBoolean positions across all coercion table types', () => {
    assert.deepStrictEqual(
      coerceDynamicBooleans(schema, doc, {
        value: INVALID,
        values: [VALID, INVALID, true, 'True', 'false', 'hello', 1, 0, NaN, null, {other: 1}, []],
        grouping: 'TRUE',
      }),
      {
        value: false,
        values: [true, false, true, true, false, false, true, false, false, false, false, false],
        grouping: true,
      },
    );
  });

  it('follows allOf members and local references to the arguments object', () => {
    const root: JsonSchema = {
      $defs: {Args: {type: 'object', properties: {on: commonRef('DynamicBoolean')}}},
      allOf: [{$ref: '#/$defs/Args'}, {type: 'object', properties: {label: {type: 'string'}}}],
    };
    assert.deepStrictEqual(
      coerceDynamicBooleans(root, {root, defs: DOC.defs}, {on: 'true', label: 'x'}),
      {on: true, label: 'x'},
    );
  });

  it('leaves already-boolean DynamicBoolean values and non-DynamicBoolean fields alone', () => {
    const args = {value: true, values: [false, true], label: 'x'};
    assert.strictEqual(coerceValidationResults(schema, doc, args), args);
  });

  it('leaves a ValidationResult alone where the schema is not a DynamicBoolean', () => {
    const args = {value: true, payload: INVALID, label: INVALID};
    assert.strictEqual(coerceValidationResults(schema, doc, args), args);
  });

  it('coerces a value when the whole schema is DynamicBoolean', () => {
    const flag = commonRef('DynamicBoolean');
    assert.strictEqual(coerceValidationResults(flag, DOC, INVALID), false);
    assert.strictEqual(coerceValidationResults(flag, DOC, 'True'), true);
    assert.strictEqual(coerceValidationResults(flag, DOC, 0), false);
    assert.strictEqual(coerceValidationResults(flag, DOC, null), false);
    assert.strictEqual(coerceValidationResults(commonRef('DynamicString'), DOC, INVALID), INVALID);
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

  it('coerces DynamicBoolean arguments in v1.0 across all value types', () => {
    const {catalog, seen} = catalogWithFlag('1.0');
    assert.strictEqual(
      catalog.invoker(
        'flag',
        {
          on: INVALID,
          all: [VALID, INVALID, 'True', 'false', 'other', 3, 0, null, {other: 1}, [true]],
        },
        ctx,
      ),
      false,
    );
    assert.deepStrictEqual(seen, [
      {
        on: false,
        all: [true, false, true, false, false, true, false, false, false, false],
      },
    ]);
  });

  it('coerces non-boolean DynamicBoolean arguments to false when not truthy', () => {
    const {catalog} = catalogWithFlag('1.0');
    assert.strictEqual(catalog.invoker('flag', {on: {other: 1}}, ctx), false);
    assert.strictEqual(catalog.invoker('flag', {on: 'True'}, ctx), true);
    assert.strictEqual(catalog.invoker('flag', {on: 'false'}, ctx), false);
    assert.strictEqual(catalog.invoker('flag', {on: 2}, ctx), true);
    assert.strictEqual(catalog.invoker('flag', {on: 0}, ctx), false);
    assert.strictEqual(catalog.invoker('flag', {on: null}, ctx), false);
  });

  it('coerces DynamicBoolean arguments in v0.9 as well', () => {
    const {catalog} = catalogWithFlag('0.9');
    assert.strictEqual(catalog.invoker('flag', {on: INVALID}, ctx), false);
    assert.strictEqual(catalog.invoker('flag', {on: VALID}, ctx), true);
    assert.strictEqual(catalog.invoker('flag', {on: 'TRUE'}, ctx), true);
    assert.strictEqual(catalog.invoker('flag', {on: 0}, ctx), false);
  });
});

describe('GenericBinder DynamicBoolean property coercion', () => {
  const CheckBoxApi: ComponentApi = {
    name: 'CheckBox',
    schema: z.object({
      value: DynamicBooleanSchema,
      label: DynamicStringSchema.optional(),
    }),
  };

  it('coerces bound DynamicBoolean component properties across all table rows', () => {
    const catalog = new Catalog('test', '1.0', [CheckBoxApi], []);
    const surface = new SurfaceModel('s1', catalog, {});
    const comp = new ComponentModel('c1', 'CheckBox', {
      value: {'@path': '/flag'},
      label: {'@path': '/flag'},
    });
    surface.componentsModel.addComponent(comp);
    const compCtx = new ComponentContext(surface, 'c1', '/');
    const binder = new GenericBinder<{value?: boolean; label?: unknown}>(
      compCtx,
      toSchemaDoc(CheckBoxApi.schema, '1.0'),
    );
    const sub = binder.subscribe(() => {});

    const cases: Array<[unknown, boolean]> = [
      [true, true],
      [false, false],
      [VALID, true],
      [INVALID, false],
      ['true', true],
      ['True', true],
      ['TRUE', true],
      ['false', false],
      ['FALSE', false],
      ['hello', false],
      ['', false],
      [1, true],
      [-5, true],
      [0, false],
      [null, false],
      [{other: 1}, false],
      [[true], false],
    ];

    for (const [raw, expected] of cases) {
      surface.dataModel.set('/flag', raw);
      assert.strictEqual(binder.snapshot.value, expected, `Failed for ${JSON.stringify(raw)}`);
    }

    sub.unsubscribe();
  });
});
