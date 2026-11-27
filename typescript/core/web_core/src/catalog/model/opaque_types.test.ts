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

import {
  Catalog,
  createFunctionImplementation,
  defineComponentApi,
  type ModelFunctionImplementation,
} from '../types.js';
import {
  a2uiType,
  defineCatalog,
  defineComponent,
  defineFunction,
  defineParameter,
  defineSurfaceProperties,
} from './catalog_builders.js';
import {validateCatalogValue, validateComponentProperties} from './model_validator.js';
import {
  mergeOpaqueTypeRegistries,
  serializeOpaqueValuesForAgent,
  type OpaqueTypeRegistry,
  type OpaqueTypeSpec,
} from './opaque_types.js';
import {A2uiDataError, A2uiRecursionError, A2uiValidationError} from '../../errors.js';
import {MessageProcessor, STRICT_VALIDATION} from '../../processing/message-processor.js';
import {INTERNAL_RAW_PAYLOAD, type InternalOperation} from '../../processing/operations.js';
import {effect, getValue, peekValue} from '../../reactivity/signals.js';
import {NodeResolver} from '../../resolution/node-resolver.js';
import {ResolvedBinding, WritableBinding} from '../../resolution/resolved-binding.js';
import type {A2uiErrorPayload, ActionPayload} from '../../state/surface-model.js';

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
            [INTERNAL_RAW_PAYLOAD]: compiledProtoV1,
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
            [INTERNAL_RAW_PAYLOAD]: compiledProtoV2,
          },
        ],
      },
    ]);
    assert.equal(compModel.rawPayload, compiledProtoV2);
    assert.equal(node.rawPayload, compiledProtoV2);

    // Passing INTERNAL_RAW_PAYLOAD NEVER skips CatalogModel property validation!
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
                [INTERNAL_RAW_PAYLOAD]: compiledProtoV2,
              },
            ],
          },
        ]),
      A2uiValidationError,
    );

    resolver.dispose();
    processor.dispose();
  });

  it('B1: blocks raw spoofed strings via createSurface.dataModel, updateDataModel, WritableBinding.set, and @call', async () => {
    const echoFn = createFunctionImplementation(
      defineFunction({
        name: 'echoStr',
        returnType: 'string',
        parameters: [defineParameter('v', a2uiType.string(), {required: true})],
      }),
      args => String(args['v']),
    );
    const model = defineCatalog({
      catalogId: 'https://example.com/b1/v1',
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
            defineParameter(
              'altSrc',
              a2uiType.string({format: 'trusted-resource-url', dynamic: true}),
            ),
          ],
        }),
      ],
      functions: [
        defineFunction({
          name: 'agentSpoofUrl',
          returnType: 'string',
          parameters: [],
        }),
      ],
    });
    const baseCatalog = Catalog.fromModel(model, {
      opaqueTypes: new Map([['trusted-resource-url', safeUrlSpec]]),
    });
    const catalog = baseCatalog.copyWith({
      functions: [echoFn, ...baseCatalog.functions.values()],
    });

    let capturedAgentCallId: string | undefined;
    const processor = new MessageProcessor([catalog], undefined, {
      version: '1.0',
      validationConfig: STRICT_VALIDATION,
      outboundListener: msg => {
        if ('callAgentFunction' in msg) {
          capturedAgentCallId = msg.callAgentFunction.functionCallId;
        }
      },
    });

    // 1. Spoofed raw string in createSurface.dataModel is rejected at resolution time.
    processor.processOperations([
      {
        type: 'createSurface',
        surfaceId: 's-b1',
        catalogId: catalog.id,
        version: '1.0',
        dataModel: {frame: {src: 'javascript:alert(1)'}},
        components: [
          {
            id: 'root',
            component: 'SafeIFrame',
            src: {'@path': '/frame/src'},
            altSrc: {'@call': 'echoStr', args: {v: 'javascript:alert(2)'}},
          },
        ],
      },
    ]);

    const surface = processor.getSurface('s-b1')!;
    const surfaceErrors: A2uiErrorPayload[] = [];
    surface.onError.subscribe(err => {
      surfaceErrors.push(err);
    });

    const resolver = new NodeResolver(surface);
    const node = peekValue(resolver.rootNode)!;
    const initialProps = peekValue(node.props);
    const srcBinding = initialProps['src'] as WritableBinding<unknown>;
    const altBinding = initialProps['altSrc'] as ResolvedBinding<unknown>;
    assert.equal(srcBinding.value, undefined);
    assert.equal(altBinding.value, undefined);
    assert.ok(surfaceErrors.some(e => e.code === 'VALIDATION_ERROR' && /src/.test(e.message)));
    assert.ok(surfaceErrors.some(e => e.code === 'VALIDATION_ERROR' && /altSrc/.test(e.message)));

    // 2. Authentic branded update succeeds reactively.
    const authentic = MockTrustedResourceUrl.fromTrustedWire('https://trusted.example/app');
    processor.processOperations([
      {type: 'updateDataModel', surfaceId: 's-b1', path: '/frame/src', value: authentic},
    ]);
    const validBinding = peekValue(node.props)['src'] as WritableBinding<unknown>;
    assert.equal(validBinding.value, authentic);

    // 3. WritableBinding.set with raw spoofed string throws and leaves authentic instance intact.
    assert.throws(() => validBinding.set('javascript:alert(3)'), A2uiValidationError);
    assert.equal((peekValue(node.props)['src'] as WritableBinding<unknown>).value, authentic);

    // 4. Subsequent updateDataModel with raw string blocks delivery to node.props.src.value.
    processor.processMessages([
      {
        version: '1.0',
        updateDataModel: {
          surfaceId: 's-b1',
          path: '/frame/src',
          value: 'javascript:alert(4)',
        },
      },
    ]);
    assert.equal((peekValue(node.props)['src'] as WritableBinding<unknown>).value, undefined);

    // 5. Async agent @call returning a raw JSON string is also blocked from node.props.
    processor.processOperations([
      {
        type: 'updateComponents',
        surfaceId: 's-b1',
        components: [
          {
            id: 'root',
            component: 'SafeIFrame',
            src: {'@call': 'agentSpoofUrl'},
          },
        ],
      },
    ]);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(capturedAgentCallId);
    processor.processOperations([
      {
        type: 'agentFunctionResponse',
        functionCallId: capturedAgentCallId!,
        version: '1.0',
        value: 'javascript:alert(5)',
      },
    ]);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((peekValue(node.props)['src'] as ResolvedBinding<unknown>).value, undefined);

    resolver.dispose();
    processor.dispose();
  });

  it('B2: treats opaque branded instances as atomic leaves in DataModel get() and set()', () => {
    class ClosureStyleTrustedUrl {
      // Mirrors Closure/safevalues own field (e.g. privateDoNotAccessOrElseWrappedResourceUrl).
      privateWrappedUrl: string;
      readonly #brand = BRAND_SECRET;
      constructor(url: string) {
        this.privateWrappedUrl = url;
      }
      isAuthentic(): boolean {
        return this.#brand === BRAND_SECRET;
      }
    }

    const spec: OpaqueTypeSpec<ClosureStyleTrustedUrl> = {
      name: 'trusted-resource-url',
      isInstance(v: unknown): v is ClosureStyleTrustedUrl {
        return v instanceof ClosureStyleTrustedUrl && v.isAuthentic();
      },
    };
    const model = defineCatalog({
      catalogId: 'https://example.com/b2/v1',
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
          ],
        }),
      ],
    });
    const catalog = Catalog.fromModel(model, {
      opaqueTypes: new Map([['trusted-resource-url', spec]]),
    });
    const processor = new MessageProcessor([catalog], undefined, {version: '1.0'});
    const realUrl = new ClosureStyleTrustedUrl('https://safe.example/doc');

    processor.processOperations([
      {
        type: 'createSurface',
        surfaceId: 's-b2',
        catalogId: catalog.id,
        version: '1.0',
        dataModel: {frame: {src: realUrl}},
      },
    ]);
    const surface = processor.getSurface('s-b2')!;

    // Reading sub-paths inside an opaque instance must NOT leak internal fields.
    assert.equal(surface.dataModel.get('/frame/src'), realUrl);
    assert.equal(surface.dataModel.get('/frame/src/privateWrappedUrl'), undefined);

    // Writing sub-paths inside an opaque instance must throw and NEVER mutate it in place.
    assert.throws(
      () => surface.dataModel.set('/frame/src/privateWrappedUrl', 'javascript:pwned()'),
      A2uiDataError,
    );
    assert.throws(
      () =>
        processor.processMessages([
          {
            version: '1.0',
            updateDataModel: {
              surfaceId: 's-b2',
              path: '/frame/src/privateWrappedUrl',
              value: 'javascript:pwned()',
            },
          },
        ]),
      A2uiDataError,
    );
    assert.equal(realUrl.privateWrappedUrl, 'https://safe.example/doc');
    processor.dispose();
  });

  it('B3: prevents untrusted JSON rawPayload spoofing and preserves recursion depth checks & legitimate rawPayload props', () => {
    const standardWidget = defineComponentApi(
      defineComponent({
        name: 'PlainWidget',
        parameters: [defineParameter('title', a2uiType.string(), {required: true})],
      }),
    );
    const customRawWidget = defineComponentApi(
      defineComponent({
        name: 'CustomRawWidget',
        parameters: [defineParameter('rawPayload', a2uiType.string(), {required: true})],
      }),
    );
    const catalog = new Catalog(
      'https://example.com/b3/v1',
      '1.0',
      [standardWidget, customRawWidget],
      [] as ModelFunctionImplementation[],
    );
    const processor = new MessageProcessor([catalog], undefined, {
      version: '1.0',
      validationConfig: STRICT_VALIDATION,
    });

    processor.processMessages([
      {version: '1.0', createSurface: {surfaceId: 's-b3', catalogId: catalog.id}},
    ]);

    // 1. Untrusted JSON with bare `"rawPayload"` fails strict validation (cannot spoof!).
    assert.throws(
      () =>
        processor.processMessages([
          {
            version: '1.0',
            updateComponents: {
              surfaceId: 's-b3',
              components: [
                {
                  id: 'root',
                  component: 'PlainWidget',
                  title: 'Hello',
                  rawPayload: {injected: 'from-untrusted-json'},
                },
              ],
            },
          },
        ]),
      A2uiValidationError,
    );

    // 2. Deeply nested `"rawPayload"` in JSON cannot bypass MAX_GLOBAL_DEPTH!
    let deep: Record<string, unknown> = {leaf: true};
    for (let i = 0; i < 80; i++) {
      deep = {nested: deep};
    }
    assert.throws(
      () =>
        processor.processMessages([
          {
            version: '1.0',
            updateDataModel: {
              surfaceId: 's-b3',
              path: '/x',
              value: {rawPayload: deep},
            },
          },
        ]),
      A2uiRecursionError,
    );

    // 3. A component legitimately declaring a `rawPayload` property works alongside out-of-band INTERNAL_RAW_PAYLOAD!
    const wireMarker = {wire: 'compiled'};
    processor.processOperations([
      {
        type: 'updateComponents',
        surfaceId: 's-b3',
        version: '1.0',
        components: [
          {
            id: 'root',
            component: 'CustomRawWidget',
            rawPayload: 'user-prop-value',
            [INTERNAL_RAW_PAYLOAD]: wireMarker,
          },
        ],
      },
    ]);
    const comp = processor.getSurface('s-b3')!.componentsModel.get('root')!;
    assert.equal(comp.properties['rawPayload'], 'user-prop-value');
    assert.equal(comp.rawPayload, wireMarker);

    processor.dispose();
  });

  it('H1 & H2: preserves opaque brands in agent call cache, sanitizes RPC responses & callAgentFunction, guards cycles, and merges colliding format specs', async () => {
    class AltTrustedUrl {
      readonly #u: string;
      constructor(u: string) {
        this.#u = u;
      }
      toAlt(): string {
        return this.#u;
      }
    }
    const altSpec: OpaqueTypeSpec<AltTrustedUrl> = {
      name: 'trusted-resource-url',
      isInstance(v: unknown): v is AltTrustedUrl {
        return v instanceof AltTrustedUrl;
      },
      serializeForAgent(v: AltTrustedUrl): unknown {
        // Also tests recursive sanitization of serializeForAgent output!
        return {
          alt: v.toAlt(),
          nestedSecret: MockTrustedResourceUrl.fromTrustedWire('https://secret.internal'),
        };
      },
    };

    // Multi-catalog merge with colliding format key preserves BOTH specs.
    const merged = mergeOpaqueTypeRegistries([
      {opaqueTypes: new Map([['trusted-resource-url', redactedUrlSpec]])},
      {opaqueTypes: new Map([['trusted-resource-url', altSpec]])},
    ]);
    assert.ok(merged);
    const altInst = new AltTrustedUrl('https://alt.example');
    const primaryInst = MockTrustedResourceUrl.fromTrustedWire('https://primary.example');
    assert.deepEqual(serializeOpaqueValuesForAgent({a: altInst, b: primaryInst}, merged), {
      a: {alt: 'https://alt.example'},
    });

    // Cycle & depth guards in serializeOpaqueValuesForAgent.
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    assert.throws(() => serializeOpaqueValuesForAgent(cyclic, merged), A2uiValidationError);
    let deepObj: Record<string, unknown> = {ok: 1};
    for (let i = 0; i < 70; i++) deepObj = {child: deepObj};
    assert.throws(() => serializeOpaqueValuesForAgent(deepObj, merged), A2uiValidationError);

    // H1: SurfaceModel.callAgentFunction cache preserves branded class instances!
    const returnOpaqueFn = createFunctionImplementation(
      defineFunction({
        name: 'getUrl',
        returnType: 'any',
        allowedCallers: 'rendererOrAgent',
        parameters: [],
      }),
      () => MockTrustedResourceUrl.fromTrustedWire('https://renderer-secret.example/path'),
    );
    const catA = Catalog.fromModel(
      defineCatalog({
        catalogId: 'https://example.com/h1h2/v1',
        protocolVersion: '1.0',
        surfaceProperties: defineSurfaceProperties({
          properties: [defineParameter('accent', a2uiType.string({pattern: '^#[0-9a-f]{6}$'}))],
        }),
        components: [defineComponent({name: 'Box', parameters: []})],
      }),
      {
        opaqueTypes: new Map([['trusted-resource-url', safeUrlSpec]]),
      },
    ).copyWith({functions: [returnOpaqueFn]});

    const outboundMessages: unknown[] = [];
    const processor = new MessageProcessor([catA], undefined, {
      version: '1.0',
      validationConfig: STRICT_VALIDATION,
      outboundListener: msg => {
        outboundMessages.push(msg);
      },
    });

    // Also verifies Catalog.fromModel surfaceProperties theme validation (Medium fix)!
    assert.throws(
      () =>
        processor.processOperations([
          {
            type: 'createSurface',
            surfaceId: 'bad-theme',
            catalogId: catA.id,
            version: '1.0',
            theme: {accent: 'not-a-hex-color'},
          },
        ]),
      A2uiValidationError,
    );

    processor.processOperations([
      {type: 'createSurface', surfaceId: 's-h1', catalogId: catA.id, version: '1.0'},
    ]);
    const surface = processor.getSurface('s-h1')!;

    let remoteCallCount = 0;
    const brandedAnswer = MockTrustedResourceUrl.fromTrustedWire('https://cached.example/ok');
    surface.agentFunctionCaller = async () => {
      remoteCallCount++;
      return {url: brandedAnswer};
    };

    const [first, coalesced] = await Promise.all([
      surface.callAgentFunction({'@call': 'fetchUrl', catalogId: catA.id, args: {}}),
      surface.callAgentFunction({'@call': 'fetchUrl', catalogId: catA.id, args: {}}),
    ]);
    const cached = await surface.callAgentFunction({
      '@call': 'fetchUrl',
      catalogId: catA.id,
      args: {},
    });
    assert.equal(remoteCallCount, 1);
    assert.equal((first as {url: unknown}).url instanceof MockTrustedResourceUrl, true);
    assert.equal((coalesced as {url: unknown}).url instanceof MockTrustedResourceUrl, true);
    assert.equal((cached as {url: unknown}).url instanceof MockTrustedResourceUrl, true);

    // H2.1: RpcHandler.executeFunctionSafely sanitizes opaque return values!
    const responses = await processor.processMessagesAsync([
      {
        version: '1.0',
        callRendererFunction: {
          surfaceId: 's-h1',
          functionCallId: 'fc-opaque-1',
          callFunction: {'@call': 'getUrl', catalogId: catA.id},
        },
      },
    ]);
    assert.equal(responses.length, 1);
    assert.deepEqual(responses[0].rendererFunctionResponse.value, {
      trustedUrl: 'https://renderer-secret.example/path',
    });

    // H2.2: MessageProcessor.callAgentFunction sanitizes opaque args!
    outboundMessages.length = 0;
    const pendingCall = processor.callAgentFunction(
      's-h1',
      {
        '@call': 'remoteEcho',
        args: {src: MockTrustedResourceUrl.fromTrustedWire('https://arg.example/a')},
      },
      {functionCallId: 'fc-agent-arg-1', timeoutMs: 2000},
    );
    assert.equal(outboundMessages.length, 1);
    const sent = outboundMessages[0] as {
      callAgentFunction: {callFunction: {args: Record<string, unknown>}};
    };
    assert.deepEqual(sent.callAgentFunction.callFunction.args, {
      src: {trustedUrl: 'https://arg.example/a'},
    });
    processor.processOperations([
      {
        type: 'agentFunctionResponse',
        functionCallId: 'fc-agent-arg-1',
        version: '1.0',
        value: 'ok',
      },
    ]);
    assert.equal(await pendingCall, 'ok');

    processor.dispose();
  });

  it('H4: triggers reactive updates on rawPayload-only changes for both resolved and unknown-type nodes', () => {
    const widgetApi = defineComponentApi(
      defineComponent({
        name: 'ReactiveWidget',
        parameters: [defineParameter('label', a2uiType.string(), {required: true})],
      }),
    );
    const catalog = new Catalog(
      'https://example.com/h4/v1',
      '1.0',
      [widgetApi],
      [] as ModelFunctionImplementation[],
    );
    const processor = new MessageProcessor([catalog], undefined, {
      version: '1.0',
      validationConfig: {allowUnknownElements: true, allowOrphanComponents: true},
    });

    const p1 = {rev: 1};
    const p2 = {rev: 2};
    const u1 = {unknownRev: 1};
    const u2 = {unknownRev: 2};

    processor.processOperations([
      {
        type: 'createSurface',
        surfaceId: 's-h4',
        catalogId: catalog.id,
        version: '1.0',
        components: [
          {
            id: 'root',
            component: 'ReactiveWidget',
            label: 'SameLabel',
            [INTERNAL_RAW_PAYLOAD]: p1,
          },
        ],
      },
    ]);

    const surface = processor.getSurface('s-h4')!;
    const resolver = new NodeResolver(surface);
    const node = peekValue(resolver.rootNode)!;

    const observedRaw: unknown[] = [];
    const observedPropEmissions: number[] = [];
    const disposeRaw = effect(() => {
      observedRaw.push(node.rawPayload);
    });
    const disposeProps = effect(() => {
      void getValue(node.props);
      observedPropEmissions.push(observedPropEmissions.length + 1);
    });
    assert.deepEqual(observedRaw, [p1]);
    assert.equal(observedPropEmissions.length, 1);

    // Update ONLY rawPayload with identical properties -> BOTH rawPayload & props react!
    processor.processOperations([
      {
        type: 'updateComponents',
        surfaceId: 's-h4',
        version: '1.0',
        components: [
          {
            id: 'root',
            component: 'ReactiveWidget',
            label: 'SameLabel',
            [INTERNAL_RAW_PAYLOAD]: p2,
          },
        ],
      },
    ]);
    assert.deepEqual(observedRaw, [p1, p2]);
    assert.equal(observedPropEmissions.length, 2);

    // Also test an 'unknown-type' node (no GenericBinder): rawPayloadSignal stays live!
    processor.processOperations([
      {
        type: 'createSurface',
        surfaceId: 's-h4-unk',
        catalogId: catalog.id,
        version: '1.0',
        components: [
          {
            id: 'root',
            component: 'UnregisteredWidget',
            [INTERNAL_RAW_PAYLOAD]: u1,
          },
        ],
      },
    ]);
    const unkResolver = new NodeResolver(processor.getSurface('s-h4-unk')!);
    const unkNode = peekValue(unkResolver.rootNode)!;
    assert.equal(unkNode.state, 'unknown-type');
    const observedUnk: unknown[] = [];
    const disposeUnk = effect(() => {
      observedUnk.push(getValue(unkNode.rawPayloadSignal));
    });
    assert.deepEqual(observedUnk, [u1]);

    processor.processOperations([
      {
        type: 'updateComponents',
        surfaceId: 's-h4-unk',
        version: '1.0',
        components: [
          {
            id: 'root',
            component: 'UnregisteredWidget',
            [INTERNAL_RAW_PAYLOAD]: u2,
          },
        ],
      },
    ]);
    assert.deepEqual(observedUnk, [u1, u2]);
    assert.equal(unkNode.rawPayload, u2);

    disposeRaw();
    disposeProps();
    disposeUnk();
    resolver.dispose();
    unkResolver.dispose();
    processor.dispose();
  });
});
