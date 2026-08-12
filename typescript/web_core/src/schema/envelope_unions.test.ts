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

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  A2uiProtocolVersion,
  AgentToRendererMessageSchema,
  RendererToAgentMessageSchema,
} from './index.js';

describe('Schema Export Strategy & Envelope Union Types', () => {
  it('defines A2uiProtocolVersion enum correctly', () => {
    assert.equal(A2uiProtocolVersion.V0_8, 'v0.8');
    assert.equal(A2uiProtocolVersion.V0_9, 'v0.9');
    assert.equal(A2uiProtocolVersion.V0_9_1, 'v0.9.1');
    assert.equal(A2uiProtocolVersion.V1_0, 'v1.0');
  });

  it('AgentToRendererMessageSchema accepts v0.9 server-to-client messages', () => {
    const v09Msg = {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'surf_v09',
        catalogId: 'cat_09',
      },
    };
    const parsed = AgentToRendererMessageSchema.safeParse(v09Msg);
    assert.equal(parsed.success, true);
  });

  it('AgentToRendererMessageSchema accepts v1.0 agent-to-renderer messages', () => {
    const v10Msg = {
      version: 'v1.0',
      createSurface: {
        surfaceId: 'surf_v10',
        catalogId: 'cat_10',
        components: [{component: 'Card', id: 'root'}],
      },
    };
    const parsed = AgentToRendererMessageSchema.safeParse(v10Msg);
    assert.equal(parsed.success, true);
  });

  it('RendererToAgentMessageSchema accepts v0.9 client-to-server action messages', () => {
    const v09ClientMsg = {
      version: 'v0.9',
      action: {
        name: 'click',
        surfaceId: 'surf_v09',
        sourceComponentId: 'btn',
        timestamp: '2026-08-12T12:00:00Z',
        context: {},
      },
    };
    const parsed = RendererToAgentMessageSchema.safeParse(v09ClientMsg);
    assert.equal(parsed.success, true);
  });

  it('RendererToAgentMessageSchema accepts v1.0 renderer-to-agent action messages', () => {
    const v10RendererMsg = {
      version: 'v1.0',
      action: {
        name: 'submit',
        userMessage: 'User clicked submit',
        surfaceId: 'surf_v10',
        sourceComponentId: 'btn_submit',
        timestamp: '2026-08-12T12:00:00Z',
        context: {key: 'val'},
      },
    };
    const parsed = RendererToAgentMessageSchema.safeParse(v10RendererMsg);
    assert.equal(parsed.success, true);
  });
});
