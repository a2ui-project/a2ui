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
  parseCatalogDocument,
  serializeCatalogDocument,
  type CatalogModel,
} from '../../catalog/model/index.js';
import {Catalog} from '../../catalog/types.js';
import {basicCatalog} from '../../catalogs/basic/v1/catalog.js';
import {
  A2UI_V1_ENVELOPE_PROTO,
  A2uiProtoCodegenError,
  generateProtoFromCatalogModel,
  protoDescriptorToCatalogModel,
  type ProtoFileDescriptor,
  type ProtoTagLockfile,
} from './index.js';

describe('Experimental Protobuf Codegen (Forward CatalogModel -> .proto & Reverse .proto -> CatalogModel)', () => {
  it('defines canonical Edition 2023 v1.0 wire envelope covering all 6 inbound and 4 outbound messages', () => {
    assert.match(A2UI_V1_ENVELOPE_PROTO, /edition = "2023";/);
    assert.match(A2UI_V1_ENVELOPE_PROTO, /package a2ui\.v1_0;/);
    for (const msg of [
      'CreateSurface create_surface = 2;',
      'UpdateComponents update_components = 3;',
      'UpdateDataModel update_data_model = 4;',
      'DeleteSurface delete_surface = 5;',
      'CallRendererFunction call_renderer_function = 6;',
      'AgentFunctionResponse agent_function_response = 7;',
      'ActionMessage action = 2;',
      'CallAgentFunction call_agent_function = 3;',
      'RendererFunctionResponse renderer_function_response = 4;',
      'ErrorMessage error = 5;',
      'google.protobuf.Any typed_payload = 7;',
      'google.protobuf.Struct properties = 8;',
      'google.protobuf.Value value = 3;',
      'google.protobuf.Any typed_value = 4;',
    ]) {
      assert.ok(A2UI_V1_ENVELOPE_PROTO.includes(msg), `Envelope proto missing '${msg}'`);
    }
  });

  it('generates Edition 2023 .proto + lockfile from the full 18-component v1.0 BasicCatalog and preserves 100% of wire tags when parameters are reordered', () => {
    const basicModel = basicCatalog.toModel();
    assert.equal(basicModel.components?.length, 18);

    const initial = generateProtoFromCatalogModel(basicModel, {
      protoPackage: 'a2ui.catalogs.basic.v1',
    });

    assert.match(initial.protoSource, /edition = "2023";/);
    assert.match(initial.protoSource, /package a2ui\.catalogs\.basic\.v1;/);
    assert.match(initial.protoSource, /import "a2ui\/v1_0\/envelope\.proto";/);

    // Local type `Weight` is emitted as a top-level message.
    assert.match(initial.protoSource, /message Weight \{/);

    // All 18 BasicCatalog component messages exist in both `.proto` and lockfile.
    for (const comp of basicModel.components ?? []) {
      assert.ok(
        initial.protoSource.includes(`message ${comp.name} {`),
        `Expected generated message ${comp.name}`,
      );
      assert.ok(
        Object.hasOwn(initial.lockfile.components, comp.name),
        `Expected lockfile entry for ${comp.name}`,
      );
    }

    // Check key v1.0 catalog structures: Dynamic<Enum> wrapper, Icon.name union, ChildList, Action, Checkable.
    assert.match(initial.protoSource, /message NameUnion \{\s+[\s\S]*oneof variant \{/);
    assert.match(initial.protoSource, /a2ui\.v1_0\.ChildList/);
    assert.match(initial.protoSource, /a2ui\.v1_0\.Action/);
    assert.match(initial.protoSource, /a2ui\.v1_0\.DynamicStringList/);
    assert.match(initial.protoSource, /Checkable component/);

    // Reorder Button's parameters (reversed!) and regenerate with the lockfile.
    const reorderedModel: CatalogModel = {
      ...basicModel,
      components: (basicModel.components ?? []).map(comp =>
        comp.name === 'Button'
          ? {...comp, parameters: [...(comp.parameters ?? [])].reverse()}
          : comp,
      ),
    };

    const regenerated = generateProtoFromCatalogModel(reorderedModel, {
      protoPackage: 'a2ui.catalogs.basic.v1',
      lockfile: initial.lockfile,
    });

    // EVERY wire tag across ALL 18 components and ALL enums must be 100% identical!
    assert.deepEqual(regenerated.lockfile.components, initial.lockfile.components);
    assert.deepEqual(regenerated.lockfile.enums, initial.lockfile.enums);
    assert.equal(regenerated.protoSource, initial.protoSource);
  });

  it('allocates new tags monotonically, retires removed tags as reserved, and rejects incompatible wire-type changes or retired-tag reuse', () => {
    const baseModel = basicCatalog.toModel();
    const v1 = generateProtoFromCatalogModel(baseModel, {
      protoPackage: 'a2ui.catalogs.basic.v1',
    });
    const buttonTagsV1 = v1.lockfile.components['Button'];
    const maxButtonTag = Math.max(...Object.values(buttonTagsV1));

    // 1. Add a new parameter and remove an existing optional parameter (`variant`).
    const removedTag = buttonTagsV1['variant'];
    assert.ok(typeof removedTag === 'number' && removedTag >= 1);

    const v2Model: CatalogModel = {
      ...baseModel,
      components: (baseModel.components ?? []).map(comp => {
        if (comp.name !== 'Button') return comp;
        const kept = (comp.parameters ?? []).filter(p => p.name !== 'variant');
        return {
          ...comp,
          parameters: [...kept, {name: 'tooltip', type: 'string', dynamic: true}],
        };
      }),
    };

    const v2 = generateProtoFromCatalogModel(v2Model, {
      protoPackage: 'a2ui.catalogs.basic.v1',
      lockfile: v1.lockfile,
    });

    assert.equal(v2.lockfile.components['Button']['tooltip'], maxButtonTag + 1);
    assert.equal(v2.lockfile.components['Button']['child'], buttonTagsV1['child']);
    assert.equal(v2.lockfile.components['Button']['action'], buttonTagsV1['action']);
    assert.deepEqual(v2.lockfile.retired?.['Button'], [removedTag]);
    assert.ok(v2.protoSource.includes(`reserved ${removedTag};`));

    // 2. Incompatible wire-type change on existing locked field MUST throw!
    const brokenTypeModel: CatalogModel = {
      ...baseModel,
      components: (baseModel.components ?? []).map(comp => {
        if (comp.name !== 'Button') return comp;
        return {
          ...comp,
          parameters: (comp.parameters ?? []).map(p =>
            p.name === 'child' ? {name: 'child', type: 'number' as const, required: true} : p,
          ),
        };
      }),
    };

    assert.throws(
      () =>
        generateProtoFromCatalogModel(brokenTypeModel, {
          protoPackage: 'a2ui.catalogs.basic.v1',
          lockfile: v1.lockfile,
        }),
      err => {
        assert.ok(err instanceof A2uiProtoCodegenError);
        assert.match(err.message, /Incompatible wire type change for 'Button\.child'/);
        return true;
      },
    );

    // 3. Attempting to reuse a retired tag in a lockfile MUST throw!
    const reusedRetiredLockfile: ProtoTagLockfile = {
      ...v2.lockfile,
      components: {
        ...v2.lockfile.components,
        Button: {
          ...v2.lockfile.components['Button'],
          tooltip: removedTag,
        },
      },
    };
    assert.throws(
      () =>
        generateProtoFromCatalogModel(v2Model, {
          protoPackage: 'a2ui.catalogs.basic.v1',
          lockfile: reusedRetiredLockfile,
        }),
      err => {
        assert.ok(err instanceof A2uiProtoCodegenError);
        assert.match(err.message, /reuses retired tag/);
        return true;
      },
    );
  });

  it('reverse-generates a valid formatVersion 1.0 CatalogModel from a proto descriptor with Google3 security protos, Dynamic*, Action, Enum, and oneof', () => {
    const descriptor: ProtoFileDescriptor = {
      package: 'google.ads.rsdk.ui.v1',
      enums: [
        {
          name: 'SandboxMode',
          values: [
            {name: 'SANDBOX_MODE_UNSPECIFIED', number: 0},
            {name: 'SANDBOX_MODE_STRICT', number: 1},
            {name: 'SANDBOX_MODE_ALLOW_SCRIPTS', number: 2},
            {name: 'SANDBOX_MODE_ALLOW_FORMS', number: 3},
          ],
        },
      ],
      messages: [
        {
          name: 'SafeIFramePropsProto',
          description: 'Sandboxed iframe accepting only authentic TrustedResourceUrl values.',
          checkable: true,
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
            {
              name: 'fallback_html',
              number: 5,
              kind: 'message',
              typeName: 'webutil.html.types.SafeHtmlProto',
            },
            {
              name: 'height_px',
              number: 6,
              kind: 'int32',
            },
          ],
        },
      ],
    };

    const model = protoDescriptorToCatalogModel(descriptor, {
      catalogId: 'https://example.com/rsdk-iframe/v1',
      title: 'R:SDK Safe Embed Catalog',
    });

    assert.equal(model.formatVersion, '1.0');
    assert.equal(model.components?.length, 1);
    const comp = model.components![0];
    assert.equal(comp.name, 'SafeIFrame');
    assert.equal(comp.checkable, true);

    const byName = new Map((comp.parameters ?? []).map(p => [p.name, p]));
    assert.deepEqual(byName.get('src'), {
      name: 'src',
      required: true,
      type: 'string',
      format: 'trusted-resource-url',
      dynamic: true,
    });
    assert.deepEqual(byName.get('title'), {
      name: 'title',
      required: true,
      type: 'string',
      dynamic: true,
    });
    assert.deepEqual(byName.get('onLoad'), {
      name: 'onLoad',
      type: 'action',
    });
    assert.deepEqual(byName.get('sandboxMode'), {
      name: 'sandboxMode',
      type: 'ref',
      ref: 'SandboxMode',
    });
    assert.deepEqual(byName.get('fallbackHtml'), {
      name: 'fallbackHtml',
      type: 'string',
      format: 'safe-html',
      dynamic: true,
    });
    assert.deepEqual(byName.get('heightPx'), {
      name: 'heightPx',
      type: 'integer',
    });
    assert.deepEqual(model.types?.['SandboxMode'], {
      type: 'enum',
      values: ['strict', 'allowScripts', 'allowForms'],
      valueType: 'string',
    });

    // Must serialize cleanly to a canonical Catalog Document and round-trip through Catalog.fromDocument!
    const doc = serializeCatalogDocument(model);
    assert.equal(doc['formatVersion'], '1.0');
    const reparsed = parseCatalogDocument(doc);
    assert.equal(reparsed.components?.[0].name, 'SafeIFrame');
    const catalog = Catalog.fromDocument(doc);
    assert.ok(catalog.components.get('SafeIFrame')?.definition);
    assert.equal(catalog.components.get('SafeIFrame')?.schema, undefined);
  });

  it('handles Dynamic<Enum> wrappers, maps, repeated fields, and oneof unions in both codegen directions', () => {
    const model: CatalogModel = {
      formatVersion: '1.0',
      catalogId: 'https://example.com/dynamic-enum/v1',
      protocolVersion: '1.0',
      components: [
        {
          name: 'RichCard',
          parameters: [
            {
              name: 'tone',
              type: 'enum',
              values: ['neutral', 'accent'],
              dynamic: true,
              required: true,
            },
            {
              name: 'src',
              type: 'string',
              format: 'trusted-resource-url',
              dynamic: true,
            },
            {
              name: 'labels',
              type: 'object',
              additionalProperties: {type: 'string'},
            },
          ],
        },
      ],
    };

    const generated = generateProtoFromCatalogModel(model, {
      protoPackage: 'a2ui.test.v1',
      opaqueFormatProtos: {
        'trusted-resource-url': {
          protoType: 'webutil.html.types.TrustedResourceUrlProto',
          importPath: 'webutil/html/types/proto/html.proto',
        },
      },
    });
    assert.ok(generated.protoSource.includes('import "webutil/html/types/proto/html.proto";'));
    assert.ok(generated.protoSource.includes('message DynamicTone {'));
    assert.ok(generated.protoSource.includes('message DynamicSrc {'));
    assert.ok(
      generated.protoSource.includes('webutil.html.types.TrustedResourceUrlProto literal = 1;'),
    );
    assert.ok(generated.protoSource.includes('map<string, string> labels = 3;'));

    // Reverse codegen with Dynamic<Enum> wrapper, map, nested message, and oneof!
    const reverseDesc: ProtoFileDescriptor = {
      package: 'a2ui.test.v1',
      enums: [
        {
          name: 'Tone',
          values: [
            {name: 'TONE_UNSPECIFIED', number: 0},
            {name: 'TONE_NEUTRAL', number: 1},
            {name: 'TONE_ACCENT', number: 2},
          ],
        },
      ],
      messages: [
        {
          name: 'DynamicTone',
          fields: [
            {name: 'literal', number: 1, kind: 'enum', typeName: 'Tone', oneofGroup: 'source'},
            {
              name: 'data_binding',
              number: 2,
              kind: 'message',
              typeName: 'a2ui.v1_0.DataBinding',
              oneofGroup: 'source',
            },
          ],
        },
        {
          name: 'RichCardPropsProto',
          fields: [
            {name: 'tone', number: 1, kind: 'message', typeName: 'DynamicTone', required: true},
            {name: 'labels', number: 2, kind: 'message', mapValue: {kind: 'string'}},
            {name: 'badge_text', number: 3, kind: 'string', oneofGroup: 'badge'},
            {name: 'badge_count', number: 4, kind: 'int32', oneofGroup: 'badge'},
          ],
        },
      ],
    };

    const reversed = protoDescriptorToCatalogModel(reverseDesc, {
      catalogId: 'https://example.com/dynamic-enum/v1',
    });
    assert.equal(reversed.components?.length, 1);
    const params = new Map((reversed.components![0].parameters ?? []).map(p => [p.name, p]));
    assert.deepEqual(params.get('tone'), {
      name: 'tone',
      required: true,
      type: 'enum',
      values: ['neutral', 'accent'],
      valueType: 'string',
      dynamic: true,
    });
    assert.deepEqual(params.get('labels'), {
      name: 'labels',
      type: 'object',
      additionalProperties: {type: 'string'},
    });
    assert.deepEqual(params.get('badge'), {
      name: 'badge',
      type: 'union',
      exclusive: true,
      variants: [{type: 'string'}, {type: 'integer'}],
    });
    assert.equal(serializeCatalogDocument(reversed)['formatVersion'], '1.0');
  });
});
