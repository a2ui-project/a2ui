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
import {Catalog, FunctionImplementation} from '../catalog/types.js';
import {ComponentModel} from '../state/component-model.js';
import {CommonSchemas} from '../types/common-types.js';

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
    const mockCatalog = new Catalog('test', [], mockFunctions);
    const surface = new SurfaceModel('s1', mockCatalog);

    const schema = z.object({
      value: CommonSchemas.DynamicString,
      checks: CommonSchemas.Checkable.shape.checks,
    });

    return {surface, schema};
  }

  it('should resolve checkable validation state reactively', async () => {
    const {surface, schema} = setupSurfaceAndMocks();
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
      surface.catalog,
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
    const {surface, schema} = setupSurfaceAndMocks();
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
      surface.catalog,
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
    const {surface, schema} = setupSurfaceAndMocks();
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
      surface.catalog,
    );
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c3');
    const binder = new GenericBinder<Record<string, unknown>>(context, schema);

    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Validation failed']);
  });

  it('should default to valid if checks array is empty', () => {
    const {surface, schema} = setupSurfaceAndMocks();

    const compModel = new ComponentModel(
      'c4',
      'Test',
      {
        value: 'hello',
        checks: [],
      },
      surface.catalog,
    );
    surface.componentsModel.addComponent(compModel);

    const context = new ComponentContext(surface, 'c4');
    const binder = new GenericBinder<Record<string, unknown>>(context, schema);

    assert.strictEqual(binder.snapshot.isValid, true);
    assert.deepStrictEqual(binder.snapshot.validationErrors, []);
  });

  it('should resolve ACTION binding and dispatch resolved payload', () => {
    const {surface} = setupSurfaceAndMocks();
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
      surface.catalog,
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

  it('should resolve STRUCTURAL ChildList bindings and update dynamically', async () => {
    const {surface} = setupSurfaceAndMocks();
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
      surface.catalog,
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

  it('should generate dynamic setters and update data model', () => {
    const {surface} = setupSurfaceAndMocks();
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
      surface.catalog,
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
    const {surface, schema} = setupSurfaceAndMocks();
    surface.dataModel.set('/val', 'v1');

    const compModel = new ComponentModel(
      'c8',
      'Test',
      {
        value: {path: '/val'},
      },
      surface.catalog,
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
      const {surface} = setupSurfaceAndMocks();

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
        surface.catalog,
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
  });

  it('should support v1.0 ValidationResult objects and dynamic messages', async () => {
    const mockCatalog = new Catalog('test', [], []);
    const surface = new SurfaceModel('s1', mockCatalog);
    (surface.catalog as any).functions = new Map([
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
    (surface.catalog as any).invoker = (name: string, args: any) => {
      const fn = (surface.catalog as any).functions.get(name);
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
        email: {path: '/email'},
        validationRules: [
          {
            condition: {
              call: 'validate_email',
              args: {val: {path: '/email'}},
            },
          },
        ],
      },
      surface.catalog,
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

  it('should reset custom message to fallback message when subsequent evaluation returns boolean or no custom message', async () => {
    const mockCatalog = new Catalog('test', [], []);
    const surface = new SurfaceModel('s1', mockCatalog);
    (surface.catalog as any).functions = new Map([
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
    (surface.catalog as any).invoker = (name: string, args: any) => {
      const fn = (surface.catalog as any).functions.get(name);
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
              call: 'dynamic_validator',
              args: {mode: {path: '/mode'}},
            },
            message: 'Default rule failure message',
          },
        ],
      },
      surface.catalog,
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
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Default rule failure message']);

    // Subsequent evaluation returning { valid: false } without message -> should reset to default message
    surface.dataModel.set('/mode', 'object_without_msg');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(binder.snapshot.isValid, false);
    assert.deepStrictEqual(binder.snapshot.validationErrors, ['Default rule failure message']);

    // Subsequent evaluation returning true -> valid
    surface.dataModel.set('/mode', 'valid');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(binder.snapshot.isValid, true);
    assert.deepStrictEqual(binder.snapshot.validationErrors, []);
  });

  it('should not treat primitive fields or unannotated condition arrays as CHECKABLE', () => {
    const {surface} = setupSurfaceAndMocks();

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
      surface.catalog,
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
});
