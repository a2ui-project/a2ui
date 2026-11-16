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
import {
  GenericBinder,
  getSafeChildList,
  MAX_DYNAMIC_CHILD_LIST_SIZE,
  scrapeComponentBehavior,
  scrapeSchemaBehavior,
  type GenerateSetters,
  type ResolveA2uiProps,
  type ResolvedChildRef,
} from './generic-binder.js';
import {ComponentContext} from './component-context.js';
import {SurfaceModel} from '../state/surface-model.js';
import {Catalog, FunctionImplementation} from '../catalog/types.js';
import {ComponentModel} from '../state/component-model.js';
import {
  CommonSchemas,
  DataBindingSchema,
  type ChildList,
  type DataBinding,
  type DynamicString,
  type FunctionCall,
} from '../types/common-types.js';
import type {Action as V1Action, CheckRule as V1CheckRule} from '../v1_0/schema/common-types.js';

describe('GenericBinder Checkable Trait', () => {
  function setupSurfaceAndMocks() {
    const mockFunctions: FunctionImplementation[] = [
      {
        name: 'required',
        returnType: 'boolean',
        schema: z.object({value: z.unknown()}),
        execute: (args: Record<string, unknown>) => !!args.value,
      },
      {
        name: 'min_length',
        returnType: 'boolean',
        schema: z.object({value: z.unknown(), min: z.number()}),
        execute: (args: Record<string, unknown>) =>
          typeof args.value === 'string' &&
          typeof args.min === 'number' &&
          args.value.length >= args.min,
      },
    ];
    const mockCatalog = new Catalog('test', '0.9', [], mockFunctions);
    const surface = new SurfaceModel('s1', mockCatalog);

    const schema = z.object({
      value: CommonSchemas.DynamicString,
      checks: CommonSchemas.Checkable.shape.checks,
    });

    return {catalog: mockCatalog, surface, schema};
  }

  it('should resolve checkable validation state reactively', async () => {
    const {catalog, surface, schema} = setupSurfaceAndMocks();
    surface.dataModel.set('/val', '');

    const compModel = new ComponentModel(
      'c1',
      'Test',
      {
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
      },
      catalog,
    );
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
    const {catalog, surface, schema} = setupSurfaceAndMocks();
    surface.dataModel.set('/val', '');

    const compModel = new ComponentModel(
      'c2',
      'Test',
      {
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
      },
      catalog,
    );
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
    const {catalog, surface, schema} = setupSurfaceAndMocks();
    surface.dataModel.set('/val', '');

    const compModel = new ComponentModel(
      'c3',
      'Test',
      {
        value: {path: '/val'},
        checks: [
          {
            condition: {
              call: 'required',
              args: {value: {path: '/val'}},
            },
          },
        ] as unknown as Array<{condition: unknown; message?: string}>,
      },
      catalog,
    );
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c3');
    const binder = new GenericBinder<Record<string, unknown>>(context, schema);

    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Validation failed']);
  });

  it('should default to valid if checks array is empty', () => {
    const {catalog, surface, schema} = setupSurfaceAndMocks();

    const compModel = new ComponentModel(
      'c4',
      'Test',
      {
        value: 'hello',
        checks: [],
      },
      catalog,
    );
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c4');
    const binder = new GenericBinder<Record<string, unknown>>(context, schema);

    assert.strictEqual(binder.snapshot.isValid, true);
    assert.deepStrictEqual(binder.snapshot.validationErrors, []);
  });

  it('should resolve ACTION binding and dispatch resolved payload', () => {
    const {catalog, surface} = setupSurfaceAndMocks();
    surface.dataModel.set('/user/name', 'Alice');

    const actionSchema = z.object({
      onTap: CommonSchemas.Action,
    });

    const compModel = new ComponentModel(
      'c5',
      'Button',
      {
        onTap: {
          event: {
            name: 'submit',
            context: {
              user: {path: '/user/name'},
            },
          },
        },
      },
      catalog,
    );
    surface.componentsModel.addComponent(compModel);

    let dispatchedAction: {
      name?: string;
      sourceComponentId?: string;
      context?: Record<string, unknown>;
    } | null = null;
    surface.onAction.subscribe(act => {
      dispatchedAction = act as {
        name?: string;
        sourceComponentId?: string;
        context?: Record<string, unknown>;
      };
    });

    const context = new ComponentContext(surface, 'c5');
    const binder = new GenericBinder<{onTap?: () => void}>(context, actionSchema);

    // Call the resolved ACTION closure
    assert.strictEqual(typeof binder.snapshot.onTap, 'function');
    binder.snapshot.onTap?.();

    assert.ok(dispatchedAction);
    assert.strictEqual((dispatchedAction as {name?: string})?.name, 'submit');
    assert.strictEqual((dispatchedAction as {sourceComponentId?: string})?.sourceComponentId, 'c5');
    assert.deepStrictEqual((dispatchedAction as {context?: Record<string, unknown>})?.context, {
      user: 'Alice',
    });
  });

  it('should return action dispatch promise settling after onAction listeners complete', async () => {
    const {catalog, surface} = setupSurfaceAndMocks();
    surface.dataModel.set('/user/name', 'Alice');

    const actionSchema = z.object({
      onTap: CommonSchemas.Action,
    });

    const compModel = new ComponentModel(
      'c5',
      'Button',
      {
        onTap: {
          event: {
            name: 'submit',
            context: {
              user: {path: '/user/name'},
            },
          },
        },
      },
      catalog,
    );
    surface.componentsModel.addComponent(compModel);

    let listenerCompleted = false;
    surface.onAction.subscribe(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      listenerCompleted = true;
    });

    const context = new ComponentContext(surface, 'c5');
    const binder = new GenericBinder<{onTap?: () => Promise<void>}>(context, actionSchema);

    assert.strictEqual(typeof binder.snapshot.onTap, 'function');
    const dispatchPromise = binder.snapshot.onTap!();
    assert.strictEqual(typeof dispatchPromise?.then, 'function');
    assert.strictEqual(listenerCompleted, false);

    await dispatchPromise;
    assert.strictEqual(listenerCompleted, true);
  });

  it('should resolve dynamic userMessage on direct name action and include it in dispatched action', () => {
    const {catalog, surface} = setupSurfaceAndMocks();
    surface.dataModel.set('/feedback', 'Great service!');

    const actionSchema = z.object({
      onTap: CommonSchemas.Action,
    });

    const compModel = new ComponentModel(
      'c5_user_msg',
      'Button',
      {
        onTap: {
          name: 'sendFeedback',
          userMessage: {path: '/feedback'},
        },
      },
      catalog,
    );
    surface.componentsModel.addComponent(compModel);

    let dispatchedAction: unknown = null;
    surface.onAction.subscribe(act => {
      dispatchedAction = act;
    });

    const context = new ComponentContext(surface, 'c5_user_msg');
    const binder = new GenericBinder<{onTap?: () => void}>(context, actionSchema);

    binder.snapshot.onTap?.();

    assert.ok(dispatchedAction);
    assert.strictEqual((dispatchedAction as {name?: string})?.name, 'sendFeedback');
    assert.strictEqual((dispatchedAction as {userMessage?: string})?.userMessage, 'Great service!');
  });

  it('should execute functionCall ACTION binding locally and not dispatch onAction event', () => {
    let orderSubmittedWith: Record<string, unknown> | null = null;
    const mockFunctions: FunctionImplementation[] = [
      {
        name: 'submitOrder',
        returnType: 'string',
        schema: z.object({orderId: z.string(), total: z.number()}),
        execute: (args: Record<string, unknown>) => {
          orderSubmittedWith = args;
          return 'ok';
        },
      },
    ];
    const mockCatalog = new Catalog('test', '0.9', [], mockFunctions);
    const surface = new SurfaceModel('s1', mockCatalog);
    surface.dataModel.set('/order/id', 'ORD-987');
    surface.dataModel.set('/order/total', 49.99);

    const actionSchema = z.object({
      onTap: CommonSchemas.Action,
    });

    const compModel = new ComponentModel(
      'c5_fc',
      'Button',
      {
        onTap: {
          functionCall: {
            call: 'submitOrder',
            args: {
              orderId: {path: '/order/id'},
              total: {path: '/order/total'},
            },
          },
        },
      },
      mockCatalog,
    );
    surface.componentsModel.addComponent(compModel);

    let dispatchedAction: unknown = null;
    surface.onAction.subscribe(act => {
      dispatchedAction = act;
    });

    const context = new ComponentContext(surface, 'c5_fc');
    const binder = new GenericBinder<{onTap?: () => void}>(context, actionSchema);

    assert.strictEqual(typeof binder.snapshot.onTap, 'function');
    assert.strictEqual(orderSubmittedWith, null);
    assert.strictEqual(dispatchedAction, null);

    binder.snapshot.onTap?.();

    assert.deepStrictEqual(orderSubmittedWith, {
      orderId: 'ORD-987',
      total: 49.99,
    });
    assert.strictEqual(dispatchedAction, null);
  });

  it('should execute functionCall ACTION without args locally upon activation and not prematurely during binding', () => {
    let refreshCallCount = 0;
    const mockFunctions: FunctionImplementation[] = [
      {
        name: 'refreshData',
        returnType: 'string',
        schema: z.object({}).passthrough(),
        execute: () => {
          refreshCallCount++;
          return 'ok';
        },
      },
    ];
    const mockCatalog = new Catalog('test', '0.9', [], mockFunctions);
    const surface = new SurfaceModel('s1', mockCatalog);

    const actionSchema = z.object({
      onTap: CommonSchemas.Action,
    });

    const compModel = new ComponentModel(
      'c5_zero_arg',
      'Button',
      {
        onTap: {
          functionCall: {
            call: 'refreshData',
          },
        },
      },
      mockCatalog,
    );
    surface.componentsModel.addComponent(compModel);

    let dispatchedAction: unknown = null;
    surface.onAction.subscribe(act => {
      dispatchedAction = act;
    });

    const context = new ComponentContext(surface, 'c5_zero_arg');
    const binder = new GenericBinder<{onTap?: () => void}>(context, actionSchema);

    // Binding must create action closure, not execute functionCall prematurely
    assert.strictEqual(typeof binder.snapshot.onTap, 'function');
    assert.strictEqual(refreshCallCount, 0);
    assert.strictEqual(dispatchedAction, null);

    binder.snapshot.onTap?.();
    assert.strictEqual(refreshCallCount, 1);
    assert.strictEqual(dispatchedAction, null);
  });

  it('should return promise settling after async functionCall ACTION completes', async () => {
    let executionCompleted = false;
    const mockFunctions: FunctionImplementation[] = [
      {
        name: 'saveDraft',
        returnType: 'string',
        schema: z.object({}).passthrough(),
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          executionCompleted = true;
          return 'saved';
        },
      },
    ];
    const mockCatalog = new Catalog('test', '1.0', [], mockFunctions);
    const surface = new SurfaceModel('s1', mockCatalog);

    const actionSchema = z.object({
      onTap: CommonSchemas.Action,
    });

    const compModel = new ComponentModel(
      'c5_async_fc',
      'Button',
      {
        onTap: {
          functionCall: {
            call: 'saveDraft',
          },
        },
      },
      mockCatalog,
    );
    surface.componentsModel.addComponent(compModel);

    let dispatchedAction: unknown = null;
    surface.onAction.subscribe(act => {
      dispatchedAction = act;
    });

    const context = new ComponentContext(surface, 'c5_async_fc');
    const binder = new GenericBinder<{onTap?: () => Promise<void>}>(context, actionSchema);

    assert.strictEqual(typeof binder.snapshot.onTap, 'function');
    const actionPromise = binder.snapshot.onTap!();
    assert.strictEqual(typeof actionPromise?.then, 'function');
    assert.strictEqual(executionCompleted, false);

    await actionPromise;
    assert.strictEqual(executionCompleted, true);
    assert.strictEqual(dispatchedAction, null);
  });

  it('should execute unwrapped {call} ACTION binding locally and not dispatch onAction event', () => {
    let executedArgs: Record<string, unknown> | null = null;
    const mockFunctions: FunctionImplementation[] = [
      {
        name: 'setValue',
        returnType: 'boolean',
        schema: z.object({path: z.string(), value: z.boolean()}),
        execute: (args: Record<string, unknown>) => {
          executedArgs = args;
          return true;
        },
      },
    ];
    const mockCatalog = new Catalog('test', '0.9', [], mockFunctions);
    const surface = new SurfaceModel('s1', mockCatalog);

    const actionSchema = z.object({
      onTap: CommonSchemas.Action,
    });

    const compModel = new ComponentModel(
      'c5_unwrapped_call',
      'Button',
      {
        onTap: {
          call: 'setValue',
          args: {
            path: '/clicked',
            value: true,
          },
        },
      },
      mockCatalog,
    );
    surface.componentsModel.addComponent(compModel);

    let dispatchedAction: unknown = null;
    surface.onAction.subscribe(act => {
      dispatchedAction = act;
    });

    const context = new ComponentContext(surface, 'c5_unwrapped_call');
    const binder = new GenericBinder<{onTap?: () => void}>(context, actionSchema);

    binder.snapshot.onTap?.();

    assert.deepStrictEqual(executedArgs, {
      path: '/clicked',
      value: true,
    });
    assert.strictEqual(dispatchedAction, null);
  });

  it('should resolve STRUCTURAL ChildList bindings and update dynamically', async () => {
    const {catalog, surface} = setupSurfaceAndMocks();
    surface.dataModel.set('/items', [{title: 'Item 1'}, {title: 'Item 2'}]);

    const structuralSchema = z.object({
      children: CommonSchemas.ChildList,
    });

    const compModel = new ComponentModel(
      'c6',
      'Column',
      {
        children: {
          componentId: 'card-item',
          path: '/items',
        },
      },
      catalog,
    );
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c6');
    const binder = new GenericBinder<{children?: unknown[]}>(context, structuralSchema);
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

  it('should cap dynamic ChildList materialization to MAX_DYNAMIC_CHILD_LIST_SIZE (Issue #2387)', async () => {
    const {catalog, surface} = setupSurfaceAndMocks();
    const largeList = Array.from({length: 12_000}, (_, i) => ({title: `Item ${i}`}));
    surface.dataModel.set('/largeItems', largeList);

    const structuralSchema = z.object({
      children: CommonSchemas.ChildList,
    });

    const compModel = new ComponentModel(
      'c_large',
      'Column',
      {
        children: {
          componentId: 'card-item',
          path: '/largeItems',
        },
      },
      catalog,
    );
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c_large');
    const binder = new GenericBinder<{children?: Array<{basePath: string}>}>(
      context,
      structuralSchema,
    );
    binder.subscribe(() => {});

    assert.ok(Array.isArray(binder.snapshot.children));
    assert.strictEqual(binder.snapshot.children!.length, MAX_DYNAMIC_CHILD_LIST_SIZE);
    assert.strictEqual(binder.snapshot.children![0].basePath, '/largeItems/0');
    assert.strictEqual(
      binder.snapshot.children![MAX_DYNAMIC_CHILD_LIST_SIZE - 1].basePath,
      `/largeItems/${MAX_DYNAMIC_CHILD_LIST_SIZE - 1}`,
    );

    // An even larger update stays capped.
    const evenLargerList = Array.from({length: 15_000}, (_, i) => ({title: `Updated ${i}`}));
    surface.dataModel.set('/largeItems', evenLargerList);
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.strictEqual(binder.snapshot.children!.length, MAX_DYNAMIC_CHILD_LIST_SIZE);
  });

  it('should generate dynamic setters and update data model', () => {
    const {catalog, surface} = setupSurfaceAndMocks();
    surface.dataModel.set('/fieldVal', 'initial');

    const dynamicSchema = z.object({
      value: CommonSchemas.DynamicString,
    });

    const compModel = new ComponentModel(
      'c7',
      'Input',
      {
        value: {path: '/fieldVal'},
      },
      catalog,
    );
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c7');
    const binder = new GenericBinder<{value?: string; setValue?: (val: string) => void}>(
      context,
      dynamicSchema,
    );

    assert.strictEqual(binder.snapshot.value, 'initial');
    assert.strictEqual(typeof binder.snapshot.setValue, 'function');

    binder.snapshot.setValue?.('updated');
    assert.strictEqual(surface.dataModel.get('/fieldVal'), 'updated');
  });

  it('should handle subscription, component update rebuilding, and dispose', async () => {
    const {catalog, surface, schema} = setupSurfaceAndMocks();
    surface.dataModel.set('/val', 'v1');

    const compModel = new ComponentModel(
      'c8',
      'Test',
      {
        value: {path: '/val'},
      },
      catalog,
    );
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c8');
    const binder = new GenericBinder<{value?: string}>(context, schema);

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

  it('drops properties that a component update removes', () => {
    const {catalog, surface, schema} = setupSurfaceAndMocks();
    const compModel = new ComponentModel(
      'c9',
      'Test',
      {value: 'kept', accessibility: {label: 'Name'}},
      catalog,
    );
    surface.componentsModel.addComponent(compModel);
    const binder = new GenericBinder<any>(new ComponentContext(surface, 'c9'), schema);
    binder.subscribe(() => {});

    compModel.properties = {value: 'kept'};

    assert.strictEqual(binder.snapshot.value, 'kept');
    assert.ok(!('accessibility' in binder.snapshot));
  });

  it('keeps the validation state of checks across a component update', () => {
    const {catalog, surface, schema} = setupSurfaceAndMocks();
    const checks = [
      {condition: {call: 'required', args: {value: {path: '/val'}}}, message: 'Required'},
    ];
    const compModel = new ComponentModel('c10', 'Test', {value: {path: '/val'}, checks}, catalog);
    surface.componentsModel.addComponent(compModel);
    const binder = new GenericBinder<any>(new ComponentContext(surface, 'c10'), schema);
    binder.subscribe(() => {});

    compModel.properties = {value: {path: '/val'}, checks};

    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Required']);
  });

  it('keeps the validation state of checks in a nested object across a component update', () => {
    const {catalog, surface} = setupSurfaceAndMocks();
    const schema = z.object({
      section: z.object({
        value: CommonSchemas.DynamicString,
        checks: CommonSchemas.Checkable.shape.checks,
      }),
    });
    const section = {
      value: {path: '/val'},
      checks: [{condition: {call: 'required', args: {value: {path: '/val'}}}, message: 'Required'}],
    };
    const compModel = new ComponentModel('c11', 'Test', {section}, catalog);
    surface.componentsModel.addComponent(compModel);
    const binder = new GenericBinder<any>(new ComponentContext(surface, 'c11'), schema);
    assert.strictEqual(binder.snapshot.section.isValid, false);
    binder.subscribe(() => {});

    compModel.properties = {section};

    assert.strictEqual(binder.snapshot.section.isValid, false);
    assert.deepStrictEqual(binder.snapshot.section.validationErrors, ['Required']);
  });

  describe('scrapeSchemaBehavior schema inference', () => {
    it('should infer behavior from schema descriptions', () => {
      // Description-based matching across formats (relative, URI, pipe-annotated)
      assert.deepStrictEqual(
        scrapeSchemaBehavior(z.unknown().describe('REF:common_types.json#/$defs/Action')),
        {type: 'ACTION'},
      );
      assert.deepStrictEqual(
        scrapeSchemaBehavior(
          z
            .unknown()
            .describe('REF:https://a2ui.org/v1_0/common_types.json#/$defs/Action|On click'),
        ),
        {type: 'ACTION'},
      );
      assert.deepStrictEqual(scrapeSchemaBehavior(z.unknown().describe('REF:#/$defs/ChildList')), {
        type: 'STRUCTURAL',
      });
      assert.deepStrictEqual(
        scrapeSchemaBehavior(
          z.unknown().describe('REF:common_types.json#/$defs/ChildList|Children array'),
        ),
        {type: 'STRUCTURAL'},
      );
      assert.deepStrictEqual(
        scrapeSchemaBehavior(z.unknown().describe('REF:#/$defs/DynamicString')),
        {
          type: 'DYNAMIC',
        },
      );
      assert.deepStrictEqual(
        scrapeSchemaBehavior(
          z
            .unknown()
            .describe('REF:https://a2ui.org/v1_0/common_types.json#/$defs/DynamicNumber|Age'),
        ),
        {type: 'DYNAMIC'},
      );
      assert.deepStrictEqual(
        scrapeSchemaBehavior(z.unknown().describe('REF:common_types.json#/$defs/DataBinding')),
        {
          type: 'DYNAMIC',
        },
      );

      // Descriptions without the REF: prefix must NOT be treated as reference schemas
      assert.deepStrictEqual(scrapeSchemaBehavior(z.unknown().describe('#/$defs/ChildList')), {
        type: 'STATIC',
      });
      assert.deepStrictEqual(scrapeSchemaBehavior(z.unknown().describe('Action')), {
        type: 'STATIC',
      });
      assert.deepStrictEqual(scrapeSchemaBehavior(z.unknown().describe('CheckRule')), {
        type: 'STATIC',
      });

      // Ref-annotated Checkable or array of CheckRule is CHECKABLE, while unannotated fields (even if named 'checks') are STATIC
      const objSchema = z.object({
        checkableField: CommonSchemas.Checkable.shape.checks,
        rulesField: z.array(z.unknown().describe('REF:common_types.json#/$defs/CheckRule')),
        checks: z.unknown(),
        customProp: z.unknown(),
      });

      const behavior = scrapeSchemaBehavior(objSchema);
      assert.strictEqual(behavior.type, 'OBJECT');
      if (behavior.type === 'OBJECT') {
        assert.strictEqual(behavior.shape.checkableField.type, 'CHECKABLE');
        assert.strictEqual(behavior.shape.rulesField.type, 'CHECKABLE');
        assert.strictEqual(behavior.shape.checks.type, 'STATIC');
        assert.strictEqual(behavior.shape.customProp.type, 'STATIC');
      }

      // Do not short-circuit to DYNAMIC if property is a nested ZodObject or ZodArray
      const nestedSchema = z.object({
        value: z.object({
          nestedField: z.string().describe('REF:#/$defs/DynamicString'),
        }),
        text: z.array(z.string().describe('REF:#/$defs/DynamicString')),
      });
      const nestedBehavior = scrapeSchemaBehavior(nestedSchema);
      assert.strictEqual(nestedBehavior.type, 'OBJECT');
      if (nestedBehavior.type === 'OBJECT') {
        assert.strictEqual(nestedBehavior.shape.value.type, 'OBJECT');
        assert.strictEqual(nestedBehavior.shape.text.type, 'ARRAY');
      }
    });
  });

  describe('Static behavior for unannotated schemas', () => {
    it('should pass unannotated properties through as static values without guessing bindings', () => {
      const {catalog, surface} = setupSurfaceAndMocks();

      const unannotatedSchema = z.object({
        customProp: z.unknown(),
        items: z.unknown(),
        handleClick: z.unknown(),
      });

      const compModel = new ComponentModel(
        'c10',
        'Custom',
        {
          customProp: {path: '/rawTitle'},
          items: {componentId: 'card-view', path: '/cards'},
          handleClick: {
            event: {
              name: 'custom_click',
              context: {userId: {path: '/user/id'}},
            },
          },
        },
        catalog,
      );
      surface.componentsModel.addComponent(compModel);

      const context = new ComponentContext(surface, 'c10');
      const binder = new GenericBinder<Record<string, unknown>>(context, unannotatedSchema);

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

    it('does not create setter for literal path in v1.0, nor for @path in v0.9', () => {
      const mockCatalogV10 = new Catalog('test', '1.0', [], []);
      const surfaceV10 = new SurfaceModel('s1', mockCatalogV10);
      const compV10 = new ComponentModel(
        'c1',
        'Custom',
        {
          details: {path: '/secret'},
        },
        mockCatalogV10,
      );
      surfaceV10.componentsModel.addComponent(compV10);
      const contextV10 = new ComponentContext(surfaceV10, 'c1');
      const binderV10 = new GenericBinder<{details: unknown}>(
        contextV10,
        z.object({details: z.unknown()}),
      );
      assert.strictEqual('setDetails' in (binderV10.snapshot as Record<string, unknown>), false);

      const mockCatalogV09 = new Catalog('test', '0.9', [], []);
      const surfaceV09 = new SurfaceModel('s2', mockCatalogV09);
      const compV09 = new ComponentModel(
        'c2',
        'Custom',
        {
          details: {'@path': '/secret'},
        },
        mockCatalogV09,
      );
      surfaceV09.componentsModel.addComponent(compV09);
      const contextV09 = new ComponentContext(surfaceV09, 'c2');
      const binderV09 = new GenericBinder<{details: unknown}>(
        contextV09,
        z.object({details: z.unknown()}),
      );
      assert.strictEqual('setDetails' in (binderV09.snapshot as Record<string, unknown>), false);
    });
  });

  it('should support v1.0 ValidationResult objects and dynamic messages', async () => {
    const mockCatalog = new Catalog('test', '1.0', [], []);
    const surface = new SurfaceModel('s1', mockCatalog);
    (surface.defaultCatalog as any).functions = new Map([
      [
        'validate_email',
        {
          execute: (args: any) => {
            const ok = typeof args.val === 'string' && args.val.includes('@');
            return {
              valid: ok,
              message: ok ? undefined : 'Must contain @ symbol',
            };
          },
          schema: z.object({val: z.any()}),
        },
      ],
    ]);
    (surface.defaultCatalog as any).invoker = (name: string, args: any) => {
      const fn = (surface.defaultCatalog as any).functions.get(name);
      return fn.execute(args);
    };

    const schema = z.object({
      email: CommonSchemas.DynamicString,
      validationRules: z.array(CommonSchemas.CheckRule),
    });

    surface.dataModel.set('/email', 'invalid');
    const compModel = new ComponentModel(
      'c_val',
      'EmailInput',
      {
        email: {'@path': '/email'},
        validationRules: [
          {
            condition: {
              '@call': 'validate_email',
              args: {val: {'@path': '/email'}},
            },
          },
        ],
      },
      mockCatalog,
    );
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c_val');
    const binder = new GenericBinder<any>(context, schema);
    binder.subscribe(() => {});

    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Must contain @ symbol']);

    surface.dataModel.set('/email', 'user@domain.com');
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.strictEqual(binder.snapshot.isValid, true);
    assert.deepStrictEqual(binder.snapshot.validationErrors, []);
  });

  it('treats a check waiting on an agent call as pending, then valid or invalid when it settles', async () => {
    const catalog = new Catalog('test', '1.0', [], []);
    const surface = new SurfaceModel('s1', catalog);
    const answers: Array<{resolve: (v: unknown) => void; reject: (e: Error) => void}> = [];
    surface.agentFunctionCaller = () =>
      new Promise((resolve, reject) => answers.push({resolve, reject}));
    surface.dataModel.set('/val', 'a');
    const schema = z.object({
      field: CommonSchemas.DynamicString,
      checks: CommonSchemas.Checkable.shape.checks,
    });
    surface.componentsModel.addComponent(
      new ComponentModel(
        'c_remote',
        'Input',
        {
          field: 'val',
          checks: [
            {
              condition: {'@call': 'remoteCheck', args: {value: {'@path': '/val'}}},
              message: 'Rejected by the agent',
            },
          ],
        },
        catalog,
      ),
    );
    const binder = new GenericBinder<any>(new ComponentContext(surface, 'c_remote'), schema);
    let notifications = 0;
    binder.subscribe(() => notifications++);
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));

    assert.strictEqual(binder.snapshot.isValid, true, 'a pending check is not a failure');
    await flush();
    assert.strictEqual(answers.length, 1);
    answers[0].resolve(false);
    await flush();
    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Rejected by the agent']);
    assert.ok(notifications > 0);

    surface.dataModel.set('/val', 'b');
    assert.strictEqual(binder.snapshot.isValid, true, 'pending again while the new call runs');
    await flush();
    const before = notifications;
    answers[1].reject(new Error('agent down'));
    await flush();
    assert.strictEqual(binder.snapshot.isValid, false, 'a failed call makes the rule invalid');
    assert.ok(notifications > before, 'pending to failed notifies subscribers');
    binder.dispose();
  });

  it('should reset custom message to fallback message when subsequent evaluation returns boolean or no custom message', async () => {
    const mockCatalog = new Catalog('test', '1.0', [], []);
    const surface = new SurfaceModel('s1', mockCatalog);
    (surface.defaultCatalog as any).functions = new Map([
      [
        'dynamic_validator',
        {
          execute: (args: any) => {
            if (args.mode === 'custom_error') {
              return {valid: false, message: 'Custom dynamic error'};
            }
            if (args.mode === 'boolean_error') {
              return false;
            }
            if (args.mode === 'object_without_msg') {
              return {valid: false};
            }
            return true;
          },
          schema: z.object({mode: z.any()}),
        },
      ],
    ]);
    (surface.defaultCatalog as any).invoker = (name: string, args: any) => {
      const fn = (surface.defaultCatalog as any).functions.get(name);
      return fn.execute(args);
    };

    const schema = z.object({
      field: CommonSchemas.DynamicString,
      checks: CommonSchemas.Checkable.shape.checks,
    });

    surface.dataModel.set('/mode', 'custom_error');
    const compModel = new ComponentModel(
      'c_reset',
      'Input',
      {
        field: 'val',
        checks: [
          {
            condition: {
              '@call': 'dynamic_validator',
              args: {mode: {'@path': '/mode'}},
            },
          },
        ],
      },
      mockCatalog,
    );
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c_reset');
    const binder = new GenericBinder<any>(context, schema);
    binder.subscribe(() => {});

    // Initial evaluation with custom message
    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Custom dynamic error']);

    // Subsequent evaluation returning boolean false -> should reset to default message
    surface.dataModel.set('/mode', 'boolean_error');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Validation failed']);

    // Subsequent evaluation returning { valid: false } without message -> should reset to default message
    surface.dataModel.set('/mode', 'object_without_msg');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Validation failed']);

    // Subsequent evaluation returning true -> valid
    surface.dataModel.set('/mode', 'valid');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(binder.snapshot.isValid, true);
    assert.deepStrictEqual(binder.snapshot.validationErrors, []);
  });

  it('should give explicit CheckRule.message precedence over function message', async () => {
    const mockCatalog = new Catalog('test', '1.0', [], []);
    const surface = new SurfaceModel('s1', mockCatalog);
    (surface.defaultCatalog as any).functions = new Map([
      [
        'dynamic_validator',
        {
          execute: () => ({valid: false, message: 'Custom dynamic error'}),
          schema: z.object({}).passthrough(),
        },
      ],
    ]);
    (surface.defaultCatalog as any).invoker = (name: string, args: any) => {
      const fn = (surface.defaultCatalog as any).functions.get(name);
      return fn.execute(args);
    };

    const schema = z.object({
      field: CommonSchemas.DynamicString,
      checks: CommonSchemas.Checkable.shape.checks,
    });

    const compModel = new ComponentModel(
      'c_override',
      'Input',
      {
        field: 'val',
        checks: [
          {
            condition: {
              '@call': 'dynamic_validator',
            },
            message: 'Explicit rule message overrides function message',
          },
        ],
      },
      mockCatalog,
    );
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c_override');
    const binder = new GenericBinder<any>(context, schema);
    binder.subscribe(() => {});

    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, [
      'Explicit rule message overrides function message',
    ]);
  });

  it('should keep the data model message on a path-bound check and fall back to CheckRule.message', async () => {
    const mockCatalog = new Catalog('test', '1.0', [], []);
    const surface = new SurfaceModel('s1', mockCatalog);
    surface.dataModel.set('/check', {
      valid: false,
      code: 'FROM_DATA',
      message: 'Message from the data model',
    });

    const schema = z.object({
      field: CommonSchemas.DynamicString,
      checks: CommonSchemas.Checkable.shape.checks,
    });
    const compModel = new ComponentModel(
      'c_path_bound',
      'Input',
      {
        field: 'val',
        checks: [{condition: {'@path': '/check'}, message: 'Rule fallback message'}],
      },
      mockCatalog,
    );
    surface.componentsModel.addComponent(compModel);

    const binder = new GenericBinder<any>(new ComponentContext(surface, 'c_path_bound'), schema);
    binder.subscribe(() => {});

    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Message from the data model']);

    // Without a message in the data model, the rule message is the fallback.
    surface.dataModel.set('/check', {valid: false});
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Rule fallback message']);

    surface.dataModel.set('/check', false);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Rule fallback message']);
  });

  it('should not treat primitive fields or unannotated condition arrays as CHECKABLE', () => {
    const {catalog, surface} = setupSurfaceAndMocks();

    const schemaWithPrimitiveDesc = z.object({
      status: z.string().describe('The validation status of the transaction'),
      label: z.string().describe('Checkbox label to display'),
      unannotatedChecks: z.array(
        z.object({
          condition: z.string(),
        }),
      ),
    });

    const compModel = new ComponentModel(
      'c_primitive',
      'Card',
      {
        status: 'pending',
        label: 'Select all',
        unannotatedChecks: [{condition: 'some_expr'}],
      },
      catalog,
    );
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c_primitive');
    const binder = new GenericBinder<any>(context, schemaWithPrimitiveDesc);

    // Primitive fields and unannotated arrays should remain plain static fields and not inject validation props
    assert.strictEqual(binder.snapshot.status, 'pending');
    assert.strictEqual(binder.snapshot.label, 'Select all');
    assert.deepStrictEqual(binder.snapshot.unannotatedChecks, [{condition: 'some_expr'}]);
    assert.strictEqual(binder.snapshot.isValid, undefined);
    assert.strictEqual(binder.snapshot.validationErrors, undefined);
  });

  it('should unwrap ZodBranded and ZodLazy schemas and preserve outer wrapper descriptions', () => {
    // Outer description on optional wrapper
    const optionalAction = z.unknown().describe('REF:common_types.json#/$defs/Action').optional();
    assert.deepStrictEqual(scrapeSchemaBehavior(optionalAction), {type: 'ACTION'});

    // ZodBranded
    const brandedDynamic = z.string().describe('REF:#/$defs/DynamicString').brand<'CustomBrand'>();
    assert.deepStrictEqual(scrapeSchemaBehavior(brandedDynamic), {type: 'DYNAMIC'});

    // ZodLazy
    const lazyAction = z.lazy(() => z.unknown().describe('REF:#/$defs/Action'));
    assert.deepStrictEqual(scrapeSchemaBehavior(lazyAction), {type: 'ACTION'});

    // Checkable wrapped in optional
    const optionalCheckable = CommonSchemas.Checkable.shape.checks.optional();
    assert.deepStrictEqual(scrapeSchemaBehavior(optionalCheckable), {type: 'CHECKABLE'});

    // Union option with wrapped object shape containing ComponentId
    const componentIdSchema = z.string().describe('REF:common_types.json#/$defs/ComponentId');
    const templateChildOption = z
      .object({
        target: componentIdSchema,
        data: z.string().describe('REF:common_types.json#/$defs/DataBinding'),
      })
      .optional();
    const unionWithChild = z.union([z.array(z.string()), templateChildOption]);
    assert.deepStrictEqual(scrapeSchemaBehavior(unionWithChild), {type: 'STRUCTURAL'});
  });

  it('should identify dynamic union options only when shape has path property', () => {
    // Union with object containing path -> DYNAMIC
    const unionWithDynamicPath = z.union([
      z.string(),
      z.object({
        path: z.string(),
      }),
    ]);
    assert.deepStrictEqual(scrapeSchemaBehavior(unionWithDynamicPath), {type: 'DYNAMIC'});

    // Union with plain object without path or ComponentId -> STATIC
    const unionWithPlainObject = z.union([
      z.string(),
      z.object({
        label: z.string(),
        value: z.number(),
      }),
    ]);
    assert.deepStrictEqual(scrapeSchemaBehavior(unionWithPlainObject), {type: 'STATIC'});
  });

  it('treats a union option as an action only when its only key is event or functionCall', () => {
    const eventOption = z.object({event: z.object({name: z.string()})});
    const functionCallOption = z.object({functionCall: z.object({call: z.string()})});
    assert.deepStrictEqual(scrapeSchemaBehavior(z.union([z.string(), eventOption])), {
      type: 'ACTION',
    });
    assert.deepStrictEqual(scrapeSchemaBehavior(z.union([z.string(), functionCallOption])), {
      type: 'ACTION',
    });

    const labeledEvent = z.object({label: z.string(), event: z.string()});
    const labeledFunctionCall = z.object({label: z.string(), functionCall: z.string()});
    assert.deepStrictEqual(scrapeSchemaBehavior(z.union([z.string(), labeledEvent])), {
      type: 'STATIC',
    });
    assert.deepStrictEqual(scrapeSchemaBehavior(z.union([z.string(), labeledFunctionCall])), {
      type: 'STATIC',
    });
  });

  it('keeps event properties and list items with an event key as plain values', () => {
    const {catalog, surface} = setupSurfaceAndMocks();
    const schema = z.object({
      label: z.string(),
      event: z.string(),
      functionCall: z.string(),
      options: z.array(z.union([z.string(), z.object({label: z.string(), event: z.string()})])),
      onPick: z.union([
        z.object({event: z.object({name: z.string()})}),
        z.object({functionCall: z.object({call: z.string()})}),
      ]),
    });
    const compModel = new ComponentModel(
      'c_select',
      'Select',
      {
        label: 'Pick',
        event: 'picked',
        functionCall: 'pick',
        options: [{label: 'Red', event: 'red'}, 'Blue'],
        onPick: {event: {name: 'picked'}},
      },
      catalog,
    );
    surface.componentsModel.addComponent(compModel);

    const binder = new GenericBinder<Record<string, unknown>>(
      new ComponentContext(surface, 'c_select'),
      schema,
    );

    assert.strictEqual(binder.snapshot.label, 'Pick');
    assert.strictEqual(binder.snapshot.event, 'picked');
    assert.strictEqual(binder.snapshot.functionCall, 'pick');
    assert.deepStrictEqual(binder.snapshot.options, [{label: 'Red', event: 'red'}, 'Blue']);
    assert.strictEqual(typeof binder.snapshot.onPick, 'function');
  });

  it('scrapeSchemaBehavior returns the same tree for the same schema', () => {
    const schema = z.object({label: z.string()});
    assert.strictEqual(scrapeSchemaBehavior(schema), scrapeSchemaBehavior(schema));
  });

  describe('Resolved prop types', () => {
    type Props = ResolveA2uiProps<{
      action?: V1Action;
      items: {name?: string; title?: DynamicString; action?: V1Action}[];
      header?: {action: V1Action};
      checks?: V1CheckRule[];
      rule?: V1CheckRule;
      data?: Record<string, unknown>;
    }>;
    const props = {} as Props;

    it('types an action in a list item or an object as the function the binder makes', () => {
      const run: () => Promise<void> = async () => {};
      const item = {} as Props['items'][number];
      const fromItem: (() => Promise<void>) | undefined = item.action;
      const fromHeader: (() => Promise<void>) | undefined = props.header?.action;
      const topLevel: (() => Promise<void>) | undefined = props.action;
      const assigned: Props['items'][number] = {name: 'a', action: run, setTitle: () => {}};
      // @ts-expect-error a nested action is a function, not the raw action.
      const raw: Props['items'][number] = {action: {event: {name: 'x'}}, setTitle: () => {}};
      assert.deepStrictEqual(
        [fromItem, fromHeader, topLevel, raw.name],
        [undefined, undefined, undefined, undefined],
      );
      assert.strictEqual(assigned.action, run);
    });

    it('types a binding in a list item as its value, with a setter', () => {
      const item: Props['items'][number] = {title: 'Hello', setTitle: () => {}};
      const title: string | undefined = item.title;
      // @ts-expect-error a nested binding resolves to its value.
      const bound: Props['items'][number] = {title: {path: '/x'}, setTitle: () => {}};
      assert.deepStrictEqual([title, bound.name], ['Hello', undefined]);
    });

    it('leaves check rules and data objects as they are', () => {
      const checks: V1CheckRule[] | undefined = props.checks;
      const rule: Props['rule'] = {condition: {path: '/valid'}};
      const data: Record<string, unknown> | undefined = props.data;
      assert.deepStrictEqual(
        [checks, rule.condition, data],
        [undefined, {path: '/valid'}, undefined],
      );
    });

    it('types a list of strings as strings and a child list as child references', () => {
      type Lists = ResolveA2uiProps<{
        names?: string[];
        csp?: {domains?: string[]};
        children: ChildList;
      }>;
      const lists = {children: ['a', {id: 'b', basePath: '/'}]} as Lists;
      const names: readonly string[] | undefined = lists.names;
      const domains: readonly string[] | undefined = lists.csp?.domains;
      const children: (string | ResolvedChildRef)[] = lists.children;
      assert.deepStrictEqual([names, domains, children.length], [undefined, undefined, 2]);
    });
  });

  describe('Generated setter types', () => {
    it('keeps the setter callable for a property declared with no literal branch', () => {
      const bindingOnly: GenerateSetters<{value: DataBinding | FunctionCall}> = {
        setValue: () => {},
      };
      bindingOnly.setValue('anything');
      const value: unknown = {selected: true};
      bindingOnly.setValue(value);

      const dataBindingOnly: GenerateSetters<{value: DataBinding}> = {
        setValue: () => {},
      };
      dataBindingOnly.setValue('anything');

      const functionCallOnly: GenerateSetters<{value: FunctionCall}> = {
        setValue: () => {},
      };
      functionCallOnly.setValue('anything');

      const withLiteral: GenerateSetters<{value: string | DataBinding | FunctionCall}> = {
        setValue: () => {},
      };
      withLiteral.setValue('ok');
      // @ts-expect-error a literal branch must still constrain the setter.
      withLiteral.setValue(123);
    });
  });
});

describe('GenericBinder allowedCallers', () => {
  function setup(allowedCallers: 'agentOnly' | 'rendererOrAgent') {
    const calls: string[] = [];
    const lookup: FunctionImplementation = {
      name: 'lookup',
      returnType: 'string',
      schema: z.object({}),
      allowedCallers,
      execute: () => {
        calls.push('lookup');
        return 'secret';
      },
    };
    const isValid: FunctionImplementation = {
      name: 'isValid',
      returnType: 'boolean',
      schema: z.object({}),
      allowedCallers,
      execute: () => {
        calls.push('isValid');
        return true;
      },
    };
    const catalog = new Catalog('test', '1.0', [], [lookup, isValid]);
    const surface = new SurfaceModel('s1', catalog);
    const errors: Array<{code: string; message: string; expression?: string}> = [];
    surface.onError.subscribe(err => {
      errors.push(err);
    });

    const schema = z.object({
      text: CommonSchemas.DynamicString,
      checks: CommonSchemas.Checkable.shape.checks,
      onTap: CommonSchemas.Action,
    });
    surface.componentsModel.addComponent(
      new ComponentModel(
        'c1',
        'Test',
        {
          text: {'@call': 'lookup', args: {}},
          checks: [{condition: {'@call': 'isValid', args: {}}, message: 'Invalid'}],
          onTap: {functionCall: {'@call': 'lookup', args: {}}},
        },
        catalog,
      ),
    );
    const binder = new GenericBinder<{text?: string; isValid?: boolean; onTap: () => void}>(
      new ComponentContext(surface, 'c1'),
      schema,
    );
    binder.subscribe(() => {});
    return {binder, calls, errors};
  }

  it('refuses agentOnly functions in bindings, checks and actions without running them', () => {
    const {binder, calls, errors} = setup('agentOnly');

    assert.strictEqual(binder.snapshot.text, undefined);
    assert.deepStrictEqual(new Set(errors.map(e => e.expression)), new Set(['lookup', 'isValid']));
    const errorsBeforeTap = errors.length;
    binder.snapshot.onTap();
    assert.strictEqual(errors.length, errorsBeforeTap + 1);

    assert.deepStrictEqual(calls, []);
    for (const err of errors) {
      assert.strictEqual(err.code, 'EXPRESSION_ERROR');
      assert.match(err.message, /cannot be called by renderer \(allowedCallers is agentOnly\)/);
    }
    binder.dispose();
  });

  it('runs rendererOrAgent functions in bindings, checks and actions', () => {
    const {binder, calls, errors} = setup('rendererOrAgent');

    assert.strictEqual(binder.snapshot.text, 'secret');
    assert.strictEqual(binder.snapshot.isValid, true);
    assert.ok(calls.includes('isValid'));
    const callsBeforeTap = calls.length;
    binder.snapshot.onTap();
    assert.deepStrictEqual(calls.slice(callsBeforeTap), ['lookup']);
    assert.deepStrictEqual(errors, []);
    binder.dispose();
  });
});

describe('getSafeChildList helper function', () => {
  it('returns an empty array for non-array or nullish inputs', () => {
    assert.deepStrictEqual(getSafeChildList(null), []);
    assert.deepStrictEqual(getSafeChildList(undefined), []);
    assert.deepStrictEqual(getSafeChildList('string'), []);
    assert.deepStrictEqual(getSafeChildList(123), []);
    assert.deepStrictEqual(getSafeChildList({}), []);
  });

  it('returns the same array if length is within MAX_DYNAMIC_CHILD_LIST_SIZE', () => {
    const list = [1, 2, 3];
    assert.deepStrictEqual(getSafeChildList(list), [1, 2, 3]);
  });

  it('slices array to MAX_DYNAMIC_CHILD_LIST_SIZE if length exceeds the limit', () => {
    const largeList = Array.from({length: 15_000}, (_, i) => i);
    const safe = getSafeChildList(largeList);
    assert.strictEqual(safe.length, MAX_DYNAMIC_CHILD_LIST_SIZE);
    assert.strictEqual(safe[0], 0);
    assert.strictEqual(safe[MAX_DYNAMIC_CHILD_LIST_SIZE - 1], MAX_DYNAMIC_CHILD_LIST_SIZE - 1);
  });

  it('does not coerce non-boolean values on polymorphic dynamic unions containing ZodBoolean', () => {
    const polySchema = z.object({
      id: z.string(),
      component: z.literal('Poly'),
      val: z.union([z.string(), z.boolean(), DataBindingSchema]),
    });
    const catalog = new Catalog('poly', [{name: 'Poly', schema: polySchema}], []);
    const surface = new SurfaceModel('s1', catalog, {});
    surface.dataModel.set('/v', 'hello');
    surface.componentsModel.addComponent(
      new ComponentModel('c1', 'Poly', {val: {path: '/v'}}, catalog),
    );
    const binder = new GenericBinder<{val: string | boolean}>(
      new ComponentContext(surface, 'c1'),
      polySchema,
    );
    assert.strictEqual(binder.snapshot.val, 'hello');
    binder.dispose();
  });
});

describe('GenericBinder omitted property pruning on update (#3779)', () => {
  it('prunes omitted scalar, nested object, array, dynamic-bound, and action properties while preserving dynamic setters', async () => {
    const catalog = new Catalog('test', '0.9', [], []);
    const surface = new SurfaceModel('s1', catalog);
    surface.dataModel.set('/val', 'initial-val');
    surface.dataModel.set('/a11yLabel', 'Save');

    const schema = z.object({
      variant: z.string().optional(),
      tags: z.array(z.string()).optional(),
      accessibility: z
        .object({
          label: CommonSchemas.DynamicString.optional(),
          description: z.string().optional(),
        })
        .optional(),
      value: CommonSchemas.DynamicString.optional(),
      onTap: CommonSchemas.Action.optional(),
      keepAction: CommonSchemas.Action.optional(),
    });

    const compModel = new ComponentModel(
      'c1',
      'Widget',
      {
        variant: 'primary',
        tags: ['alpha', 'beta'],
        accessibility: {
          label: {path: '/a11yLabel'},
          description: 'Submit the form',
        },
        value: {path: '/val'},
        onTap: {event: {name: 'tap_evt'}},
        keepAction: {event: {name: 'keep_evt'}},
      },
      catalog,
    );
    surface.componentsModel.addComponent(compModel);

    const binder = new GenericBinder<{
      variant?: string;
      tags?: string[];
      accessibility?: {
        label?: string;
        setLabel: (v: string) => void;
        description?: string;
      };
      value?: string;
      setValue: (v: string) => void;
      onTap?: () => Promise<void>;
      keepAction?: () => Promise<void>;
    }>(new ComponentContext(surface, 'c1'), schema);

    let notifications = 0;
    const sub = binder.subscribe(() => {
      notifications++;
    });

    const initialTapClosure = binder.snapshot.onTap;
    const initialKeepClosure = binder.snapshot.keepAction;
    assert.strictEqual(typeof initialTapClosure, 'function');
    assert.strictEqual(typeof initialKeepClosure, 'function');
    assert.strictEqual(binder.snapshot.variant, 'primary');
    assert.deepStrictEqual(binder.snapshot.tags, ['alpha', 'beta']);
    assert.strictEqual(binder.snapshot.value, 'initial-val');
    assert.strictEqual(binder.snapshot.accessibility?.label, 'Save');
    assert.strictEqual(binder.snapshot.accessibility?.description, 'Submit the form');

    // Update omitting variant, tags, accessibility.description, value, and onTap
    compModel.properties = {
      accessibility: {
        label: {path: '/a11yLabel'},
      },
      keepAction: {event: {name: 'keep_evt'}},
    };

    assert.strictEqual(Object.hasOwn(binder.snapshot, 'variant'), false);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'tags'), false);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'value'), false);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'onTap'), false);
    assert.ok(binder.snapshot.accessibility);
    assert.strictEqual(Object.hasOwn(binder.snapshot.accessibility, 'description'), false);
    assert.strictEqual(binder.snapshot.accessibility.label, 'Save');

    // Dynamic setter remains intact and becomes a safe no-op when omitted
    assert.strictEqual(typeof binder.snapshot.setValue, 'function');
    binder.snapshot.setValue('should-not-write');
    assert.strictEqual(surface.dataModel.get('/val'), 'initial-val');

    // Unchanged action keeps closure identity
    assert.strictEqual(binder.snapshot.keepAction, initialKeepClosure);

    // Updating the old bound path does not notify or resurrect the omitted property
    const notificationsBeforeDataWrite = notifications;
    surface.dataModel.set('/val', 'updated-val');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(notifications, notificationsBeforeDataWrite);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'value'), false);

    // Re-adding onTap creates a new closure because the omitted one was evicted
    compModel.properties = {
      onTap: {event: {name: 'tap_evt'}},
      keepAction: {event: {name: 'keep_evt'}},
    };
    assert.strictEqual(typeof binder.snapshot.onTap, 'function');
    assert.notStrictEqual(binder.snapshot.onTap, initialTapClosure);
    assert.strictEqual(binder.snapshot.keepAction, initialKeepClosure);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'accessibility'), false);

    // Updating /a11yLabel after omitting accessibility does not notify or resurrect it
    const notificationsBeforeA11yWrite = notifications;
    surface.dataModel.set('/a11yLabel', 'Cancel');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(notifications, notificationsBeforeA11yWrite);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'accessibility'), false);

    sub.unsubscribe();
    surface.dispose();
  });

  it('preserves top-level, nested, and array-of-object checkable validation state when checks remain and prunes it when omitted', async () => {
    const required: FunctionImplementation = {
      name: 'required',
      returnType: 'boolean',
      schema: z.object({value: z.unknown()}),
      execute: (args: Record<string, unknown>) => Boolean(args.value),
    };
    const catalog = new Catalog('test-v1', '1.0', [], [required]);
    const surface = new SurfaceModel('s1', catalog);
    surface.dataModel.set('/v', '');

    const schema = z.object({
      value: CommonSchemas.DynamicString.optional(),
      extra: z.string().optional(),
      checks: CommonSchemas.Checkable.shape.checks,
      nested: z
        .object({
          checks: CommonSchemas.Checkable.shape.checks,
        })
        .optional(),
      items: z
        .array(
          z.object({
            checks: CommonSchemas.Checkable.shape.checks,
          }),
        )
        .optional(),
    });

    const checkRule = (message: string) => [
      {
        condition: {'@call': 'required', args: {value: {'@path': '/v'}}},
        message,
      },
    ];

    const compModel = new ComponentModel(
      'c1',
      'ValidatedInput',
      {
        value: {'@path': '/v'},
        extra: 'temporary',
        checks: checkRule('Top required'),
        nested: {
          checks: checkRule('Nested required'),
        },
        items: [{checks: checkRule('Item 0 required')}],
      },
      catalog,
    );
    surface.componentsModel.addComponent(compModel);

    const binder = new GenericBinder<Record<string, unknown>>(
      new ComponentContext(surface, 'c1'),
      schema,
    );

    // Synchronous initial snapshot includes top-level, nested, and array-element validation state
    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Top required']);
    assert.strictEqual((binder.snapshot.nested as Record<string, unknown>).isValid, false);
    assert.deepStrictEqual((binder.snapshot.nested as Record<string, unknown>).validationErrors, [
      'Nested required',
    ]);
    const initialItems = binder.snapshot.items as Record<string, unknown>[];
    assert.strictEqual(initialItems[0].isValid, false);
    assert.deepStrictEqual(initialItems[0].validationErrors, ['Item 0 required']);

    const sub = binder.subscribe(() => {});

    // Component update omitting `extra` preserves validation state while `checks` remain
    compModel.properties = {
      value: {'@path': '/v'},
      checks: checkRule('Top required'),
      nested: {
        checks: checkRule('Nested required'),
      },
      items: [{checks: checkRule('Item 0 required')}],
    };
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'extra'), false);
    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Top required']);
    assert.strictEqual((binder.snapshot.nested as Record<string, unknown>).isValid, false);
    assert.deepStrictEqual((binder.snapshot.nested as Record<string, unknown>).validationErrors, [
      'Nested required',
    ]);
    const updatedItems = binder.snapshot.items as Record<string, unknown>[];
    assert.strictEqual(updatedItems[0].isValid, false);
    assert.deepStrictEqual(updatedItems[0].validationErrors, ['Item 0 required']);

    // Reactive data update updates top-level, nested, and array-element validation state
    surface.dataModel.set('/v', 'non-empty');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(binder.snapshot.isValid, true);
    assert.deepStrictEqual(binder.snapshot.validationErrors, []);
    assert.deepStrictEqual(binder.snapshot.validationResults, []);
    assert.strictEqual((binder.snapshot.nested as Record<string, unknown>).isValid, true);
    assert.deepStrictEqual(
      (binder.snapshot.nested as Record<string, unknown>).validationErrors,
      [],
    );
    const reactiveItems = binder.snapshot.items as Record<string, unknown>[];
    assert.strictEqual(reactiveItems[0].isValid, true);
    assert.deepStrictEqual(reactiveItems[0].validationErrors, []);

    // Component update omitting `checks`, `nested`, `items`, and `value` clears validation state
    compModel.properties = {};
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'value'), false);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'checks'), false);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'isValid'), false);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'validationErrors'), false);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'validationResults'), false);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'nested'), false);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'items'), false);

    // Subsequent updates to /v do not resurrect validation state or value
    surface.dataModel.set('/v', '');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'isValid'), false);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'validationErrors'), false);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'validationResults'), false);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'value'), false);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'items'), false);

    sub.unsubscribe();
    surface.dispose();
  });

  it('prunes omitted properties for STATIC schemas without aliasing componentModel.properties', () => {
    const catalog = new Catalog('test-static', '0.9', [], []);
    const surface = new SurfaceModel('s1', catalog);
    const compModel = new ComponentModel('c1', 'OpenBox', {a: 1, b: 2}, catalog);
    surface.componentsModel.addComponent(compModel);

    const binder = new GenericBinder<Record<string, unknown>>(
      new ComponentContext(surface, 'c1'),
      z.record(z.unknown()),
    );

    assert.notStrictEqual(binder.snapshot, compModel.properties);
    assert.deepStrictEqual(binder.snapshot, {a: 1, b: 2});

    const sub = binder.subscribe(() => {});
    compModel.properties = {a: 1};

    assert.notStrictEqual(binder.snapshot, compModel.properties);
    assert.deepStrictEqual(binder.snapshot, {a: 1});
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'b'), false);

    sub.unsubscribe();
    surface.dispose();
  });

  it('terminates cleanly on recursive z.lazy schemas in scrapeSchemaBehavior', () => {
    const RecArray: z.ZodTypeAny = z.lazy(() => z.array(RecArray));
    assert.deepStrictEqual(scrapeSchemaBehavior(RecArray), {
      type: 'ARRAY',
      element: {type: 'STATIC'},
    });

    const RecOptional: z.ZodTypeAny = z.lazy(() => RecOptional.optional());
    assert.deepStrictEqual(scrapeSchemaBehavior(RecOptional), {type: 'STATIC'});

    const RecObject: z.ZodTypeAny = z.lazy(() =>
      z.object({
        label: CommonSchemas.DynamicString,
        next: RecObject.optional(),
      }),
    );
    const scrapedObj = scrapeSchemaBehavior(RecObject);
    assert.strictEqual(scrapedObj.type, 'OBJECT');
    if (scrapedObj.type === 'OBJECT') {
      assert.deepStrictEqual(scrapedObj.shape.label, {type: 'DYNAMIC'});
      assert.deepStrictEqual(scrapedObj.shape.next, {type: 'STATIC'});
    }

    const RecPipe: z.ZodTypeAny = z.lazy(() => RecPipe.pipe(z.boolean()));
    const scrapedRecPipe = scrapeSchemaBehavior(
      z.object({flag: z.union([CommonSchemas.DataBinding, RecPipe])}),
    );
    assert.strictEqual(scrapedRecPipe.type, 'OBJECT');
    if (scrapedRecPipe.type === 'OBJECT') {
      assert.deepStrictEqual(scrapedRecPipe.shape.flag, {type: 'DYNAMIC', isBoolean: true});
    }
  });

  it('binds dynamic, action, and structural properties across ZodIntersection, ZodPipeline, ZodCatch, and object-variant unions', () => {
    const componentIdSchema = z.string().describe('REF:common_types.json#/$defs/ComponentId');
    assert.deepStrictEqual(scrapeSchemaBehavior(CommonSchemas.ChildList.and(z.number())), {
      type: 'STATIC',
    });
    assert.deepStrictEqual(scrapeSchemaBehavior(CommonSchemas.ChildList.pipe(z.number())), {
      type: 'STATIC',
    });
    assert.deepStrictEqual(
      scrapeSchemaBehavior(z.union([componentIdSchema, CommonSchemas.ChildList]).and(z.string())),
      {type: 'STATIC'},
    );
    assert.deepStrictEqual(scrapeSchemaBehavior(CommonSchemas.ChildList.and(z.array(z.string()))), {
      type: 'STRUCTURAL',
    });

    const variantUnionSchema = z.discriminatedUnion('mode', [
      z.object({
        mode: z.literal('card'),
        title: CommonSchemas.DynamicString.catch('fallback').pipe(z.any()),
        child: componentIdSchema,
      }),
      z.object({
        mode: z.literal('list'),
        title: CommonSchemas.DynamicString,
        children: CommonSchemas.ChildList,
      }),
    ]);

    const scrapedVariant = scrapeSchemaBehavior(variantUnionSchema);
    assert.strictEqual(scrapedVariant.type, 'OBJECT');

    const scrapedOpenRecord = scrapeSchemaBehavior(z.record(z.unknown()));
    assert.strictEqual(scrapedOpenRecord.type, 'OBJECT');
    if (scrapedOpenRecord.type === 'OBJECT') {
      assert.deepStrictEqual(scrapedOpenRecord.shape.children, {type: 'STRUCTURAL'});
      assert.strictEqual(scrapedOpenRecord.shape.accessibility?.type, 'OBJECT');
    }

    const scrapedNumericRecord = scrapeSchemaBehavior(z.record(z.number()));
    assert.strictEqual(scrapedNumericRecord.type, 'OBJECT');
    if (scrapedNumericRecord.type === 'OBJECT') {
      assert.strictEqual(Object.hasOwn(scrapedNumericRecord.shape, 'children'), false);
      assert.strictEqual(scrapedNumericRecord.shape.accessibility?.type, 'OBJECT');
    }

    const compositeSchema = z
      .object({
        subtitle: CommonSchemas.DynamicString.optional(),
      })
      .and(variantUnionSchema)
      .and(
        z.object({
          onPress: CommonSchemas.Action.optional(),
        }),
      );

    const catalog = new Catalog('test-composite', '0.9', [], []);
    const surface = new SurfaceModel('s1', catalog);
    surface.dataModel.set('/heading', 'Bound Heading');
    surface.dataModel.set('/sub', 'Bound Sub');
    surface.dataModel.set('/items', [{name: 'A'}, {name: 'B'}]);

    const dispatched: unknown[] = [];
    surface.onAction.subscribe(evt => {
      dispatched.push(evt);
    });

    const compModel = new ComponentModel(
      'c1',
      'CompositeCard',
      {
        mode: 'list',
        title: {path: '/heading'},
        subtitle: {path: '/sub'},
        children: {componentId: 'item-tpl', path: '/items'},
        onPress: {event: {name: 'tap'}},
        accessibility: {label: {path: '/heading'}},
      },
      catalog,
    );
    surface.componentsModel.addComponent(compModel);

    const binder = new GenericBinder<Record<string, unknown>>(
      new ComponentContext(surface, 'c1'),
      compositeSchema,
    );
    const sub = binder.subscribe(() => {});

    assert.strictEqual(binder.snapshot.title, 'Bound Heading');
    assert.strictEqual(binder.snapshot.subtitle, 'Bound Sub');
    assert.deepStrictEqual(binder.snapshot.children, [
      {id: 'item-tpl', basePath: '/items/0'},
      {id: 'item-tpl', basePath: '/items/1'},
    ]);
    assert.deepStrictEqual(binder.snapshot.accessibility, {
      label: 'Bound Heading',
      setLabel: (binder.snapshot.accessibility as Record<string, unknown>).setLabel,
      setDescription: (binder.snapshot.accessibility as Record<string, unknown>).setDescription,
      setHidden: (binder.snapshot.accessibility as Record<string, unknown>).setHidden,
    });
    assert.strictEqual(typeof binder.snapshot.onPress, 'function');
    (binder.snapshot.onPress as () => void)();
    assert.strictEqual(dispatched.length, 1);

    sub.unsubscribe();
    surface.dispose();
  });

  it('preserves DYNAMIC, ACTION, and CHECKABLE behaviors in object-variant unions paired with static variants and handles composite ZodRecord schemas', () => {
    const mixedVariantSchema = z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('interactive'),
        label: CommonSchemas.DynamicString,
        onSelect: CommonSchemas.Action,
        checks: CommonSchemas.Checkable.shape.checks,
      }),
      z.object({
        kind: z.literal('plain'),
        label: z.string(),
        onSelect: z.string().optional(),
        checks: z.string().optional(),
      }),
    ]);

    const recordInIntersection = z
      .object({heading: CommonSchemas.DynamicString.optional()})
      .and(z.record(z.unknown()));
    const recordInPipeline = z.record(z.unknown()).pipe(z.record(z.unknown()));
    const recordInUnion = z.union([
      z.object({mode: z.literal('typed'), heading: CommonSchemas.DynamicString}),
      z.record(z.unknown()),
    ]);

    for (const recSchema of [recordInIntersection, recordInPipeline, recordInUnion]) {
      const scraped = scrapeSchemaBehavior(recSchema);
      assert.strictEqual(scraped.type, 'OBJECT');
      if (scraped.type === 'OBJECT') {
        assert.deepStrictEqual(scraped.shape.children, {type: 'STRUCTURAL'});
        assert.strictEqual(scraped.shape.accessibility?.type, 'OBJECT');
      }
    }

    const catalog = new Catalog('test-mixed-union', '0.9', [], []);
    const surface = new SurfaceModel('s-mixed', catalog);
    surface.dataModel.set('/label', 'Dynamic Label');
    surface.dataModel.set('/validFlag', false);
    surface.dataModel.set('/rows', [{id: 1}, {id: 2}]);

    const dispatched: unknown[] = [];
    surface.onAction.subscribe(evt => {
      dispatched.push(evt);
    });

    const compModel = new ComponentModel(
      'c-mixed',
      'MixedVariant',
      {
        kind: 'interactive',
        label: {path: '/label'},
        onSelect: {event: {name: 'choose'}},
        checks: [{condition: {path: '/validFlag'}, message: 'Must be valid'}],
      },
      catalog,
    );
    surface.componentsModel.addComponent(compModel);

    const binder = new GenericBinder<Record<string, unknown>>(
      new ComponentContext(surface, 'c-mixed'),
      mixedVariantSchema,
    );
    const sub = binder.subscribe(() => {});

    assert.strictEqual(binder.snapshot.label, 'Dynamic Label');
    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Must be valid']);
    assert.strictEqual(typeof binder.snapshot.onSelect, 'function');
    (binder.snapshot.onSelect as () => void)();
    assert.strictEqual(dispatched.length, 1);

    // Switching to the static variant passes static scalars through without wrapping or mutating isValid.
    compModel.properties = {
      kind: 'plain',
      label: 'Literal Label',
      onSelect: 'noop-tag',
      checks: 'skip',
    };
    assert.strictEqual(binder.snapshot.label, 'Literal Label');
    assert.strictEqual(binder.snapshot.onSelect, 'noop-tag');
    assert.strictEqual(binder.snapshot.checks, 'skip');
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'isValid'), false);

    // Verify composite ZodRecord union binds both dynamic variant properties and open template children.
    const recCompModel = new ComponentModel(
      'c-rec-union',
      'RecUnion',
      {
        mode: 'typed',
        heading: {path: '/label'},
        children: {componentId: 'row-tpl', path: '/rows'},
      },
      catalog,
    );
    surface.componentsModel.addComponent(recCompModel);
    const recBinder = new GenericBinder<Record<string, unknown>>(
      new ComponentContext(surface, 'c-rec-union'),
      recordInUnion,
    );
    assert.strictEqual(recBinder.snapshot.heading, 'Dynamic Label');
    assert.deepStrictEqual(recBinder.snapshot.children, [
      {id: 'row-tpl', basePath: '/rows/0'},
      {id: 'row-tpl', basePath: '/rows/1'},
    ]);

    sub.unsubscribe();
    recBinder.dispose();
    surface.dispose();
  });

  it('binds dynamic and action schemas on ZodRecord, .catchall(), composite intersections/unions, and chained .or() unions', () => {
    const catchallDynamicSchema = z
      .object({
        staticKey: z.string(),
        chainedDynamic: z
          .object({path: z.string()})
          .or(z.object({call: z.string()}))
          .or(z.string())
          .optional(),
      })
      .catchall(CommonSchemas.DynamicString);

    const recordActionSchema = z.record(CommonSchemas.Action);
    const compositeCatchallSchema = z
      .object({id: z.string()})
      .passthrough()
      .and(z.record(CommonSchemas.DynamicString));
    const unionCatchallSchema = z.union([
      z.record(CommonSchemas.DynamicString),
      z.object({fixed: CommonSchemas.Action}),
    ]);

    const scrapedCatchall = scrapeSchemaBehavior(catchallDynamicSchema);
    assert.strictEqual(scrapedCatchall.type, 'OBJECT');
    if (scrapedCatchall.type === 'OBJECT') {
      assert.deepStrictEqual(scrapedCatchall.shape.staticKey, {type: 'STATIC'});
      assert.deepStrictEqual(scrapedCatchall.shape.chainedDynamic, {type: 'DYNAMIC'});
      assert.deepStrictEqual(scrapedCatchall.catchall, {type: 'DYNAMIC'});
    }

    const scrapedComposite = scrapeSchemaBehavior(compositeCatchallSchema);
    assert.strictEqual(scrapedComposite.type, 'OBJECT');
    if (scrapedComposite.type === 'OBJECT') {
      assert.deepStrictEqual(scrapedComposite.shape.id, {type: 'DYNAMIC'});
      assert.deepStrictEqual(scrapedComposite.catchall, {type: 'DYNAMIC'});
    }
    const scrapedCompositeReversed = scrapeSchemaBehavior(
      z.record(CommonSchemas.DynamicString).and(z.object({id: z.string()}).passthrough()),
    );
    assert.deepStrictEqual(scrapedCompositeReversed, scrapedComposite);

    const scrapedUnion = scrapeSchemaBehavior(unionCatchallSchema);
    assert.strictEqual(scrapedUnion.type, 'OBJECT');
    if (scrapedUnion.type === 'OBJECT') {
      assert.deepStrictEqual(scrapedUnion.catchall, {type: 'DYNAMIC'});
    }

    const catalog = new Catalog('test-catchall-binder', '0.9', [], []);
    const surface = new SurfaceModel('s-catchall', catalog);
    surface.dataModel.set('/dyn', 'Hello Catchall');
    surface.dataModel.set('/chained', 'Chained Value');

    const dispatched: unknown[] = [];
    surface.onAction.subscribe(evt => {
      dispatched.push(evt);
    });

    const compModel = new ComponentModel(
      'c-catchall',
      'CatchallCard',
      {
        staticKey: 'keep-static',
        chainedDynamic: {path: '/chained'},
        customBound: {path: '/dyn'},
        customLiteral: 'plain-text',
      },
      catalog,
    );
    surface.componentsModel.addComponent(compModel);

    const binder = new GenericBinder<Record<string, unknown>>(
      new ComponentContext(surface, 'c-catchall'),
      catchallDynamicSchema,
    );
    const sub = binder.subscribe(() => {});

    assert.strictEqual(binder.snapshot.staticKey, 'keep-static');
    assert.strictEqual(binder.snapshot.chainedDynamic, 'Chained Value');
    assert.strictEqual(binder.snapshot.customBound, 'Hello Catchall');
    assert.strictEqual(binder.snapshot.customLiteral, 'plain-text');
    assert.strictEqual(typeof binder.snapshot.setCustomBound, 'function');
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'setCustomLiteral'), false);
    assert.strictEqual(Object.hasOwn(binder.snapshot, 'setStaticKey'), false);

    // Invoking synthesized catchall setter updates dataModel and reactively updates snapshot.
    (binder.snapshot.setCustomBound as (v: unknown) => void)('Updated Catchall');
    assert.strictEqual(surface.dataModel.get('/dyn'), 'Updated Catchall');
    assert.strictEqual(binder.snapshot.customBound, 'Updated Catchall');

    // Action record binds arbitrary action keys into dispatch closures.
    const actionComp = new ComponentModel(
      'c-act-rec',
      'ActionRecord',
      {
        onSave: {event: {name: 'save'}},
        onCancel: {event: {name: 'cancel'}},
      },
      catalog,
    );
    surface.componentsModel.addComponent(actionComp);
    const actionBinder = new GenericBinder<Record<string, unknown>>(
      new ComponentContext(surface, 'c-act-rec'),
      recordActionSchema,
    );
    const actionSub = actionBinder.subscribe(() => {});
    assert.strictEqual(typeof actionBinder.snapshot.onSave, 'function');
    assert.strictEqual(typeof actionBinder.snapshot.onCancel, 'function');
    (actionBinder.snapshot.onSave as () => void)();
    (actionBinder.snapshot.onCancel as () => void)();
    assert.strictEqual(dispatched.length, 2);

    sub.unsubscribe();
    actionSub.unsubscribe();
    surface.dispose();
  });

  it('forwards ChildRefAnalysisOptions in scrapeSchemaBehavior, scrapeComponentBehavior, and GenericBinder with isolated caches', () => {
    const customListSchema = z.object({
      customChildren: z
        .unknown()
        .describe('REF:#/$defs/CustomChildList|Custom list ref')
        .optional(),
    });
    const customOptions = {
      childRefNames: new Set(['ComponentId']),
      childListRefNames: new Set(['CustomChildList']),
    };

    const defaultBehavior = scrapeSchemaBehavior(customListSchema);
    const customBehavior = scrapeSchemaBehavior(customListSchema, customOptions);
    assert.strictEqual(defaultBehavior.type, 'OBJECT');
    assert.strictEqual(customBehavior.type, 'OBJECT');
    if (defaultBehavior.type === 'OBJECT' && customBehavior.type === 'OBJECT') {
      assert.deepStrictEqual(defaultBehavior.shape.customChildren, {type: 'STATIC'});
      assert.deepStrictEqual(customBehavior.shape.customChildren, {type: 'STRUCTURAL'});
    }

    const defaultCompBehavior = scrapeComponentBehavior(customListSchema);
    const customCompBehavior = scrapeComponentBehavior(customListSchema, customOptions);
    assert.notStrictEqual(defaultCompBehavior, customCompBehavior);
    if (defaultCompBehavior.type === 'OBJECT' && customCompBehavior.type === 'OBJECT') {
      assert.deepStrictEqual(defaultCompBehavior.shape.customChildren, {type: 'STATIC'});
      assert.deepStrictEqual(customCompBehavior.shape.customChildren, {type: 'STRUCTURAL'});
    }

    const catalog = new Catalog('custom-opts-cat', '0.9', [], []);
    const surface = new SurfaceModel('s-opts', catalog);
    surface.dataModel.set('/items', [{name: 'A'}, {name: 'B'}]);
    const comp = new ComponentModel(
      'c-opts',
      'CustomContainer',
      {customChildren: {componentId: 'kid-tpl', path: '/items'}},
      catalog,
    );
    surface.componentsModel.addComponent(comp);

    const defaultBinder = new GenericBinder<Record<string, unknown>>(
      new ComponentContext(surface, 'c-opts'),
      customListSchema,
    );
    const customBinder = new GenericBinder<Record<string, unknown>>(
      new ComponentContext(surface, 'c-opts'),
      customListSchema,
      customOptions,
    );
    assert.deepStrictEqual(defaultBinder.snapshot.customChildren, {
      componentId: 'kid-tpl',
      path: '/items',
    });
    assert.deepStrictEqual(customBinder.snapshot.customChildren, [
      {id: 'kid-tpl', basePath: '/items/0'},
      {id: 'kid-tpl', basePath: '/items/1'},
    ]);

    defaultBinder.dispose();
    customBinder.dispose();
    surface.dispose();
  });

  it('binds explicit keys intersected with a dynamic catchall, expands [list, nested] union templates, and re-exports scrapeComponentBehavior', async () => {
    const resolutionBarrel = await import('./index.js');
    const rootBarrel = await import('../index.js');
    assert.strictEqual(resolutionBarrel.scrapeComponentBehavior, scrapeComponentBehavior);
    assert.strictEqual(rootBarrel.scrapeComponentBehavior, scrapeComponentBehavior);

    const compositeCatchallSchema = z
      .object({id: z.string()})
      .passthrough()
      .and(z.record(CommonSchemas.DynamicString));

    const structuredItems = z.array(
      z.object({
        title: CommonSchemas.DynamicString,
        child: CommonSchemas.ComponentId,
      }),
    );
    const objUnionListFirst = z.union([
      z.object({sections: CommonSchemas.ChildList}),
      z.object({sections: structuredItems}),
    ]);
    const objUnionNestedFirst = z.union([
      z.object({sections: structuredItems}),
      z.object({sections: CommonSchemas.ChildList}),
    ]);
    const propUnionSchema = z.object({
      sections: CommonSchemas.ChildList.or(structuredItems),
    });

    assert.deepStrictEqual(
      scrapeComponentBehavior(objUnionListFirst),
      scrapeComponentBehavior(objUnionNestedFirst),
    );

    const catalog = new Catalog('union-catchall-cat', '0.9', [], []);
    const surface = new SurfaceModel('s-union-catchall', catalog);
    surface.dataModel.set('/dynId', 'resolved-id-42');
    surface.dataModel.set('/extra', 'extra-val');
    surface.dataModel.set('/secTitle', 'Bound Section');
    surface.dataModel.set('/rows', [{label: 'One'}, {label: 'Two'}]);

    surface.componentsModel.addComponent(
      new ComponentModel(
        'c-comp-catchall',
        'CompositeCatchall',
        {id: {path: '/dynId'}, extra: {path: '/extra'}},
        catalog,
      ),
    );
    const compositeBinder = new GenericBinder<Record<string, unknown>>(
      new ComponentContext(surface, 'c-comp-catchall'),
      compositeCatchallSchema,
    );
    const compositeSub = compositeBinder.subscribe(() => {});
    assert.strictEqual(compositeBinder.snapshot.id, 'resolved-id-42');
    assert.strictEqual(compositeBinder.snapshot.extra, 'extra-val');
    assert.strictEqual(typeof compositeBinder.snapshot.setId, 'function');
    (compositeBinder.snapshot.setId as (v: unknown) => void)('updated-id-99');
    assert.strictEqual(surface.dataModel.get('/dynId'), 'updated-id-99');
    assert.strictEqual(compositeBinder.snapshot.id, 'updated-id-99');

    for (const [idx, schema] of [
      objUnionListFirst,
      objUnionNestedFirst,
      propUnionSchema,
    ].entries()) {
      const tplId = `c-tpl-${idx}`;
      surface.componentsModel.addComponent(
        new ComponentModel(
          tplId,
          'FlexSections',
          {sections: {componentId: 'row-tpl', path: '/rows'}},
          catalog,
        ),
      );
      const tplBinder = new GenericBinder<Record<string, unknown>>(
        new ComponentContext(surface, tplId),
        schema,
      );
      assert.deepStrictEqual(tplBinder.snapshot.sections, [
        {id: 'row-tpl', basePath: '/rows/0'},
        {id: 'row-tpl', basePath: '/rows/1'},
      ]);
      tplBinder.dispose();

      const arrId = `c-arr-${idx}`;
      surface.componentsModel.addComponent(
        new ComponentModel(
          arrId,
          'FlexSections',
          {sections: [{title: {path: '/secTitle'}, child: 'leaf-1'}]},
          catalog,
        ),
      );
      const arrBinder = new GenericBinder<Record<string, unknown>>(
        new ComponentContext(surface, arrId),
        schema,
      );
      const boundSections = arrBinder.snapshot.sections as Array<Record<string, unknown>>;
      assert.strictEqual(boundSections.length, 1);
      assert.strictEqual(boundSections[0].title, 'Bound Section');
      assert.strictEqual(boundSections[0].child, 'leaf-1');
      arrBinder.dispose();
    }

    compositeSub.unsubscribe();
    compositeBinder.dispose();
    surface.dispose();
  });

  it('preserves active element bindings in [list, array] and [single, nested] unions, transform pipelines, Catalog.fromJson oneOf, and composite catchalls', () => {
    const ComponentIdRef = z.string().describe('REF:common_types.json#/$defs/ComponentId');
    const ChildListUnion = z
      .union([
        z.array(ComponentIdRef),
        z.object({
          componentId: ComponentIdRef,
          path: z.string(),
        }),
      ])
      .describe('REF:common_types.json#/$defs/ChildList');
    const DynamicTitleObj = z.object({
      title: CommonSchemas.DynamicString,
    });
    const NestedRowObj = z.object({
      title: CommonSchemas.DynamicString,
      child: ComponentIdRef,
    });

    // 1. [list, array-of-objects-without-child-refs] keeps ARRAY + templateFallback
    const listOrActiveArraySchema = z.object({
      content: ChildListUnion.or(z.array(DynamicTitleObj)),
    });

    // 2. [single, nested] union keeps ARRAY element bindings in both branch orders
    const singleOrNestedFirst = z.object({
      slot: ComponentIdRef.or(z.array(NestedRowObj)),
    });
    const singleOrNestedSecond = z.object({
      slot: z.array(NestedRowObj).or(ComponentIdRef),
    });

    // 3. Transform-backed pipeline into typed output schema preserves output behaviors
    const transformedPipelineSchema = z.object({
      payload: z
        .unknown()
        .transform(v => v)
        .pipe(
          z.object({
            label: CommonSchemas.DynamicString,
            onTap: CommonSchemas.Action,
          }),
        ),
    });

    // 4. Intersecting or unioning explicit ACTION and ComponentId properties with dynamic catchall (both orders)
    const explicitAndCatchallLeft = z
      .object({fixed: CommonSchemas.Action, child: ComponentIdRef.optional()})
      .and(z.record(CommonSchemas.DynamicString));
    const explicitAndCatchallRight = z
      .record(CommonSchemas.DynamicString)
      .and(z.object({fixed: CommonSchemas.Action, child: ComponentIdRef.optional()}));
    const explicitOrCatchallLeft = z.union([
      z.record(CommonSchemas.DynamicString),
      z.object({fixed: CommonSchemas.Action, child: ComponentIdRef.optional()}),
    ]);
    const explicitOrCatchallRight = z.union([
      z.object({fixed: CommonSchemas.Action, child: ComponentIdRef.optional()}),
      z.record(CommonSchemas.DynamicString),
    ]);

    // 5. Object union where only one branch has a dynamic catchall does not infect closed sibling props
    const unionPartialCatchallLeft = z.union([
      z.object({kind: z.literal('open')}).catchall(CommonSchemas.DynamicString),
      z.object({kind: z.literal('closed'), meta: z.record(z.unknown())}),
    ]);
    const unionPartialCatchallRight = z.union([
      z.object({kind: z.literal('closed'), meta: z.record(z.unknown())}),
      z.object({kind: z.literal('open')}).catchall(CommonSchemas.DynamicString),
    ]);

    // 6. Catalog.fromJson oneOf schemas preserve ACTION, DYNAMIC (including nested $defs oneOf), and STRUCTURAL
    const oneOfCatalog = Catalog.fromJson({
      catalogId: 'oneof-binder-cat',
      $defs: {
        ComponentId: {type: 'string'},
        DataBinding: {
          type: 'object',
          properties: {path: {type: 'string'}},
          required: ['path'],
        },
        FunctionCall: {
          type: 'object',
          properties: {call: {type: 'string'}},
          required: ['call'],
        },
        NestedBindingUnion: {
          oneOf: [{$ref: '#/$defs/DataBinding'}, {$ref: '#/$defs/FunctionCall'}],
        },
      },
      components: {
        OneOfComp: {
          type: 'object',
          properties: {
            child: {
              oneOf: [{type: 'string'}, {$ref: '#/$defs/NestedBindingUnion'}],
            },
            disabled: {
              oneOf: [{type: 'boolean'}, {$ref: '#/$defs/NestedBindingUnion'}],
            },
            onPress: {
              oneOf: [
                {
                  type: 'object',
                  properties: {event: {type: 'object', properties: {name: {type: 'string'}}}},
                  required: ['event'],
                },
                {
                  type: 'object',
                  properties: {
                    functionCall: {type: 'object', properties: {call: {type: 'string'}}},
                  },
                  required: ['functionCall'],
                },
              ],
            },
            items: {
              oneOf: [
                {type: 'array', items: {$ref: '#/$defs/ComponentId'}},
                {
                  type: 'object',
                  properties: {
                    componentId: {$ref: '#/$defs/ComponentId'},
                    path: {type: 'string'},
                  },
                  required: ['componentId', 'path'],
                },
              ],
            },
          },
        },
      },
    });
    const oneOfCompSchema = oneOfCatalog.components.get('OneOfComp')!.schema;

    const catalog = new Catalog('regression-binder-cat', '0.9', [], []);
    const surface = new SurfaceModel('s-reg-binder', catalog);
    surface.dataModel.set('/secTitle', 'Resolved Section');
    surface.dataModel.set('/rows', [{label: 'R1'}, {label: 'R2'}]);
    surface.dataModel.set('/flag', 'false');
    surface.dataModel.set('/extraVal', 'Extra Dynamic');

    // Verify (1): [list, array-of-objects-without-child-refs]
    surface.componentsModel.addComponent(
      new ComponentModel(
        'c-list-arr-objs',
        'Box',
        {content: [{title: {path: '/secTitle'}}]},
        catalog,
      ),
    );
    const listArrBinder = new GenericBinder<Record<string, unknown>>(
      new ComponentContext(surface, 'c-list-arr-objs'),
      listOrActiveArraySchema,
    );
    const listArrItems = listArrBinder.snapshot.content as Array<Record<string, unknown>>;
    assert.strictEqual(listArrItems.length, 1);
    assert.strictEqual(listArrItems[0].title, 'Resolved Section');
    assert.strictEqual(typeof listArrItems[0].setTitle, 'function');
    listArrBinder.dispose();

    surface.componentsModel.addComponent(
      new ComponentModel(
        'c-list-arr-tpl',
        'Box',
        {content: {componentId: 'tpl-1', path: '/rows'}},
        catalog,
      ),
    );
    const listTplBinder = new GenericBinder<Record<string, unknown>>(
      new ComponentContext(surface, 'c-list-arr-tpl'),
      listOrActiveArraySchema,
    );
    assert.deepStrictEqual(listTplBinder.snapshot.content, [
      {id: 'tpl-1', basePath: '/rows/0'},
      {id: 'tpl-1', basePath: '/rows/1'},
    ]);
    listTplBinder.dispose();

    // Verify (2): [single, nested] in both orders
    for (const [idx, slotSchema] of [singleOrNestedFirst, singleOrNestedSecond].entries()) {
      const arrCompId = `c-slot-arr-${idx}`;
      surface.componentsModel.addComponent(
        new ComponentModel(
          arrCompId,
          'SlotBox',
          {slot: [{title: {path: '/secTitle'}, child: 'kid-1'}]},
          catalog,
        ),
      );
      const slotArrBinder = new GenericBinder<Record<string, unknown>>(
        new ComponentContext(surface, arrCompId),
        slotSchema,
      );
      const slotArrItems = slotArrBinder.snapshot.slot as Array<Record<string, unknown>>;
      assert.strictEqual(slotArrItems.length, 1);
      assert.strictEqual(slotArrItems[0].title, 'Resolved Section');
      assert.strictEqual(slotArrItems[0].child, 'kid-1');
      assert.strictEqual(typeof slotArrItems[0].setTitle, 'function');
      slotArrBinder.dispose();

      const strCompId = `c-slot-str-${idx}`;
      surface.componentsModel.addComponent(
        new ComponentModel(strCompId, 'SlotBox', {slot: 'kid-1'}, catalog),
      );
      const slotStrBinder = new GenericBinder<Record<string, unknown>>(
        new ComponentContext(surface, strCompId),
        slotSchema,
      );
      assert.strictEqual(slotStrBinder.snapshot.slot, 'kid-1');
      slotStrBinder.dispose();
    }

    // Verify (3): Transform-backed pipeline into typed output
    surface.componentsModel.addComponent(
      new ComponentModel(
        'c-transform-pipe',
        'PipeBox',
        {payload: {label: {path: '/secTitle'}, onTap: {event: {name: 'tapped'}}}},
        catalog,
      ),
    );
    const pipeBinder = new GenericBinder<Record<string, unknown>>(
      new ComponentContext(surface, 'c-transform-pipe'),
      transformedPipelineSchema,
    );
    const resolvedPayload = pipeBinder.snapshot.payload as Record<string, unknown>;
    assert.strictEqual(resolvedPayload.label, 'Resolved Section');
    assert.strictEqual(typeof resolvedPayload.onTap, 'function');
    pipeBinder.dispose();

    // Verify (4): Explicit ACTION and ComponentId intersected or unioned with dynamic catchall (both orders)
    for (const [idx, catchallSchema] of [
      explicitAndCatchallLeft,
      explicitAndCatchallRight,
      explicitOrCatchallLeft,
      explicitOrCatchallRight,
    ].entries()) {
      const scraped = scrapeComponentBehavior(catchallSchema);
      assert.strictEqual(scraped.type, 'OBJECT');
      if (scraped.type === 'OBJECT') {
        assert.deepStrictEqual(scraped.shape.fixed, {type: 'ACTION'});
        assert.deepStrictEqual(scraped.shape.child, {type: 'STATIC'});
        assert.deepStrictEqual(scraped.catchall, {type: 'DYNAMIC'});
      }

      const cid = `c-catchall-and-${idx}`;
      surface.componentsModel.addComponent(
        new ComponentModel(
          cid,
          'CatchallAnd',
          {
            fixed: {event: {name: 'go'}},
            child: 'child-id-1',
            extra: {path: '/extraVal'},
          },
          catalog,
        ),
      );
      const andBinder = new GenericBinder<Record<string, unknown>>(
        new ComponentContext(surface, cid),
        catchallSchema,
      );
      assert.strictEqual(typeof andBinder.snapshot.fixed, 'function');
      assert.strictEqual(andBinder.snapshot.child, 'child-id-1');
      assert.strictEqual(andBinder.snapshot.extra, 'Extra Dynamic');
      andBinder.dispose();
    }

    // Verify (5): Union with catchall on only one branch leaves closed sibling object untouched
    for (const [idx, unionSchema] of [
      unionPartialCatchallLeft,
      unionPartialCatchallRight,
    ].entries()) {
      const cid = `c-union-partial-${idx}`;
      surface.componentsModel.addComponent(
        new ComponentModel(
          cid,
          'UnionPartial',
          {kind: 'closed', meta: {path: '/secTitle'}, extra: {path: '/extraVal'}},
          catalog,
        ),
      );
      const uBinder = new GenericBinder<Record<string, unknown>>(
        new ComponentContext(surface, cid),
        unionSchema,
      );
      assert.deepStrictEqual(uBinder.snapshot.meta, {path: '/secTitle'});
      assert.strictEqual(uBinder.snapshot.extra, 'Extra Dynamic');
      uBinder.dispose();
    }

    // Verify (6): Catalog.fromJson oneOf behaviors (including nested $defs oneOf on `child`)
    surface.componentsModel.addComponent(
      new ComponentModel(
        'c-oneof-comp',
        'OneOfComp',
        {
          child: {path: '/secTitle'},
          disabled: {path: '/flag'},
          onPress: {event: {name: 'pressed'}},
          items: {componentId: 'tpl-1', path: '/rows'},
        },
        catalog,
      ),
    );
    const oneOfBinder = new GenericBinder<Record<string, unknown>>(
      new ComponentContext(surface, 'c-oneof-comp'),
      oneOfCompSchema,
    );
    assert.strictEqual(oneOfBinder.snapshot.child, 'Resolved Section');
    assert.strictEqual(oneOfBinder.snapshot.disabled, false);
    assert.strictEqual(typeof oneOfBinder.snapshot.onPress, 'function');
    assert.deepStrictEqual(oneOfBinder.snapshot.items, [
      {id: 'tpl-1', basePath: '/rows/0'},
      {id: 'tpl-1', basePath: '/rows/1'},
    ]);
    oneOfBinder.dispose();

    surface.dispose();
  });
});

describe('GenericBinder @accessibility mirror', () => {
  function setup(schema: z.ZodTypeAny) {
    const catalog = new Catalog('test', '1.0', [], []);
    const surface = new SurfaceModel('s1', catalog);
    surface.dataModel.set('/label', 'Save');
    surface.componentsModel.addComponent(
      new ComponentModel('c1', 'Widget', {'@accessibility': {label: {'@path': '/label'}}}, catalog),
    );
    const binder = new GenericBinder<{
      'accessibility'?: unknown;
      '@accessibility'?: {label?: string};
    }>(new ComponentContext(surface, 'c1'), schema);
    const sub = binder.subscribe(() => {});
    return {surface, binder, sub};
  }

  it('does not mirror @accessibility onto a custom accessibility the payload omits', async () => {
    const {surface, binder, sub} = setup(
      z.object({accessibility: z.enum(['high', 'low']).optional()}),
    );
    assert.strictEqual(binder.snapshot['@accessibility']?.label, 'Save');
    assert.strictEqual(binder.snapshot.accessibility, undefined);

    surface.dataModel.set('/label', 'Cancel');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(binder.snapshot['@accessibility']?.label, 'Cancel');
    assert.strictEqual(binder.snapshot.accessibility, undefined);

    sub.unsubscribe();
    surface.dispose();
  });

  it('mirrors @accessibility onto accessibility when the schema declares no custom one', async () => {
    const {surface, binder, sub} = setup(z.object({text: z.string().optional()}));
    assert.deepStrictEqual(binder.snapshot.accessibility, binder.snapshot['@accessibility']);
    assert.strictEqual(
      (binder.snapshot.accessibility as {label?: string} | undefined)?.label,
      'Save',
    );

    surface.dataModel.set('/label', 'Cancel');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(
      (binder.snapshot.accessibility as {label?: string} | undefined)?.label,
      'Cancel',
    );

    sub.unsubscribe();
    surface.dispose();
  });
});
