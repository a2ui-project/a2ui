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

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {z} from 'zod';

import {Catalog} from '../catalog/types.js';
import {
  ActionSchema,
  ChildListSchema,
  ComponentIdSchema,
  DynamicStringSchema,
} from '../v0_9/schema/common-types.js';
import {ChildSchema as V1ChildSchema} from '../v1_0/schema/common-types.js';
import {extractRefFields} from './ref-fields.js';

describe('extractRefFields', () => {
  it('extracts explicit ComponentIdSchema, ChildSchema, ChildListSchema, and REF pointers on any field name', () => {
    const schema = z.object({
      header: ComponentIdSchema.optional(),
      footer: V1ChildSchema.describe('Footer child.').nullable(),
      items: ChildListSchema.describe('Items list.'),
      cards: z.array(ComponentIdSchema).optional(),
      handSingle: z.string().describe('REF:#/$defs/Child|Hand-authored child'),
      handList: z.unknown().describe('REF:common_types.json#/$defs/ChildList|Hand-authored list'),
      tabs: z.array(
        z.object({
          title: z.string(),
          panel: ComponentIdSchema,
        }),
      ),
    });

    const refs = extractRefFields(schema);
    assert.deepStrictEqual(refs.get('header'), {kind: 'single'});
    assert.deepStrictEqual(refs.get('footer'), {kind: 'single'});
    assert.deepStrictEqual(refs.get('items'), {kind: 'list'});
    assert.deepStrictEqual(refs.get('cards'), {kind: 'list'});
    assert.deepStrictEqual(refs.get('handSingle'), {kind: 'single'});
    assert.deepStrictEqual(refs.get('handList'), {kind: 'list'});
    assert.deepStrictEqual(refs.get('tabs'), {kind: 'nested', keys: new Set(['panel'])});
  });

  it('unwraps readonly, branded, refined, default, and lazy wrappers safely', () => {
    const schema = z
      .lazy(() =>
        z.object({
          slot: ComponentIdSchema.brand<'SlotId'>().readonly().optional(),
          list: ChildListSchema.refine(() => true).default([]),
        }),
      )
      .describe('Lazy wrapper');

    const refs = extractRefFields(schema);
    assert.deepStrictEqual(refs.get('slot'), {kind: 'single'});
    assert.deepStrictEqual(refs.get('list'), {kind: 'list'});
  });

  it('terminates cleanly on self-referential z.lazy schemas without misclassifying inline object trees', () => {
    const TreeNodeSchema: z.ZodTypeAny = z.lazy(() =>
      z.object({
        label: z.string(),
        children: z.array(TreeNodeSchema).optional(),
      }),
    );

    const refs = extractRefFields(TreeNodeSchema);
    assert.strictEqual(refs.size, 0);

    const PathologicalLazy: z.ZodTypeAny = z.lazy(() => PathologicalLazy);
    assert.strictEqual(extractRefFields(PathologicalLazy).size, 0);

    const RecursiveArray: z.ZodTypeAny = z.lazy(() => z.array(RecursiveArray));
    assert.strictEqual(extractRefFields(z.object({children: RecursiveArray})).size, 0);

    const RecursiveIncompatibleUnion: z.ZodTypeAny = z.lazy(() =>
      z.union([z.number(), RecursiveIncompatibleUnion]),
    );
    assert.strictEqual(extractRefFields(z.object({child: RecursiveIncompatibleUnion})).size, 0);

    const RecursiveStringUnion: z.ZodTypeAny = z.lazy(() =>
      z.union([RecursiveStringUnion, z.string()]),
    );
    assert.deepStrictEqual(extractRefFields(z.object({child: RecursiveStringUnion})).get('child'), {
      kind: 'single',
    });
  });

  it('extracts child and children fallbacks for z.record, z.any, and z.unknown schemas', () => {
    for (const schema of [
      z.record(z.unknown()),
      z.record(z.string(), z.any()),
      z.any(),
      z.unknown(),
    ]) {
      const refs = extractRefFields(schema);
      assert.deepStrictEqual(refs.get('child'), {kind: 'single'});
      assert.deepStrictEqual(refs.get('children'), {kind: 'list'});
      assert.strictEqual(refs.size, 2);
    }

    const stringRecordRefs = extractRefFields(z.record(z.string()));
    assert.deepStrictEqual(stringRecordRefs.get('child'), {kind: 'single'});
    assert.strictEqual(stringRecordRefs.has('children'), false);

    const numberRecordRefs = extractRefFields(z.record(z.number()));
    assert.strictEqual(numberRecordRefs.size, 0);
  });

  it('extracts child and children fallbacks for empty-shape and open ZodObject schemas', () => {
    for (const schema of [
      z.object({}),
      z.object({}).strict(),
      z.object({title: z.string()}).passthrough(),
      z.object({title: z.string()}).catchall(z.unknown()),
    ]) {
      const refs = extractRefFields(schema);
      assert.deepStrictEqual(refs.get('child'), {kind: 'single'});
      assert.deepStrictEqual(refs.get('children'), {kind: 'list'});
      assert.strictEqual(refs.size, 2);
    }

    const stringCatchallRefs = extractRefFields(z.object({title: z.string()}).catchall(z.string()));
    assert.deepStrictEqual(stringCatchallRefs.get('child'), {kind: 'single'});
    assert.strictEqual(stringCatchallRefs.has('children'), false);

    const numberCatchallRefs = extractRefFields(z.object({title: z.string()}).catchall(z.number()));
    assert.strictEqual(numberCatchallRefs.size, 0);
  });

  it('extracts unannotated child, children, and nested item child fields with compatible types', () => {
    const schema = z.object({
      title: z.string().optional(),
      child: z.string().optional(),
      children: z.array(z.string()).optional(),
      tabItems: z
        .array(
          z.object({
            title: z.string(),
            child: z.string(),
          }),
        )
        .optional(),
      unionItems: z.array(
        z.discriminatedUnion('kind', [
          z.object({kind: z.literal('a'), child: z.string()}),
          z.object({kind: z.literal('b'), panel: ComponentIdSchema}),
        ]),
      ),
      intersectionItems: z.array(
        z.object({title: z.string()}).and(z.object({slot: ComponentIdSchema})),
      ),
    });

    const refs = extractRefFields(schema);
    assert.deepStrictEqual(refs.get('child'), {kind: 'single'});
    assert.deepStrictEqual(refs.get('children'), {kind: 'list'});
    assert.deepStrictEqual(refs.get('tabItems'), {kind: 'nested', keys: new Set(['child'])});
    assert.deepStrictEqual(refs.get('unionItems'), {
      kind: 'nested',
      keys: new Set(['child', 'panel']),
    });
    assert.deepStrictEqual(refs.get('intersectionItems'), {
      kind: 'nested',
      keys: new Set(['slot']),
    });
    assert.strictEqual(refs.has('title'), false);
  });

  it('supports dynamic and unannotated component schemas loaded via Catalog.fromJson', () => {
    const catalog = Catalog.fromJson({
      catalogId: 'https://example.com/dynamic-catalog.json',
      components: {
        EmptyBox: {type: 'object'},
        OpenBox: {
          allOf: [
            {$ref: 'common_types.json#/$defs/ComponentCommon'},
            {
              type: 'object',
              properties: {title: {type: 'string'}},
            },
          ],
          unevaluatedProperties: true,
        },
        UnannotatedContainer: {
          type: 'object',
          properties: {
            child: {type: 'string'},
            children: {type: 'array', items: {type: 'string'}},
          },
        },
        ClosedLeaf: {
          type: 'object',
          properties: {
            label: {$ref: 'common_types.json#/$defs/DynamicString'},
          },
          additionalProperties: false,
        },
      },
    });

    for (const compName of ['EmptyBox', 'OpenBox', 'UnannotatedContainer']) {
      const api = catalog.components.get(compName);
      assert.ok(api, `expected component ${compName}`);
      const refs = extractRefFields(api.schema);
      assert.deepStrictEqual(refs.get('child'), {kind: 'single'}, `${compName}.child`);
      assert.deepStrictEqual(refs.get('children'), {kind: 'list'}, `${compName}.children`);
    }

    const leafApi = catalog.components.get('ClosedLeaf');
    assert.ok(leafApi);
    assert.strictEqual(extractRefFields(leafApi.schema).size, 0);
  });

  it('does not misclassify closed non-child schemas or incompatible scalar types on child/children', () => {
    assert.strictEqual(
      extractRefFields(z.object({text: DynamicStringSchema, variant: z.string().optional()})).size,
      0,
    );

    // An empty mixin intersected with a closed leaf schema is not an empty or open schema.
    assert.strictEqual(extractRefFields(z.object({}).and(z.object({text: z.string()}))).size, 0);

    // Incompatible scalar/array types on `child` or `children` must not be classified as refs.
    assert.strictEqual(
      extractRefFields(z.object({child: z.boolean(), children: z.number()})).size,
      0,
    );
    assert.strictEqual(
      extractRefFields(
        z.object({
          child: z.number(),
          children: z.array(z.number()),
          items: z.array(z.object({title: z.string(), child: z.number()})),
        }),
      ).size,
      0,
    );

    // Explicit non-child A2UI REF markers on `child` / `children` must be respected.
    assert.strictEqual(
      extractRefFields(z.object({child: DynamicStringSchema, children: ActionSchema})).size,
      0,
    );

    // On a passthrough object, an explicitly incompatible `children` stays unclassified
    // while `child` still gets the open-schema fallback.
    const partialOpen = extractRefFields(z.object({children: z.number()}).passthrough());
    assert.deepStrictEqual(partialOpen.get('child'), {kind: 'single'});
    assert.strictEqual(partialOpen.has('children'), false);
  });

  it('merges ref fields across unions and intersections and caches results per schema', () => {
    const unionSchema = z.discriminatedUnion('mode', [
      z.object({mode: z.literal('single'), child: z.string()}),
      z.object({mode: z.literal('list'), children: z.array(z.string())}),
    ]);
    const unionRefs = extractRefFields(unionSchema);
    assert.deepStrictEqual(unionRefs.get('child'), {kind: 'single'});
    assert.deepStrictEqual(unionRefs.get('children'), {kind: 'list'});
    assert.strictEqual(extractRefFields(unionSchema), unionRefs);

    // Union branch ordering: a property that is `single` in one branch and `list` in another
    // must resolve to `list` regardless of branch order.
    const singleBranch = z.object({slot: ComponentIdSchema});
    const listBranch = z.object({slot: ChildListSchema});
    assert.deepStrictEqual(extractRefFields(z.union([singleBranch, listBranch])).get('slot'), {
      kind: 'list',
    });
    assert.deepStrictEqual(extractRefFields(z.union([listBranch, singleBranch])).get('slot'), {
      kind: 'list',
    });

    // Intersection compatibility: narrowing an explicit ref field with `z.string()` keeps it,
    // while narrowing with `z.number()` or an incompatible `ZodRecord` drops it.
    const narrowedValid = z.object({header: ComponentIdSchema}).and(z.object({header: z.string()}));
    assert.deepStrictEqual(extractRefFields(narrowedValid).get('header'), {kind: 'single'});

    const narrowedInvalid = z
      .object({header: ComponentIdSchema})
      .and(z.object({header: z.number()}));
    assert.strictEqual(extractRefFields(narrowedInvalid).has('header'), false);

    const recordInvalid = z.object({child: z.string()}).and(z.record(z.number()));
    assert.strictEqual(extractRefFields(recordInvalid).size, 0);

    const emptyAndStringRecord = z.object({}).and(z.record(z.string()));
    const emptyRecordRefs = extractRefFields(emptyAndStringRecord);
    assert.deepStrictEqual(emptyRecordRefs.get('child'), {kind: 'single'});
    assert.strictEqual(emptyRecordRefs.has('children'), false);
  });
});
