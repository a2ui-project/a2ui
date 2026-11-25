/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {CONTRACT_VERSION} from './contract_version.js';
import {
  A2UI_STRUCTURED_KEY,
  readEmbedPayload,
  toToolResult,
  type EmbedPayload,
} from './embed_payload.js';

const payload: EmbedPayload = {
  contractVersion: CONTRACT_VERSION,
  messages: [
    {
      version: '1.0',
      createSurface: {
        surfaceId: 'main',
        catalogId: 'https://a2ui.org/specification/v1_0/basic_catalog.json',
      },
    },
    {
      version: '1.0',
      updateComponents: {
        surfaceId: 'main',
        components: [{id: 'root', component: 'Text', text: 'Hello'}],
      },
    },
  ],
};

describe('toToolResult', () => {
  it('puts the text in content and the payload in structuredContent', () => {
    assert.deepEqual(toToolResult({text: '2 rows', payload}), {
      content: [{type: 'text', text: '2 rows'}],
      structuredContent: {a2ui: payload},
    });
  });

  it('keeps the follow-up', () => {
    const withFollowUp = {...payload, followUp: {text: 'Break down "revenue" by "country"'}};
    const result = toToolResult({text: '', payload: withFollowUp});
    assert.deepEqual(result.structuredContent[A2UI_STRUCTURED_KEY].followUp, withFollowUp.followUp);
  });
});

describe('readEmbedPayload', () => {
  it('reads the payload built by toToolResult', () => {
    assert.deepEqual(readEmbedPayload(toToolResult({text: 'summary', payload})), {
      ok: true,
      payload,
    });
  });

  it('reads a payload with a follow-up and no messages', () => {
    const followUpOnly = {contractVersion: '1.0', messages: [], followUp: {text: 'Next'}};
    assert.deepEqual(readEmbedPayload({structuredContent: {a2ui: followUpOnly}}), {
      ok: true,
      payload: followUpOnly,
    });
  });

  it('accepts a newer minor version', () => {
    const result = readEmbedPayload({
      structuredContent: {a2ui: {...payload, contractVersion: '1.3'}},
    });
    assert.equal(result.ok, true);
  });

  it('keeps unknown message fields for the message processor to validate', () => {
    const message = {version: '1.0', futureMessage: {surfaceId: 'main'}};
    const result = readEmbedPayload({
      structuredContent: {a2ui: {contractVersion: '1.0', messages: [message]}},
    });
    assert.deepEqual(result.ok && result.payload.messages, [message]);
  });

  for (const [label, toolResult] of [
    ['null', null],
    ['undefined', undefined],
    ['a result without structuredContent', {}],
    ['a structuredContent array', {structuredContent: [payload]}],
    ['a structuredContent without a2ui', {structuredContent: {other: payload}}],
  ] as const) {
    it(`reports ${label} as missing`, () => {
      const result = readEmbedPayload(toolResult);
      assert.equal(!result.ok && result.code, 'missing');
    });
  }

  it('reports a newer major version as unsupported, whatever its shape', () => {
    const result = readEmbedPayload({structuredContent: {a2ui: {contractVersion: '2.0', ops: []}}});
    assert.equal(!result.ok && result.code, 'unsupported-version');
    assert.match(!result.ok ? result.message : '', /newer than the supported version/);
  });

  it('reports a malformed version as unsupported', () => {
    const result = readEmbedPayload({
      structuredContent: {a2ui: {...payload, contractVersion: 'one'}},
    });
    assert.equal(!result.ok && result.code, 'unsupported-version');
  });

  for (const [label, a2ui, path] of [
    ['a non-object payload', 'hello', '(root)'],
    ['a missing contractVersion', {messages: []}, 'contractVersion'],
    ['missing messages', {contractVersion: '1.0'}, 'messages'],
    ['a message that is not an object', {contractVersion: '1.0', messages: ['x']}, 'messages.0'],
    [
      'a message of another protocol version',
      {contractVersion: '1.0', messages: [{version: 'v0.9', createSurface: {}}]},
      'messages.0.version',
    ],
    [
      'a follow-up without text',
      {contractVersion: '1.0', messages: [], followUp: {}},
      'followUp.text',
    ],
  ] as const) {
    it(`reports ${label} as invalid`, () => {
      const result = readEmbedPayload({structuredContent: {a2ui}});
      assert.equal(!result.ok && result.code, 'invalid');
      assert.match(
        !result.ok ? result.message : '',
        new RegExp(`${path.replace(/[.()]/g, '\\$&')}:`),
      );
    });
  }
});
