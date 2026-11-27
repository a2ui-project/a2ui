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
  a2uiType,
  defineCatalog,
  defineComponent,
  defineParameter,
  type OpaqueTypeRegistry,
  type OpaqueTypeSpec,
} from '../../catalog/model/index.js';
import {Catalog, type ModelFunctionImplementation} from '../../catalog/types.js';
import {A2uiIntegrityError, A2uiValidationError} from '../../errors.js';
import {MessageProcessor, STRICT_VALIDATION} from '../../processing/message-processor.js';
import {peekValue} from '../../reactivity/signals.js';
import {isComponentNode, type ComponentNode} from '../../resolution/component-node.js';
import {NodeResolver} from '../../resolution/node-resolver.js';
import {ResolvedBinding} from '../../resolution/resolved-binding.js';
import type {ActionPayload} from '../../state/surface-model.js';
import {
  MAX_PROTO_DEPTH,
  ProtoTransportAdapter,
  ProtoWireReader,
  ProtoWireWriter,
  WireType,
  decodeAction,
  decodeAgentToRendererMessage,
  decodeDynamicString,
  decodeProtoStruct,
  decodeProtoValue,
  decodeRendererToAgentMessage,
  encodeAction,
  encodeAgentToRendererMessage,
  encodeDynamicString,
  encodeLengthDelimitedFrame,
  encodeProtoStruct,
  encodeProtoValue,
  encodeRendererToAgentMessage,
  type ComponentProtoDecoder,
  type OpaqueValueProtoDecoder,
} from './index.js';

// ============================================================================
// Mock TrustedResourceUrl (Private Brand, Static `fromProto` Factory ONLY!)
// ============================================================================

const TRUSTED_URL_INTERNAL_TOKEN = Symbol('TrustedResourceUrl.internal');
const TRUSTED_URL_TYPE_URL = 'type.googleapis.com/webutil.html.types.TrustedResourceUrlProto';

/**
 * Models Google3's `TrustedResourceUrl` security contract:
 * - Private `#brand` and `#url` fields (not spoofable by plain objects or `{...spread}`).
 * - No public string constructor (throws if called without private token).
 * - Only constructible from wire protobuf bytes via `TrustedResourceUrl.fromProto(bytes)`.
 */
class TrustedResourceUrl {
  readonly #brand = TRUSTED_URL_INTERNAL_TOKEN;
  readonly #url: string;

  constructor(token: symbol, url: string) {
    if (token !== TRUSTED_URL_INTERNAL_TOKEN) {
      throw new Error(
        'TrustedResourceUrl cannot be constructed from raw strings; use TrustedResourceUrl.fromProto().',
      );
    }
    this.#url = url;
  }

  /** Encodes a `webutil.html.types.TrustedResourceUrlProto` (`string private_do_not_access_or_else_trusted_resource_url_wrapped_value = 4`). */
  static toProtoBytesForTestServer(url: string): Uint8Array {
    return new ProtoWireWriter().writeString(4, url).finish();
  }

  /** Trusted boundary factory matching `TrustedResourceUrl.fromProto(proto)`. */
  static fromProto(protoBytes: Uint8Array): TrustedResourceUrl {
    const reader = new ProtoWireReader(protoBytes);
    let wrappedUrl = '';
    while (reader.hasMore()) {
      const {fieldNumber, wireType} = reader.readTag();
      if (fieldNumber === 4 && wireType === WireType.LEN) {
        wrappedUrl = reader.readString();
      } else {
        reader.skipField(wireType);
      }
    }
    if (!wrappedUrl.startsWith('https://')) {
      throw new A2uiValidationError(`TrustedResourceUrlProto must carry an https:// URL.`);
    }
    return new TrustedResourceUrl(TRUSTED_URL_INTERNAL_TOKEN, wrappedUrl);
  }

  unwrapForTrustedSink(): string {
    return this.#url;
  }

  verifyBrand(): boolean {
    return this.#brand === TRUSTED_URL_INTERNAL_TOKEN;
  }
}

// ============================================================================
// Sample Typed Component Proto Encoders & Tree-Shakeable Decoders
// ============================================================================

const BUTTON_TYPE_URL = 'type.googleapis.com/a2ui.catalogs.demo.v1.Button';
const SAFE_IFRAME_TYPE_URL = 'type.googleapis.com/google.ads.rsdk.v1.SafeIFramePropsProto';

const BUTTON_VARIANT_ENUM = {default: 1, primary: 2, borderless: 3} as const;
const BUTTON_VARIANT_FROM_ENUM: Record<number, 'default' | 'primary' | 'borderless'> = {
  1: 'default',
  2: 'primary',
  3: 'borderless',
};

function encodeButtonPropsProto(props: {
  readonly child: string;
  readonly action: {readonly event: {readonly name: string}};
  readonly variant?: 'default' | 'primary' | 'borderless';
}): Uint8Array {
  const w = new ProtoWireWriter();
  w.writeString(1, props.child);
  w.writeBytes(2, encodeAction(props.action));
  if (props.variant !== undefined) {
    w.writeEnum(3, BUTTON_VARIANT_ENUM[props.variant]);
  }
  return w.finish();
}

const decodeButtonProto: ComponentProtoDecoder = bytes => {
  const r = new ProtoWireReader(bytes);
  const properties: Record<string, unknown> = {};
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === 1 && wireType === WireType.LEN) {
      properties['child'] = r.readString();
    } else if (fieldNumber === 2 && wireType === WireType.LEN) {
      properties['action'] = decodeAction(r.readBytes());
    } else if (fieldNumber === 3 && wireType === WireType.VARINT) {
      properties['variant'] = BUTTON_VARIANT_FROM_ENUM[r.readEnum()];
    } else {
      r.skipField(wireType);
    }
  }
  return {properties};
};

function encodeSafeIFramePropsProto(props: {
  readonly srcProtoBytes?: Uint8Array;
  readonly srcPath?: string;
  readonly title: string | {'@path': string};
}): Uint8Array {
  const w = new ProtoWireWriter();
  if (props.srcProtoBytes !== undefined) {
    w.writeBytes(1, props.srcProtoBytes);
  } else if (props.srcPath !== undefined) {
    w.writeString(2, props.srcPath);
  }
  w.writeBytes(3, encodeDynamicString(props.title));
  return w.finish();
}

const decodeSafeIFrameProto: ComponentProtoDecoder = bytes => {
  const r = new ProtoWireReader(bytes);
  const properties: Record<string, unknown> = {};
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === 1 && wireType === WireType.LEN) {
      properties['src'] = TrustedResourceUrl.fromProto(r.readBytes());
    } else if (fieldNumber === 2 && wireType === WireType.LEN) {
      properties['src'] = {'@path': r.readString()};
    } else if (fieldNumber === 3 && wireType === WireType.LEN) {
      properties['title'] = decodeDynamicString(r.readBytes());
    } else {
      r.skipField(wireType);
    }
  }
  return {properties, rawPayload: bytes};
};

const decodeTrustedUrlOpaqueAny: OpaqueValueProtoDecoder<TrustedResourceUrl> = bytes =>
  TrustedResourceUrl.fromProto(bytes);

function buildTestCatalog(opaqueTypes?: OpaqueTypeRegistry) {
  const model = defineCatalog({
    catalogId: 'https://example.com/proto-e2e/v1',
    protocolVersion: '1.0',
    components: [
      defineComponent({
        name: 'Column',
        parameters: [defineParameter('children', a2uiType.childList(), {required: true})],
      }),
      defineComponent({
        name: 'Text',
        parameters: [defineParameter('text', a2uiType.string({dynamic: true}), {required: true})],
      }),
      defineComponent({
        name: 'Button',
        parameters: [
          defineParameter('child', a2uiType.child(), {required: true}),
          defineParameter('action', a2uiType.action(), {required: true}),
          defineParameter('variant', a2uiType.enum(['default', 'primary', 'borderless'])),
        ],
      }),
      defineComponent({
        name: 'StatusBadge',
        allowedParents: ['Column'],
        parameters: [
          defineParameter('label', a2uiType.string({dynamic: true}), {required: true}),
          defineParameter('severity', a2uiType.enum(['info', 'warn', 'error']), {required: true}),
          defineParameter('code', a2uiType.string({pattern: '^[A-Z]{2}-[0-9]{3}$'})),
        ],
      }),
      defineComponent({
        name: 'SafeIFrame',
        parameters: [
          defineParameter('src', a2uiType.string({format: 'trusted-resource-url', dynamic: true}), {
            required: true,
          }),
          defineParameter('title', a2uiType.string({dynamic: true}), {required: true}),
          defineParameter('onLoad', a2uiType.action()),
        ],
      }),
    ],
  });
  const schemaCatalog = Catalog.fromModel(model, {opaqueTypes});
  return schemaCatalog.withEntries(
    [...schemaCatalog.components.values()],
    [] as ModelFunctionImplementation[],
  );
}

describe('Experimental Protobuf Transport End-to-End Suite', () => {
  it('round-trips binary wire primitives, Struct/Value, AgentToRendererMessage, RendererToAgentMessage, and skips unknown fields', () => {
    // 1. Struct / Value round-trip including null, negative doubles, nested objects, lists, UTF-8.
    const sampleStruct = {
      str: 'héllo 🚀',
      num: -42.5,
      flag: true,
      empty: null,
      list: [1, 'two', false, null, {nested: 'ok'}],
    };
    assert.deepEqual(decodeProtoStruct(encodeProtoStruct(sampleStruct)), sampleStruct);

    // 2. Unknown future field skipping on AgentToRendererMessage.
    const baseFrame = encodeAgentToRendererMessage({
      version: '1.0',
      kind: 'deleteSurface',
      deleteSurface: {surfaceId: 'surf-del'},
    });
    const extraField = new ProtoWireWriter().writeString(99, 'future-extension').finish();
    const extendedFrame = new Uint8Array(baseFrame.byteLength + extraField.byteLength);
    extendedFrame.set(baseFrame, 0);
    extendedFrame.set(extraField, baseFrame.byteLength);
    assert.deepEqual(decodeAgentToRendererMessage(extendedFrame), {
      version: '1.0',
      kind: 'deleteSurface',
      deleteSurface: {surfaceId: 'surf-del'},
    });

    // 3. RendererToAgentMessage round-trip (action, callAgentFunction, rendererFunctionResponse, error).
    const actionBytes = encodeRendererToAgentMessage({
      version: '1.0',
      kind: 'action',
      action: {
        name: 'submit',
        surfaceId: 's1',
        sourceComponentId: 'btn1',
        timestamp: '2026-11-27T00:00:00Z',
        context: {count: 3, ok: true},
        userMessage: 'Submitted',
      },
    });
    assert.deepEqual(decodeRendererToAgentMessage(actionBytes), {
      version: '1.0',
      kind: 'action',
      action: {
        name: 'submit',
        surfaceId: 's1',
        sourceComponentId: 'btn1',
        timestamp: '2026-11-27T00:00:00Z',
        context: {count: 3, ok: true},
        userMessage: 'Submitted',
      },
    });

    const errBytes = encodeRendererToAgentMessage({
      version: '1.0',
      kind: 'error',
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid prop',
        surfaceId: 's1',
        path: '/components/0/label',
        details: [{path: '/label', code: 'missing_field', message: 'Required'}],
      },
    });
    assert.deepEqual(decodeRendererToAgentMessage(errBytes), {
      version: '1.0',
      kind: 'error',
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid prop',
        surfaceId: 's1',
        path: '/components/0/label',
        details: [{path: '/label', code: 'missing_field', message: 'Required'}],
      },
    });

    // 4. Rejects unregistered typed_payload / typed_value Any decoders clearly.
    const emptyAdapter = new ProtoTransportAdapter();
    const unknownCompFrame = encodeAgentToRendererMessage({
      version: '1.0',
      kind: 'updateComponents',
      updateComponents: {
        surfaceId: 's1',
        components: [
          {
            id: 'c1',
            component: 'UnregisteredWidget',
            typedPayload: {typeUrl: 'type.googleapis.com/demo.Unknown', value: new Uint8Array([1])},
          },
        ],
      },
    });
    assert.throws(() => emptyAdapter.decode(unknownCompFrame), A2uiValidationError);
  });

  it('Goal 1: mixes binary Protobuf (typed Any Button + Struct-fallback StatusBadge) AND JSON messages on ONE MessageProcessor with zero Zod', () => {
    const catalog = buildTestCatalog();
    const processor = new MessageProcessor([catalog], undefined, {
      version: '1.0',
      validationConfig: STRICT_VALIDATION,
    });

    const adapter = new ProtoTransportAdapter({
      componentDecoders: new Map<string, ComponentProtoDecoder>([['Button', decodeButtonProto]]),
    });

    // Binary Protobuf frame: CreateSurface containing Column + typed-Any Button + Struct-fallback StatusBadge + initial Text.
    const protoCreateFrame = encodeAgentToRendererMessage({
      version: '1.0',
      kind: 'createSurface',
      createSurface: {
        surfaceId: 'hybrid-surf',
        catalogId: catalog.id,
        components: [
          {
            id: 'root',
            component: 'Column',
            properties: {children: ['btn1', 'badge1']},
          },
          {
            id: 'btnLabel',
            component: 'Text',
            properties: {text: 'Deploy'},
          },
          {
            id: 'btn1',
            component: 'Button',
            typedPayload: {
              typeUrl: BUTTON_TYPE_URL,
              value: encodeButtonPropsProto({
                child: 'btnLabel',
                action: {event: {name: 'deploy'}},
                variant: 'primary',
              }),
            },
          },
          {
            id: 'badge1',
            component: 'StatusBadge',
            properties: {label: 'Healthy', severity: 'info', code: 'OK-200'},
          },
        ],
      },
    });

    processor.processOperations(adapter.decode(protoCreateFrame));

    // Standard JSON message on the EXACT SAME MessageProcessor adds a new Text component!
    processor.processMessages({
      version: '1.0',
      updateComponents: {
        surfaceId: 'hybrid-surf',
        components: [
          {id: 'root', component: 'Column', children: ['btn1', 'badge1', 'jsonNote']},
          {id: 'jsonNote', component: 'Text', text: 'Updated via JSON'},
        ],
      },
    });

    const surface = processor.getSurface('hybrid-surf')!;
    const resolver = new NodeResolver(surface);
    const rootNode = peekValue(resolver.rootNode)!;
    const children = peekValue(rootNode.props)['children'] as ComponentNode[];
    assert.equal(children.length, 3);
    assert.ok(children.every(isComponentNode));

    // Typed Any Button
    const btnNode = children[0];
    assert.equal(btnNode.type, 'Button');
    assert.equal(peekValue(btnNode.props)['variant'], 'primary');
    const btnChild = peekValue(btnNode.props)['child'] as ComponentNode;
    assert.equal((peekValue(btnChild.props)['text'] as ResolvedBinding<string>).value, 'Deploy');

    // Struct-fallback StatusBadge
    const badgeNode = children[1];
    assert.equal(badgeNode.type, 'StatusBadge');
    assert.equal((peekValue(badgeNode.props)['label'] as ResolvedBinding<string>).value, 'Healthy');
    assert.equal(peekValue(badgeNode.props)['severity'], 'info');
    assert.equal(peekValue(badgeNode.props)['code'], 'OK-200');

    // JSON-added Text
    const jsonNode = children[2];
    assert.equal(jsonNode.type, 'Text');
    assert.equal(
      (peekValue(jsonNode.props)['text'] as ResolvedBinding<string>).value,
      'Updated via JSON',
    );

    resolver.dispose();
    processor.dispose();
  });

  it('Goal 2: enforces mandatory CatalogModel validation on Proto Struct fallback (enum, required, regex, allowedParents)', () => {
    const catalog = buildTestCatalog();
    const processor = new MessageProcessor([catalog], undefined, {
      version: '1.0',
      validationConfig: STRICT_VALIDATION,
    });
    const adapter = new ProtoTransportAdapter();

    // Seed a valid surface first.
    const seedFrame = encodeAgentToRendererMessage({
      version: '1.0',
      kind: 'createSurface',
      createSurface: {
        surfaceId: 'val-surf',
        catalogId: catalog.id,
        components: [
          {id: 'root', component: 'Column', properties: {children: ['badge']}},
          {
            id: 'badge',
            component: 'StatusBadge',
            properties: {label: 'Ready', severity: 'info', code: 'AB-123'},
          },
        ],
      },
    });
    processor.processOperations(adapter.decode(seedFrame));

    // 1. Invalid enum value in Proto Struct fallback -> A2uiValidationError.
    const badEnumFrame = encodeAgentToRendererMessage({
      version: '1.0',
      kind: 'updateComponents',
      updateComponents: {
        surfaceId: 'val-surf',
        components: [
          {
            id: 'badge',
            component: 'StatusBadge',
            properties: {label: 'Oops', severity: 'critical-invalid'},
          },
        ],
      },
    });
    assert.throws(
      () => processor.processOperations(adapter.decode(badEnumFrame)),
      err => {
        assert.ok(err instanceof A2uiValidationError);
        assert.match(err.message, /Invalid enum value/);
        return true;
      },
    );

    // 2. Missing required field (`label`) in Proto Struct fallback -> A2uiValidationError.
    const missingRequiredFrame = encodeAgentToRendererMessage({
      version: '1.0',
      kind: 'updateComponents',
      updateComponents: {
        surfaceId: 'val-surf',
        components: [
          {
            id: 'badge',
            component: 'StatusBadge',
            properties: {severity: 'warn'},
          },
        ],
      },
    });
    assert.throws(
      () => processor.processOperations(adapter.decode(missingRequiredFrame)),
      err => {
        assert.ok(err instanceof A2uiValidationError);
        assert.match(err.message, /label: Expected string, received undefined/);
        return true;
      },
    );

    // 3. Regex pattern mismatch (`code`) in Proto Struct fallback -> A2uiValidationError.
    const badRegexFrame = encodeAgentToRendererMessage({
      version: '1.0',
      kind: 'updateComponents',
      updateComponents: {
        surfaceId: 'val-surf',
        components: [
          {
            id: 'badge',
            component: 'StatusBadge',
            properties: {label: 'Bad code', severity: 'error', code: 'invalid-code'},
          },
        ],
      },
    });
    assert.throws(
      () => processor.processOperations(adapter.decode(badRegexFrame)),
      err => {
        assert.ok(err instanceof A2uiValidationError);
        assert.match(err.message, /does not match pattern/);
        return true;
      },
    );

    // 4. `allowedParents` violation: StatusBadge placed directly as root (parent is Surface, not Column)!
    const badParentFrame = encodeAgentToRendererMessage({
      version: '1.0',
      kind: 'createSurface',
      createSurface: {
        surfaceId: 'bad-parent-surf',
        catalogId: catalog.id,
        components: [
          {
            id: 'root',
            component: 'StatusBadge',
            properties: {label: 'Misplaced', severity: 'info'},
          },
        ],
      },
    });
    assert.throws(
      () => processor.processOperations(adapter.decode(badParentFrame)),
      err => {
        assert.ok(err instanceof A2uiValidationError || err instanceof A2uiIntegrityError);
        assert.match(err.message, /allowedParents|Surface|Column/i);
        return true;
      },
    );

    processor.dispose();
  });

  it('Goal 3: preserves TrustedResourceUrl chain of custody statically & reactively over binary UpdateDataModel.typed_value, rejects raw spoofed strings, and redacts/serializes outbound data', async () => {
    // Public string construction must be impossible!
    assert.throws(
      () => new TrustedResourceUrl(Symbol('fake'), 'https://evil.example'),
      /cannot be constructed from raw strings/,
    );

    const trustedUrlSpecWithSerializer: OpaqueTypeSpec<TrustedResourceUrl> = {
      name: 'trusted-resource-url',
      isInstance: (v): v is TrustedResourceUrl =>
        v instanceof TrustedResourceUrl && v.verifyBrand(),
      serializeForAgent: url => ({opaqueHost: new URL(url.unwrapForTrustedSink()).host}),
    };
    const trustedUrlSpecRedacted: OpaqueTypeSpec<TrustedResourceUrl> = {
      name: 'trusted-resource-url',
      isInstance: (v): v is TrustedResourceUrl =>
        v instanceof TrustedResourceUrl && v.verifyBrand(),
    };

    const catalog = buildTestCatalog(
      new Map([['trusted-resource-url', trustedUrlSpecWithSerializer]]),
    );
    const actions: ActionPayload[] = [];
    const processor = new MessageProcessor(
      [catalog],
      a => {
        actions.push(a);
      },
      {
        version: '1.0',
        validationConfig: STRICT_VALIDATION,
      },
    );

    const adapter = new ProtoTransportAdapter({
      componentDecoders: new Map<string, ComponentProtoDecoder>([
        [`${catalog.id}#SafeIFrame`, decodeSafeIFrameProto],
      ]),
      opaqueValueDecoders: new Map<string, OpaqueValueProtoDecoder>([
        [TRUSTED_URL_TYPE_URL, decodeTrustedUrlOpaqueAny],
      ]),
    });

    // Stream 2 length-delimited binary protobuf frames:
    // Frame 1: CreateSurface with BOTH a static TrustedResourceUrl SafeIFrame AND a @path-bound SafeIFrame!
    // Frame 2: Streaming binary UpdateDataModel carrying TrustedResourceUrlProto in `typed_value` Any!
    const frame1 = encodeAgentToRendererMessage({
      version: '1.0',
      kind: 'createSurface',
      createSurface: {
        surfaceId: 'sec-surf',
        catalogId: catalog.id,
        sendDataModel: true,
        components: [
          {
            id: 'root',
            component: 'Column',
            properties: {children: ['staticFrame', 'reactiveFrame']},
          },
          {
            id: 'staticFrame',
            component: 'SafeIFrame',
            catalogId: catalog.id,
            typedPayload: {
              typeUrl: SAFE_IFRAME_TYPE_URL,
              value: encodeSafeIFramePropsProto({
                srcProtoBytes: TrustedResourceUrl.toProtoBytesForTestServer(
                  'https://static.trusted.example/widget',
                ),
                title: 'Static Embed',
              }),
            },
          },
          {
            id: 'reactiveFrame',
            component: 'SafeIFrame',
            properties: {
              src: {'@path': '/frame/src'},
              title: 'Reactive Embed',
              onLoad: {
                event: {
                  name: 'frameLoaded',
                  context: {url: {'@path': '/frame/src'}},
                },
              },
            },
          },
        ],
      },
    });

    const frame2 = encodeAgentToRendererMessage({
      version: '1.0',
      kind: 'updateDataModel',
      updateDataModel: {
        surfaceId: 'sec-surf',
        path: '/frame/src',
        typedValue: {
          typeUrl: TRUSTED_URL_TYPE_URL,
          value: TrustedResourceUrl.toProtoBytesForTestServer(
            'https://stream-v1.trusted.example/report',
          ),
        },
      },
    });

    const delimited1 = encodeLengthDelimitedFrame(frame1);
    const delimited2 = encodeLengthDelimitedFrame(frame2);
    const streamChunk = new Uint8Array(delimited1.byteLength + delimited2.byteLength);
    streamChunk.set(delimited1, 0);
    streamChunk.set(delimited2, delimited1.byteLength);

    processor.processOperations(adapter.decodeLengthDelimitedStream(streamChunk));

    const surface = processor.getSurface('sec-surf')!;
    const resolver = new NodeResolver(surface);
    const rootNode = peekValue(resolver.rootNode)!;
    const [staticNode, reactiveNode] = peekValue(rootNode.props)['children'] as ComponentNode[];

    // 1. Static SafeIFrame receives authentic branded TrustedResourceUrl AND preserves rawPayload escape hatch.
    const staticSrc = peekValue(staticNode.props)['src'] as ResolvedBinding<TrustedResourceUrl>;
    assert.ok(staticSrc.value instanceof TrustedResourceUrl);
    assert.equal(staticSrc.value.unwrapForTrustedSink(), 'https://static.trusted.example/widget');
    assert.ok(staticNode.rawPayload instanceof Uint8Array);

    // 2. Reactive @path SafeIFrame receives authentic branded TrustedResourceUrl from streaming UpdateDataModel!
    const reactiveSrcV1 = peekValue(reactiveNode.props)[
      'src'
    ] as ResolvedBinding<TrustedResourceUrl>;
    assert.ok(reactiveSrcV1.value instanceof TrustedResourceUrl);
    assert.equal(
      reactiveSrcV1.value.unwrapForTrustedSink(),
      'https://stream-v1.trusted.example/report',
    );

    // 3. Stream a SECOND binary UpdateDataModel updating `/frame/src` -> reactive NodeResolver updates in place!
    const frame3 = encodeAgentToRendererMessage({
      version: '1.0',
      kind: 'updateDataModel',
      updateDataModel: {
        surfaceId: 'sec-surf',
        path: '/frame/src',
        typedValue: {
          typeUrl: TRUSTED_URL_TYPE_URL,
          value: TrustedResourceUrl.toProtoBytesForTestServer(
            'https://stream-v2.trusted.example/report',
          ),
        },
      },
    });
    processor.processOperations(adapter.decode(frame3));

    const reactiveSrcV2 = peekValue(reactiveNode.props)[
      'src'
    ] as ResolvedBinding<TrustedResourceUrl>;
    assert.ok(reactiveSrcV2.value instanceof TrustedResourceUrl);
    assert.equal(
      reactiveSrcV2.value.unwrapForTrustedSink(),
      'https://stream-v2.trusted.example/report',
    );

    // 4. Spoofed raw string via JSON OR Proto Struct fallback is strictly REJECTED!
    const spoofedStructFrame = encodeAgentToRendererMessage({
      version: '1.0',
      kind: 'updateComponents',
      updateComponents: {
        surfaceId: 'sec-surf',
        components: [
          {
            id: 'staticFrame',
            component: 'SafeIFrame',
            properties: {
              src: 'https://evil.example/xss',
              title: 'Spoofed',
            },
          },
        ],
      },
    });
    assert.throws(
      () => processor.processOperations(adapter.decode(spoofedStructFrame)),
      A2uiValidationError,
    );
    assert.throws(
      () =>
        processor.processMessages({
          version: '1.0',
          updateComponents: {
            surfaceId: 'sec-surf',
            components: [
              {
                id: 'staticFrame',
                component: 'SafeIFrame',
                src: 'https://evil.example/xss',
                title: 'Spoofed JSON',
              },
            ],
          },
        }),
      A2uiValidationError,
    );

    // 5. Outbound `getRendererDataModel` and `Action.context` invoke `serializeForAgent` safely!
    assert.deepEqual(processor.getRendererDataModel('1.0'), {
      version: '1.0',
      surfaces: {
        'sec-surf': {
          frame: {src: {opaqueHost: 'stream-v2.trusted.example'}},
        },
      },
    });

    const onLoad = peekValue(reactiveNode.props)['onLoad'] as () => Promise<void>;
    await onLoad();
    assert.equal(actions.length, 1);
    assert.deepEqual(actions[0].context, {
      url: {opaqueHost: 'stream-v2.trusted.example'},
    });

    // 6. Explicit-presence delete on UpdateDataModel (neither `value` nor `typedValue` set).
    const deleteKeyFrame = encodeAgentToRendererMessage({
      version: '1.0',
      kind: 'updateDataModel',
      updateDataModel: {
        surfaceId: 'sec-surf',
        path: '/frame/src',
      },
    });
    processor.processOperations(adapter.decode(deleteKeyFrame));
    assert.equal(surface.dataModel.get('/frame/src'), undefined);

    resolver.dispose();
    processor.dispose();

    // 7. When `serializeForAgent` is omitted, opaque values are cleanly redacted from `getRendererDataModel`!
    const redactedCatalog = buildTestCatalog(
      new Map([['trusted-resource-url', trustedUrlSpecRedacted]]),
    );
    const redactedProcessor = new MessageProcessor([redactedCatalog], undefined, {version: '1.0'});
    redactedProcessor.processOperations(
      adapter.decode(
        encodeAgentToRendererMessage({
          version: '1.0',
          kind: 'createSurface',
          createSurface: {
            surfaceId: 'redacted-surf',
            catalogId: redactedCatalog.id,
            sendDataModel: true,
            dataModel: {publicLabel: 'visible'},
          },
        }),
      ),
    );
    redactedProcessor.processOperations(
      adapter.decode(
        encodeAgentToRendererMessage({
          version: '1.0',
          kind: 'updateDataModel',
          updateDataModel: {
            surfaceId: 'redacted-surf',
            path: '/secretUrl',
            typedValue: {
              typeUrl: TRUSTED_URL_TYPE_URL,
              value: TrustedResourceUrl.toProtoBytesForTestServer(
                'https://private.internal/secret',
              ),
            },
          },
        }),
      ),
    );
    assert.deepEqual(redactedProcessor.getRendererDataModel('1.0'), {
      version: '1.0',
      surfaces: {
        'redacted-surf': {publicLabel: 'visible'},
      },
    });
    redactedProcessor.dispose();
  });

  it('B4 & H2.5: hardens wire codec against deep recursion DoS, __proto__ pollution, wire-type mismatches, varint bounds, invalid UTF-8, and raw class instances', () => {
    // 1. Deeply nested ListValue (> MAX_PROTO_DEPTH) throws A2uiValidationError (not RangeError).
    let nested = encodeProtoValue(1);
    for (let i = 0; i < MAX_PROTO_DEPTH + 10; i++) {
      const listBytes = new ProtoWireWriter().writeBytes(1, nested).finish();
      nested = new ProtoWireWriter().writeBytes(6, listBytes).finish();
    }
    assert.throws(() => decodeProtoValue(nested), A2uiValidationError);

    // 2. Action.context wire map key "__proto__" does NOT pollute prototype.
    const pollutedActionBytes = new ProtoWireWriter()
      .writeMessage(1, evW => {
        evW.writeString(1, 'click');
        evW.writeMessage(3, mapW => {
          mapW.writeString(1, '__proto__');
          mapW.writeBytes(
            2,
            new ProtoWireWriter().writeBytes(1, encodeProtoValue({polluted: true})).finish(),
          );
        });
      })
      .finish();
    const decodedAction = decodeAction(pollutedActionBytes);
    assert.ok('event' in decodedAction && decodedAction.event.context);
    assert.equal(Object.getPrototypeOf(decodedAction.event.context), Object.prototype);
    assert.equal(Object.hasOwn(decodedAction.event.context!, '__proto__'), true);

    // 3. Wire-type mismatch in decodeProtoValue (tag 2 number_value encoded as VARINT) throws!
    const badWireValue = new ProtoWireWriter()
      .writeTag(2, WireType.VARINT)
      .writeRawVarint(42)
      .finish();
    assert.throws(() => decodeProtoValue(badWireValue), A2uiValidationError);

    // 4. Varint bounds: writeRawVarint rejects > uint64; readRawVarint rejects 10th byte > 0x01.
    assert.throws(() => new ProtoWireWriter().writeRawVarint(1n << 70n), A2uiValidationError);
    const badVarint10 = new Uint8Array([
      0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x02,
    ]);
    assert.throws(() => new ProtoWireReader(badVarint10).readRawVarint(), A2uiValidationError);

    // 5. Invalid UTF-8 throws A2uiValidationError (not native TypeError).
    const invalidUtf8 = new ProtoWireWriter().writeBytes(1, new Uint8Array([0xff, 0xfe])).finish();
    const reader = new ProtoWireReader(invalidUtf8);
    reader.readTag();
    assert.throws(() => reader.readString(), A2uiValidationError);

    // 6. Edition 2023 delimited group (SGROUP/EGROUP) is skipped cleanly; stray EGROUP throws.
    const withGroup = new ProtoWireWriter()
      .writeTag(99, WireType.SGROUP)
      .writeString(1, 'ignored')
      .writeTag(99, WireType.EGROUP)
      .writeString(1, 'kept')
      .finish();
    assert.equal(decodeDynamicString(withGroup), 'kept');
    const strayEgroup = new ProtoWireWriter().writeTag(99, WireType.EGROUP).finish();
    assert.throws(() => decodeDynamicString(strayEgroup), A2uiValidationError);

    // 7. H2.5: encodeProtoValue rejects non-plain class instances & cyclic objects.
    const urlInstance = TrustedResourceUrl.fromProto(
      TrustedResourceUrl.toProtoBytesForTestServer('https://safe.example/x'),
    );
    assert.throws(() => encodeProtoValue(urlInstance), A2uiValidationError);
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    assert.throws(() => encodeProtoValue(cyclic), A2uiValidationError);
  });

  it('H3: enforces version on all Proto ops, atomic batch pre-validation in processOperations, non-empty surfaceId, and blocks Struct envelope spoofing', () => {
    const urlSpec: OpaqueTypeSpec<TrustedResourceUrl> = {
      name: 'trusted-resource-url',
      isInstance: (v): v is TrustedResourceUrl =>
        v instanceof TrustedResourceUrl && v.verifyBrand(),
    };
    const catalog = buildTestCatalog(new Map([['trusted-resource-url', urlSpec]]));
    const processor = new MessageProcessor([catalog], undefined, {
      version: '1.0',
      validationConfig: {...STRICT_VALIDATION, targetVersion: '1.0'},
    });
    const adapter = new ProtoTransportAdapter();

    // 1. Create a valid surface first.
    processor.processOperations(
      adapter.decode(
        encodeAgentToRendererMessage({
          version: '1.0',
          kind: 'createSurface',
          createSurface: {surfaceId: 'h3-surf', catalogId: catalog.id},
        }),
      ),
    );

    // 2. Wire version '0.8' on updateDataModel / updateComponents / deleteSurface is rejected!
    for (const badFrame of [
      encodeAgentToRendererMessage({
        version: '0.8',
        kind: 'updateDataModel',
        updateDataModel: {surfaceId: 'h3-surf', path: '/a', value: 1},
      }),
      encodeAgentToRendererMessage({
        version: '0.8',
        kind: 'updateComponents',
        updateComponents: {
          surfaceId: 'h3-surf',
          components: [
            {id: 'root', component: 'StatusBadge', properties: {label: 'x', tone: 'info'}},
          ],
        },
      }),
      encodeAgentToRendererMessage({
        version: '0.8',
        kind: 'deleteSurface',
        deleteSurface: {surfaceId: 'h3-surf'},
      }),
    ]) {
      const ops = adapter.decode(badFrame);
      assert.throws(() => processor.processOperations(ops), A2uiValidationError);
    }

    // 3. Batch pre-validation prevents partial state mutation when op #2 fails!
    assert.throws(
      () =>
        processor.processOperations([
          {type: 'createSurface', surfaceId: 'atomic-surf', catalogId: catalog.id, version: '1.0'},
          {type: 'updateDataModel', surfaceId: 'atomic-surf', path: '/a', value: 1, version: '0.8'},
        ]),
      A2uiValidationError,
    );
    assert.equal(processor.getSurface('atomic-surf'), undefined);

    // 4. Empty surfaceId and malformed non-operation entries are rejected cleanly!
    assert.throws(
      () =>
        processor.processOperations([
          {type: 'updateDataModel', surfaceId: '', path: '/a', value: 1, version: '1.0'},
        ]),
      A2uiValidationError,
    );
    assert.throws(
      () => processor.processOperations([{notAnOp: true} as unknown as never]),
      A2uiValidationError,
    );

    // 5. Component.properties Struct containing envelope keys (@catalogId, @checks, etc.) is rejected!
    for (const forbiddenKey of [
      '@catalogId',
      '@accessibility',
      '@metadata',
      '@checks',
      'component',
      'id',
    ]) {
      const spoofedFrame = encodeAgentToRendererMessage({
        version: '1.0',
        kind: 'updateComponents',
        updateComponents: {
          surfaceId: 'h3-surf',
          components: [
            {
              id: 'root',
              component: 'StatusBadge',
              properties: {label: 'ok', tone: 'info', [forbiddenKey]: 'spoofed'},
            },
          ],
        },
      });
      assert.throws(() => adapter.decode(spoofedFrame), A2uiValidationError);
    }

    processor.dispose();
  });
});
