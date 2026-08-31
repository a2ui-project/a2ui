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
  isChildListSchema,
  isChildOrChildListSchema,
  isChildSchema,
} from './reference-map.js';
import {Catalog} from './types.js';
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
    assert.deepStrictEqual(Array.from(refMap.CustomSplitPane[0]).sort(), ['bottomSlot', 'topSlot']);
    assert.deepStrictEqual(Array.from(refMap.CustomSplitPane[1]), ['sidePanels']);
  });

  it('prioritizes isChildList over isChild when inspecting oneOf combiners with both', () => {
    const mixedUnionSchema = {
      oneOf: [
        {$ref: 'https://a2ui.org/specification/v1_0/common_types.json#/$defs/ComponentId'},
        {$ref: 'https://a2ui.org/specification/v1_0/common_types.json#/$defs/ChildList'},
      ],
    };
    const res = analyzeChildRefSchema(mixedUnionSchema);
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

    const refMap = buildComponentRefMap([rawJsonSchemaApi as any]);
    assert.ok(refMap.PlainJsonComponent);
    assert.deepStrictEqual(Array.from(refMap.PlainJsonComponent[0]), ['headerSlot']);
    assert.deepStrictEqual(Array.from(refMap.PlainJsonComponent[1]), ['itemsSlot']);
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
    assert.deepStrictEqual(Array.from(refMap1.Drawer[0]), ['slot']);
  });
});
