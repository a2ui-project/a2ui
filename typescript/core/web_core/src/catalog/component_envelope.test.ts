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

import * as assert from 'node:assert';
import {describe, it} from 'node:test';

import {z} from 'zod';

import {A2uiValidationError} from '../errors.js';
import {AccessibilityAttributesSchema} from '../v1_0/schema/common-types.js';
import {
  componentMixinLayout,
  componentPayloadState,
  splitComponentEnvelope,
} from './component_envelope.js';
import {exclusiveUnion} from './exclusive_union.js';
import {Catalog} from './types.js';

describe('componentMixinLayout', () => {
  it('finds custom mixin names declared in a union option', () => {
    const schema = z.union([
      z.object({kind: z.literal('a'), metadata: z.string().optional()}),
      z.object({kind: z.literal('b'), label: z.string()}),
    ]);
    const layout = componentMixinLayout(schema);
    assert.deepStrictEqual([...layout.customKeys], ['metadata']);
    assert.deepStrictEqual([...layout.schemaKeys], []);
  });

  it('finds custom mixin names declared in a discriminated union option', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({kind: z.literal('a'), label: z.string()}),
      z.object({kind: z.literal('b'), catalogId: z.number().optional()}),
    ]);
    assert.deepStrictEqual([...componentMixinLayout(schema).customKeys], ['catalogId']);
  });

  it('finds custom mixin names declared in a oneOf union', () => {
    const schema = exclusiveUnion([
      z.object({kind: z.literal('a'), metadata: z.string()}),
      z.object({kind: z.literal('b')}),
    ]);
    assert.deepStrictEqual([...componentMixinLayout(schema).customKeys], ['metadata']);
  });

  it('finds @-prefixed mixin keys declared in a union option', () => {
    const schema = z.union([
      z.object({'kind': z.literal('a'), '@checks': z.array(z.unknown()).optional()}),
      z.object({kind: z.literal('b')}),
    ]);
    const layout = componentMixinLayout(schema);
    assert.deepStrictEqual([...layout.customKeys], []);
    assert.strictEqual(layout.schemaKeys.get('checks'), '@checks');
  });

  it('treats a mixin name as standard only if every option declares the standard schema', () => {
    const allStandard = z.union([
      z.object({kind: z.literal('a'), accessibility: AccessibilityAttributesSchema.optional()}),
      z.object({kind: z.literal('b'), accessibility: AccessibilityAttributesSchema.optional()}),
    ]);
    assert.deepStrictEqual([...componentMixinLayout(allStandard).customKeys], []);
    assert.strictEqual(
      componentMixinLayout(allStandard).schemaKeys.get('accessibility'),
      'accessibility',
    );

    const mixed = z.union([
      z.object({kind: z.literal('a'), accessibility: AccessibilityAttributesSchema.optional()}),
      z.object({kind: z.literal('b'), accessibility: z.enum(['high', 'low']).optional()}),
    ]);
    assert.deepStrictEqual([...componentMixinLayout(mixed).customKeys], ['accessibility']);
    assert.strictEqual(componentMixinLayout(mixed).schemaKeys.has('accessibility'), false);
  });

  it('keeps reading the properties of intersections', () => {
    const schema = z.object({label: z.string()}).and(z.object({metadata: z.string().optional()}));
    assert.deepStrictEqual([...componentMixinLayout(schema).customKeys], ['metadata']);
  });

  describe('an inline catalogId or metadata', () => {
    const extensionsOnly = z.object({extensions: z.record(z.unknown()).optional()});

    function layoutOf(shape: z.ZodRawShape) {
      return componentMixinLayout(z.object(shape));
    }

    it('is the standard mixin beside an inline id with the standard shape', () => {
      const layout = layoutOf({
        id: z.string(),
        catalogId: z.string().optional(),
        metadata: extensionsOnly.optional(),
      });
      assert.deepStrictEqual([...layout.customKeys], []);
      assert.strictEqual(layout.schemaKeys.get('catalogId'), 'catalogId');
      assert.strictEqual(layout.schemaKeys.get('metadata'), 'metadata');
    });

    it('is custom beside an inline id with another shape', () => {
      const layout = layoutOf({
        id: z.string(),
        catalogId: z.number().optional(),
        metadata: z.string().optional(),
      });
      assert.deepStrictEqual([...layout.customKeys].sort(), ['catalogId', 'metadata']);
    });

    it('is custom without an inline id', () => {
      const layout = layoutOf({
        catalogId: z.string().optional(),
        metadata: extensionsOnly.optional(),
      });
      assert.deepStrictEqual([...layout.customKeys].sort(), ['catalogId', 'metadata']);
    });

    it('is custom when id is declared by another object of an intersection', () => {
      const schema = z.object({id: z.string()}).and(z.object({catalogId: z.string().optional()}));
      assert.deepStrictEqual([...componentMixinLayout(schema).customKeys], ['catalogId']);
    });

    function jsonLayoutOf(properties: Record<string, unknown>) {
      const catalog = Catalog.fromJson({
        catalogId: 'inline',
        protocolVersion: '1.0',
        components: {Widget: {type: 'object', properties}},
      });
      return componentMixinLayout(catalog.components.get('Widget')!.schema);
    }

    const jsonExtensionsOnly = {
      type: 'object',
      properties: {extensions: {type: 'object', additionalProperties: true}},
    };

    it('is the standard mixin in a JSON catalog beside an inline id with the standard shape', () => {
      const layout = jsonLayoutOf({
        id: {type: 'string'},
        catalogId: {type: 'string'},
        metadata: jsonExtensionsOnly,
      });
      assert.deepStrictEqual([...layout.customKeys], []);
      assert.strictEqual(layout.schemaKeys.get('catalogId'), 'catalogId');
      assert.strictEqual(layout.schemaKeys.get('metadata'), 'metadata');
    });

    it('is custom in a JSON catalog beside an inline id with another shape', () => {
      const layout = jsonLayoutOf({
        id: {type: 'string'},
        catalogId: {type: 'integer'},
        metadata: {type: 'string'},
      });
      assert.deepStrictEqual([...layout.customKeys].sort(), ['catalogId', 'metadata']);
    });

    it('is custom in a JSON catalog without an inline id', () => {
      const layout = jsonLayoutOf({catalogId: {type: 'string'}, metadata: jsonExtensionsOnly});
      assert.deepStrictEqual([...layout.customKeys].sort(), ['catalogId', 'metadata']);
    });
  });
});

describe('splitComponentEnvelope', () => {
  it('reports a mixin given in both forms at its @-prefixed key', () => {
    assert.throws(
      () =>
        splitComponentEnvelope(
          {'id': 'root', 'component': 'Plain', '@metadata': {}, 'metadata': {}},
          componentMixinLayout(z.object({})),
        ),
      (err: unknown) => {
        assert.ok(err instanceof A2uiValidationError);
        assert.strictEqual(err.details[0].path, '/@metadata');
        assert.strictEqual(err.path, '/@metadata');
        return true;
      },
    );
  });
});

describe('componentPayloadState', () => {
  it('keeps a bare metadata declared in a union option as a property beside @metadata', () => {
    const schema = z.union([
      z.object({kind: z.literal('a'), metadata: z.string().optional()}),
      z.object({kind: z.literal('b')}),
    ]);
    const state = componentPayloadState(
      {
        'id': 'root',
        'component': 'Widget',
        'kind': 'a',
        'metadata': 'x',
        '@metadata': {extensions: {com_example: 1}},
      },
      '1.0',
      schema,
    );
    assert.deepStrictEqual(state.properties, {kind: 'a', metadata: 'x'});
    assert.deepStrictEqual(state.metadata, {extensions: {com_example: 1}});
  });
});
