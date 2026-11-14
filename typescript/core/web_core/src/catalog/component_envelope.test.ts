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

import {A2uiValidationError} from '../errors.js';
import type {SchemaCursor} from '../schema-engine/nav.js';
import type {JsonSchema} from '../schema-engine/types.js';
import {entrySchema} from './entry-schema.js';
import V09CommonTypes from '../v0_9/schemas/common_types.json' with {type: 'json'};
import V10CommonTypes from '../v1_0/schemas/common_types.json' with {type: 'json'};
import {
  componentMixinLayout,
  componentPayloadState,
  splitComponentEnvelope,
} from './component_envelope.js';
import {Catalog} from './types.js';
import {testValidator} from '../test/validator.js';

const DEFS: Record<string, JsonSchema> = {'common_types.json': V10CommonTypes as JsonSchema};

/** A JSON fixture that may reference the v1.0 common types. */
const json = (node: JsonSchema, defs = DEFS): SchemaCursor => ({node, doc: {root: node, defs}});
const commonRef = (name: string): JsonSchema => ({$ref: `common_types.json#/$defs/${name}`});
const object = (properties: Record<string, JsonSchema>, extra: Record<string, unknown> = {}) => ({
  type: 'object',
  properties,
  ...extra,
});

describe('componentMixinLayout', () => {
  it('finds custom mixin names declared in an anyOf option', () => {
    const layout = componentMixinLayout(
      json({
        anyOf: [
          object({kind: {const: 'a'}, metadata: {type: 'string'}}),
          object({kind: {const: 'b'}, label: {type: 'string'}}),
        ],
      }),
    );
    assert.deepStrictEqual([...layout.customKeys], ['metadata']);
    assert.deepStrictEqual([...layout.schemaKeys], []);
  });

  it('finds custom mixin names declared in a oneOf option', () => {
    const schema = json({
      oneOf: [
        object({kind: {const: 'a'}, label: {type: 'string'}}),
        object({kind: {const: 'b'}, catalogId: {type: 'number'}}),
      ],
    });
    assert.deepStrictEqual([...componentMixinLayout(schema).customKeys], ['catalogId']);
  });

  it('finds @-prefixed mixin keys declared in an option', () => {
    const layout = componentMixinLayout(
      json({
        anyOf: [
          object({'kind': {const: 'a'}, '@checks': {type: 'array', items: {}}}),
          object({kind: {const: 'b'}}),
        ],
      }),
    );
    assert.deepStrictEqual([...layout.customKeys], []);
    assert.strictEqual(layout.schemaKeys.get('checks'), '@checks');
  });

  it('treats a mixin name as standard only if every option declares the standard schema', () => {
    const allStandard = json({
      anyOf: [
        object({kind: {const: 'a'}, accessibility: commonRef('AccessibilityAttributes')}),
        object({kind: {const: 'b'}, accessibility: commonRef('AccessibilityAttributes')}),
      ],
    });
    assert.deepStrictEqual([...componentMixinLayout(allStandard).customKeys], []);
    assert.strictEqual(
      componentMixinLayout(allStandard).schemaKeys.get('accessibility'),
      'accessibility',
    );

    const mixed = json({
      anyOf: [
        object({kind: {const: 'a'}, accessibility: commonRef('AccessibilityAttributes')}),
        object({kind: {const: 'b'}, accessibility: {enum: ['high', 'low']}}),
      ],
    });
    assert.deepStrictEqual([...componentMixinLayout(mixed).customKeys], ['accessibility']);
    assert.strictEqual(componentMixinLayout(mixed).schemaKeys.has('accessibility'), false);
  });

  it('keeps reading the properties of allOf members', () => {
    const schema = json({
      allOf: [object({label: {type: 'string'}}), object({metadata: {type: 'string'}})],
    });
    assert.deepStrictEqual([...componentMixinLayout(schema).customKeys], ['metadata']);
  });

  it('takes the properties of a $ref to a spec mixin as the standard mixins', () => {
    const v10 = componentMixinLayout(
      json({
        allOf: [commonRef('ComponentCommon'), commonRef('Checkable'), object({label: {}})],
        unevaluatedProperties: false,
      }),
    );
    assert.deepStrictEqual([...v10.customKeys], []);
    // `@catalogId` is an envelope field, like `id`, not a property.
    assert.deepStrictEqual(Object.fromEntries(v10.schemaKeys), {
      metadata: '@metadata',
      accessibility: '@accessibility',
      checks: '@checks',
    });

    const uri = 'https://a2ui.org/specification/v0_9/common_types.json';
    const v09 = componentMixinLayout(
      json(
        {
          allOf: [
            {$ref: `${uri}#/$defs/ComponentCommon`},
            {$ref: `${uri}#/$defs/Checkable`},
            object({label: {}}),
          ],
        },
        {[uri]: V09CommonTypes as JsonSchema},
      ),
    );
    assert.deepStrictEqual([...v09.customKeys], []);
    assert.deepStrictEqual(Object.fromEntries(v09.schemaKeys), {
      accessibility: 'accessibility',
      checks: 'checks',
    });
  });

  it('takes @catalogId as an envelope field however it is declared', () => {
    const layout = componentMixinLayout(
      json(object({'id': {type: 'string'}, '@catalogId': {type: 'string'}, 'text': {}})),
    );
    assert.deepStrictEqual([...layout.customKeys], []);
    assert.strictEqual(layout.schemaKeys.has('catalogId'), false);
  });

  it("does not take a catalog's own Checkable definition as the spec mixin", () => {
    const root: JsonSchema = {
      $defs: {Checkable: object({checks: {type: 'string'}})},
      allOf: [{$ref: '#/$defs/Checkable'}, object({label: {}})],
    };
    const layout = componentMixinLayout({node: root, doc: {root, defs: DEFS}});
    assert.deepStrictEqual([...layout.customKeys], ['checks']);
    assert.strictEqual(layout.schemaKeys.has('checks'), false);
  });

  it('keeps a custom bare key beside the @-prefixed mixin', () => {
    const layout = componentMixinLayout(
      json({allOf: [commonRef('Checkable'), object({checks: {type: 'string'}})]}),
    );
    assert.deepStrictEqual([...layout.customKeys], ['checks']);
    assert.strictEqual(layout.schemaKeys.get('checks'), '@checks');
  });

  it('takes bare checks of CheckRule items as the standard mixin', () => {
    const layout = componentMixinLayout(
      json(object({checks: {type: 'array', items: commonRef('CheckRule')}})),
    );
    assert.deepStrictEqual([...layout.customKeys], []);
    assert.strictEqual(layout.schemaKeys.get('checks'), 'checks');
  });

  it('skips a reference it cannot resolve', () => {
    const layout = componentMixinLayout(
      json({allOf: [{$ref: 'other.json#/$defs/X'}, object({metadata: {type: 'string'}})]}),
    );
    assert.deepStrictEqual([...layout.customKeys], ['metadata']);
  });

  describe('an inline catalogId or metadata', () => {
    const extensionsOnly = object({extensions: {type: 'object', additionalProperties: true}});

    it('is the standard mixin beside an inline id with the standard shape', () => {
      const layout = componentMixinLayout(
        json(object({id: {type: 'string'}, catalogId: {type: 'string'}, metadata: extensionsOnly})),
      );
      assert.deepStrictEqual([...layout.customKeys], []);
      assert.strictEqual(layout.schemaKeys.get('catalogId'), 'catalogId');
      assert.strictEqual(layout.schemaKeys.get('metadata'), 'metadata');
    });

    it('is custom beside an inline id with another shape', () => {
      const layout = componentMixinLayout(
        json(
          object({id: {type: 'string'}, catalogId: {type: 'number'}, metadata: {type: 'string'}}),
        ),
      );
      assert.deepStrictEqual([...layout.customKeys].sort(), ['catalogId', 'metadata']);
    });

    it('is custom without an inline id', () => {
      const layout = componentMixinLayout(
        json(object({catalogId: {type: 'string'}, metadata: extensionsOnly})),
      );
      assert.deepStrictEqual([...layout.customKeys].sort(), ['catalogId', 'metadata']);
    });

    it('is custom when id is declared by another allOf member', () => {
      const schema = json({
        allOf: [object({id: {type: 'string'}}), object({catalogId: {type: 'string'}})],
      });
      assert.deepStrictEqual([...componentMixinLayout(schema).customKeys], ['catalogId']);
    });

    // A loaded component is read through its JSON definition.
    function jsonLayoutOf(properties: Record<string, unknown>) {
      const catalog = Catalog.fromJson(
        {
          catalogId: 'inline',
          protocolVersion: '1.0',
          components: {Widget: {type: 'object', properties}},
        },
        undefined,
        undefined,
        {validator: testValidator},
      );
      const api = catalog.components.get('Widget')!;
      return componentMixinLayout(entrySchema(api, 'component', catalog)!.cursor);
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
          componentMixinLayout(json(object({}))),
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
    const schema = json({
      anyOf: [
        object({kind: {const: 'a'}, metadata: {type: 'string'}}),
        object({kind: {const: 'b'}}),
      ],
    });
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
