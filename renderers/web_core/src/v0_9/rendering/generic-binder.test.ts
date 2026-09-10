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
import {GenericBinder, scrapeSchemaBehavior} from './generic-binder.js';
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

  it('should default to valid if checks array is empty', () => {
    const {surface, schema} = setupSurfaceAndMocks();

    const compModel = new ComponentModel('c4', 'Test', {
      value: 'hello',
      checks: [],
    });
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c4');
    const binder = new GenericBinder<any>(context, schema);

    assert.strictEqual(binder.snapshot.isValid, true);
    assert.deepStrictEqual(binder.snapshot.validationErrors, []);
  });

  it('should resolve ACTION binding and dispatch resolved payload', () => {
    const {surface} = setupSurfaceAndMocks();
    surface.dataModel.set('/user/name', 'Alice');

    const actionSchema = z.object({
      onTap: CommonSchemas.Action,
    });

    const compModel = new ComponentModel('c5', 'Button', {
      onTap: {
        event: {
          name: 'submit',
          context: {
            user: {path: '/user/name'},
          },
        },
      },
    });
    surface.componentsModel.addComponent(compModel);

    let dispatchedAction: any = null;
    surface.onAction.subscribe(act => {
      dispatchedAction = act;
    });

    const context = new ComponentContext(surface, 'c5');
    const binder = new GenericBinder<any>(context, actionSchema);

    // Call the resolved ACTION closure
    assert.strictEqual(typeof binder.snapshot.onTap, 'function');
    binder.snapshot.onTap();

    assert.ok(dispatchedAction);
    assert.strictEqual(dispatchedAction.name, 'submit');
    assert.strictEqual(dispatchedAction.sourceComponentId, 'c5');
    assert.deepStrictEqual(dispatchedAction.context, {user: 'Alice'});
  });

  it('should resolve STRUCTURAL ChildList bindings and update dynamically', async () => {
    const {surface} = setupSurfaceAndMocks();
    surface.dataModel.set('/items', [{title: 'Item 1'}, {title: 'Item 2'}]);

    const structuralSchema = z.object({
      children: CommonSchemas.ChildList,
    });

    const compModel = new ComponentModel('c6', 'Column', {
      children: {
        componentId: 'card-item',
        path: '/items',
      },
    });
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c6');
    const binder = new GenericBinder<any>(context, structuralSchema);
    binder.subscribe(() => {});

    assert.deepStrictEqual(binder.snapshot.children, [
      {id: 'card-item', basePath: '/items/0'},
      {id: 'card-item', basePath: '/items/1'},
    ]);

    // Update list in data model
    surface.dataModel.set('/items', [{title: 'Item 1'}, {title: 'Item 2'}, {title: 'Item 3'}]);
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.deepStrictEqual(binder.snapshot.children, [
      {id: 'card-item', basePath: '/items/0'},
      {id: 'card-item', basePath: '/items/1'},
      {id: 'card-item', basePath: '/items/2'},
    ]);
  });

  it('should generate dynamic setters and update data model', () => {
    const {surface} = setupSurfaceAndMocks();
    surface.dataModel.set('/fieldVal', 'initial');

    const dynamicSchema = z.object({
      value: CommonSchemas.DynamicString,
    });

    const compModel = new ComponentModel('c7', 'Input', {
      value: {path: '/fieldVal'},
    });
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c7');
    const binder = new GenericBinder<any>(context, dynamicSchema);

    assert.strictEqual(binder.snapshot.value, 'initial');
    assert.strictEqual(typeof (binder.snapshot as any).setValue, 'function');

    (binder.snapshot as any).setValue('updated');
    assert.strictEqual(surface.dataModel.get('/fieldVal'), 'updated');
  });

  it('should handle subscription, component update rebuilding, and dispose', async () => {
    const {surface, schema} = setupSurfaceAndMocks();
    surface.dataModel.set('/val', 'v1');

    const compModel = new ComponentModel('c8', 'Test', {
      value: {path: '/val'},
    });
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c8');
    const binder = new GenericBinder<any>(context, schema);

    let notificationCount = 0;
    const sub = binder.subscribe(() => {
      notificationCount++;
    });

    assert.strictEqual(binder.snapshot.value, 'v1');

    // Trigger component update to test rebuildAllBindings
    compModel.properties = {
      value: {path: '/val'},
      extra: 'new_prop',
    };

    assert.strictEqual(notificationCount, 1);

    sub.unsubscribe();
    // After unsubscribe, further updates should not notify
    compModel.properties = {
      value: {path: '/val'},
      extra: 'another_prop',
    };
    assert.strictEqual(notificationCount, 1);
  });

  describe('scrapeSchemaBehavior schema inference', () => {
    it('should infer behavior from schema descriptions', () => {
      // Description-based matching
      assert.deepStrictEqual(
        scrapeSchemaBehavior(z.any().describe('REF:common_types.json#/$defs/Action')),
        {
          type: 'ACTION',
        },
      );
      assert.deepStrictEqual(scrapeSchemaBehavior(z.any().describe('#/$defs/ChildList')), {
        type: 'STRUCTURAL',
      });
      assert.deepStrictEqual(scrapeSchemaBehavior(z.any().describe('#/$defs/DynamicString')), {
        type: 'DYNAMIC',
      });
      assert.deepStrictEqual(
        scrapeSchemaBehavior(z.any().describe('REF:common_types.json#/$defs/DataBinding')),
        {
          type: 'DYNAMIC',
        },
      );

      // Checks property is CHECKABLE, while unannotated fields are STATIC
      const objSchema = z.object({
        checks: z.any(),
        customProp: z.any(),
      });

      const behavior = scrapeSchemaBehavior(objSchema);
      assert.strictEqual(behavior.type, 'OBJECT');
      assert.strictEqual((behavior as any).shape.checks.type, 'CHECKABLE');
      assert.strictEqual((behavior as any).shape.customProp.type, 'STATIC');

      // Do not short-circuit to DYNAMIC if property is a nested ZodObject or ZodArray
      const nestedSchema = z.object({
        value: z.object({
          nestedField: z.string().describe('#/$defs/DynamicString'),
        }),
        text: z.array(z.string().describe('#/$defs/DynamicString')),
      });
      const nestedBehavior = scrapeSchemaBehavior(nestedSchema);
      assert.strictEqual(nestedBehavior.type, 'OBJECT');
      assert.strictEqual((nestedBehavior as any).shape.value.type, 'OBJECT');
      assert.strictEqual((nestedBehavior as any).shape.text.type, 'ARRAY');
    });
  });

  describe('Static behavior for unannotated schemas', () => {
    it('should pass unannotated properties through as static values without guessing bindings', () => {
      const {surface} = setupSurfaceAndMocks();

      const unannotatedSchema = z.object({
        customProp: z.any(),
        items: z.any(),
        handleClick: z.any(),
      });

      const compModel = new ComponentModel('c10', 'Custom', {
        customProp: {path: '/rawTitle'},
        items: {componentId: 'card-view', path: '/cards'},
        handleClick: {
          event: {
            name: 'custom_click',
            context: {userId: {path: '/user/id'}},
          },
        },
      });
      surface.componentsModel.addComponent(compModel);

      const context = new ComponentContext(surface, 'c10');
      const binder = new GenericBinder<any>(context, unannotatedSchema);

      // Data is passed through as-is rather than being misinterpreted as reactive bindings
      assert.deepStrictEqual(binder.snapshot.customProp, {path: '/rawTitle'});
      assert.deepStrictEqual(binder.snapshot.items, {componentId: 'card-view', path: '/cards'});
      assert.deepStrictEqual(binder.snapshot.handleClick, {
        event: {
          name: 'custom_click',
          context: {userId: {path: '/user/id'}},
        },
      });
    });
  });
});
