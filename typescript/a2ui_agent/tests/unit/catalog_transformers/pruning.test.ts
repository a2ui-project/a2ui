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

import {describe, it, expect} from 'vitest';
import {
  ComponentPruningTransformer,
  FunctionPruningTransformer,
} from '../../../src/catalog_transformers/pruning.js';
import {Catalog, ComponentApi, FunctionImplementation} from '../../../src/internal/web_core.js';
import {z} from 'zod';

describe('Pruning Transformers', () => {
  const compA: ComponentApi = {name: 'CompA', schema: z.object({})};
  const compB: ComponentApi = {name: 'CompB', schema: z.object({})};

  const funcX: FunctionImplementation = {
    name: 'FuncX',
    returnType: 'string',
    schema: z.object({}),
    execute: () => 'x',
  };

  const funcY: FunctionImplementation = {
    name: 'FuncY',
    returnType: 'string',
    schema: z.object({}),
    execute: () => 'y',
  };

  it('ComponentPruningTransformer correctly prunes components and is immutable', () => {
    const catalog = new Catalog('test', [compA, compB], [funcX, funcY]);

    // Access getters to memoize their state on the original catalog
    const originalSchema = catalog.catalogSchema;
    const originalRefMap = catalog.componentRefMap;

    const transformer = new ComponentPruningTransformer(['CompA']);
    const pruned = transformer.transform(catalog);

    // Verify immutability: old catalog is unchanged
    expect(catalog.components.size).toBe(2);
    expect(catalog.catalogSchema).toBe(originalSchema);
    expect(catalog.componentRefMap).toBe(originalRefMap);

    // Verify pruned catalog properties
    expect(pruned).not.toBe(catalog);
    expect(pruned.components.size).toBe(1);
    expect(pruned.components.has('CompA')).toBe(true);
    expect(pruned.components.has('CompB')).toBe(false);
    expect(pruned.functions.size).toBe(2);

    // Verify lazy properties don't leak unpruned components
    // We use any here to test internal structure that isn't strictly typed on catalogSchema
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prunedSchema = pruned.catalogSchema as any;
    expect(prunedSchema.components.CompA).toBeDefined();
    expect(prunedSchema.components.CompB).toBeUndefined();

    // Verify the memoized schema isn't the same object (i.e. invalidated/fresh)
    expect(pruned.catalogSchema).not.toBe(originalSchema);
    expect(pruned.componentRefMap).not.toBe(originalRefMap);
  });

  it('FunctionPruningTransformer correctly prunes functions and is immutable', () => {
    const catalog = new Catalog('test', [compA, compB], [funcX, funcY]);

    const originalSchema = catalog.catalogSchema;

    const transformer = new FunctionPruningTransformer(['FuncY']);
    const pruned = transformer.transform(catalog);

    // Verify immutability
    expect(catalog.functions.size).toBe(2);

    // Verify pruned catalog properties
    expect(pruned).not.toBe(catalog);
    expect(pruned.components.size).toBe(2);
    expect(pruned.functions.size).toBe(1);
    expect(pruned.functions.has('FuncY')).toBe(true);
    expect(pruned.functions.has('FuncX')).toBe(false);

    // Verify lazy properties don't leak unpruned functions
    // We use any here to test internal structure that isn't strictly typed on catalogSchema
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prunedSchema = pruned.catalogSchema as any;
    expect(prunedSchema.functions.FuncY).toBeDefined();
    expect(prunedSchema.functions.FuncX).toBeUndefined();

    expect(pruned.catalogSchema).not.toBe(originalSchema);
  });
});
