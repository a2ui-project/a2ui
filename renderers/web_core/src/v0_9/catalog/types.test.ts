/*
 * Copyright 2025 Google LLC
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

import assert from 'node:assert';
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

    const catalog = new Catalog('test-cat', [mockComponent], [mockFunc]);

    assert.strictEqual(catalog.id, 'test-cat');
    assert.strictEqual(catalog.components.size, 1);
    assert.strictEqual(catalog.components.get('MockComp'), mockComponent);

    assert.ok(catalog.functions);
    assert.strictEqual(catalog.functions.size, 1);
    assert.strictEqual(catalog.functions.get('mockFunc'), mockFunc);
  });

  it('throws A2uiExpressionError when function is not found', () => {
    const catalog = new Catalog('test-cat', []);
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
    const catalog = new Catalog('test-cat', [], [mockFunc]);
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
