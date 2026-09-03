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
 * @fileoverview Unit tests for catalog reference map introspection and schema analysis.
 */

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeChildRefSchema,
  buildComponentRefMap,
  ChildRefAnalysisOptions,
  extractRefDefName,
  isChildListSchema,
  isChildOrChildListSchema,
  isChildSchema,
} from './reference-map.js';
import {Catalog, ComponentApi} from './types.js';
import {V08_CHILD_REF_OPTIONS} from '../v0_8/standard_defs.js';
import {V09_CHILD_REF_OPTIONS} from '../v0_9/standard_defs.js';
import {V10_CHILD_REF_OPTIONS} from '../v1_0/standard_defs.js';
import {z} from 'zod';

describe('reference-map schema introspection', () => {
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

    const childListAnalysis = analyzeChildRefSchema(childListRef, V10_CHILD_REF_OPTIONS);
    assert.strictEqual(childListAnalysis.isChildList, true);
    assert.strictEqual(childListAnalysis.isChild, false);

    const componentIdAnalysis = analyzeChildRefSchema(componentIdRef, V10_CHILD_REF_OPTIONS);
    assert.strictEqual(componentIdAnalysis.isChild, true);
    assert.strictEqual(componentIdAnalysis.isChildList, false);

    assert.strictEqual(isChildListSchema(childListRef, V10_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildSchema(childListRef, V10_CHILD_REF_OPTIONS), false);

    assert.strictEqual(isChildSchema(componentIdRef, V10_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildListSchema(componentIdRef, V10_CHILD_REF_OPTIONS), false);

    assert.strictEqual(isChildSchema(childRef, V10_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildListSchema(childRef, V10_CHILD_REF_OPTIONS), false);

    assert.strictEqual(isChildListSchema(v09ChildListRef, V09_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildSchema(v09ComponentIdRef, V09_CHILD_REF_OPTIONS), true);

    assert.strictEqual(isChildOrChildListSchema(nonChildRef, V09_CHILD_REF_OPTIONS), false);
  });

  it('identifies Zod schemas for ComponentId and ChildList via REF pointers and structure', () => {
    const singleChildApi = z
      .string()
      .describe('REF:#/$defs/ComponentId|Custom child reference slot.');
    const childListUnion = z.union([
      z.array(singleChildApi),
      z.object({componentId: z.string(), path: z.string()}),
    ]);
    const normalString = z.string().describe('A normal text field');

    assert.strictEqual(isChildSchema(singleChildApi, V09_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildListSchema(singleChildApi, V09_CHILD_REF_OPTIONS), false);

    assert.strictEqual(isChildListSchema(childListUnion, V09_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildSchema(childListUnion, V09_CHILD_REF_OPTIONS), false);

    assert.strictEqual(isChildOrChildListSchema(normalString, V09_CHILD_REF_OPTIONS), false);
  });

  it('identifies Zod schemas stamped with markChildRef metadata without description', () => {
    const markedChild = z.string();
    (markedChild._def as any).a2uiChildRef = 'component-id';

    const markedList = z.union([z.array(z.string()), z.any()]);
    (markedList._def as any).a2uiChildRef = 'child-list';

    assert.strictEqual(isChildSchema(markedChild, V10_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildListSchema(markedChild, V10_CHILD_REF_OPTIONS), false);

    assert.strictEqual(isChildListSchema(markedList, V10_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildSchema(markedList, V10_CHILD_REF_OPTIONS), false);
  });

  it('builds dynamic ref map for custom components with non-standard property names', () => {
    const customSplitPaneApi = {
      name: 'CustomSplitPane',
      schema: z.object({
        topSlot: z.string().describe('REF:#/$defs/ComponentId'),
        bottomSlot: z.string().describe('REF:#/$defs/ComponentId'),
        sidePanels: z.array(z.string().describe('REF:#/$defs/ComponentId')),
      }),
    };

    const refMap = buildComponentRefMap([customSplitPaneApi], V09_CHILD_REF_OPTIONS);
    assert.ok(refMap.CustomSplitPane);
    assert.deepStrictEqual(Array.from(refMap.CustomSplitPane.singleRefs).sort(), [
      'bottomSlot',
      'topSlot',
    ]);
    assert.deepStrictEqual(Array.from(refMap.CustomSplitPane.listRefs), ['sidePanels']);
  });

  it('prioritizes isChildList over isChild when inspecting oneOf combiners with both', () => {
    const mixedUnionSchema = {
      oneOf: [
        {$ref: 'https://a2ui.org/specification/v1_0/common_types.json#/$defs/ComponentId'},
        {$ref: 'https://a2ui.org/specification/v1_0/common_types.json#/$defs/ChildList'},
      ],
    };
    const res = analyzeChildRefSchema(mixedUnionSchema, V10_CHILD_REF_OPTIONS);
    assert.strictEqual(res.isChildList, true);
    assert.strictEqual(res.isChild, false);
  });

  it('builds dynamic ref map from plain JSON Schema component definitions', () => {
    const rawJsonSchemaApi = {
      name: 'PlainJsonComponent',
      schema: {
        type: 'object',
        properties: {
          headerSlot: {
            $ref: 'https://a2ui.org/specification/v1_0/common_types.json#/$defs/ComponentId',
          },
          itemsSlot: {
            $ref: 'https://a2ui.org/specification/v1_0/common_types.json#/$defs/ChildList',
          },
          label: {type: 'string'},
        },
      },
    };

    const refMap = buildComponentRefMap([rawJsonSchemaApi as any], V10_CHILD_REF_OPTIONS);
    assert.ok(refMap.PlainJsonComponent);
    assert.deepStrictEqual(Array.from(refMap.PlainJsonComponent.singleRefs), ['headerSlot']);
    assert.deepStrictEqual(Array.from(refMap.PlainJsonComponent.listRefs), ['itemsSlot']);
  });

  it('extracts definition names from various JSON Schema $ref pointer formats', () => {
    assert.strictEqual(
      extractRefDefName('https://a2ui.org/specification/v1_0/common_types.json#/$defs/ChildList'),
      'ChildList',
    );
    assert.strictEqual(
      extractRefDefName('common_types.json#/definitions/ComponentId'),
      'ComponentId',
    );
    assert.strictEqual(extractRefDefName('custom_types.json#/$defs/Child'), 'Child');
    assert.strictEqual(extractRefDefName('#/definitions/ChildList'), 'ChildList');
    assert.strictEqual(extractRefDefName('#ChildList'), 'ChildList');
    assert.strictEqual(extractRefDefName('ComponentId'), 'ComponentId');
    assert.strictEqual(extractRefDefName(''), '');
  });

  it('recognizes child and child list references in custom or future schema filenames', () => {
    const customChildListRef = {
      $ref: 'https://example.com/spec/v2/shared_components.json#/$defs/ChildList',
    };
    const customComponentIdRef = {
      $ref: 'other_types.json#/definitions/ComponentId',
    };
    const customChildRef = {
      $ref: '../catalog/definitions.json#/$defs/Child',
    };

    assert.strictEqual(isChildListSchema(customChildListRef, V10_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildSchema(customChildListRef, V10_CHILD_REF_OPTIONS), false);

    assert.strictEqual(isChildSchema(customComponentIdRef, V10_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildListSchema(customComponentIdRef, V10_CHILD_REF_OPTIONS), false);

    assert.strictEqual(isChildSchema(customChildRef, V10_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildListSchema(customChildRef, V10_CHILD_REF_OPTIONS), false);
  });

  it('supports custom ChildRefAnalysisOptions for extensible type names', () => {
    const customTargetRef = {$ref: 'custom.json#/$defs/CustomSlotTarget'};
    const customListRef = {$ref: 'custom.json#/$defs/CustomSlotListTarget'};

    // Default v0.9 analysis does not match custom names
    assert.strictEqual(isChildOrChildListSchema(customTargetRef, V09_CHILD_REF_OPTIONS), false);
    assert.strictEqual(isChildOrChildListSchema(customListRef, V09_CHILD_REF_OPTIONS), false);

    // Custom options recognize them
    const customOptions: ChildRefAnalysisOptions = {
      childRefNames: new Set(['CustomSlotTarget']),
      childListRefNames: new Set(['CustomSlotListTarget']),
    };

    assert.strictEqual(isChildSchema(customTargetRef, customOptions), true);
    assert.strictEqual(isChildListSchema(customTargetRef, customOptions), false);

    assert.strictEqual(isChildListSchema(customListRef, customOptions), true);
    assert.strictEqual(isChildSchema(customListRef, customOptions), false);
  });

  it('exposes version-specific reference token sets', () => {
    assert.ok(V08_CHILD_REF_OPTIONS.childRefNames.has('ComponentId'));
    assert.ok(V08_CHILD_REF_OPTIONS.childRefNames.has('Child'));
    assert.ok(V08_CHILD_REF_OPTIONS.childListRefNames.has('ChildList'));

    assert.ok(V09_CHILD_REF_OPTIONS.childRefNames.has('ComponentId'));
    assert.ok(V09_CHILD_REF_OPTIONS.childListRefNames.has('ChildList'));

    assert.ok(V10_CHILD_REF_OPTIONS.childRefNames.has('ComponentId'));
    assert.ok(V10_CHILD_REF_OPTIONS.childListRefNames.has('ChildList'));
    assert.ok(V10_CHILD_REF_OPTIONS.childListRefNames.has('TemplateChildList'));
  });

  it('lazily computes and caches componentRefMap on Catalog instance', () => {
    const drawerApi = {
      name: 'Drawer',
      schema: z.object({
        slot: z.string().describe('ComponentId'),
      }),
    };
    const catalog = new Catalog('drawer-cat', [drawerApi]);
    const refMap1 = catalog.componentRefMap;
    const refMap2 = catalog.componentRefMap;
    assert.strictEqual(refMap1, refMap2);
    assert.ok(refMap1.Drawer);
    assert.deepStrictEqual(Array.from(refMap1.Drawer.singleRefs), ['slot']);
  });

  it('safely defaults componentRefMap to standard options when refOptions is omitted', () => {
    const drawerApi = {
      name: 'Drawer',
      schema: z.object({
        slot: z.string().describe('ComponentId'),
      }),
    };
    const catalogWithoutOptions = new Catalog('drawer-cat', [drawerApi]);
    const refMap = catalogWithoutOptions.componentRefMap;
    assert.ok(refMap.Drawer);
    assert.deepStrictEqual(Array.from(refMap.Drawer.singleRefs), ['slot']);
  });

  it('handles recursive z.lazy() component schemas without cycle overflow', () => {
    interface TreeNodeSchema {
      label: string;
      childSlot?: string;
      nestedNode?: TreeNodeSchema;
    }
    const treeNodeSchema: z.ZodType<TreeNodeSchema> = z.lazy(() =>
      z.object({
        label: z.string(),
        childSlot: z.string().describe('REF:common_types.json#/$defs/ComponentId').optional(),
        nestedNode: treeNodeSchema.optional(),
      }),
    );

    const treeApi: ComponentApi = {
      name: 'TreeNode',
      schema: treeNodeSchema,
    };

    const catalog = new Catalog('tree-cat', [treeApi]);
    const refMap = catalog.componentRefMap;
    assert.ok(refMap.TreeNode);
    assert.deepStrictEqual(Array.from(refMap.TreeNode.singleRefs), ['childSlot']);
  });

  it('does not falsely classify non-ID properties whose descriptions mention child components', () => {
    const customApi: ComponentApi = {
      name: 'CardCounter',
      schema: z.object({
        childCount: z.number().describe('The total count of child components in this view'),
        hasChildren: z.boolean().describe('Whether child component is rendered'),
        mainSlot: z.string().describe('REF:common_types.json#/$defs/ComponentId'),
      }),
    };

    const catalog = new Catalog('counter-cat', [customApi]);
    const refMap = catalog.componentRefMap;
    assert.ok(refMap.CardCounter);
    assert.deepStrictEqual(Array.from(refMap.CardCounter.singleRefs), ['mainSlot']);
    assert.strictEqual(refMap.CardCounter.listRefs.size, 0);
  });
});
