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
    const catalog = new Catalog('drawer-cat', '1.0', [drawerApi]);
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
    const catalogWithoutOptions = new Catalog('drawer-cat', '1.0', [drawerApi]);
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

    const catalog = new Catalog('tree-cat', '1.0', [treeApi]);
    const refMap = catalog.componentRefMap;
    assert.ok(refMap.TreeNode);
    assert.deepStrictEqual(Array.from(refMap.TreeNode.singleRefs), ['childSlot']);
  });

  it('handles recursive z.lazy() union schemas with arrays without cycle overflow', () => {
    type JsonValue = string | number | boolean | null | JsonValue[] | {[key: string]: JsonValue};
    const jsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(jsonSchema),
        z.record(jsonSchema),
      ]),
    );

    const customApi: ComponentApi = {
      name: 'JsonViewer',
      schema: z.object({
        data: jsonSchema,
        childSlot: z.string().describe('REF:common_types.json#/$defs/ComponentId').optional(),
      }),
    };

    const catalog = new Catalog('json-cat', '1.0', [customApi]);
    const refMap = catalog.componentRefMap;
    assert.ok(refMap.JsonViewer);
    assert.deepStrictEqual(Array.from(refMap.JsonViewer.singleRefs), ['childSlot']);
    assert.strictEqual(refMap.JsonViewer.listRefs.size, 0);
  });

  it('correctly identifies multiple sibling references sharing the same schema reference', () => {
    const childId = z.string().describe('REF:common_types.json#/$defs/ComponentId');
    const customApi: ComponentApi = {
      name: 'DualSlotContainer',
      schema: z.object({
        items: z.array(
          z.object({
            left: childId,
            right: childId,
          }),
        ),
      }),
    };

    const catalog = new Catalog('dual-cat', '1.0', [customApi]);
    const refMap = catalog.componentRefMap;
    assert.ok(refMap.DualSlotContainer);
    assert.ok(refMap.DualSlotContainer.listRefs.has('items'));
    const nested = refMap.DualSlotContainer.nestedRefs?.items;
    assert.ok(nested);
    assert.ok(nested.has('left'));
    assert.ok(nested.has('right'));
  });

  it('classifies a union reusing one child schema directly and in an array as a child list', () => {
    const childId = z.string().describe('REF:common_types.json#/$defs/ComponentId');
    const res = analyzeChildRefSchema(z.union([childId, z.array(childId)]), V10_CHILD_REF_OPTIONS);
    assert.strictEqual(res.isChildList, true);
    assert.strictEqual(res.isChild, false);
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

    const catalog = new Catalog('counter-cat', '1.0', [customApi]);
    const refMap = catalog.componentRefMap;
    assert.ok(refMap.CardCounter);
    assert.deepStrictEqual(Array.from(refMap.CardCounter.singleRefs), ['mainSlot']);
    assert.strictEqual(refMap.CardCounter.listRefs.size, 0);
  });

  it('extracts nested child references and child lists from raw JSON schemas with array items', () => {
    const rawComponent = {
      name: 'SectionList',
      schema: {
        type: 'object',
        properties: {
          sections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: {type: 'string'},
                headerChild: {$ref: '#/$defs/ComponentId'},
                childItems: {$ref: '#/$defs/ChildList'},
              },
            },
          },
        },
      },
    };

    const catalog = new Catalog('section-cat', '1.0', [rawComponent as any]);
    const refMap = catalog.componentRefMap;
    assert.ok(refMap.SectionList);
    assert.ok(refMap.SectionList.listRefs.has('sections'));
    assert.ok(refMap.SectionList.nestedRefs?.sections.has('headerChild'));
    assert.strictEqual(refMap.SectionList.nestedRefs?.sections.has('title'), false);
  });

  it('recognizes v0.8 inline string child properties (child, entryPointChild, contentChild)', () => {
    const cardApi: ComponentApi = {
      name: 'Card',
      schema: z.object({
        child: z.string(),
      }),
    };
    const modalApi: ComponentApi = {
      name: 'Modal',
      schema: z.object({
        entryPointChild: z.string(),
        contentChild: z.string(),
      }),
    };
    const tabsApi: ComponentApi = {
      name: 'Tabs',
      schema: z.object({
        tabItems: z.array(
          z.object({
            title: z.string(),
            child: z.string(),
          }),
        ),
      }),
    };

    const v08Catalog = new Catalog('v08-cat', '0.8', [cardApi, modalApi, tabsApi]);
    const refMap = v08Catalog.componentRefMap;
    assert.deepStrictEqual(Array.from(refMap.Card.singleRefs), ['child']);
    assert.deepStrictEqual(Array.from(refMap.Modal.singleRefs).sort(), [
      'contentChild',
      'entryPointChild',
    ]);
    assert.deepStrictEqual(Array.from(refMap.Tabs.listRefs), ['tabItems']);
    assert.ok(refMap.Tabs.nestedRefs?.tabItems.has('child'));
  });

  it('includes z.object({}) containers in componentRefMap while keeping strict and raw empty schemas empty', () => {
    const emptyContainerApi: ComponentApi = {
      name: 'EmptyBox',
      schema: z.object({}),
    };
    const strictEmptyApi: ComponentApi = {
      name: 'StrictEmptyLeaf',
      schema: z.object({}).strict(),
    };
    const rawEmptyLeafApi = {
      name: 'RawEmptyLeaf',
      schema: {type: 'object'},
    } as unknown as ComponentApi;
    const rawOpenApi = {
      name: 'RawOpenBox',
      schema: {type: 'object', additionalProperties: true},
    } as unknown as ComponentApi;
    const openApi: ComponentApi = {
      name: 'OpenBox',
      schema: z.object({title: z.string().optional()}).passthrough(),
    };
    const catchallApi: ComponentApi = {
      name: 'CatchallBox',
      schema: z.object({}).catchall(z.unknown()),
    };
    const recordApi: ComponentApi = {
      name: 'RecordBox',
      schema: z.record(z.unknown()),
    };
    const intersectedOpenApi: ComponentApi = {
      name: 'IntersectedOpenBox',
      schema: z.object({title: z.string().optional()}).and(z.record(z.unknown())),
    };
    const unmarkedAndWrappedApi: ComponentApi = {
      name: 'UnmarkedAndWrapped',
      schema: z
        .object({
          child: z.string().optional(),
          children: z
            .union([z.array(z.string()), z.object({componentId: z.string(), path: z.string()})])
            .catch([])
            .pipe(z.any()),
          incompatiblePipedSlot: z.string().describe('REF:#/$defs/Child').pipe(z.number()),
        })
        .and(
          z.object({
            extraSlot: z.string().describe('REF:#/$defs/Child').catch('fallback').pipe(z.string()),
          }),
        ),
    };

    const catalog = new Catalog('aligned-cat', '1.0', [
      emptyContainerApi,
      strictEmptyApi,
      rawEmptyLeafApi,
      rawOpenApi,
      openApi,
      catchallApi,
      recordApi,
      intersectedOpenApi,
      unmarkedAndWrappedApi,
    ]);
    const refMap = catalog.componentRefMap;

    for (const leafName of ['StrictEmptyLeaf', 'RawEmptyLeaf']) {
      assert.strictEqual(refMap[leafName].singleRefs.size, 0, `${leafName}.singleRefs`);
      assert.strictEqual(refMap[leafName].listRefs.size, 0, `${leafName}.listRefs`);
    }

    for (const openName of [
      'EmptyBox',
      'RawOpenBox',
      'OpenBox',
      'CatchallBox',
      'RecordBox',
      'IntersectedOpenBox',
    ]) {
      assert.deepStrictEqual(
        Array.from(refMap[openName].singleRefs),
        ['child'],
        `${openName}.singleRefs`,
      );
      assert.deepStrictEqual(
        Array.from(refMap[openName].listRefs),
        ['children'],
        `${openName}.listRefs`,
      );
    }

    assert.deepStrictEqual(Array.from(refMap.UnmarkedAndWrapped.singleRefs).sort(), [
      'child',
      'extraSlot',
    ]);
    assert.deepStrictEqual(Array.from(refMap.UnmarkedAndWrapped.listRefs), ['children']);
  });

  it('analyzes ZodPipeline, ZodIntersection, and ZodDiscriminatedUnion in analyzeChildRefSchema', () => {
    const childSchema = z.string().describe('REF:#/$defs/Child');
    const childListSchema = z.array(childSchema).describe('REF:#/$defs/ChildList');

    assert.deepStrictEqual(
      analyzeChildRefSchema(childSchema.pipe(z.string()), V10_CHILD_REF_OPTIONS),
      {isChild: true, isChildList: false},
    );
    assert.deepStrictEqual(
      analyzeChildRefSchema(z.any().pipe(childSchema), V10_CHILD_REF_OPTIONS),
      {
        isChild: true,
        isChildList: false,
      },
    );
    assert.deepStrictEqual(
      analyzeChildRefSchema(childSchema.pipe(z.number()), V10_CHILD_REF_OPTIONS),
      {isChild: false, isChildList: false},
    );
    assert.deepStrictEqual(
      analyzeChildRefSchema(z.number().pipe(childSchema), V10_CHILD_REF_OPTIONS),
      {isChild: false, isChildList: false},
    );

    // Narrowing `Child | ChildList` with `z.string()` preserves `isChild: true`.
    assert.deepStrictEqual(
      analyzeChildRefSchema(
        z.union([childSchema, childListSchema]).and(z.string()),
        V10_CHILD_REF_OPTIONS,
      ),
      {isChild: true, isChildList: false},
    );
    // Intersecting `Child` with `z.array(Child)` is unsatisfiable.
    assert.deepStrictEqual(
      analyzeChildRefSchema(childSchema.and(z.array(childSchema)), V10_CHILD_REF_OPTIONS),
      {isChild: false, isChildList: false},
    );

    const discriminatedRef = z.discriminatedUnion('kind', [
      z.object({kind: z.literal('tpl'), componentId: z.string(), path: z.string()}),
      z.object({kind: z.literal('empty')}),
    ]);
    assert.deepStrictEqual(analyzeChildRefSchema(discriminatedRef, V10_CHILD_REF_OPTIONS), {
      isChild: false,
      isChildList: true,
    });
  });

  it('terminates cleanly on wrapped recursive z.lazy arrays and unions in analyzeChildRefSchema', () => {
    const childSchema = z.string().describe('REF:#/$defs/Child');
    const childListSchema = z.array(childSchema).describe('REF:#/$defs/ChildList');

    const RecursiveOptionalArray: z.ZodTypeAny = z.lazy(() =>
      z.array(RecursiveOptionalArray.optional()),
    );
    assert.deepStrictEqual(analyzeChildRefSchema(RecursiveOptionalArray, V10_CHILD_REF_OPTIONS), {
      isChild: false,
      isChildList: false,
    });

    const RecursiveNullableUnion: z.ZodTypeAny = z.lazy(() =>
      z.union([z.string(), RecursiveNullableUnion.nullable()]),
    );
    assert.deepStrictEqual(analyzeChildRefSchema(RecursiveNullableUnion, V10_CHILD_REF_OPTIONS), {
      isChild: false,
      isChildList: false,
    });

    const RecursiveUnionWithChild: z.ZodTypeAny = z.lazy(() =>
      z.union([RecursiveUnionWithChild.optional(), childSchema]),
    );
    assert.deepStrictEqual(analyzeChildRefSchema(RecursiveUnionWithChild, V10_CHILD_REF_OPTIONS), {
      isChild: true,
      isChildList: false,
    });

    const RecursiveUnionWithChildList: z.ZodTypeAny = z.lazy(() =>
      z.union([RecursiveUnionWithChildList.optional(), childListSchema]),
    );
    assert.deepStrictEqual(
      analyzeChildRefSchema(RecursiveUnionWithChildList, V10_CHILD_REF_OPTIONS),
      {
        isChild: false,
        isChildList: true,
      },
    );

    // Sibling union branches reusing the same schema instance remain analyzed.
    const sharedChild = childSchema.optional();
    assert.deepStrictEqual(
      analyzeChildRefSchema(z.union([sharedChild, sharedChild]), V10_CHILD_REF_OPTIONS),
      {isChild: true, isChildList: false},
    );
  });
});
