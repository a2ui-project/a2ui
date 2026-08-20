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
import {A2uiValidator, RELAXED_VALIDATION, STRICT_VALIDATION} from './validator.js';
import {A2uiIntegrityError, A2uiRecursionError, A2uiValidationError} from '../errors.js';
import {Catalog} from '../catalog/types.js';
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

  describe('A2uiValidator Full Pipeline', () => {
    const validator = new A2uiValidator();

    it('validates a valid message envelope stream', () => {
      const payload = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'main',
            catalogId: 'https://a2ui.org/catalog',
          },
        },
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 'main',
            components: [
              {
                id: 'root',
                component: 'Column',
                children: ['c1'],
              },
              {
                id: 'c1',
                component: 'Text',
                text: 'Hello World',
              },
            ],
          },
        },
      ];

      assert.doesNotThrow(() => validator.validate(payload));
    });

    it('validates inline components inside createSurface for v1.0', () => {
      const payload = {
        version: 'v1.0',
        createSurface: {
          surfaceId: 'main',
          catalogId: 'https://a2ui.org/catalog',
          components: [
            {
              id: 'root',
              component: 'Column',
              children: ['c1'],
            },
            {
              id: 'c1',
              component: 'Text',
              text: 'Inline text',
            },
          ],
        },
      };

      assert.doesNotThrow(() => validator.validate(payload));
    });

    it('auto-enables allowMissingRoot for incremental updateComponents messages without createSurface', () => {
      const incrementalPayload = {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 'main',
          components: [
            {
              id: 'c1',
              component: 'Text',
              text: 'Updated child node only',
            },
          ],
        },
      };

      // By default without createSurface, allowMissingRoot is automatically enabled
      assert.doesNotThrow(() => validator.validate(incrementalPayload));
    });

    it('respects relaxed validation config for dangling references & orphans', () => {
      const orphanPayload = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 's1',
            catalogId: 'https://a2ui.org/catalog',
          },
        },
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's1',
            components: [
              {id: 'root', component: 'Column', children: ['c1']},
              {id: 'c1', component: 'Text', text: 'Child'},
              {id: 'orphan', component: 'Text', text: 'Unused'},
            ],
          },
        },
      ];

      assert.throws(
        () => validator.validate(orphanPayload, undefined, STRICT_VALIDATION),
        (err: any) => err instanceof A2uiIntegrityError && err.message.includes('not reachable'),
      );

      assert.doesNotThrow(() => validator.validate(orphanPayload, undefined, RELAXED_VALIDATION));
    });

    it('enforces missing root even when allowDanglingReferences is true', () => {
      const components = [{id: 'c1', component: 'Text', text: 'No root'}];
      assert.throws(
        () =>
          validateComponentIntegrity(
            components,
            {},
            {allowDanglingReferences: true, allowMissingRoot: false},
          ),
        (err: any) =>
          err instanceof A2uiIntegrityError && err.message.includes("No component has id='root'"),
      );
    });

    it('validates components split across multiple stream messages', () => {
      const splitPayload = [
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's1',
            components: [{id: 'root', component: 'Column', children: ['c1']}],
          },
        },
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's1',
            components: [{id: 'c1', component: 'Text', text: 'Child in second message'}],
          },
        },
      ];

      assert.doesNotThrow(() => validator.validate(splitPayload, undefined, STRICT_VALIDATION));
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

    it('validates v0.9 envelope messages with version adapter', () => {
      const v09Payload = [
        {
          version: 'v0.9',
          createSurface: {
            surfaceId: 's1',
            catalogId: 'basic',
          },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's1',
            components: [{id: 'root', component: 'Box', child: 'txt'}],
          },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's1',
            components: [{id: 'txt', component: 'Text', text: 'Hello v0.9'}],
          },
        },
      ];

      assert.doesNotThrow(() => validator.validate(v09Payload));
    });
  });

  describe('analyzeChildRefSchema & Schema Ref Introspection', () => {
    it('identifies JSON Schema $ref pointers to ChildList and ComponentId', () => {
      const childListRef = {$ref: 'https://a2ui.org/specification/v1_0/common_types.json#/$defs/ChildList'};
      const componentIdRef = {$ref: 'https://a2ui.org/specification/v1_0/common_types.json#/$defs/ComponentId'};
      const childRef = {$ref: 'https://a2ui.org/specification/v1_0/common_types.json#/$defs/Child'};
      const v09ChildListRef = {$ref: 'common_types.json#/definitions/ChildList'};
      const v09ComponentIdRef = {$ref: 'common_types.json#/definitions/ComponentId'};
      const nonChildRef = {$ref: 'common_types.json#/definitions/DynamicString'};

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
      const singleChildApi = z.string().describe('The unique identifier for a component, used for references.');
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
      assert.deepStrictEqual(Array.from(refMap.CustomSplitPane[0]).sort(), ['bottomSlot', 'topSlot']);
      assert.deepStrictEqual(Array.from(refMap.CustomSplitPane[1]), ['sidePanels']);
    });
  });
});
