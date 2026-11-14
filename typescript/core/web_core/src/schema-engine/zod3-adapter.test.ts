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

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {z} from 'zod';

import {Catalog} from '../catalog/types.js';
import {extractRefFields} from '../resolution/ref-fields.js';
import {ChildListSchema, ComponentIdSchema} from '../v0_9/schema/common-types.js';
import {ChildSchema as V1ChildSchema} from '../v1_0/schema/common-types.js';
import {cursorOf} from '../test/schema.js';
import {fromZod3, isZod3Schema, zod3Issues, zod3ToJsonSchema} from './zod3-adapter.js';
import {testValidator} from '../test/validator.js';

describe('fromZod3', () => {
  it('writes markChildRef-stamped schemas as $refs into the common types document', () => {
    const {node, doc} = cursorOf(
      z.object({
        header: ComponentIdSchema.optional(),
        footer: V1ChildSchema.describe('Footer child.'),
        items: ChildListSchema,
      }),
      '1.0',
    );
    const props = (node as {properties: Record<string, Record<string, unknown>>}).properties;
    assert.equal(props.header.$ref, 'common_types.json#/$defs/ComponentId');
    assert.equal(props.footer.$ref, 'common_types.json#/$defs/ComponentId');
    assert.equal(props.footer.description, 'Footer child.');
    assert.equal(props.items.$ref, 'common_types.json#/$defs/ChildList');
    assert.ok(doc.defs['common_types.json']);
  });

  it('marks a hand-stamped schema without a description', () => {
    const markedChild = z.string();
    (markedChild._def as {a2uiChildRef?: string}).a2uiChildRef = 'component-id';
    const markedList = z.union([z.array(z.string()), z.any()]);
    (markedList._def as {a2uiChildRef?: string}).a2uiChildRef = 'child-list';

    assert.deepEqual(zod3ToJsonSchema(markedChild), {$ref: 'common_types.json#/$defs/ComponentId'});
    assert.deepEqual(zod3ToJsonSchema(markedList), {$ref: 'common_types.json#/$defs/ChildList'});
  });

  it('keeps REF: descriptions and closes strip and strict objects', () => {
    const node = zod3ToJsonSchema(
      z.object({
        text: z.string().describe('REF:common_types.json#/$defs/DynamicString'),
        strip: z.object({}),
        strict: z.object({}).strict(),
        open: z.object({}).passthrough(),
        both: z
          .object({a: z.string()})
          .strict()
          .and(z.object({b: z.string()})),
      }),
    );
    const props = (node as {properties: Record<string, Record<string, unknown>>}).properties;
    assert.equal(props.text.description, 'REF:common_types.json#/$defs/DynamicString');
    assert.equal(props.strip.additionalProperties, false);
    assert.equal(props.strict.additionalProperties, false);
    assert.equal(props.open.additionalProperties, true);
    const both = props.both.allOf as Record<string, unknown>[];
    assert.equal(both[0].additionalProperties, false);
    // A strip member of an intersection takes the other member's keys.
    assert.equal('additionalProperties' in both[1], false);
    assert.equal(props.both.unevaluatedProperties, false);
  });

  it('keeps the REF: of a wrapped schema that a wrapper re-describes', () => {
    const flag = z.boolean().describe('REF:#/$defs/DynamicBoolean|A flag.');
    const node = zod3ToJsonSchema(
      z.object({
        defaulted: flag.default(true).describe('Grouping.'),
        optional: flag.optional().describe('Whether.'),
        plain: z.string().optional().describe('Text.'),
        nullable: flag.nullable().describe('Maybe.'),
      }),
    );
    const props = (node as {properties: Record<string, Record<string, unknown>>}).properties;
    assert.equal(props.defaulted.description, 'REF:#/$defs/DynamicBoolean|Grouping.');
    assert.equal(props.defaulted.default, true);
    assert.equal(props.optional.description, 'REF:#/$defs/DynamicBoolean|Whether.');
    assert.equal(props.plain.description, 'Text.');
    assert.equal(props.nullable.description, 'REF:#/$defs/DynamicBoolean|Maybe.');
  });

  it('wraps each schema once and converts it once', () => {
    const schema = z.object({child: z.string()});
    assert.equal(fromZod3(schema), fromZod3(schema));
    const json = fromZod3(schema)['~standard'].jsonSchema;
    assert.equal(json.input({target: 'draft-2020-12'}), json.input({target: 'draft-2020-12'}));
    assert.notEqual(cursorOf(schema, '1.0').doc.defs, cursorOf(schema, '0.9').doc.defs);
  });

  it("validates with zod's own Standard Schema validate", () => {
    const schema = z.object({text: z.string().transform(t => t.toUpperCase())});
    const wrapped = fromZod3(schema);
    assert.deepEqual(wrapped['~standard'].validate({text: 'abc'}), {value: {text: 'ABC'}});
    const failed = wrapped['~standard'].validate({text: 1}) as {issues: z.ZodIssue[]};
    assert.equal(failed.issues[0].code, 'invalid_type');
    assert.deepEqual(zod3Issues(failed.issues), failed.issues);
    assert.equal(zod3Issues([{message: 'x'}]), undefined);
  });

  it('recognizes zod 3 schemas only', () => {
    assert.ok(isZod3Schema(z.string()));
    assert.equal(isZod3Schema(fromZod3(z.string())), false);
    assert.equal(isZod3Schema({type: 'string'}), false);
  });

  it('preserves child discovery for zod schemas Catalog.fromJson derives', () => {
    const catalog = Catalog.fromJson(
      {
        catalogId: 'https://example.com/dynamic-catalog.json',
        components: {
          EmptyLeaf: {type: 'object'},
          EmptyOpenBox: {type: 'object', additionalProperties: true},
          OpenBox: {
            allOf: [
              {$ref: 'common_types.json#/$defs/ComponentCommon'},
              {type: 'object', properties: {title: {type: 'string'}}},
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
              count: {oneOf: [{type: 'number'}, {type: 'boolean'}]},
            },
          },
          ClosedLeaf: {
            type: 'object',
            properties: {label: {$ref: 'common_types.json#/$defs/DynamicString'}},
            additionalProperties: false,
          },
        },
      },
      undefined,
      undefined,
      {validator: testValidator},
    );
    const refsOf = (name: string) => {
      const {node, doc} = cursorOf(catalog.components.get(name)!.schema, catalog.protocolVersion);
      return extractRefFields(node, doc);
    };

    for (const name of ['EmptyOpenBox', 'OpenBox', 'UnannotatedContainer']) {
      assert.deepEqual(refsOf(name).get('child'), {kind: 'single'}, `${name}.child`);
      assert.deepEqual(refsOf(name).get('children'), {kind: 'list'}, `${name}.children`);
    }
    assert.deepEqual(refsOf('OneOfSlotContainer').get('slot'), {kind: 'list'});
    assert.equal(refsOf('OneOfSlotContainer').has('count'), false);
    for (const name of ['EmptyLeaf', 'ClosedLeaf']) {
      assert.equal(refsOf(name).size, 0, `${name} refs`);
    }
  });

  it('preserves wrapper, recursion, and pipeline-as-allOf discovery for zod schemas', () => {
    const refsOf = (schema: z.ZodTypeAny) => {
      const {node, doc} = cursorOf(schema);
      return extractRefFields(node, doc);
    };
    const r = refsOf(
      z
        .lazy(() =>
          z.object({
            slot: ComponentIdSchema.brand<'SlotId'>().readonly().optional(),
            list: ChildListSchema.refine(() => true).default([]),
            caughtSingle: ComponentIdSchema.catch('fallback'),
            pipedSingle: ComponentIdSchema.pipe(z.string()),
            transformedSingle: ComponentIdSchema.transform(s => s.trim()).pipe(z.string()),
            incompatiblePipeOut: ComponentIdSchema.pipe(z.number()),
          }),
        )
        .describe('Lazy wrapper'),
    );
    assert.deepEqual(r.get('slot'), {kind: 'single'});
    assert.deepEqual(r.get('list'), {kind: 'list'});
    assert.deepEqual(r.get('caughtSingle'), {kind: 'single'});
    assert.deepEqual(r.get('pipedSingle'), {kind: 'single'});
    assert.deepEqual(r.get('transformedSingle'), {kind: 'single'});
    assert.equal(r.has('incompatiblePipeOut'), false);

    const tree: z.ZodTypeAny = z.lazy(() =>
      z.object({label: z.string(), children: z.array(tree).optional()}),
    );
    assert.equal(refsOf(tree).size, 0);
    // A strip object is closed, like a strict one.
    assert.equal(refsOf(z.object({})).size, 0);
    assert.equal(refsOf(z.object({}).strict()).size, 0);
    assert.deepEqual([...refsOf(z.object({}).passthrough())].sort(), [
      ['child', {kind: 'single'}],
      ['children', {kind: 'list'}],
    ]);
  });
});
