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
import type {SchemaDoc} from '../schema-engine/nav.js';
import V10CommonTypes from '../v1_0/schemas/common_types.json' with {type: 'json'};
import {fromJsonSchema} from '../schema-engine/from-json-schema.js';
import type {CompiledValidator, JsonSchema, JsonSchemaValidator} from '../schema-engine/types.js';
import {jsonFixture} from '../test/schema.js';

const docOf = (root: JsonSchema): SchemaDoc => ({
  root,
  defs: {'common_types.json': V10CommonTypes as JsonSchema},
});
const analyze = (node: JsonSchema, options: ChildRefAnalysisOptions) =>
  analyzeChildRefSchema(node, docOf(node), options);
const isChild = (node: JsonSchema, options: ChildRefAnalysisOptions) =>
  isChildSchema(node, docOf(node), options);
const isChildList = (node: JsonSchema, options: ChildRefAnalysisOptions) =>
  isChildListSchema(node, docOf(node), options);
const isEither = (node: JsonSchema, options: ChildRefAnalysisOptions) =>
  isChildOrChildListSchema(node, docOf(node), options);

/**
 * A plain JSON Schema as a component schema. These fixtures are read for
 * discovery only, and some reference documents no validator could resolve.
 */
const acceptAll: JsonSchemaValidator = {
  compile: <T>() =>
    ((value: unknown) => ({success: true, data: value as T})) as CompiledValidator<T>,
};
const json = (schema: JsonSchema) => fromJsonSchema(schema, acceptAll);

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

    const childListAnalysis = analyze(childListRef, V10_CHILD_REF_OPTIONS);
    assert.strictEqual(childListAnalysis.isChildList, true);
    assert.strictEqual(childListAnalysis.isChild, false);

    const componentIdAnalysis = analyze(componentIdRef, V10_CHILD_REF_OPTIONS);
    assert.strictEqual(componentIdAnalysis.isChild, true);
    assert.strictEqual(componentIdAnalysis.isChildList, false);

    assert.strictEqual(isChildList(childListRef, V10_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChild(childListRef, V10_CHILD_REF_OPTIONS), false);

    assert.strictEqual(isChild(componentIdRef, V10_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildList(componentIdRef, V10_CHILD_REF_OPTIONS), false);

    assert.strictEqual(isChild(childRef, V10_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildList(childRef, V10_CHILD_REF_OPTIONS), false);

    assert.strictEqual(isChildList(v09ChildListRef, V09_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChild(v09ComponentIdRef, V09_CHILD_REF_OPTIONS), true);

    assert.strictEqual(isEither(nonChildRef, V09_CHILD_REF_OPTIONS), false);
  });

  it('identifies ComponentId and ChildList via REF pointers and structure', () => {
    const singleChildApi = {
      type: 'string',
      description: 'REF:#/$defs/ComponentId|Custom child reference slot.',
    };
    const childListUnion = {
      anyOf: [
        {type: 'array', items: singleChildApi},
        {type: 'object', properties: {componentId: {type: 'string'}, path: {type: 'string'}}},
      ],
    };
    const normalString = {type: 'string', description: 'A normal text field'};

    assert.strictEqual(isChild(singleChildApi, V09_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildList(singleChildApi, V09_CHILD_REF_OPTIONS), false);

    assert.strictEqual(isChildList(childListUnion, V09_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChild(childListUnion, V09_CHILD_REF_OPTIONS), false);

    assert.strictEqual(isEither(normalString, V09_CHILD_REF_OPTIONS), false);
  });

  it('identifies $refs to the common Child and ChildList definitions without a description', () => {
    const markedChild = {$ref: 'common_types.json#/$defs/ComponentId'};
    const markedList = {$ref: 'common_types.json#/$defs/ChildList'};

    assert.strictEqual(isChild(markedChild, V10_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildList(markedChild, V10_CHILD_REF_OPTIONS), false);

    assert.strictEqual(isChildList(markedList, V10_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChild(markedList, V10_CHILD_REF_OPTIONS), false);
  });

  it('builds dynamic ref map for custom components with non-standard property names', () => {
    const customSplitPaneApi = {
      name: 'CustomSplitPane',
      schema: jsonFixture({
        'type': 'object',
        'properties': {
          'topSlot': {'$ref': 'common_types.json#/$defs/ComponentId'},
          'bottomSlot': {'$ref': 'common_types.json#/$defs/ComponentId'},
          'sidePanels': {
            'type': 'array',
            'items': {'$ref': 'common_types.json#/$defs/ComponentId'},
          },
        },
        'required': ['topSlot', 'bottomSlot', 'sidePanels'],
        'additionalProperties': false,
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
    const res = analyze(mixedUnionSchema, V10_CHILD_REF_OPTIONS);
    assert.strictEqual(res.isChildList, true);
    assert.strictEqual(res.isChild, false);
  });

  it('builds dynamic ref map from plain JSON Schema component definitions', () => {
    const rawJsonSchemaApi = {
      name: 'PlainJsonComponent',
      schema: json({
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
      }),
    };

    const refMap = buildComponentRefMap([rawJsonSchemaApi], V10_CHILD_REF_OPTIONS);
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

    assert.strictEqual(isChildList(customChildListRef, V10_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChild(customChildListRef, V10_CHILD_REF_OPTIONS), false);

    assert.strictEqual(isChild(customComponentIdRef, V10_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildList(customComponentIdRef, V10_CHILD_REF_OPTIONS), false);

    assert.strictEqual(isChild(customChildRef, V10_CHILD_REF_OPTIONS), true);
    assert.strictEqual(isChildList(customChildRef, V10_CHILD_REF_OPTIONS), false);
  });

  it('supports custom ChildRefAnalysisOptions for extensible type names', () => {
    const customTargetRef = {$ref: 'custom.json#/$defs/CustomSlotTarget'};
    const customListRef = {$ref: 'custom.json#/$defs/CustomSlotListTarget'};

    // Default v0.9 analysis does not match custom names
    assert.strictEqual(isEither(customTargetRef, V09_CHILD_REF_OPTIONS), false);
    assert.strictEqual(isEither(customListRef, V09_CHILD_REF_OPTIONS), false);

    // Custom options recognize them
    const customOptions: ChildRefAnalysisOptions = {
      childRefNames: new Set(['CustomSlotTarget']),
      childListRefNames: new Set(['CustomSlotListTarget']),
    };

    assert.strictEqual(isChild(customTargetRef, customOptions), true);
    assert.strictEqual(isChildList(customTargetRef, customOptions), false);

    assert.strictEqual(isChildList(customListRef, customOptions), true);
    assert.strictEqual(isChild(customListRef, customOptions), false);
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
      schema: jsonFixture({
        'type': 'object',
        'properties': {'slot': {'type': 'string', 'description': 'ComponentId'}},
        'required': ['slot'],
        'additionalProperties': false,
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
      schema: jsonFixture({
        'type': 'object',
        'properties': {'slot': {'type': 'string', 'description': 'ComponentId'}},
        'required': ['slot'],
        'additionalProperties': false,
      }),
    };
    const catalogWithoutOptions = new Catalog('drawer-cat', '1.0', [drawerApi]);
    const refMap = catalogWithoutOptions.componentRefMap;
    assert.ok(refMap.Drawer);
    assert.deepStrictEqual(Array.from(refMap.Drawer.singleRefs), ['slot']);
  });

  it('handles recursive component schemas without cycle overflow', () => {
    const treeApi: ComponentApi = {
      name: 'TreeNode',
      schema: jsonFixture({
        $ref: '#/$defs/TreeNode',
        $defs: {
          TreeNode: {
            type: 'object',
            properties: {
              label: {type: 'string'},
              childSlot: {$ref: 'common_types.json#/$defs/ComponentId'},
              nestedNode: {$ref: '#/$defs/TreeNode'},
            },
            required: ['label'],
            additionalProperties: false,
          },
        },
      }),
    };

    const catalog = new Catalog('tree-cat', '1.0', [treeApi]);
    const refMap = catalog.componentRefMap;
    assert.ok(refMap.TreeNode);
    assert.deepStrictEqual(Array.from(refMap.TreeNode.singleRefs), ['childSlot']);
  });

  it('handles recursive union schemas with arrays without cycle overflow', () => {
    const customApi: ComponentApi = {
      name: 'JsonViewer',
      schema: jsonFixture({
        type: 'object',
        properties: {
          data: {$ref: '#/$defs/JsonValue'},
          childSlot: {$ref: 'common_types.json#/$defs/ComponentId'},
        },
        required: ['data'],
        additionalProperties: false,
        $defs: {
          JsonValue: {
            anyOf: [
              {type: 'string'},
              {type: 'number'},
              {type: 'boolean'},
              {type: 'null'},
              {type: 'array', items: {$ref: '#/$defs/JsonValue'}},
              {type: 'object', additionalProperties: {$ref: '#/$defs/JsonValue'}},
            ],
          },
        },
      }),
    };

    const catalog = new Catalog('json-cat', '1.0', [customApi]);
    const refMap = catalog.componentRefMap;
    assert.ok(refMap.JsonViewer);
    assert.deepStrictEqual(Array.from(refMap.JsonViewer.singleRefs), ['childSlot']);
    assert.strictEqual(refMap.JsonViewer.listRefs.size, 0);
  });

  it('correctly identifies multiple sibling references sharing the same schema reference', () => {
    const customApi: ComponentApi = {
      name: 'DualSlotContainer',
      schema: jsonFixture({
        'type': 'object',
        'properties': {
          'items': {
            'type': 'array',
            'items': {
              'type': 'object',
              'properties': {
                'left': {'$ref': 'common_types.json#/$defs/ComponentId'},
                'right': {'$ref': 'common_types.json#/$defs/ComponentId'},
              },
              'required': ['left', 'right'],
              'additionalProperties': false,
            },
          },
        },
        'required': ['items'],
        'additionalProperties': false,
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
    const childId = {type: 'string', description: 'REF:common_types.json#/$defs/ComponentId'};
    const res = analyze({anyOf: [childId, {type: 'array', items: childId}]}, V10_CHILD_REF_OPTIONS);
    assert.strictEqual(res.isChildList, true);
    assert.strictEqual(res.isChild, false);
  });

  it('does not falsely classify non-ID properties whose descriptions mention child components', () => {
    const customApi: ComponentApi = {
      name: 'CardCounter',
      schema: jsonFixture({
        'type': 'object',
        'properties': {
          'childCount': {
            'type': 'number',
            'description': 'The total count of child components in this view',
          },
          'hasChildren': {'type': 'boolean', 'description': 'Whether child component is rendered'},
          'mainSlot': {'$ref': 'common_types.json#/$defs/ComponentId'},
        },
        'required': ['childCount', 'hasChildren', 'mainSlot'],
        'additionalProperties': false,
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
      schema: json({
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
      }),
    };

    const catalog = new Catalog('section-cat', '1.0', [rawComponent]);
    const refMap = catalog.componentRefMap;
    assert.ok(refMap.SectionList);
    assert.ok(refMap.SectionList.listRefs.has('sections'));
    assert.ok(refMap.SectionList.nestedRefs?.sections.has('headerChild'));
    assert.strictEqual(refMap.SectionList.nestedRefs?.sections.has('title'), false);
  });

  it('recognizes v0.8 inline string child properties (child, entryPointChild, contentChild)', () => {
    const cardApi: ComponentApi = {
      name: 'Card',
      schema: jsonFixture({
        'type': 'object',
        'properties': {'child': {'type': 'string'}},
        'required': ['child'],
        'additionalProperties': false,
      }),
    };
    const modalApi: ComponentApi = {
      name: 'Modal',
      schema: jsonFixture({
        'type': 'object',
        'properties': {'entryPointChild': {'type': 'string'}, 'contentChild': {'type': 'string'}},
        'required': ['entryPointChild', 'contentChild'],
        'additionalProperties': false,
      }),
    };
    const tabsApi: ComponentApi = {
      name: 'Tabs',
      schema: jsonFixture({
        'type': 'object',
        'properties': {
          'tabItems': {
            'type': 'array',
            'items': {
              'type': 'object',
              'properties': {'title': {'type': 'string'}, 'child': {'type': 'string'}},
              'required': ['title', 'child'],
              'additionalProperties': false,
            },
          },
        },
        'required': ['tabItems'],
        'additionalProperties': false,
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

  it('includes open containers in componentRefMap while keeping strip, strict and raw empty schemas empty', () => {
    const emptyContainerApi: ComponentApi = {
      name: 'EmptyBox',
      schema: jsonFixture({'type': 'object', 'properties': {}, 'additionalProperties': false}),
    };
    const strictEmptyApi: ComponentApi = {
      name: 'StrictEmptyLeaf',
      schema: jsonFixture({'type': 'object', 'properties': {}, 'additionalProperties': false}),
    };
    const rawEmptyLeafApi: ComponentApi = {
      name: 'RawEmptyLeaf',
      schema: json({type: 'object'}),
    };
    const rawOpenApi: ComponentApi = {
      name: 'RawOpenBox',
      schema: json({type: 'object', additionalProperties: true}),
    };
    const openApi: ComponentApi = {
      name: 'OpenBox',
      schema: jsonFixture({
        'type': 'object',
        'properties': {'title': {'type': 'string'}},
        'additionalProperties': true,
      }),
    };
    const catchallApi: ComponentApi = {
      name: 'CatchallBox',
      schema: jsonFixture({'type': 'object', 'properties': {}, 'additionalProperties': {}}),
    };
    const recordApi: ComponentApi = {
      name: 'RecordBox',
      schema: jsonFixture({'type': 'object', 'additionalProperties': {}}),
    };
    const intersectedOpenApi: ComponentApi = {
      name: 'IntersectedOpenBox',
      schema: jsonFixture({
        'allOf': [
          {'type': 'object', 'properties': {'title': {'type': 'string'}}},
          {'type': 'object', 'additionalProperties': {}},
        ],
      }),
    };
    const unmarkedAndWrappedApi: ComponentApi = {
      name: 'UnmarkedAndWrapped',
      schema: jsonFixture({
        'allOf': [
          {
            'type': 'object',
            'properties': {
              'child': {'type': 'string'},
              'children': {
                'allOf': [
                  {
                    'anyOf': [
                      {'type': 'array', 'items': {'type': 'string'}},
                      {
                        'type': 'object',
                        'properties': {
                          'componentId': {'type': 'string'},
                          'path': {'type': 'string'},
                        },
                        'required': ['componentId', 'path'],
                        'additionalProperties': false,
                      },
                    ],
                  },
                  {},
                ],
              },
              'incompatiblePipedSlot': {
                'allOf': [{'$ref': 'common_types.json#/$defs/Child'}, {'type': 'number'}],
              },
            },
            'required': ['incompatiblePipedSlot'],
          },
          {
            'type': 'object',
            'properties': {
              'extraSlot': {
                'allOf': [{'$ref': 'common_types.json#/$defs/Child'}, {'type': 'string'}],
              },
            },
          },
        ],
        'unevaluatedProperties': false,
      }),
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

    // A strip `z.object({})` is closed (`additionalProperties: false`).
    for (const leafName of ['EmptyBox', 'StrictEmptyLeaf', 'RawEmptyLeaf']) {
      assert.strictEqual(refMap[leafName].singleRefs.size, 0, `${leafName}.singleRefs`);
      assert.strictEqual(refMap[leafName].listRefs.size, 0, `${leafName}.listRefs`);
    }

    for (const openName of [
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

  it('analyzes allOf stages, intersections, and discriminated unions in analyzeChildRefSchema', () => {
    const childSchema = {type: 'string', description: 'REF:#/$defs/Child'};
    const childListSchema = {
      type: 'array',
      items: childSchema,
      description: 'REF:#/$defs/ChildList',
    };
    const str = {type: 'string'};
    const num = {type: 'number'};

    assert.deepStrictEqual(analyze({allOf: [childSchema, str]}, V10_CHILD_REF_OPTIONS), {
      isChild: true,
      isChildList: false,
    });
    assert.deepStrictEqual(analyze({allOf: [{}, childSchema]}, V10_CHILD_REF_OPTIONS), {
      isChild: true,
      isChildList: false,
    });
    assert.deepStrictEqual(analyze({allOf: [childSchema, num]}, V10_CHILD_REF_OPTIONS), {
      isChild: false,
      isChildList: false,
    });
    assert.deepStrictEqual(analyze({allOf: [num, childSchema]}, V10_CHILD_REF_OPTIONS), {
      isChild: false,
      isChildList: false,
    });

    // Narrowing `Child | ChildList` with a string preserves `isChild: true`.
    assert.deepStrictEqual(
      analyze({allOf: [{anyOf: [childSchema, childListSchema]}, str]}, V10_CHILD_REF_OPTIONS),
      {isChild: true, isChildList: false},
    );
    // Intersecting `Child` with an array of `Child` is unsatisfiable.
    assert.deepStrictEqual(
      analyze({allOf: [childSchema, {type: 'array', items: childSchema}]}, V10_CHILD_REF_OPTIONS),
      {isChild: false, isChildList: false},
    );

    const discriminatedRef = {
      anyOf: [
        {
          type: 'object',
          properties: {kind: {const: 'tpl'}, componentId: str, path: str},
        },
        {type: 'object', properties: {kind: {const: 'empty'}}},
      ],
    };
    assert.deepStrictEqual(analyze(discriminatedRef, V10_CHILD_REF_OPTIONS), {
      isChild: false,
      isChildList: true,
    });
  });

  it('terminates cleanly on recursive $ref arrays and unions in analyzeChildRefSchema', () => {
    const childSchema = {type: 'string', description: 'REF:#/$defs/Child'};
    const childListSchema = {
      type: 'array',
      items: childSchema,
      description: 'REF:#/$defs/ChildList',
    };
    const recursive = (def: JsonSchema) => ({$defs: {R: def}, $ref: '#/$defs/R'});
    const self = {$ref: '#/$defs/R'};
    const optional = (s: JsonSchema) => ({anyOf: [{not: {}}, s]});
    const nullable = (s: JsonSchema) => ({anyOf: [s, {type: 'null'}]});

    assert.deepStrictEqual(
      analyze(recursive({type: 'array', items: optional(self)}), V10_CHILD_REF_OPTIONS),
      {isChild: false, isChildList: false},
    );
    assert.deepStrictEqual(
      analyze(recursive({anyOf: [{type: 'string'}, nullable(self)]}), V10_CHILD_REF_OPTIONS),
      {isChild: false, isChildList: false},
    );
    assert.deepStrictEqual(
      analyze(recursive({anyOf: [optional(self), childSchema]}), V10_CHILD_REF_OPTIONS),
      {isChild: true, isChildList: false},
    );
    assert.deepStrictEqual(
      analyze(recursive({anyOf: [optional(self), childListSchema]}), V10_CHILD_REF_OPTIONS),
      {isChild: false, isChildList: true},
    );

    // Sibling union branches reusing the same schema object remain analyzed.
    const sharedChild = optional(childSchema);
    assert.deepStrictEqual(analyze({anyOf: [sharedChild, sharedChild]}, V10_CHILD_REF_OPTIONS), {
      isChild: true,
      isChildList: false,
    });
  });
});
