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

import {
  Catalog,
  serializeCatalogDocument,
  type ModelFunctionImplementation,
  type OpaqueTypeSpec,
} from '@a2ui/web_core/catalog';
import {
  ProtoTransportAdapter,
  ProtoWireReader,
  ProtoWireWriter,
  WireType,
  encodeAgentToRendererMessage,
  protoDescriptorToCatalogModel,
  type OpaqueValueProtoDecoder,
  type ProtoFileDescriptor,
} from '@a2ui/web_core/experimental/proto';
import {MessageProcessor, STRICT_VALIDATION} from '@a2ui/web_core/processing';
import {peekValue} from '@a2ui/web_core/reactivity';
import {
  NodeResolver,
  ResolvedBinding,
  isComponentNode,
  type ComponentNode,
} from '@a2ui/web_core/resolution';
import {describe, expect, it} from 'vitest';

import {ExpressCompiler} from '../../src/inference-formats/express/compiler.js';
import {ExpressPromptGenerator} from '../../src/inference-formats/express/prompt-generator.js';

const TRUSTED_URL_TOKEN = Symbol('SafeIFrame.TrustedResourceUrl');
const TRUSTED_URL_TYPE_URL = 'type.googleapis.com/webutil.html.types.TrustedResourceUrlProto';

class TrustedResourceUrl {
  readonly #token = TRUSTED_URL_TOKEN;
  readonly #url: string;

  constructor(token: symbol, url: string) {
    if (token !== TRUSTED_URL_TOKEN) {
      throw new Error('Use TrustedResourceUrl.fromProto().');
    }
    this.#url = url;
  }

  static encodeProtoForTest(url: string): Uint8Array {
    return new ProtoWireWriter().writeString(4, url).finish();
  }

  static fromProto(bytes: Uint8Array): TrustedResourceUrl {
    const reader = new ProtoWireReader(bytes);
    let url = '';
    while (reader.hasMore()) {
      const {fieldNumber, wireType} = reader.readTag();
      if (fieldNumber === 4 && wireType === WireType.LEN) {
        url = reader.readString();
      } else {
        reader.skipField(wireType);
      }
    }
    return new TrustedResourceUrl(TRUSTED_URL_TOKEN, url);
  }

  getTrustedUrl(): string {
    return this.#url;
  }

  isAuthentic(): boolean {
    return this.#token === TRUSTED_URL_TOKEN;
  }
}

describe('Goal 5: Reverse Proto Codegen -> Express LLM Prompt/Compiler -> Zero-Zod Runtime Rendering', () => {
  const protoDescriptor: ProtoFileDescriptor = {
    package: 'google.ads.rsdk.embed.v1',
    enums: [
      {
        name: 'SandboxMode',
        values: [
          {name: 'SANDBOX_MODE_UNSPECIFIED', number: 0},
          {name: 'SANDBOX_MODE_STRICT', number: 1},
          {name: 'SANDBOX_MODE_ALLOW_SCRIPTS', number: 2},
        ],
      },
    ],
    messages: [
      {
        name: 'EmbedContainerPropsProto',
        componentName: 'EmbedContainer',
        description: 'Container layout holding embedded frames.',
        fields: [
          {
            name: 'children',
            number: 1,
            kind: 'message',
            typeName: 'a2ui.v1_0.ChildList',
            required: true,
          },
        ],
      },
      {
        name: 'SafeIFramePropsProto',
        description: 'Sandboxed iframe bound to a server-verified TrustedResourceUrlProto.',
        fields: [
          {
            name: 'src',
            number: 1,
            kind: 'message',
            typeName: 'webutil.html.types.TrustedResourceUrlProto',
            required: true,
          },
          {
            name: 'title',
            number: 2,
            kind: 'message',
            typeName: 'a2ui.v1_0.DynamicString',
            required: true,
          },
          {
            name: 'on_load',
            number: 3,
            kind: 'message',
            typeName: 'a2ui.v1_0.Action',
          },
          {
            name: 'sandbox_mode',
            number: 4,
            kind: 'enum',
            typeName: 'SandboxMode',
          },
        ],
      },
    ],
  };

  it('generates Express prompt, compiles Express DSL, and renders reactive TrustedResourceUrl from binary Protobuf', async () => {
    // 1. Reverse codegen: .proto descriptor -> CatalogModel -> Catalog Document -> Catalog.fromDocument
    const catalogModel = protoDescriptorToCatalogModel(protoDescriptor, {
      catalogId: 'https://example.com/rsdk-embed/v1',
      title: 'R:SDK Safe Embed Catalog',
    });
    const catalogDoc = serializeCatalogDocument(catalogModel);

    const trustedUrlSpec: OpaqueTypeSpec<TrustedResourceUrl> = {
      name: 'trusted-resource-url',
      isInstance: (v): v is TrustedResourceUrl =>
        v instanceof TrustedResourceUrl && v.isAuthentic(),
      serializeForAgent: v => ({host: new URL(v.getTrustedUrl()).host}),
    };

    const schemaCatalog = Catalog.fromDocument(catalogDoc, undefined, undefined, {
      opaqueTypes: new Map([['trusted-resource-url', trustedUrlSpec]]),
    });
    const catalog = schemaCatalog.withEntries(
      [...schemaCatalog.components.values()],
      [] as ModelFunctionImplementation[],
    );
    expect(catalog.components.get('SafeIFrame')?.schema).toBeUndefined();
    expect(catalog.components.get('SafeIFrame')?.definition).toBeDefined();

    // 2. Feed reverse-generated Catalog directly into ExpressPromptGenerator!
    const promptGen = new ExpressPromptGenerator([catalog]);
    const prompt = promptGen.generate();
    expect(prompt).toContain('SafeIFrame(');
    expect(prompt).toContain('EmbedContainer(');
    expect(prompt).toContain('strict');
    expect(prompt).toContain('allowScripts');
    expect(prompt).toContain('onLoad');

    // 3. Compile LLM-authored Express DSL binding `src` to `$/frame/src`!
    const compiler = new ExpressCompiler([catalog]);
    const dsl = `
      frame = SafeIFrame($/frame/src, "Quarterly Dashboard", onLoad=Event("frameReady", context={"src": $/frame/src}), sandboxMode="strict")
      root = EmbedContainer([frame])
    `;
    const compiledMessages = compiler.compile(dsl, 'embed-surf');

    // 4. Feed compiled Express messages into MessageProcessor, then stream authentic TrustedResourceUrlProto via binary Protobuf!
    const dispatchedActions: Array<{name: string; context: Record<string, unknown>}> = [];
    const processor = new MessageProcessor(
      [catalog],
      action => {
        dispatchedActions.push({name: action.name, context: action.context});
      },
      {version: '1.0', validationConfig: STRICT_VALIDATION},
    );
    processor.processMessages(compiledMessages);

    const protoAdapter = new ProtoTransportAdapter({
      opaqueValueDecoders: new Map<string, OpaqueValueProtoDecoder>([
        [TRUSTED_URL_TYPE_URL, bytes => TrustedResourceUrl.fromProto(bytes)],
      ]),
    });

    const dataUpdateFrame = encodeAgentToRendererMessage({
      version: '1.0',
      kind: 'updateDataModel',
      updateDataModel: {
        surfaceId: 'embed-surf',
        path: '/frame/src',
        typedValue: {
          typeUrl: TRUSTED_URL_TYPE_URL,
          value: TrustedResourceUrl.encodeProtoForTest('https://reports.corp.example/q4'),
        },
      },
    });
    processor.processOperations(protoAdapter.decode(dataUpdateFrame));

    // 5. Resolve through NodeResolver and verify authentic branded TrustedResourceUrl + props + action!
    const surface = processor.getSurface('embed-surf')!;
    const resolver = new NodeResolver(surface);
    const rootNode = peekValue(resolver.rootNode)!;
    const children = peekValue(rootNode.props)['children'] as ComponentNode[];
    expect(children).toHaveLength(1);
    expect(isComponentNode(children[0])).toBe(true);

    const iframeNode = children[0];
    expect(iframeNode.type).toBe('SafeIFrame');

    const srcBinding = peekValue(iframeNode.props)['src'] as ResolvedBinding<TrustedResourceUrl>;
    expect(srcBinding).toBeInstanceOf(ResolvedBinding);
    expect(srcBinding.value).toBeInstanceOf(TrustedResourceUrl);
    expect(srcBinding.value.getTrustedUrl()).toBe('https://reports.corp.example/q4');

    const titleBinding = peekValue(iframeNode.props)['title'] as ResolvedBinding<string>;
    expect(titleBinding.value).toBe('Quarterly Dashboard');
    expect(peekValue(iframeNode.props)['sandboxMode']).toBe('strict');

    // Trigger action and confirm opaque value in context was safely serialized for agent!
    const onLoad = peekValue(iframeNode.props)['onLoad'] as () => Promise<void>;
    await onLoad();
    expect(dispatchedActions).toEqual([
      {name: 'frameReady', context: {src: {host: 'reports.corp.example'}}},
    ]);

    resolver.dispose();
    processor.dispose();
  });
});
