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

import {Catalog, defineComponentApi, type ModelFunctionImplementation} from '../types.js';
import {a2uiType, defineCatalog, defineComponent, defineParameter} from './catalog_builders.js';
import {validateCatalogValue, validateComponentProperties} from './model_validator.js';
import {
  serializeOpaqueValuesForAgent,
  type OpaqueTypeRegistry,
  type OpaqueTypeSpec,
} from './opaque_types.js';
import {A2uiValidationError} from '../../errors.js';
import {MessageProcessor, STRICT_VALIDATION} from '../../processing/message-processor.js';
import type {InternalOperation} from '../../processing/operations.js';
import {peekValue} from '../../reactivity/signals.js';
import {NodeResolver} from '../../resolution/node-resolver.js';
import {ResolvedBinding} from '../../resolution/resolved-binding.js';
import type {ActionPayload} from '../../state/surface-model.js';

const BRAND_SECRET = Symbol('TrustedResourceUrl.secret');

/**
 * Mock branded security type enforcing authentic construction (no public string constructor).
 */
class MockTrustedResourceUrl {
  readonly #url: string;
  readonly #brand = BRAND_SECRET;

  constructor(token: symbol, url: string) {
    if (token !== BRAND_SECRET) {
      throw new Error('MockTrustedResourceUrl cannot be constructed from raw strings.');
    }
    this.#url = url;
  }

  static fromTrustedWire(url: string): MockTrustedResourceUrl {
    return new MockTrustedResourceUrl(BRAND_SECRET, url);
  }

  toTrustedString(): string {
    return this.#url;
  }

  hasValidBrand(): boolean {
    return this.#brand === BRAND_SECRET;
  }
}

describe('Opaque / branded host value types and core transport hooks', () => {
  const safeUrlSpec: OpaqueTypeSpec<MockTrustedResourceUrl> = {
    name: 'trusted-resource-url',
    isInstance: (value): value is MockTrustedResourceUrl =>
      value instanceof MockTrustedResourceUrl && value.hasValidBrand(),
    serializeForAgent: value => ({trustedUrl: value.toTrustedString()}),
  };

  const redactedUrlSpec: OpaqueTypeSpec<MockTrustedResourceUrl> = {
    name: 'trusted-resource-url',
    isInstance: (value): value is MockTrustedResourceUrl =>
      value instanceof MockTrustedResourceUrl && value.hasValidBrand(),
  };

  const registryWithSerializer: OpaqueTypeRegistry = new Map([
    ['trusted-resource-url', safeUrlSpec],
  ]);

  const registryRedacted: OpaqueTypeRegistry = new Map([['trusted-resource-url', redactedUrlSpec]]);

  it('accepts branded instances and rejects raw strings in validateCatalogValue', () => {
    const typeDef = a2uiType.string({format: 'trusted-resource-url', dynamic: true});
    const trusted = MockTrustedResourceUrl.fromTrustedWire('https://trusted.example/embed');

    const ok = validateCatalogValue(typeDef, trusted, {opaqueTypes: registryWithSerializer});
    assert.equal(ok.success, true);
    if (ok.success) {
      assert.equal(ok.data, trusted);
    }

    const bindingOk = validateCatalogValue(
      typeDef,
      {'@path': '/frame/src'},
      {opaqueTypes: registryWithSerializer, protocolVersion: '1.0'},
    );
    assert.equal(bindingOk.success, true);

    const rawStringRejected = validateCatalogValue(typeDef, 'https://evil.example/xss', {
      opaqueTypes: registryWithSerializer,
    });
    assert.equal(rawStringRejected.success, false);
    if (!rawStringRejected.success) {
      assert.match(rawStringRejected.issues[0].message, /branded opaque value/i);
    }

    const plainObjectRejected = validateCatalogValue(
      typeDef,
      {url: 'https://spoofed.example'},
      {opaqueTypes: registryWithSerializer},
    );
    assert.equal(plainObjectRejected.success, false);
  });

  it('validates opaque types inside component properties, arrays, and nested objects', () => {
    const def = defineComponent({
      name: 'SafeEmbed',
      parameters: [
        defineParameter('src', a2uiType.string({format: 'trusted-resource-url', dynamic: true}), {
          required: true,
        }),
        defineParameter(
          'fallbacks',
          a2uiType.array(a2uiType.string({format: 'trusted-resource-url'})),
        ),
      ],
    });
    const urlA = MockTrustedResourceUrl.fromTrustedWire('https://a.example');
    const urlB = MockTrustedResourceUrl.fromTrustedWire('https://b.example');

    const valid = validateComponentProperties(
      def,
      {src: urlA, fallbacks: [urlB]},
      {opaqueTypes: registryWithSerializer, protocolVersion: '1.0'},
    );
    assert.equal(valid.success, true);

    const invalidFallback = validateComponentProperties(
      def,
      {src: urlA, fallbacks: ['https://untrusted.example']},
      {opaqueTypes: registryWithSerializer, protocolVersion: '1.0'},
    );
    assert.equal(invalidFallback.success, false);
    if (!invalidFallback.success) {
      assert.deepEqual(invalidFallback.issues[0].path, ['fallbacks', 0]);
    }
  });

  it('serializes or redacts opaque values via serializeOpaqueValuesForAgent', () => {
    const trusted = MockTrustedResourceUrl.fromTrustedWire('https://docs.example/1');
    const state = {
      frame: {src: trusted, title: 'Docs'},
      list: [trusted, 'plain'],
    };

    const serialized = serializeOpaqueValuesForAgent(state, registryWithSerializer);
    assert.deepEqual(serialized, {
      frame: {src: {trustedUrl: 'https://docs.example/1'}, title: 'Docs'},
      list: [{trustedUrl: 'https://docs.example/1'}, 'plain'],
    });
    assert.doesNotThrow(() => JSON.stringify(serialized));

    const redacted = serializeOpaqueValuesForAgent(state, registryRedacted);
    assert.deepEqual(redacted, {
      frame: {title: 'Docs'},
      list: ['plain'],
    });
    assert.equal('src' in (redacted as {frame: Record<string, unknown>}).frame, false);
  });

  it('ingests normalized operations via processOperations, preserves branded instances reactively, and sanitizes outbound state and actions', async () => {
    const model = defineCatalog({
      catalogId: 'https://example.com/opaque-test/v1',
      protocolVersion: '1.0',
      components: [
        defineComponent({
          name: 'SafeIFrame',
          parameters: [
            defineParameter(
              'src',
              a2uiType.string({format: 'trusted-resource-url', dynamic: true}),
              {
                required: true,
              },
            ),
            defineParameter('title', a2uiType.string({dynamic: true}), {required: true}),
            defineParameter('onLoad', a2uiType.action()),
          ],
        }),
      ],
    });

    const schemaCatalog = Catalog.fromModel(model, {opaqueTypes: registryWithSerializer});
    const catalog = schemaCatalog.withEntries(
      [...schemaCatalog.components.values()],
      [] as ModelFunctionImplementation[],
    );
    const emittedActions: ActionPayload[] = [];
    const processor = new MessageProcessor(
      [catalog],
      action => {
        emittedActions.push(action);
      },
      {version: '1.0', validationConfig: STRICT_VALIDATION},
    );

    const url1 = MockTrustedResourceUrl.fromTrustedWire('https://trusted.example/v1');
    const url2 = MockTrustedResourceUrl.fromTrustedWire('https://trusted.example/v2');

    const ops: InternalOperation[] = [
      {
        type: 'createSurface',
        surfaceId: 'surf-1',
        catalogId: catalog.id,
        sendDataModel: true,
        version: '1.0',
        dataModel: {frame: {src: url1}},
        components: [
          {
            id: 'root',
            component: 'SafeIFrame',
            src: {'@path': '/frame/src'},
            title: 'Report',
            onLoad: {
              event: {
                name: 'iframeLoaded',
                context: {loadedSrc: {'@path': '/frame/src'}, label: 'ok'},
              },
            },
          },
        ],
      },
    ];

    processor.processOperations(ops);
    const surface = processor.getSurface('surf-1')!;
    const resolver = new NodeResolver(surface);
    const rootNode = peekValue(resolver.rootNode)!;

    const initialSrc = peekValue(rootNode.props)['src'] as ResolvedBinding<MockTrustedResourceUrl>;
    assert.ok(initialSrc instanceof ResolvedBinding);
    assert.ok(initialSrc.value instanceof MockTrustedResourceUrl);
    assert.equal(initialSrc.value, url1);
    assert.equal(initialSrc.value.toTrustedString(), 'https://trusted.example/v1');

    // Update data model reactively with a second branded instance via processOperations.
    processor.processOperations([
      {
        type: 'updateDataModel',
        surfaceId: 'surf-1',
        path: '/frame/src',
        value: url2,
      },
    ]);

    const updatedSrc = peekValue(rootNode.props)['src'] as ResolvedBinding<MockTrustedResourceUrl>;
    assert.ok(updatedSrc.value instanceof MockTrustedResourceUrl);
    assert.equal(updatedSrc.value, url2);
    assert.equal(updatedSrc.value.toTrustedString(), 'https://trusted.example/v2');

    // Verify getRendererDataModel applies serializeForAgent cleanly.
    const dataModelPayload = processor.getRendererDataModel('1.0');
    assert.deepEqual(dataModelPayload, {
      version: '1.0',
      surfaces: {
        'surf-1': {frame: {src: {trustedUrl: 'https://trusted.example/v2'}}},
      },
    });

    // Verify outbound Action.context applies serializeForAgent cleanly.
    const onLoad = peekValue(rootNode.props)['onLoad'] as () => Promise<void>;
    await onLoad();
    assert.equal(emittedActions.length, 1);
    assert.deepEqual(emittedActions[0].context, {
      loadedSrc: {trustedUrl: 'https://trusted.example/v2'},
      label: 'ok',
    });

    // Verify raw spoofed string is rejected on component update.
    assert.throws(
      () =>
        processor.processOperations([
          {
            type: 'updateComponents',
            surfaceId: 'surf-1',
            components: [
              {
                id: 'root',
                component: 'SafeIFrame',
                src: 'https://evil.example/spoof',
                title: 'Spoof',
              },
            ],
          },
        ]),
      A2uiValidationError,
    );

    resolver.dispose();
    processor.dispose();
  });

  it('forwards optional rawPayload escape hatch onto ComponentModel and ComponentNode while still enforcing CatalogModel validation', () => {
    const widgetApi = defineComponentApi(
      defineComponent({
        name: 'DomainWidget',
        parameters: [
          defineParameter('headline', a2uiType.string({dynamic: true}), {required: true}),
          defineParameter('mode', a2uiType.enum(['compact', 'expanded'])),
        ],
      }),
    );
    const catalog = new Catalog(
      'https://example.com/domain/v1',
      '1.0',
      [widgetApi],
      [] as ModelFunctionImplementation[],
    );
    const processor = new MessageProcessor([catalog], undefined, {
      version: '1.0',
      validationConfig: STRICT_VALIDATION,
    });

    const compiledProtoV1 = Object.freeze({protoTag: 'AdsHeaderV1', budgetMicros: 5_000_000n});
    const compiledProtoV2 = Object.freeze({protoTag: 'AdsHeaderV2', budgetMicros: 9_000_000n});

    processor.processOperations([
      {
        type: 'createSurface',
        surfaceId: 's-raw',
        catalogId: catalog.id,
        version: '1.0',
        components: [
          {
            id: 'root',
            component: 'DomainWidget',
            headline: 'Q4 Campaign',
            mode: 'compact',
            rawPayload: compiledProtoV1,
          },
        ],
      },
    ]);

    const surface = processor.getSurface('s-raw')!;
    const compModel = surface.componentsModel.get('root')!;
    assert.equal(compModel.rawPayload, compiledProtoV1);
    assert.equal('rawPayload' in compModel.properties, false);

    const resolver = new NodeResolver(surface);
    const node = peekValue(resolver.rootNode)!;
    assert.equal(node.rawPayload, compiledProtoV1);

    // Updating the component in place refreshes rawPayload on both model and node.
    processor.processOperations([
      {
        type: 'updateComponents',
        surfaceId: 's-raw',
        components: [
          {
            id: 'root',
            component: 'DomainWidget',
            headline: 'Q4 Campaign',
            mode: 'expanded',
            rawPayload: compiledProtoV2,
          },
        ],
      },
    ]);
    assert.equal(compModel.rawPayload, compiledProtoV2);
    assert.equal(node.rawPayload, compiledProtoV2);

    // Passing rawPayload NEVER skips CatalogModel property validation!
    assert.throws(
      () =>
        processor.processOperations([
          {
            type: 'updateComponents',
            surfaceId: 's-raw',
            components: [
              {
                id: 'root',
                component: 'DomainWidget',
                headline: 'Bad Mode',
                mode: 'not-a-valid-enum',
                rawPayload: compiledProtoV2,
              },
            ],
          },
        ]),
      A2uiValidationError,
    );

    resolver.dispose();
    processor.dispose();
  });
});
