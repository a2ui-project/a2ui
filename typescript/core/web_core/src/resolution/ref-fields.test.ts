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

  it('unwraps readonly, branded, refined, default, catch, pipeline, and lazy wrappers safely', () => {
    const schema = z
      .lazy(() =>
        z.object({
          slot: ComponentIdSchema.brand<'SlotId'>().readonly().optional(),
          list: ChildListSchema.refine(() => true).default([]),
          caughtSingle: ComponentIdSchema.catch('fallback'),
          pipedSingle: ComponentIdSchema.pipe(z.string()),
          pipedFromAny: z.any().pipe(ComponentIdSchema),
          transformedSingle: ComponentIdSchema.transform(s => s.trim()).pipe(z.string()),
          incompatiblePipeIn: z.number().pipe(ComponentIdSchema),
          incompatiblePipeOut: ComponentIdSchema.pipe(z.number()),
          incompatibleTransformPipe: z.number().transform(String).pipe(ComponentIdSchema),
        }),
      )
      .describe('Lazy wrapper');

    const refs = extractRefFields(schema);
    assert.deepStrictEqual(refs.get('slot'), {kind: 'single'});
    assert.deepStrictEqual(refs.get('list'), {kind: 'list'});
    assert.deepStrictEqual(refs.get('caughtSingle'), {kind: 'single'});
    assert.deepStrictEqual(refs.get('pipedSingle'), {kind: 'single'});
    assert.deepStrictEqual(refs.get('pipedFromAny'), {kind: 'single'});
    assert.deepStrictEqual(refs.get('transformedSingle'), {kind: 'single'});
    assert.strictEqual(refs.has('incompatiblePipeIn'), false);
    assert.strictEqual(refs.has('incompatiblePipeOut'), false);
    assert.strictEqual(refs.has('incompatibleTransformPipe'), false);
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

    // Non-transform pipelines must satisfy both input and output wire constraints.
    assert.strictEqual(extractRefFields(z.number().pipe(z.any())).size, 0);
    assert.strictEqual(extractRefFields(z.any().pipe(z.number())).size, 0);
    assert.strictEqual(extractRefFields(z.number().transform(String).pipe(z.any())).size, 0);
  });

  it('extracts child and children fallbacks for unannotated empty-shape and open ZodObject schemas while excluding strict or closed empty schemas', () => {
    for (const schema of [
      z.object({}),
      z.object({title: z.string()}).passthrough(),
      z.object({title: z.string()}).catchall(z.unknown()),
    ]) {
      const refs = extractRefFields(schema);
      assert.deepStrictEqual(refs.get('child'), {kind: 'single'});
      assert.deepStrictEqual(refs.get('children'), {kind: 'list'});
      assert.strictEqual(refs.size, 2);
    }

    // Strict or incompatible catchall empty objects reject unknown `child`/`children` keys.
    assert.strictEqual(extractRefFields(z.object({}).strict()).size, 0);
    assert.strictEqual(extractRefFields(z.object({}).catchall(z.number())).size, 0);

    const stringCatchallRefs = extractRefFields(z.object({title: z.string()}).catchall(z.string()));
    assert.deepStrictEqual(stringCatchallRefs.get('child'), {kind: 'single'});
    assert.strictEqual(stringCatchallRefs.has('children'), false);

    const numberCatchallRefs = extractRefFields(z.object({title: z.string()}).catchall(z.number()));
    assert.strictEqual(numberCatchallRefs.size, 0);
  });

  it('extracts unannotated child, children, discriminated union properties, and nested item child fields with compatible types', () => {
    const schema = z.object({
      title: z.string().optional(),
      child: z.string().optional(),
      children: z.array(z.string()).optional(),
      discriminatedList: z.discriminatedUnion('mode', [
        z.object({mode: z.literal('template'), componentId: z.string(), path: z.string()}),
        z.object({mode: z.literal('none')}),
      ]),
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
    assert.deepStrictEqual(refs.get('discriminatedList'), {kind: 'list'});
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

  it('supports dynamic, oneOf, and unannotated component schemas loaded via Catalog.fromJson', () => {
    const catalog = Catalog.fromJson({
      catalogId: 'https://example.com/dynamic-catalog.json',
      components: {
        EmptyLeaf: {type: 'object'},
        EmptyOpenBox: {type: 'object', additionalProperties: true},
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
        OneOfSlotContainer: {
          type: 'object',
          properties: {
            slot: {
              oneOf: [
                {$ref: 'common_types.json#/$defs/ComponentId'},
                {$ref: 'common_types.json#/$defs/ChildList'},
              ],
            },
            count: {
              oneOf: [{type: 'number'}, {type: 'boolean'}],
            },
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

    for (const compName of ['EmptyOpenBox', 'OpenBox', 'UnannotatedContainer']) {
      const api = catalog.components.get(compName);
      assert.ok(api, `expected component ${compName}`);
      const refs = extractRefFields(api.schema);
      assert.deepStrictEqual(refs.get('child'), {kind: 'single'}, `${compName}.child`);
      assert.deepStrictEqual(refs.get('children'), {kind: 'list'}, `${compName}.children`);
    }

    const oneOfApi = catalog.components.get('OneOfSlotContainer');
    assert.ok(oneOfApi);
    const oneOfRefs = extractRefFields(oneOfApi.schema);
    assert.deepStrictEqual(oneOfRefs.get('slot'), {kind: 'list'});
    assert.strictEqual(oneOfRefs.has('count'), false);

    for (const leafName of ['EmptyLeaf', 'ClosedLeaf']) {
      const leafApi = catalog.components.get(leafName);
      assert.ok(leafApi, `expected leaf ${leafName}`);
      assert.strictEqual(extractRefFields(leafApi.schema).size, 0, `${leafName} refs`);
    }
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
    assert.deepStrictEqual(
      extractRefFields(z.object({slot: ComponentIdSchema.or(ChildListSchema)})).get('slot'),
      {kind: 'list'},
    );

    // Intersection compatibility: narrowing an explicit ref field with `z.string()` keeps it,
    // while narrowing with `z.number()`, mutually incompatible ref kinds, or an incompatible
    // `ZodRecord` drops it.
    const narrowedValid = z.object({header: ComponentIdSchema}).and(z.object({header: z.string()}));
    assert.deepStrictEqual(extractRefFields(narrowedValid).get('header'), {kind: 'single'});

    const narrowedInvalid = z
      .object({header: ComponentIdSchema})
      .and(z.object({header: z.number()}));
    assert.strictEqual(extractRefFields(narrowedInvalid).has('header'), false);
    assert.strictEqual(
      extractRefFields(z.object({header: ComponentIdSchema.and(z.number())})).has('header'),
      false,
    );

    // Mutually incompatible `single` & `list` intersection accepts neither strings nor arrays.
    const conflictingRefKinds = z
      .object({slot: ComponentIdSchema})
      .and(z.object({slot: z.array(ComponentIdSchema)}));
    assert.strictEqual(extractRefFields(conflictingRefKinds).size, 0);

    // Narrowing `single | list` with `z.string()` preserves `single`.
    const narrowedUnionToSingle = z
      .object({slot: z.union([ComponentIdSchema, ChildListSchema])})
      .and(z.object({slot: z.string()}));
    assert.deepStrictEqual(extractRefFields(narrowedUnionToSingle).get('slot'), {kind: 'single'});
    const propLevelNarrowedToSingle = z.object({
      slot: z.union([ComponentIdSchema, ChildListSchema]).and(z.string()),
    });
    assert.deepStrictEqual(extractRefFields(propLevelNarrowedToSingle).get('slot'), {
      kind: 'single',
    });

    // Nested array of objects intersected with array of numbers drops the nested ref,
    // and intersecting two object-array schemas filters incompatible item sub-keys.
    const nestedVsNumberArray = z
      .object({items: z.array(z.object({child: ComponentIdSchema}))})
      .and(z.object({items: z.array(z.number())}));
    assert.strictEqual(extractRefFields(nestedVsNumberArray).size, 0);

    const nestedFilteredSubKeys = z
      .object({
        items: z.array(z.object({keep: ComponentIdSchema, drop: ComponentIdSchema})),
      })
      .and(
        z.object({
          items: z.array(z.object({keep: z.string(), drop: z.number()})),
        }),
      );
    assert.deepStrictEqual(extractRefFields(nestedFilteredSubKeys).get('items'), {
      kind: 'nested',
      keys: new Set(['keep']),
    });

    const recordInvalid = z.object({child: z.string()}).and(z.record(z.number()));
    assert.strictEqual(extractRefFields(recordInvalid).size, 0);

    const emptyAndStringRecord = z.object({}).and(z.record(z.string()));
    const emptyRecordRefs = extractRefFields(emptyAndStringRecord);
    assert.deepStrictEqual(emptyRecordRefs.get('child'), {kind: 'single'});
    assert.strictEqual(emptyRecordRefs.has('children'), false);

    // Standalone template object on a non-`children` key is recognized as `list`,
    // and array element classification respects pipelines and incompatible intersections.
    const standaloneTemplateAndArrayElements = z.object({
      itemsTemplate: z.object({componentId: z.string(), path: z.string()}),
      pipedIds: z.array(ComponentIdSchema.pipe(z.string())),
      invalidIntersectedIds: z.array(ComponentIdSchema.and(z.number())),
    });
    const elementParityRefs = extractRefFields(standaloneTemplateAndArrayElements);
    assert.deepStrictEqual(elementParityRefs.get('itemsTemplate'), {kind: 'list'});
    assert.deepStrictEqual(elementParityRefs.get('pipedIds'), {kind: 'list'});
    assert.strictEqual(elementParityRefs.has('invalidIntersectedIds'), false);

    // Intersecting a non-strict non-empty object with an open schema retains open child/children,
    // unless unknown keys are constrained or `child`/`children` is declared with a non-ref type.
    const objectAndRecord = z.object({title: z.string()}).and(z.record(z.unknown()));
    assert.deepStrictEqual(extractRefFields(objectAndRecord).get('child'), {kind: 'single'});
    assert.deepStrictEqual(extractRefFields(objectAndRecord).get('children'), {kind: 'list'});

    const objectAndPassthrough = z.object({title: z.string()}).and(z.object({}).passthrough());
    assert.deepStrictEqual(extractRefFields(objectAndPassthrough).get('child'), {kind: 'single'});
    assert.deepStrictEqual(extractRefFields(objectAndPassthrough).get('children'), {kind: 'list'});

    const strictObjectAndRecord = z.object({title: z.string()}).strict().and(z.record(z.unknown()));
    assert.strictEqual(extractRefFields(strictObjectAndRecord).size, 0);

    const nonRefChildAndRecord = z.object({child: z.number()}).and(z.record(z.unknown()));
    assert.strictEqual(extractRefFields(nonRefChildAndRecord).has('child'), false);
    assert.deepStrictEqual(extractRefFields(nonRefChildAndRecord).get('children'), {kind: 'list'});

    // Union of a branch declaring non-ref `child`/`children` and an open branch keeps open refs.
    const unionOpenWithNonRefChild = z.union([
      z.object({child: z.number()}),
      z.object({title: z.string()}).passthrough(),
    ]);
    assert.deepStrictEqual(extractRefFields(unionOpenWithNonRefChild).get('child'), {
      kind: 'single',
    });
    assert.deepStrictEqual(extractRefFields(unionOpenWithNonRefChild).get('children'), {
      kind: 'list',
    });

    const unionOpenWithNonRefChildren = z.union([
      z.object({children: z.number()}),
      z.record(z.unknown()),
    ]);
    assert.deepStrictEqual(extractRefFields(unionOpenWithNonRefChildren).get('child'), {
      kind: 'single',
    });
    assert.deepStrictEqual(extractRefFields(unionOpenWithNonRefChildren).get('children'), {
      kind: 'list',
    });

    // Transform pipelines from open/empty inputs into strict or closed output schemas do not
    // synthesize unintended `child` or `children` slots.
    const transformOpenToStrict = z
      .any()
      .transform(v => v)
      .pipe(z.object({title: z.string()}).strict());
    assert.strictEqual(extractRefFields(transformOpenToStrict).size, 0);

    const transformPassthroughToClosed = z
      .object({})
      .passthrough()
      .transform(v => v)
      .pipe(z.object({title: z.string()}));
    assert.strictEqual(extractRefFields(transformPassthroughToClosed).size, 0);

    const transformEmptyToClosed = z
      .object({})
      .transform(v => v)
      .pipe(z.object({title: z.string()}));
    assert.strictEqual(extractRefFields(transformEmptyToClosed).size, 0);

    const transformOpenToPassthrough = z
      .any()
      .transform(v => v)
      .pipe(z.object({title: z.string()}).passthrough());
    assert.deepStrictEqual(extractRefFields(transformOpenToPassthrough).get('child'), {
      kind: 'single',
    });
    assert.deepStrictEqual(extractRefFields(transformOpenToPassthrough).get('children'), {
      kind: 'list',
    });

    // Unmarked dynamic-binding/function-call unions on `child`/`children` are treated as dynamic
    // data properties, not component references, including chained `.or()` nested unions and lazy cycles.
    const unmarkedDynamicProps = z.object({
      child: z.union([z.string(), z.object({'@path': z.string()})]),
      children: z.union([z.array(z.string()), z.object({'@call': z.string()})]),
    });
    assert.strictEqual(extractRefFields(unmarkedDynamicProps).size, 0);

    const chainedNestedDynamicProps = z.object({
      child: z
        .object({'@path': z.string()})
        .or(z.object({'@call': z.string()}))
        .or(z.string()),
      children: z
        .object({'@path': z.string()})
        .or(z.object({'@call': z.string()}))
        .or(z.array(z.string())),
    });
    assert.strictEqual(extractRefFields(chainedNestedDynamicProps).size, 0);

    const cyclicNestedDynamic: z.ZodTypeAny = z.lazy(() =>
      z.union([z.object({'@path': z.string()}).or(cyclicNestedDynamic), z.string()]),
    );
    assert.strictEqual(extractRefFields(z.object({child: cyclicNestedDynamic})).size, 0);

    // Explicit child-ref markers inside nested unions still classify as component references.
    const nestedExplicitChildRefs = z.object({
      child: z.object({'@path': z.string()}).or(ComponentIdSchema).or(z.string()),
      children: z.object({'@path': z.string()}).or(ChildListSchema).or(z.array(z.string())),
    });
    assert.deepStrictEqual(extractRefFields(nestedExplicitChildRefs).get('child'), {
      kind: 'single',
    });
    assert.deepStrictEqual(extractRefFields(nestedExplicitChildRefs).get('children'), {
      kind: 'list',
    });
  });

  it('constrains open-branch union fallbacks and strips undeclared explicit refs across closed pipelines', () => {
    const unionWithOpenBranch = z.union([
      z.object({title: z.string()}).passthrough(),
      z.object({title: z.string(), subtitle: z.string().optional()}),
    ]);
    assert.deepStrictEqual(extractRefFields(unionWithOpenBranch).get('child'), {kind: 'single'});
    assert.deepStrictEqual(extractRefFields(unionWithOpenBranch).get('children'), {kind: 'list'});

    // Non-transform pipeline into a closed output object strips synthesized open-branch fallbacks.
    const pipedUnionToClosed = unionWithOpenBranch.pipe(z.object({title: z.string()}));
    assert.strictEqual(extractRefFields(pipedUnionToClosed).size, 0);

    // Transform pipeline from open-branch union into strict output drops synthesized fallbacks,
    // while passthrough output declaring incompatible `child` drops only `child`.
    const transformUnionToStrict = unionWithOpenBranch
      .transform(v => v)
      .pipe(z.object({title: z.string()}).strict());
    assert.strictEqual(extractRefFields(transformUnionToStrict).size, 0);

    const transformUnionToIncompatibleChild = unionWithOpenBranch
      .transform(v => v)
      .pipe(z.object({child: z.number()}).passthrough());
    assert.strictEqual(extractRefFields(transformUnionToIncompatibleChild).has('child'), false);
    assert.deepStrictEqual(extractRefFields(transformUnionToIncompatibleChild).get('children'), {
      kind: 'list',
    });

    // Intersecting open-branch union with non-strict vs strict vs incompatible `child` objects.
    const unionAndPlain = unionWithOpenBranch.and(z.object({extra: z.string().optional()}));
    assert.deepStrictEqual(extractRefFields(unionAndPlain).get('child'), {kind: 'single'});
    assert.deepStrictEqual(extractRefFields(unionAndPlain).get('children'), {kind: 'list'});

    const unionAndIncompatibleChild = unionWithOpenBranch.and(z.object({child: z.number()}));
    assert.strictEqual(extractRefFields(unionAndIncompatibleChild).has('child'), false);
    assert.deepStrictEqual(extractRefFields(unionAndIncompatibleChild).get('children'), {
      kind: 'list',
    });

    const unionAndStrict = unionWithOpenBranch.and(z.object({title: z.string()}).strict());
    assert.strictEqual(extractRefFields(unionAndStrict).size, 0);

    // Non-transform pipeline strips explicit ref keys omitted by a closed output stage,
    // while `.passthrough()` output preserves them.
    const explicitRefsPipedToClosed = z
      .object({
        title: z.string(),
        child: ComponentIdSchema,
        header: ComponentIdSchema,
      })
      .pipe(z.object({title: z.string()}));
    assert.strictEqual(extractRefFields(explicitRefsPipedToClosed).size, 0);

    const explicitRefsPipedToPassthrough = z
      .object({
        title: z.string(),
        child: ComponentIdSchema,
        header: ComponentIdSchema,
      })
      .pipe(z.object({title: z.string()}).passthrough());
    assert.deepStrictEqual(extractRefFields(explicitRefsPipedToPassthrough).get('child'), {
      kind: 'single',
    });
    assert.deepStrictEqual(extractRefFields(explicitRefsPipedToPassthrough).get('header'), {
      kind: 'single',
    });
  });

  it('merges [list, nested] and [single, nested] unions order-independently and narrows via intersections', () => {
    const structuredArray = z.array(
      z.object({
        title: z.string(),
        child: ComponentIdSchema,
      }),
    );

    const objListThenNested = z.union([
      z.object({sections: ChildListSchema}),
      z.object({sections: structuredArray}),
    ]);
    const objNestedThenList = z.union([
      z.object({sections: structuredArray}),
      z.object({sections: ChildListSchema}),
    ]);
    assert.deepStrictEqual(extractRefFields(objListThenNested).get('sections'), {
      kind: 'nested',
      keys: new Set(['child']),
    });
    assert.deepStrictEqual(
      extractRefFields(objListThenNested).get('sections'),
      extractRefFields(objNestedThenList).get('sections'),
    );

    const propListThenNested = z.object({
      sections: ChildListSchema.or(structuredArray),
    });
    const propNestedThenList = z.object({
      sections: structuredArray.or(ChildListSchema),
    });
    assert.deepStrictEqual(extractRefFields(propListThenNested).get('sections'), {
      kind: 'nested',
      keys: new Set(['child']),
    });
    assert.deepStrictEqual(
      extractRefFields(propListThenNested).get('sections'),
      extractRefFields(propNestedThenList).get('sections'),
    );

    const propSingleThenNested = z.object({
      slot: ComponentIdSchema.or(structuredArray),
    });
    const propNestedThenSingle = z.object({
      slot: structuredArray.or(ComponentIdSchema),
    });
    assert.deepStrictEqual(extractRefFields(propSingleThenNested).get('slot'), {
      kind: 'nested',
      keys: new Set(['child']),
    });
    assert.deepStrictEqual(
      extractRefFields(propSingleThenNested).get('slot'),
      extractRefFields(propNestedThenSingle).get('slot'),
    );

    // Narrowing a [list, nested] union with z.array(z.string()) yields {kind: 'list'}.
    const narrowedToList = propListThenNested.and(z.object({sections: z.array(z.string())}));
    assert.deepStrictEqual(extractRefFields(narrowedToList).get('sections'), {
      kind: 'list',
    });

    // Narrowing a [single, nested] union with z.string() yields {kind: 'single'}.
    const narrowedToSingle = propSingleThenNested.and(z.object({slot: z.string()}));
    assert.deepStrictEqual(extractRefFields(narrowedToSingle).get('slot'), {
      kind: 'single',
    });
  });

  it('drops explicit ref keys stripped by a transform-backed pipeline output stage', () => {
    const withExplicitRefs = z.object({
      child: ComponentIdSchema,
      header: ComponentIdSchema,
    });
    const strippedAll = withExplicitRefs.transform(val => val).pipe(z.object({}));
    assert.deepStrictEqual([...extractRefFields(strippedAll)], []);

    const strippedChained = strippedAll.pipe(z.object({child: z.string(), header: z.string()}));
    assert.deepStrictEqual([...extractRefFields(strippedChained)], []);

    const keptChildOnly = withExplicitRefs
      .transform(val => val)
      .pipe(z.object({child: z.string()}));
    assert.deepStrictEqual([...extractRefFields(keptChildOnly)], [['child', {kind: 'single'}]]);
  });

  it('filters stripped element sub-keys in property-level nested array intersections and pipelines', () => {
    const twoSubKeyArray = z.array(
      z.object({
        keep: ComponentIdSchema,
        drop: ComponentIdSchema,
      }),
    );
    const keepOnlyPipeStage = z.array(z.object({keep: z.string()}));
    const keepOnlyStrictConstraint = z.array(z.object({keep: z.string()}).strict());
    const keepOnlyIncompatibleDrop = z.array(z.object({keep: z.string(), drop: z.number()}));
    const dropAllPipeStage = z.array(z.object({label: z.string()}));
    const dropAllStrictConstraint = z.array(z.object({label: z.string()}).strict());

    // Non-strict `.and()` merges object shapes in Zod, keeping both sub-keys.
    assert.deepStrictEqual(
      extractRefFields(z.object({items: twoSubKeyArray.and(keepOnlyPipeStage)})).get('items'),
      {
        kind: 'nested',
        keys: new Set(['keep', 'drop']),
      },
    );

    // Strict/incompatible `.and()` constraints and strip-mode `.pipe()` stages filter `drop`.
    for (const schema of [
      z.object({items: twoSubKeyArray.and(keepOnlyStrictConstraint)}),
      z.object({items: keepOnlyStrictConstraint.and(twoSubKeyArray)}),
      z.object({items: twoSubKeyArray.and(keepOnlyIncompatibleDrop)}),
      z.object({items: keepOnlyIncompatibleDrop.and(twoSubKeyArray)}),
      z.object({items: twoSubKeyArray.pipe(keepOnlyPipeStage)}),
      z.object({items: twoSubKeyArray.transform(v => v).pipe(keepOnlyPipeStage)}),
      z.object({items: z.union([twoSubKeyArray, z.null()]).and(keepOnlyStrictConstraint)}),
    ]) {
      assert.deepStrictEqual(extractRefFields(schema).get('items'), {
        kind: 'nested',
        keys: new Set(['keep']),
      });
    }

    for (const schema of [
      z.object({items: twoSubKeyArray.and(dropAllStrictConstraint)}),
      z.object({items: dropAllStrictConstraint.and(twoSubKeyArray)}),
      z.object({items: twoSubKeyArray.pipe(dropAllPipeStage)}),
      z.object({items: twoSubKeyArray.pipe(z.array(z.object({})))}),
      z.object({items: twoSubKeyArray.transform(v => v).pipe(dropAllPipeStage)}),
    ]) {
      assert.strictEqual(extractRefFields(schema).has('items'), false);
    }

    // Explicit `ComponentIdSchema` intersected with `z.record(DynamicString)` keeps `child`
    // without inventing unannotated `child`/`children` fallbacks on standalone dynamic records.
    const dynamicStringSchema = z
      .union([z.string(), z.object({path: z.string()})])
      .describe('REF:common_types.json#/$defs/DynamicString');
    assert.strictEqual(extractRefFields(z.record(dynamicStringSchema)).size, 0);
    assert.deepStrictEqual(
      [
        ...extractRefFields(
          z.record(dynamicStringSchema).and(z.object({child: ComponentIdSchema})),
        ),
      ],
      [['child', {kind: 'single'}]],
    );
    assert.strictEqual(
      extractRefFields(z.record(z.unknown()).and(z.object({child: dynamicStringSchema}))).has(
        'child',
      ),
      false,
    );
  });

  it('distinguishes Catalog.fromJson oneOf dynamic bindings from child ref unions', () => {
    const catalog = Catalog.fromJson({
      catalogId: 'oneof-ref-test',
      $defs: {
        ComponentId: {type: 'string'},
        DataBinding: {
          type: 'object',
          properties: {path: {type: 'string'}},
          required: ['path'],
        },
        FunctionCall: {
          type: 'object',
          properties: {call: {type: 'string'}},
          required: ['call'],
        },
        NestedBindingUnion: {
          oneOf: [{$ref: '#/$defs/DataBinding'}, {$ref: '#/$defs/FunctionCall'}],
        },
      },
      components: {
        OneOfWidget: {
          type: 'object',
          properties: {
            child: {
              oneOf: [{type: 'string'}, {$ref: '#/$defs/NestedBindingUnion'}],
            },
            children: {
              oneOf: [
                {type: 'array', items: {type: 'string'}},
                {$ref: '#/$defs/NestedBindingUnion'},
              ],
            },
            items: {
              oneOf: [
                {type: 'array', items: {type: 'string'}},
                {
                  type: 'object',
                  properties: {
                    componentId: {$ref: '#/$defs/ComponentId'},
                    path: {type: 'string'},
                  },
                  required: ['componentId', 'path'],
                },
              ],
            },
          },
        },
      },
    });

    const schema = catalog.components.get('OneOfWidget')!.schema;
    const refs = extractRefFields(schema);
    assert.strictEqual(refs.has('child'), false);
    assert.strictEqual(refs.has('children'), false);
    assert.deepStrictEqual(refs.get('items'), {kind: 'list'});
  });
});
