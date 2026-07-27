/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {TestBed} from '@angular/core/testing';
import {ComponentBinder} from './component-binder.service';
import {Catalog, ComponentContext, ComponentModel, SurfaceModel} from '@a2ui/web_core/v0_9';

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
  const catalog = new Catalog('test-catalog', []);
  const surface = new SurfaceModel('test-surface', catalog);

  for (const [path, val] of Object.entries(data)) {
    surface.dataModel.set(path, val);
  }

  const componentModel = new ComponentModel(componentId, componentType, properties);
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
  });
});
