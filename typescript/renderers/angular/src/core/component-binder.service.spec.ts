/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {TestBed} from '@angular/core/testing';
import {ComponentBinder} from './component-binder.service';
import {
  Catalog,
  ComponentContext,
  ComponentModel,
  NodeResolver,
  SurfaceModel,
  basicCatalog,
  getValue,
} from '@a2ui/web_core/v0_9';

/**
 * Helper to construct instances of SurfaceModel, ComponentModel, and ComponentContext.
 */
function createComponentContext({
  properties,
  componentId = 'test-comp',
  componentType = 'TestComponent',
  data = {},
}: {
  properties: Record<string, unknown>;
  componentId?: string;
  componentType?: string;
  data?: Record<string, unknown>;
}): {context: ComponentContext; surface: SurfaceModel} {
  const catalog = new Catalog('test-catalog', '0.9', []);
  const surface = new SurfaceModel('test-surface', catalog);

  for (const [path, val] of Object.entries(data)) {
    surface.dataModel.set(path, val);
  }

  const componentModel = new ComponentModel(componentId, componentType, properties, catalog);
  surface.componentsModel.addComponent(componentModel);

  const context = new ComponentContext(surface, componentId);

  return {context, surface};
}

describe('ComponentBinder', () => {
  let binder: ComponentBinder;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ComponentBinder],
    });
    binder = TestBed.inject(ComponentBinder);
  });

  it('should be created', () => {
    expect(binder).toBeTruthy();
  });

  describe('basic property binding', () => {
    it('should bind literal properties to Angular signals', () => {
      const {context} = createComponentContext({
        properties: {
          text: 'Hello World',
          count: 42,
          enabled: true,
          config: {theme: 'dark'},
          empty: null,
        },
      });

      const bound = binder.bind(context);

      expect(bound['text'].value()).toBe('Hello World');
      expect(bound['count'].value()).toBe(42);
      expect(bound['enabled'].value()).toBe(true);
      expect(bound['config'].value()).toEqual({theme: 'dark'});
      expect(bound['empty'].value()).toBeNull();

      expect(bound['text'].template).toBeUndefined();
      expect(bound['text'].raw).toBe('Hello World');
    });

    it('should bind path-based properties and setup onUpdate (two-way binding)', () => {
      const {context, surface} = createComponentContext({
        properties: {value: {path: '/data/text'}},
        data: {'/data/text': 'initial-value'},
      });

      const bound = binder.bind(context);

      expect(bound['value'].value()).toBe('initial-value');
      expect(bound['value'].onUpdate).toBeDefined();

      // Call onUpdate to verify it propagates dynamically to the DataModel
      bound['value'].onUpdate('new-value');
      expect(surface.dataModel.get('/data/text')).toBe('new-value');
      expect(bound['value'].value()).toBe('new-value');
    });

    it('should make onUpdate a no-op for literal properties', () => {
      const {context} = createComponentContext({
        properties: {
          text: 'literal-text',
        },
      });

      const bound = binder.bind(context);

      expect(bound['text'].value()).toBe('literal-text');
      expect(bound['text'].onUpdate).toBeDefined();

      // Verify calling onUpdate does not throw or modify
      expect(() => bound['text'].onUpdate('new-text')).not.toThrow();
      expect(bound['text'].value()).toBe('literal-text');
    });
  });

  describe('single child bindings (child, trigger, content)', () => {
    const testSingleChildKey = (key: 'child' | 'trigger' | 'content') => {
      it(`should handle null/falsy value for ${key}`, () => {
        const {context} = createComponentContext({
          properties: {[key]: null},
        });
        const bound = binder.bind(context);
        expect(bound[key].value()).toBeNull();
      });

      it(`should resolve string ID to Child object for ${key}`, () => {
        const {context} = createComponentContext({
          properties: {[key]: 'my-child-id'},
        });
        const bound = binder.bind(context);
        expect(bound[key].value()).toEqual({
          id: 'my-child-id',
          basePath: '/',
        });
      });

      it(`should return existing Child object as-is for ${key}`, () => {
        const existingChild = {
          id: 'custom-child-id',
          basePath: '/different/path',
        };
        const {context} = createComponentContext({
          properties: {[key]: existingChild},
        });
        const bound = binder.bind(context);
        expect(bound[key].value()).toEqual(existingChild);
      });
    };

    describe('child', () => testSingleChildKey('child'));
    describe('trigger', () => testSingleChildKey('trigger'));
    describe('content', () => testSingleChildKey('content'));
  });

  describe('children list bindings', () => {
    it('should handle null/falsy or non-array values by returning an empty array', () => {
      const {context} = createComponentContext({
        properties: {children: null},
      });
      const bound = binder.bind(context);
      expect(bound['children'].value()).toEqual([]);
    });

    it('should bind a static array of string child IDs', () => {
      const {context} = createComponentContext({
        properties: {children: ['child-1', 'child-2']},
      });
      const bound = binder.bind(context);
      expect(bound['children'].value()).toEqual([
        {id: 'child-1', basePath: '/'},
        {id: 'child-2', basePath: '/'},
      ]);
      expect(bound['children'].template).toBeUndefined();
    });

    it('should bind a path resolving to an array of child IDs', () => {
      const {context} = createComponentContext({
        properties: {children: {path: '/dynamic/list'}},
        data: {'/dynamic/list': ['child-a', 'child-b']},
      });
      const bound = binder.bind(context);
      expect(bound['children'].value()).toEqual([
        {id: 'child-a', basePath: '/'},
        {id: 'child-b', basePath: '/'},
      ]);
      expect(bound['children'].template).toBeUndefined();
    });

    it('should bind a path resolving to an array of pre-formatted Child objects', () => {
      const {context} = createComponentContext({
        properties: {children: {path: '/dynamic/custom-list'}},
        data: {
          '/dynamic/custom-list': [
            {id: 'child-x', basePath: '/custom/x'},
            {id: 'child-y', basePath: '/custom/y'},
          ],
        },
      });
      const bound = binder.bind(context);
      expect(bound['children'].value()).toEqual([
        {id: 'child-x', basePath: '/custom/x'},
        {id: 'child-y', basePath: '/custom/y'},
      ]);
    });

    it('should expand ChildList template objects and populate template field', () => {
      const {context} = createComponentContext({
        properties: {children: {componentId: 'item-card', path: '/items'}},
        data: {'/items': ['item1', 'item2', 'item3']},
      });
      const bound = binder.bind(context);
      expect(bound['children'].value()).toEqual([
        {id: 'item-card', basePath: '/items/0'},
        {id: 'item-card', basePath: '/items/1'},
        {id: 'item-card', basePath: '/items/2'},
      ]);

      expect(bound['children'].template).toEqual({
        id: 'item-card',
        path: '/items',
      });
    });

    it('should not leak template to subsequent properties', () => {
      const {context} = createComponentContext({
        properties: {
          children: {componentId: 'item-card', path: '/items'},
          anotherProp: 'some-literal',
        },
        data: {'/items': ['item1']},
      });
      const bound = binder.bind(context);

      expect(bound['children'].template).toEqual({
        id: 'item-card',
        path: '/items',
      });
      expect(bound['anotherProp'].template).toBeUndefined();
    });
  });

  describe('validation checks (checks)', () => {
    it('should return isValid=true and empty errors when checks is null/empty', () => {
      const {context} = createComponentContext({
        properties: {checks: []},
      });
      const bound = binder.bind(context);

      expect(bound['isValid']).toBeDefined();
      expect(bound['validationErrors']).toBeDefined();

      expect(bound['isValid'].value()).toBe(true);
      expect(bound['validationErrors'].value()).toEqual([]);
    });

    it('should handle checks with simple condition values (resolved as signals)', () => {
      const {context, surface} = createComponentContext({
        properties: {
          checks: [
            {condition: {path: '/form/nameValid'}, message: 'Name must be valid'},
            {condition: {path: '/form/ageValid'}, message: 'Age must be valid'},
          ],
        },
        data: {
          '/form/nameValid': true,
          '/form/ageValid': false,
        },
      });

      const bound = binder.bind(context);

      // Since one rule resolves to false in the DataModel:
      expect(bound['isValid'].value()).toBe(false);
      expect(bound['validationErrors'].value()).toEqual(['Age must be valid']);

      // Dynamically update the DataModel to verify reactivity:
      surface.dataModel.set('/form/ageValid', true);
      expect(bound['isValid'].value()).toBe(true);
      expect(bound['validationErrors'].value()).toEqual([]);
    });

    it('should support shorthand condition rules (condition as the rule object itself)', () => {
      const {context, surface} = createComponentContext({
        properties: {
          checks: [
            {path: '/form/singleCheck'}, // Shorthand
          ],
        },
        data: {'/form/singleCheck': false},
      });

      const bound = binder.bind(context);

      expect(bound['isValid'].value()).toBe(false);
      expect(bound['validationErrors'].value()).toEqual(['Validation failed']); // default message

      surface.dataModel.set('/form/singleCheck', true);
      expect(bound['isValid'].value()).toBe(true);
      expect(bound['validationErrors'].value()).toEqual([]);
    });

    it('should evaluate multiple validation errors dynamically', () => {
      const {context, surface} = createComponentContext({
        properties: {
          checks: [
            {condition: {path: '/check1'}, message: 'Error 1'},
            {condition: {path: '/check2'}, message: 'Error 2'},
            {condition: {path: '/check3'}, message: 'Error 3'},
          ],
        },
        data: {
          '/check1': true,
          '/check2': false,
          '/check3': false,
        },
      });

      const bound = binder.bind(context);

      expect(bound['isValid'].value()).toBe(false);
      expect(bound['validationErrors'].value()).toEqual(['Error 2', 'Error 3']);

      // Partially solve in DataModel:
      surface.dataModel.set('/check2', true);
      expect(bound['isValid'].value()).toBe(false);
      expect(bound['validationErrors'].value()).toEqual(['Error 3']);

      // Fully solve in DataModel:
      surface.dataModel.set('/check3', true);
      expect(bound['isValid'].value()).toBe(true);
      expect(bound['validationErrors'].value()).toEqual([]);
    });

    it('should resolve dynamic message bindings in check rules', () => {
      const {context, surface} = createComponentContext({
        properties: {
          checks: [
            {
              condition: {path: '/form/isValid'},
              message: {path: '/i18n/errorMsg'},
            },
          ],
        },
        data: {
          '/form/isValid': false,
          '/i18n/errorMsg': 'Dynamic localized error',
        },
      });

      const bound = binder.bind(context);

      expect(bound['isValid'].value()).toBe(false);
      expect(bound['validationErrors'].value()).toEqual(['Dynamic localized error']);

      surface.dataModel.set('/i18n/errorMsg', 'Updated localized error');
      expect(bound['validationErrors'].value()).toEqual(['Updated localized error']);
    });

    it('should support v1.0 structured CheckResult objects with severity and dynamic message override', () => {
      const {context, surface} = createComponentContext({
        properties: {
          checks: [
            {
              condition: {path: '/form/checkResult'},
              message: 'Static fallback error',
            },
          ],
        },
        data: {
          '/form/checkResult': {
            valid: false,
            severity: 'error',
            message: 'Server returned custom error',
            code: 'INVALID_EMAIL',
          },
        },
      });

      const bound = binder.bind(context);

      expect(bound['isValid'].value()).toBe(false);
      expect(bound['validationErrors'].value()).toEqual(['Server returned custom error']);

      // When CheckResult omits message, fall back to rule.message:
      surface.dataModel.set('/form/checkResult', {
        valid: false,
        severity: 'error',
      });
      expect(bound['isValid'].value()).toBe(false);
      expect(bound['validationErrors'].value()).toEqual(['Static fallback error']);

      // When severity is warning or info, it does not block validity or emit validationErrors:
      surface.dataModel.set('/form/checkResult', {
        valid: false,
        severity: 'warning',
        message: 'Non-blocking warning',
      });
      expect(bound['isValid'].value()).toBe(true);
      expect(bound['validationErrors'].value()).toEqual([]);

      surface.dataModel.set('/form/checkResult', {
        valid: false,
        severity: 'info',
        message: 'Informational hint',
      });
      expect(bound['isValid'].value()).toBe(true);
      expect(bound['validationErrors'].value()).toEqual([]);

      // When valid is true, no error is emitted:
      surface.dataModel.set('/form/checkResult', {
        valid: true,
        severity: 'error',
      });
      expect(bound['isValid'].value()).toBe(true);
      expect(bound['validationErrors'].value()).toEqual([]);
    });
  });

  describe('bindNode (NodeResolver integration)', () => {
    it('binds resolved ComponentNode props, two-way WritableBinding updates, and child nodes', () => {
      const surface = new SurfaceModel('node-surface', basicCatalog);
      surface.dataModel.set('/userName', 'Initial Name');
      surface.componentsModel.addComponent(
        new ComponentModel('root', 'Column', {children: ['input-1']}, basicCatalog),
      );
      surface.componentsModel.addComponent(
        new ComponentModel(
          'input-1',
          'TextField',
          {label: 'Username', value: {path: '/userName'}},
          basicCatalog,
        ),
      );

      const resolver = new NodeResolver(surface, basicCatalog);
      const rootNode = getValue(resolver.rootNode)!;
      const rootBound = binder.bindNode(rootNode);
      const children = rootBound['children'].value() as Array<{
        id: string;
        basePath: string;
        node: unknown;
      }>;
      expect(children.length).toBe(1);
      expect(children[0].id).toBe('input-1');
      expect(children[0].basePath).toBe('/');

      const childNode = (getValue(rootNode.props)['children'] as any[])[0];
      expect(children[0].node).toBe(childNode);
      const inputBound = binder.bindNode(childNode);
      expect(inputBound['label'].value()).toBe('Username');
      expect(inputBound['value'].value()).toBe('Initial Name');

      // Two-way update writes through WritableBinding to DataModel
      inputBound['value'].onUpdate('Updated Name');
      expect(surface.dataModel.get('/userName')).toBe('Updated Name');
      // The resolver refreshes `node.props` in an effect, which Angular runs on tick.
      TestBed.tick();
      expect(inputBound['value'].value()).toBe('Updated Name');

      // onUpdate on a read-only (literal) binding is a no-op
      expect(() => inputBound['label'].onUpdate('Changed')).not.toThrow();
      expect(inputBound['label'].value()).toBe('Username');

      resolver.dispose();
    });

    it('does not create DataContext subscriptions of its own when binding a node', () => {
      const surface = new SurfaceModel('node-surface-2', basicCatalog);
      surface.dataModel.set('/title', 'A');
      surface.componentsModel.addComponent(
        new ComponentModel('root', 'Text', {text: {path: '/title'}}, basicCatalog),
      );
      const resolver = new NodeResolver(surface, basicCatalog);
      const rootNode = getValue(resolver.rootNode)!;

      const resolveSpy = spyOn(rootNode.context!.dataContext, 'resolveSignal').and.callThrough();
      const bound = binder.bindNode(rootNode);
      expect(resolveSpy).not.toHaveBeenCalled();

      expect(bound['text'].value()).toBe('A');
      surface.dataModel.set('/title', 'B');
      TestBed.tick();
      expect(bound['text'].value()).toBe('B');

      resolver.dispose();
    });

    it('exposes the resolver check outputs for nodes with checks', () => {
      const surface = new SurfaceModel('node-surface-3', basicCatalog);
      surface.dataModel.set('/ok', false);
      surface.componentsModel.addComponent(
        new ComponentModel(
          'root',
          'TextField',
          {label: 'Name', checks: [{condition: {path: '/ok'}, message: 'Required'}]},
          basicCatalog,
        ),
      );
      const resolver = new NodeResolver(surface, basicCatalog);
      const bound = binder.bindNode(getValue(resolver.rootNode)!);

      expect(bound['isValid'].value()).toBe(false);
      expect(bound['validationErrors'].value()).toEqual(['Required']);
      surface.dataModel.set('/ok', true);
      TestBed.tick();
      expect(bound['isValid'].value()).toBe(true);

      resolver.dispose();
    });

    it('exposes action closures from the node props', () => {
      const surface = new SurfaceModel('node-surface-4', basicCatalog);
      surface.componentsModel.addComponent(
        new ComponentModel(
          'root',
          'Button',
          {child: 'label', action: {event: {name: 'tap'}}},
          basicCatalog,
        ),
      );
      surface.componentsModel.addComponent(
        new ComponentModel('label', 'Text', {text: 'Tap'}, basicCatalog),
      );
      const resolver = new NodeResolver(surface, basicCatalog);
      const bound = binder.bindNode(getValue(resolver.rootNode)!);

      expect(typeof bound['action'].value()).toBe('function');

      resolver.dispose();
    });

    it('unsubscribes signal subscriptions when unbind is called', () => {
      const {context} = createComponentContext({
        properties: {
          text: [{path: '/dynamic/item'}],
          checks: [{condition: [{path: '/dynamic/check'}], message: 'Failed'}],
        },
        data: {'/dynamic/item': 'A', '/dynamic/check': true},
      });

      let unsubscribedCount = 0;
      const origResolve = context.dataContext.resolveSignal.bind(context.dataContext);
      spyOn(context.dataContext, 'resolveSignal').and.callFake((<V>(
        val: unknown,
        depth?: number,
      ) => {
        const sig = origResolve<V>(val, depth);
        const origUnsub = sig.unsubscribe;
        if (origUnsub) {
          sig.unsubscribe = () => {
            unsubscribedCount++;
            origUnsub();
          };
        }
        return sig;
      }) as typeof context.dataContext.resolveSignal);

      const bound = binder.bind(context);
      expect(unsubscribedCount).toBe(0);

      binder.unbind(bound);
      expect(unsubscribedCount).toBeGreaterThan(0);
    });
  });
});
