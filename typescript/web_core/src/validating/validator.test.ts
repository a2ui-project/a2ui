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
 * @fileoverview Unit tests for A2uiValidator, integrity checks, path syntax validation, and graph topology analysis.
 */

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeChildRefSchema,
  buildComponentRefMap,
  getComponentReferences,
  isChildListSchema,
  isChildOrChildListSchema,
  isChildSchema,
  validateComponentIntegrity,
  validateRecursionAndPaths,
} from './integrity-checker.js';
import {analyzeTopology} from './topology-analyzer.js';
import {A2uiValidator} from './validator.js';
import {A2uiIntegrityError, A2uiRecursionError, A2uiValidationError} from '../errors.js';
import {Catalog} from '../catalog/types.js';
import {BASIC_COMPONENTS} from '../v1_0/basic_catalog/components/basic_components.js';
import {z} from 'zod';

describe('A2uiValidator & Integrity Verification', () => {
  describe('getComponentReferences', () => {
    it('extracts references from container components', () => {
      const refMap = {
        Container: [new Set(['singleChild', 'nestedObj']), new Set(['childrenList', 'tabs'])],
      } as const;

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
      const refMap = {Box: [new Set(['child']), new Set()]} as const;
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

    it('throws on missing root component', () => {
      const components = [{id: 'c1', component: 'Box'}];
      assert.throws(
        () => validateComponentIntegrity(components, {}),
        (err: any) =>
          err instanceof A2uiIntegrityError && err.message.includes("No component has id='root'"),
      );
    });

    it('throws on dangling component reference', () => {
      const refMap = {Box: [new Set(['child']), new Set()]} as const;
      const components = [{id: 'root', component: {Box: {child: 'nonexistent'}}}];
      assert.throws(
        () => validateComponentIntegrity(components, refMap as any),
        (err: any) =>
          err instanceof A2uiIntegrityError &&
          err.message.includes("references non-existent component 'nonexistent'"),
      );
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
  });

  describe('analyzeTopology', () => {
    it('passes for valid graph topology', () => {
      const refMap = {Node: [new Set(['next']), new Set()]} as const;
      const components = [
        {id: 'root', component: {Node: {next: 'n1'}}},
        {id: 'n1', component: {Node: {}}},
      ];
      const visited = analyzeTopology(components, refMap as any, {allowOrphanComponents: false});
      assert.strictEqual(visited.size, 2);
      assert.ok(visited.has('root'));
      assert.ok(visited.has('n1'));
    });

    it('detects self-reference', () => {
      const refMap = {Node: [new Set(['next']), new Set()]} as const;
      const components = [{id: 'root', component: {Node: {next: 'root'}}}];
      assert.throws(
        () => analyzeTopology(components, refMap as any),
        (err: any) =>
          err instanceof A2uiRecursionError &&
          err.message.includes("Component 'root' references itself"),
      );
    });

    it('detects circular reference', () => {
      const refMap = {Node: [new Set(['next']), new Set()]} as const;
      const components = [
        {id: 'root', component: {Node: {next: 'n1'}}},
        {id: 'n1', component: {Node: {next: 'root'}}},
      ];
      assert.throws(
        () => analyzeTopology(components, refMap as any),
        (err: any) =>
          err instanceof A2uiRecursionError && err.message.includes('Circular reference detected'),
      );
    });

    it('detects orphan components when prohibited', () => {
      const refMap = {Node: [new Set(['next']), new Set()]} as const;
      const components = [
        {id: 'root', component: {Node: {}}},
        {id: 'orphan', component: {Node: {}}},
      ];
      assert.throws(
        () => analyzeTopology(components, refMap as any, {allowOrphanComponents: false}),
        (err: any) =>
          err instanceof A2uiIntegrityError &&
          err.message.includes("Component 'orphan' is not reachable"),
      );
    });
  });

  describe('A2uiValidator Component Validation', () => {
    const validator = new A2uiValidator();
    const basicCatalog = new Catalog('basic', BASIC_COMPONENTS);

    it('enforces missing root even when allowDanglingReferences is true', () => {
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

      assert.doesNotThrow(() => validator.validateComponents(components, customCat));
    });
  });

  describe('analyzeChildRefSchema & Schema Ref Introspection', () => {
    it('identifies JSON Schema $ref pointers to ChildList and ComponentId', () => {
      const childListRef = {
        $ref: 'https://a2ui.org/specification/v1_0/common_types.json#/$defs/ChildList',
      };
      const componentIdRef = {
        $ref: 'https://a2ui.org/specification/v1_0/common_types.json#/$defs/ComponentId',
      };
      const childRef = {
        $ref: 'https://a2ui.org/specification/v1_0/common_types.json#/$defs/Child',
      };
      const v09ChildListRef = {$ref: 'common_types.json#/definitions/ChildList'};
      const v09ComponentIdRef = {$ref: 'common_types.json#/definitions/ComponentId'};
      const nonChildRef = {$ref: 'common_types.json#/definitions/DynamicString'};

      const childListAnalysis = analyzeChildRefSchema(childListRef);
      assert.strictEqual(childListAnalysis.isChildList, true);
      assert.strictEqual(childListAnalysis.isChild, false);

      const componentIdAnalysis = analyzeChildRefSchema(componentIdRef);
      assert.strictEqual(componentIdAnalysis.isChild, true);
      assert.strictEqual(componentIdAnalysis.isChildList, false);

      assert.strictEqual(isChildListSchema(childListRef), true);
      assert.strictEqual(isChildSchema(childListRef), false);

      assert.strictEqual(isChildSchema(componentIdRef), true);
      assert.strictEqual(isChildListSchema(componentIdRef), false);

      assert.strictEqual(isChildSchema(childRef), true);
      assert.strictEqual(isChildListSchema(childRef), false);

      assert.strictEqual(isChildListSchema(v09ChildListRef), true);
      assert.strictEqual(isChildSchema(v09ComponentIdRef), true);

      assert.strictEqual(isChildOrChildListSchema(nonChildRef), false);
    });

    it('identifies Zod schemas for ComponentId and ChildList', () => {
      const singleChildApi = z
        .string()
        .describe('The unique identifier for a component, used for references.');
      const childListUnion = z.union([
        z.array(singleChildApi),
        z.object({componentId: z.string(), path: z.string()}),
      ]);
      const normalString = z.string().describe('A normal text field');

      assert.strictEqual(isChildSchema(singleChildApi), true);
      assert.strictEqual(isChildListSchema(singleChildApi), false);

      assert.strictEqual(isChildListSchema(childListUnion), true);
      assert.strictEqual(isChildSchema(childListUnion), false);

      assert.strictEqual(isChildOrChildListSchema(normalString), false);
    });

    it('builds dynamic ref map for custom components with non-standard property names', () => {
      const customSplitPaneApi = {
        name: 'CustomSplitPane',
        schema: z.object({
          topSlot: z.string().describe('ComponentId'),
          bottomSlot: z.string().describe('ComponentId'),
          sidePanels: z.array(z.string().describe('ComponentId')),
        }),
      };

      const refMap = buildComponentRefMap([customSplitPaneApi]);
      assert.ok(refMap.CustomSplitPane);
      assert.deepStrictEqual(Array.from(refMap.CustomSplitPane[0]).sort(), [
        'bottomSlot',
        'topSlot',
      ]);
      assert.deepStrictEqual(Array.from(refMap.CustomSplitPane[1]), ['sidePanels']);
    });

    it('validates components and graph topology across multiple catalogs', () => {
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

      // 1. validateComponentIntegrity with array of catalogs
      assert.doesNotThrow(() => validateComponentIntegrity(components, [catalogA, catalogB]));

      // 2. analyzeTopology with array of catalogs
      const visited = analyzeTopology(components, [catalogA, catalogB]);
      assert.strictEqual(visited.size, 3);
      assert.ok(visited.has('root'));
      assert.ok(visited.has('node-b'));
      assert.ok(visited.has('leaf-b'));

      // 3. A2uiValidator validateComponents with array of catalogs
      const validator = new A2uiValidator();
      assert.doesNotThrow(() => validator.validateComponents(components, [catalogA, catalogB]));
    });
  });
});
