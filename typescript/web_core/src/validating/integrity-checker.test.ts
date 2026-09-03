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

/**
 * @fileoverview Unit tests for component integrity checking and path syntax recursion validation.
 */

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  getComponentReferences,
  validateComponentIntegrity,
  validateRecursionAndPaths,
} from './integrity-checker.js';
import {A2uiIntegrityError, A2uiRecursionError, A2uiValidationError} from '../errors.js';
import {Catalog} from '../catalog/types.js';
import {BASIC_COMPONENTS} from '../v1_0/basic_catalog/components/basic_components.js';
import {z} from 'zod';

describe('Integrity Verification', () => {
  describe('getComponentReferences', () => {
    it('extracts references from container components', () => {
      const refMap = {
        Container: {
          singleRefs: new Set(['singleChild', 'nestedObj']),
          listRefs: new Set(['childrenList', 'tabs']),
        },
      };

      const comp = {
        id: 'c1',
        component: {
          Container: {
            singleChild: 'child1',
            childrenList: ['child2', 'child3'],
            nestedObj: {componentId: 'child4'},
            tabs: [{child: 'tab1'}, {child: 'tab2'}],
          },
        },
      };

      const refs = Array.from(getComponentReferences(comp, refMap as any));
      const refIds = refs.map(([id]) => id);

      assert.ok(refIds.includes('child1'));
      assert.ok(refIds.includes('child2'));
      assert.ok(refIds.includes('child3'));
      assert.ok(refIds.includes('child4'));
      assert.ok(refIds.includes('tab1'));
      assert.ok(refIds.includes('tab2'));
    });
  });

  describe('validateComponentIntegrity', () => {
    it('passes for valid component tree', () => {
      const refMap = {Box: {singleRefs: new Set(['child']), listRefs: new Set<string>()}};
      const components = [
        {id: 'root', component: {Box: {child: 'c1'}}},
        {id: 'c1', component: {Box: {}}},
      ];
      assert.doesNotThrow(() => validateComponentIntegrity(components, refMap as any));
    });

    it('throws on duplicate component ID', () => {
      const components = [
        {id: 'c1', component: 'Box'},
        {id: 'c1', component: 'Text'},
      ];
      assert.throws(
        () => validateComponentIntegrity(components, {}),
        (err: any) =>
          err instanceof A2uiIntegrityError && err.message.includes('Duplicate component ID: c1'),
      );
    });

    it('throws on component missing an id or having an empty id', () => {
      assert.throws(
        () => validateComponentIntegrity([{component: 'Text', text: 'No id'} as any], {}),
        (err: any) =>
          err instanceof A2uiIntegrityError &&
          err.message.includes('Component is missing a valid id'),
      );

      assert.throws(
        () => validateComponentIntegrity([{id: '', component: 'Text', text: 'Empty id'}], {}),
        (err: any) =>
          err instanceof A2uiIntegrityError &&
          err.message.includes('Component is missing a valid id'),
      );
    });

    it('throws on missing root component', () => {
      const components = [{id: 'c1', component: 'Box'}];
      assert.throws(
        () => validateComponentIntegrity(components, {}),
        (err: any) =>
          err instanceof A2uiIntegrityError && err.message.includes("No component has id='root'"),
      );
    });

    it('throws on dangling component reference', () => {
      const refMap = {Box: {singleRefs: new Set(['child']), listRefs: new Set<string>()}};
      const components = [{id: 'root', component: {Box: {child: 'nonexistent'}}}];
      assert.throws(
        () => validateComponentIntegrity(components, refMap as any),
        (err: any) =>
          err instanceof A2uiIntegrityError &&
          err.message.includes("references non-existent component 'nonexistent'"),
      );
    });

    it('enforces missing root even when allowDanglingReferences is true', () => {
      const basicCatalog = new Catalog('basic', BASIC_COMPONENTS);
      const components = [{id: 'c1', component: 'Text', text: 'No root'}];
      assert.throws(
        () =>
          validateComponentIntegrity(components, basicCatalog, {
            allowDanglingReferences: true,
            allowMissingRoot: false,
          }),
        (err: any) =>
          err instanceof A2uiIntegrityError && err.message.includes("No component has id='root'"),
      );
    });

    it('builds dynamic ref map from custom Catalog schemas', () => {
      const customDrawerApi = {
        name: 'CustomDrawer',
        schema: z.object({
          header: z.string().describe('ChildComponentId'),
          bodyItems: z.array(z.string()).describe('ChildList'),
        }),
      };
      const customCat = new Catalog('custom-cat', [customDrawerApi]);
      const components = [
        {id: 'root', component: 'CustomDrawer', header: 'c1', bodyItems: ['c2', 'c3']},
        {id: 'c1', component: 'Text', text: 'Header'},
        {id: 'c2', component: 'Text', text: 'Item 1'},
        {id: 'c3', component: 'Text', text: 'Item 2'},
      ];

      assert.doesNotThrow(() => validateComponentIntegrity(components, customCat));
    });

    it('validates components across multiple catalogs', () => {
      const catalogA = new Catalog('cat-a', [
        {
          name: 'BoxA',
          schema: z.object({childSlot: z.string().describe('ChildComponentId')}),
        },
      ]);
      const catalogB = new Catalog('cat-b', [
        {
          name: 'BoxB',
          schema: z.object({contentSlot: z.string().describe('ChildComponentId')}),
        },
        {
          name: 'LeafB',
          schema: z.object({text: z.string()}),
        },
      ]);

      const components = [
        {id: 'root', component: 'BoxA', catalogId: 'cat-a', childSlot: 'node-b'},
        {id: 'node-b', component: 'BoxB', catalogId: 'cat-b', contentSlot: 'leaf-b'},
        {id: 'leaf-b', component: 'LeafB', catalogId: 'cat-b', text: 'Hello'},
      ];

      assert.doesNotThrow(() => validateComponentIntegrity(components, [catalogA, catalogB]));
    });
  });

  describe('validateRecursionAndPaths', () => {
    it('passes valid path syntax', () => {
      const data = {path: '/valid/path', nested: [{path: '/another'}]};
      assert.doesNotThrow(() => validateRecursionAndPaths(data));
    });

    it('throws on unescaped invalid path syntax', () => {
      const data = {path: 'invalid~path//double'};
      assert.throws(
        () => validateRecursionAndPaths(data),
        (err: any) =>
          err instanceof A2uiValidationError && err.message.includes('Invalid path syntax'),
      );
    });

    it('throws when global recursion depth limit is exceeded', () => {
      let deepList: any = [];
      for (let i = 0; i < 52; i++) {
        deepList = [deepList];
      }
      assert.throws(
        () => validateRecursionAndPaths(deepList),
        (err: any) =>
          err instanceof A2uiRecursionError &&
          err.message.includes('Global recursion limit exceeded'),
      );
    });

    it('throws when function call recursion depth limit is exceeded', () => {
      const deepCall: Record<string, any> = {};
      let curr = deepCall;
      for (let i = 0; i < 6; i++) {
        curr.call = 'func';
        curr.args = {};
        curr = curr.args;
      }
      assert.throws(
        () => validateRecursionAndPaths(deepCall),
        (err: any) =>
          err instanceof A2uiRecursionError && err.message.includes('Recursion limit exceeded'),
      );
    });

    it('throws when wrapped functionCall recursion depth limit is exceeded', () => {
      let wrappedCall: any = {call: 'leaf', args: {}};
      for (let i = 0; i < 6; i++) {
        wrappedCall = {functionCall: wrappedCall};
      }
      assert.throws(
        () => validateRecursionAndPaths(wrappedCall),
        (err: any) =>
          err instanceof A2uiRecursionError && err.message.includes('Recursion limit exceeded'),
      );
    });
  });

  describe('Integrity and Recursion Errors', () => {
    it('instantiates A2uiIntegrityError and A2uiRecursionError with custom error codes', () => {
      const integrityErr = new A2uiIntegrityError('Integrity failed');
      assert.strictEqual(integrityErr.code, 'INTEGRITY_ERROR');
      assert.strictEqual(integrityErr.name, 'A2uiIntegrityError');

      const recursionErr = new A2uiRecursionError('Recursion exceeded');
      assert.strictEqual(recursionErr.code, 'RECURSION_ERROR');
      assert.strictEqual(recursionErr.name, 'A2uiRecursionError');
    });
  });
});
