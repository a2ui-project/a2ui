/*
 * Copyright 2026 Google LLC
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
import {z} from 'zod';
import {GenericBinder} from './generic-binder.js';
import {ComponentContext} from './component-context.js';
import {SurfaceModel} from '../state/surface-model.js';
import {Catalog} from '../catalog/types.js';
import {ComponentModel} from '../state/component-model.js';
import {CommonSchemas} from '../schema/common-types.js';

describe('GenericBinder Checkable Trait', () => {
  const mockCatalog = new Catalog('test', [], []);

  function setupSurfaceAndMocks() {
    const surface = new SurfaceModel('s1', mockCatalog);

    // Mock required and min_length functions
    (surface.catalog as any).functions = new Map([
      [
        'required',
        {
          execute: (args: any) => !!args.value,
          schema: z.object({value: z.any()}),
        },
      ],
      [
        'min_length',
        {
          execute: (args: any) => typeof args.value === 'string' && args.value.length >= args.min,
          schema: z.object({value: z.any(), min: z.number()}),
        },
      ],
    ]);
    (surface.catalog as any).invoker = (name: string, args: any) => {
      const fn = (surface.catalog as any).functions.get(name);
      return fn.execute(args);
    };

    const schema = z.object({
      value: CommonSchemas.DynamicString,
      checks: CommonSchemas.Checkable.shape.checks,
    });

    return {surface, schema};
  }

  it('should resolve checkable validation state reactively', async () => {
    const {surface, schema} = setupSurfaceAndMocks();
    surface.dataModel.set('/val', '');

    const compModel = new ComponentModel('c1', 'Test', {
      value: {path: '/val'},
      checks: [
        {
          condition: {
            call: 'required',
            args: {value: {path: '/val'}},
          },
          message: 'Value is required',
        },
      ],
    });
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c1');
    const binder = new GenericBinder<any>(context, schema);
    binder.subscribe(() => {});

    // Initial state: should be invalid
    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Value is required']);

    // Update data: should become valid
    surface.dataModel.set('/val', 'hello');
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.strictEqual(binder.snapshot.isValid, true);
    assert.deepStrictEqual(binder.snapshot.validationErrors, []);
  });

  it('should aggregate multiple validation rules correctly', async () => {
    const {surface, schema} = setupSurfaceAndMocks();
    surface.dataModel.set('/val', '');

    const compModel = new ComponentModel('c2', 'Test', {
      value: {path: '/val'},
      checks: [
        {
          condition: {
            call: 'required',
            args: {value: {path: '/val'}},
          },
          message: 'Cannot be empty',
        },
        {
          condition: {
            call: 'min_length',
            args: {value: {path: '/val'}, min: 3},
          },
          message: 'Must be at least 3 characters',
        },
      ],
    });
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c2');
    const binder = new GenericBinder<any>(context, schema);
    binder.subscribe(() => {});

    // Both rules fail initially
    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, [
      'Cannot be empty',
      'Must be at least 3 characters',
    ]);

    // Update data to satisfy first rule but fail second
    surface.dataModel.set('/val', 'hi');
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Must be at least 3 characters']);

    // Update data to satisfy all rules
    surface.dataModel.set('/val', 'hello');
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.strictEqual(binder.snapshot.isValid, true);
    assert.deepStrictEqual(binder.snapshot.validationErrors, []);
  });

  it('should provide a default message if rule.message is missing', async () => {
    const {surface, schema} = setupSurfaceAndMocks();
    surface.dataModel.set('/val', '');

    const compModel = new ComponentModel('c3', 'Test', {
      value: {path: '/val'},
      checks: [
        {
          condition: {
            call: 'required',
            args: {value: {path: '/val'}},
          },
        },
      ] as any,
    });
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c3');
    const binder = new GenericBinder<any>(context, schema);

    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Validation failed']);
  });

  it('should default to valid if checks array is empty or undefined', async () => {
    const {surface, schema} = setupSurfaceAndMocks();

    const compModel = new ComponentModel('c4', 'Test', {
      value: 'static',
      checks: [], // Empty checks
    });
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c4');
    const binder = new GenericBinder<any>(context, schema);

    assert.strictEqual(binder.snapshot.isValid, true);
    assert.deepStrictEqual(binder.snapshot.validationErrors, []);
  });
});
