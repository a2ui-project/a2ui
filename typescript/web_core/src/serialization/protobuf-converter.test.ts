// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as assert from 'node:assert';
import {describe, it} from 'node:test';
import {
  encodeAgentToRendererMessage,
  decodeAgentToRendererMessages,
  encodeRendererToAgentMessage,
  decodeRendererToAgentMessage,
  jsValueToProtoValue,
  protoValueToJsValue,
  isA2uiMimeType,
  isProtobufMimeType,
  MIME_TYPE_A2UI_JSON,
  MIME_TYPE_A2UI_PROTO,
  MIME_TYPE_PROTO_BYTES,
  LEGACY_MIME_TYPE_JSON,
} from './index.js';
import {
  AgentToRendererListWrapperType,
  AgentToRendererMessageListType,
} from '../v1_0/proto/index.js';

describe('Protobuf Converter & Serialization', () => {
  describe('jsValueToProtoValue and protoValueToJsValue', () => {
    it('roundtrips scalar values (null, number, string, boolean)', () => {
      assert.deepStrictEqual(protoValueToJsValue(jsValueToProtoValue(null)), null);
      assert.deepStrictEqual(protoValueToJsValue(jsValueToProtoValue(42)), 42);
      assert.deepStrictEqual(protoValueToJsValue(jsValueToProtoValue('hello')), 'hello');
      assert.deepStrictEqual(protoValueToJsValue(jsValueToProtoValue(true)), true);
      assert.deepStrictEqual(protoValueToJsValue(jsValueToProtoValue(false)), false);
    });

    it('roundtrips complex nested objects and arrays', () => {
      const original = {
        name: 'Alice',
        age: 30,
        tags: ['admin', 'user'],
        metadata: {
          active: true,
          score: 98.6,
          nullable: null,
        },
      };

      const protoVal = jsValueToProtoValue(original);
      const recovered = protoValueToJsValue(protoVal);
      assert.deepStrictEqual(recovered, original);
    });
  });

  describe('AgentToRendererMessage encoding and decoding', () => {
    it('encodes and decodes createSurface message', () => {
      const payload = {
        createSurface: {
          surfaceId: 'surface-main',
          catalogId: 'basic',
          sendDataModel: true,
        },
      };

      const bytes = encodeAgentToRendererMessage(payload);
      assert.ok(bytes instanceof Uint8Array);
      assert.ok(bytes.length > 0);

      const decoded = decodeAgentToRendererMessages(bytes);
      assert.strictEqual(decoded.length, 1);
      const msg = decoded[0] as {
        createSurface?: {surfaceId?: string; catalogId?: string; sendDataModel?: boolean};
      };
      assert.strictEqual(msg.createSurface?.surfaceId, 'surface-main');
      assert.strictEqual(msg.createSurface?.catalogId, 'basic');
      assert.strictEqual(msg.createSurface?.sendDataModel, true);
    });

    it('encodes and decodes updateComponents with component property flattening', () => {
      const payload = {
        updateComponents: {
          surfaceId: 'surface-main',
          components: [
            {
              id: 'text_1',
              component: 'Text',
              text: 'Hello Protobuf',
            },
            {
              id: 'btn_1',
              component: 'Button',
              label: 'Submit',
            },
          ],
        },
      };

      const bytes = encodeAgentToRendererMessage(payload);
      const decoded = decodeAgentToRendererMessages(bytes);
      assert.strictEqual(decoded.length, 1);
      const msg = decoded[0] as {
        updateComponents?: {components?: Array<Record<string, unknown>>};
      };
      const comps = msg.updateComponents?.components || [];
      assert.strictEqual(comps.length, 2);
      assert.strictEqual(comps[0].id, 'text_1');
      assert.strictEqual(comps[0].component, 'Text');
      assert.strictEqual(comps[0].text, 'Hello Protobuf');
      assert.strictEqual(comps[1].id, 'btn_1');
      assert.strictEqual(comps[1].label, 'Submit');
    });

    it('encodes and decodes updateDataModel message', () => {
      const payload = {
        updateDataModel: {
          surfaceId: 'surface-main',
          path: '/user/profile',
          value: {username: 'charlie', roles: ['editor']},
        },
      };

      const bytes = encodeAgentToRendererMessage(payload);
      const decoded = decodeAgentToRendererMessages(bytes);
      assert.strictEqual(decoded.length, 1);
      const msg = decoded[0] as {
        updateDataModel?: {surfaceId?: string; path?: string; value?: unknown};
      };
      assert.strictEqual(msg.updateDataModel?.surfaceId, 'surface-main');
      assert.strictEqual(msg.updateDataModel?.path, '/user/profile');
      assert.deepStrictEqual(msg.updateDataModel?.value, {
        username: 'charlie',
        roles: ['editor'],
      });
    });

    it('encodes and decodes deleteSurface message', () => {
      const payload = {
        deleteSurface: {
          surfaceId: 'surface-main',
        },
      };

      const bytes = encodeAgentToRendererMessage(payload);
      const decoded = decodeAgentToRendererMessages(bytes);
      assert.strictEqual(decoded.length, 1);
      const msg = decoded[0] as {deleteSurface?: {surfaceId?: string}};
      assert.strictEqual(msg.deleteSurface?.surfaceId, 'surface-main');
    });

    it('decodes AgentToRendererListWrapper multi-message binary payload', () => {
      const wrapperMsg = AgentToRendererListWrapperType.create({
        messages: {
          messages: [
            {
              createSurface: {
                surfaceId: 's_list',
                catalogId: 'basic',
              },
            },
            {
              deleteSurface: {
                surfaceId: 's_list',
              },
            },
          ],
        },
      });

      const binaryBytes = AgentToRendererListWrapperType.encode(wrapperMsg).finish();
      const decoded = decodeAgentToRendererMessages(binaryBytes);
      assert.strictEqual(decoded.length, 2);
      const msg0 = decoded[0] as {createSurface?: {surfaceId?: string}};
      const msg1 = decoded[1] as {deleteSurface?: {surfaceId?: string}};
      assert.strictEqual(msg0.createSurface?.surfaceId, 's_list');
      assert.strictEqual(msg1.deleteSurface?.surfaceId, 's_list');
    });

    it('encodes and decodes createSurface with initial dataModel', () => {
      const payload = {
        createSurface: {
          surfaceId: 'surface-data',
          catalogId: 'basic',
          dataModel: {
            user: {name: 'Bob', age: 25},
          },
        },
      };

      const bytes = encodeAgentToRendererMessage(payload);
      const decoded = decodeAgentToRendererMessages(bytes);
      assert.strictEqual(decoded.length, 1);
      const msg = decoded[0] as {
        createSurface?: {dataModel?: {user?: {name?: string; age?: number}}};
      };
      assert.deepStrictEqual(msg.createSurface?.dataModel?.user, {name: 'Bob', age: 25});
    });

    it('decodes AgentToRendererMessageListType multi-message binary payload', () => {
      const listMsg = AgentToRendererMessageListType.create({
        messages: [
          {
            createSurface: {
              surfaceId: 's_list_direct',
              catalogId: 'basic',
            },
          },
        ],
      });

      const binaryBytes = AgentToRendererMessageListType.encode(listMsg).finish();
      const decoded = decodeAgentToRendererMessages(binaryBytes);
      assert.strictEqual(decoded.length, 1);
      const msg0 = decoded[0] as {createSurface?: {surfaceId?: string}};
      assert.strictEqual(msg0.createSurface?.surfaceId, 's_list_direct');
    });

    it('handles pre-parsed object input and empty/null inputs', () => {
      assert.deepStrictEqual(decodeAgentToRendererMessages(null as any), []);
      assert.deepStrictEqual(decodeAgentToRendererMessages(undefined as any), []);
      assert.deepStrictEqual(decodeAgentToRendererMessages(new Uint8Array(0)), []);

      const plainObj = {createSurface: {surfaceId: 's1', catalogId: 'basic'}};
      const decoded = decodeAgentToRendererMessages(plainObj);
      assert.strictEqual(decoded.length, 1);
      const msg = decoded[0] as {createSurface?: {surfaceId?: string}};
      assert.strictEqual(msg.createSurface?.surfaceId, 's1');
    });

    it('throws error when encoding invalid agent payload', () => {
      assert.throws(() => {
        encodeAgentToRendererMessage({
          createSurface: 12345 as any,
        });
      });
    });
  });

  describe('RendererToAgentMessage encoding and decoding', () => {
    it('encodes and decodes action message', () => {
      const actionPayload = {
        version: 'v1.0',
        action: {
          name: 'button_click',
          surfaceId: 'surface-main',
          sourceComponentId: 'btn_1',
          context: {item_id: '123'},
        },
      };

      const bytes = encodeRendererToAgentMessage(actionPayload);
      const decoded = decodeRendererToAgentMessage(bytes) as {
        version?: string;
        action?: {name?: string; surfaceId?: string; sourceComponentId?: string};
      };
      assert.strictEqual(decoded.version, 'v1.0');
      assert.strictEqual(decoded.action?.name, 'button_click');
      assert.strictEqual(decoded.action?.surfaceId, 'surface-main');
      assert.strictEqual(decoded.action?.sourceComponentId, 'btn_1');
    });

    it('handles pre-parsed object and throws on unsupported inputs for renderer message', () => {
      const plainAction = {version: 'v1.0', action: {name: 'test'}};
      assert.deepStrictEqual(decodeRendererToAgentMessage(plainAction), plainAction);

      assert.throws(() => {
        decodeRendererToAgentMessage(12345 as any);
      });
      assert.throws(() => {
        encodeRendererToAgentMessage({action: 12345 as any});
      });
    });
  });

  describe('MIME Type Helpers', () => {
    it('identifies A2UI MIME types correctly', () => {
      assert.strictEqual(isA2uiMimeType(MIME_TYPE_A2UI_JSON), true);
      assert.strictEqual(isA2uiMimeType(MIME_TYPE_A2UI_PROTO), true);
      assert.strictEqual(isA2uiMimeType(MIME_TYPE_PROTO_BYTES), true);
      assert.strictEqual(isA2uiMimeType(LEGACY_MIME_TYPE_JSON), true);
      assert.strictEqual(isA2uiMimeType('application/json'), false);
      assert.strictEqual(isA2uiMimeType(null), false);
    });

    it('identifies Protobuf MIME types correctly', () => {
      assert.strictEqual(isProtobufMimeType(MIME_TYPE_A2UI_PROTO), true);
      assert.strictEqual(isProtobufMimeType(MIME_TYPE_PROTO_BYTES), true);
      assert.strictEqual(isProtobufMimeType(MIME_TYPE_A2UI_JSON), false);
      assert.strictEqual(isProtobufMimeType(null), false);
    });
  });
});
