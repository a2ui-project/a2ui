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

import type {ActionPayload} from '../state/surface-model.js';
import {A2uiClientMessageSchema} from '../v0_9/schema/client-to-server.js';
import {
  ActionMessageSchema,
  RendererToAgentMessageSchema,
} from '../v1_0/schema/renderer-to-agent.js';
import {toOutboundActionMessage} from './outbound-envelope.js';

describe('toOutboundActionMessage', () => {
  const baseAction: ActionPayload = {
    name: 'submitForm',
    surfaceId: 'surface-1',
    sourceComponentId: 'btn-submit',
    timestamp: '2026-11-07T01:00:00.000Z',
    context: {query: 'hello', count: 2},
  };

  it('builds a v1.0 action envelope that validates against ActionMessageSchema', () => {
    const action: ActionPayload = {
      ...baseAction,
      userMessage: 'Submitted form',
      catalogId: 'https://example.com/catalog.json',
      metadata: {extensions: {vendor_trace: {spanId: 'abc'}}},
    };

    for (const ver of ['1.0', 'v1.0', '1.1', '2.0']) {
      const envelope = toOutboundActionMessage(action, ver);
      assert.deepStrictEqual(envelope, {
        version: '1.0',
        action: {
          name: 'submitForm',
          surfaceId: 'surface-1',
          sourceComponentId: 'btn-submit',
          timestamp: '2026-11-07T01:00:00.000Z',
          context: {query: 'hello', count: 2},
          userMessage: 'Submitted form',
          catalogId: 'https://example.com/catalog.json',
          metadata: {extensions: {vendor_trace: {spanId: 'abc'}}},
        },
      });
      assert.strictEqual(ActionMessageSchema.safeParse(envelope).success, true);
      assert.strictEqual(RendererToAgentMessageSchema.safeParse(envelope).success, true);
    }
  });

  it('builds v0.9 and v0.9.1 action envelopes that validate against A2uiClientMessageSchema', () => {
    const action: ActionPayload = {
      ...baseAction,
      userMessage: 'Clicked button',
      catalogId: 'custom-cat',
      metadata: {extensions: {vendor_trace: {spanId: 'xyz'}}},
    };

    const v09Envelope = toOutboundActionMessage(action, '0.9');
    assert.deepStrictEqual(v09Envelope, {
      version: 'v0.9',
      action: {
        name: 'submitForm',
        surfaceId: 'surface-1',
        sourceComponentId: 'btn-submit',
        timestamp: '2026-11-07T01:00:00.000Z',
        context: {query: 'hello', count: 2},
        userMessage: 'Clicked button',
        catalogId: 'custom-cat',
        metadata: {extensions: {vendor_trace: {spanId: 'xyz'}}},
      },
    });
    assert.strictEqual(A2uiClientMessageSchema.safeParse(v09Envelope).success, true);

    const v091Envelope = toOutboundActionMessage(action, 'v0.9.1');
    assert.deepStrictEqual(v091Envelope, {
      version: 'v0.9.1',
      action: {
        name: 'submitForm',
        surfaceId: 'surface-1',
        sourceComponentId: 'btn-submit',
        timestamp: '2026-11-07T01:00:00.000Z',
        context: {query: 'hello', count: 2},
        userMessage: 'Clicked button',
        catalogId: 'custom-cat',
        metadata: {extensions: {vendor_trace: {spanId: 'xyz'}}},
      },
    });
    assert.strictEqual(A2uiClientMessageSchema.safeParse(v091Envelope).success, true);
  });

  it('omits optional fields when undefined and strips arbitrary extra ActionPayload keys', () => {
    const actionWithExtra: ActionPayload = {
      ...baseAction,
      extraInternalField: 'should-be-dropped',
      anotherKey: 123,
    };

    const v10 = toOutboundActionMessage(actionWithExtra, '1.0');
    assert.deepStrictEqual(v10, {
      version: '1.0',
      action: {
        name: 'submitForm',
        surfaceId: 'surface-1',
        sourceComponentId: 'btn-submit',
        timestamp: '2026-11-07T01:00:00.000Z',
        context: {query: 'hello', count: 2},
      },
    });
    assert.strictEqual('userMessage' in v10.action, false);
    assert.strictEqual('catalogId' in v10.action, false);
    assert.strictEqual('metadata' in v10.action, false);
    assert.strictEqual('extraInternalField' in v10.action, false);
    assert.strictEqual(ActionMessageSchema.safeParse(v10).success, true);

    const v09 = toOutboundActionMessage(actionWithExtra, 'v0.9');
    assert.deepStrictEqual(v09, {
      version: 'v0.9',
      action: {
        name: 'submitForm',
        surfaceId: 'surface-1',
        sourceComponentId: 'btn-submit',
        timestamp: '2026-11-07T01:00:00.000Z',
        context: {query: 'hello', count: 2},
      },
    });
    assert.strictEqual(A2uiClientMessageSchema.safeParse(v09).success, true);
  });

  it('returns undefined for v0.8, missing, or unparseable versions', () => {
    for (const unsupported of ['v0.8', '0.8', '0.8.1', '', 'invalid', undefined]) {
      assert.strictEqual(toOutboundActionMessage(baseAction, unsupported), undefined);
    }
  });
});
