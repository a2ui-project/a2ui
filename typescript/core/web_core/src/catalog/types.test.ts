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
import {
  Catalog,
  ComponentApi,
  InferredComponentApiSchemaType,
  createFunctionImplementation,
} from './types.js';
import {A2uiExpressionError} from '../errors.js';
import {z} from 'zod';

describe('Catalog Types', () => {
  it('creates a catalog with functions', () => {
    const mockComponent = {
      name: 'MockComp',
      schema: z.object({}),
    } satisfies ComponentApi;

    const mockFunc = createFunctionImplementation(
      {
        name: 'mockFunc',
        returnType: 'string',
        schema: z.object({}),
      },
      () => 'result',
    );

    const catalog = new Catalog('test-cat', '1.0', [mockComponent], [mockFunc]);

    assert.strictEqual(catalog.id, 'test-cat');
    assert.strictEqual(catalog.components.size, 1);
    assert.strictEqual(catalog.components.get('MockComp'), mockComponent);

    assert.ok(catalog.functions);
    assert.strictEqual(catalog.functions.size, 1);
    assert.strictEqual(catalog.functions.get('mockFunc'), mockFunc);
  });

  it('defaults to v0.9 when constructed with the pre-1.0 argument order', () => {
    const mockComponent = {name: 'MockComp', schema: z.object({})} satisfies ComponentApi;
    const mockFunc = createFunctionImplementation(
      {name: 'mockFunc', returnType: 'string', schema: z.object({})},
      () => 'result',
    );
    const themeSchema = z.object({primaryColor: z.string()});

    const legacy = new Catalog('legacy-cat', [mockComponent], [mockFunc], themeSchema, 'Use it');

    assert.strictEqual(legacy.protocolVersion, '0.9');
    assert.strictEqual(legacy.components.get('MockComp'), mockComponent);
    assert.strictEqual(legacy.functions.get('mockFunc'), mockFunc);
    assert.strictEqual(legacy.themeSchema, themeSchema);
    assert.strictEqual(legacy.instructions, 'Use it');

    const bare = new Catalog('bare-cat');
    assert.strictEqual(bare.protocolVersion, '0.9');
    assert.strictEqual(bare.components.size, 0);
    assert.strictEqual(bare.functions.size, 0);

    const withUndefinedComponents = new Catalog(
      'undef-comp-cat',
      undefined,
      [mockFunc],
      themeSchema,
      'Use it',
    );
    assert.strictEqual(withUndefinedComponents.protocolVersion, '0.9');
    assert.strictEqual(withUndefinedComponents.components.size, 0);
    assert.strictEqual(withUndefinedComponents.functions.get('mockFunc'), mockFunc);
  });

  it('keeps the 1.0 argument order when a protocol version is given', () => {
    const themeSchema = z.object({primaryColor: z.string()});
    const withOptions = new Catalog('cat', '1.0', [], [], {themeSchema, instructions: 'A'});
    assert.strictEqual(withOptions.protocolVersion, '1.0');
    assert.strictEqual(withOptions.themeSchema, themeSchema);
    assert.strictEqual(withOptions.instructions, 'A');

    const withSchema = new Catalog('cat', '1.0', [], [], themeSchema, 'B');
    assert.strictEqual(withSchema.themeSchema, themeSchema);
    assert.strictEqual(withSchema.instructions, 'B');

    const withoutFunctions = new Catalog('cat', '1.0', [], undefined, {themeSchema}, 'C');
    assert.strictEqual(withoutFunctions.functions.size, 0);
    assert.strictEqual(withoutFunctions.themeSchema, themeSchema);
    assert.strictEqual(withoutFunctions.instructions, 'C');

    assert.throws(() => new Catalog('cat', ''), /protocolVersion must be provided/);
  });

  it('throws A2uiExpressionError when function is not found', () => {
    const catalog = new Catalog('test-cat', '1.0', []);
    const ctx = {} as any;

    assert.throws(
      () => catalog.invoker('nonExistent', {}, ctx),
      (err: any) => {
        return (
          err instanceof A2uiExpressionError &&
          err.message.includes('Function not found') &&
          err.expression === 'nonExistent'
        );
      },
    );
  });

  it('throws A2uiExpressionError when zod validation fails', () => {
    const mockFunc = createFunctionImplementation(
      {
        name: 'test',
        returnType: 'string',
        schema: z.object({
          requiredField: z.string(),
        }),
      },
      () => 'result',
    );
    const catalog = new Catalog('test-cat', '1.0', [], [mockFunc]);
    const ctx = {} as any;

    assert.throws(
      () => catalog.invoker('test', {}, ctx),
      (err: any) => {
        return (
          err instanceof A2uiExpressionError &&
          err.message.includes('Validation failed') &&
          err.expression === 'test' &&
          Array.isArray(err.details)
        );
      },
    );
  });

  it('safely computes componentRefMap with default fallback when refOptions is omitted', () => {
    const mockComponent = {
      name: 'Container',
      schema: z.object({
        child: z.string().describe('ComponentId'),
      }),
    } satisfies ComponentApi;

    const catalog = new Catalog('guid-1234', '1.0', [mockComponent]);
    assert.doesNotThrow(() => {
      const refMap = catalog.componentRefMap;
      assert.ok(refMap.Container);
      assert.deepStrictEqual(Array.from(refMap.Container.singleRefs), ['child']);
      assert.deepStrictEqual(Array.from(refMap.Container.listRefs), []);
    });
  });

  it('serializes catalog to JSON schema via validationSchema', () => {
    const mockComponent = {
      name: 'CustomButton',
      schema: z.object({
        label: z.string().describe('REF:#/$defs/DynamicString'),
      }),
    } satisfies ComponentApi;

    const catalog = new Catalog('https://example.com/custom-cat.json', '1.0', [mockComponent]);

    const schema = catalog.validationSchema;
    const defs = schema['$defs'] as Record<string, any>;
    assert.ok(defs);
    assert.ok(defs.DynamicString);
  });

  describe('invoker with pending arguments', () => {
    const upper = createFunctionImplementation(
      {name: 'upper', returnType: 'string', schema: z.object({'value': z.string()})},
      args => args.value.toUpperCase(),
    );
    const catalog = new Catalog('test-cat', '1.0', [], [upper]);

    it('runs synchronously when every argument is settled', () => {
      assert.strictEqual(catalog.invoker('upper', {value: 'abc'}, {} as any), 'ABC');
    });

    it('awaits a pending argument before validating against a z.string() schema', async () => {
      const result = catalog.invoker('upper', {value: Promise.resolve('abc')}, {} as any);
      assert.strictEqual(typeof (result as Promise<unknown>).then, 'function');
      assert.strictEqual(await result, 'ABC');
    });

    it('rejects with the validation error once a pending argument settles to the wrong type', async () => {
      await assert.rejects(
        catalog.invoker('upper', {value: Promise.resolve(42)}, {} as any) as Promise<unknown>,
        (err: any) =>
          err instanceof A2uiExpressionError &&
          err.message.includes('Validation failed') &&
          err.expression === 'upper',
      );
    });

    it('propagates the rejection of a pending argument', async () => {
      const failure = new Error('inner failure');
      await assert.rejects(
        catalog.invoker('upper', {value: Promise.reject(failure)}, {} as any) as Promise<unknown>,
        failure,
      );
    });

    it('resolves to undefined when aborted before the arguments settle', async () => {
      const abortController = new AbortController();
      let executed = false;
      const spy = createFunctionImplementation(
        {name: 'spy', returnType: 'string', schema: z.object({'value': z.string()})},
        () => {
          executed = true;
          return 'ran';
        },
      );
      const spyCatalog = new Catalog('test-cat', '1.0', [], [spy]);
      const result = spyCatalog.invoker(
        'spy',
        {value: Promise.resolve('abc')},
        {} as any,
        abortController.signal,
      );
      abortController.abort();
      assert.strictEqual(await result, undefined);
      assert.strictEqual(executed, false);
    });

    it('enforces user activation synchronously, before awaiting any argument', () => {
      const guarded = createFunctionImplementation(
        {
          name: 'guarded',
          returnType: 'string',
          schema: z.object({'value': z.string()}),
          requiresUserActivation: true,
        },
        () => 'ran',
      );
      const guardedCatalog = new Catalog('test-cat', '1.0', [], [guarded]);
      assert.throws(
        () =>
          guardedCatalog.invoker('guarded', {value: Promise.resolve('abc')}, {
            isPassiveEvaluation: true,
          } as any),
        (err: any) =>
          err instanceof A2uiExpressionError && err.message.includes('requires user activation'),
      );
    });
  });
});

describe('InferredComponentApiSchemaType', () => {
  it('infers the correct schema type from a ComponentApi', () => {
    const mockSchema = z.object({
      field1: z.string(),
      field2: z.number().optional(),
    });

    const mockApi = {
      name: 'MockComp',
      schema: mockSchema,
    } satisfies ComponentApi;

    // Type-level equivalence assertion using z.infer
    type ExpectedType = z.infer<typeof mockSchema>;
    type InferredType = InferredComponentApiSchemaType<typeof mockApi>;

    // Assert `InferredType` is not exactly `any`
    type IsAny<T> = 0 extends 1 & T ? true : false;
    // inferredIsAny only accepts "true" if `InferredType` is "any".
    // This happens when `mockApi: ComponentApi`, but doesn't when
    // `mockApi {} satisfies ComponentApi`!
    const inferredIsAny: IsAny<InferredType> = false;

    // When types are not "any", check that they're the same by checking if they
    // extend each other.
    type TypesAreEquivalent<Expected, Actual> = Actual extends Expected
      ? Expected extends Actual
        ? true
        : false
      : false;

    // typesMatchExact only accepts "true" if `TypesAreEquivalent`
    const typesMatchExact: TypesAreEquivalent<ExpectedType, InferredType> = true;

    // Appease linter by using the variables
    assert.ok(mockApi);
    assert.strictEqual(inferredIsAny, false);
    assert.strictEqual(typesMatchExact, true);
  });
});
