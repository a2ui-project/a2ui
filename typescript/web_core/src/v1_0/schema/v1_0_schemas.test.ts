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
  CreateSurfaceMessageSchema,
  UpdateComponentsMessageSchema,
  UpdateDataModelMessageSchema,
  DeleteSurfaceMessageSchema,
  CallRendererFunctionMessageSchema,
  AgentFunctionResponseMessageSchema,
  AgentToRendererMessageSchema,
} from './agent-to-renderer.js';
import {
  RendererActionMessageSchema,
  CallAgentFunctionMessageSchema,
  RendererFunctionResponseMessageSchema,
  RendererErrorMessageSchema,
  RendererToAgentMessageSchema,
} from './renderer-to-agent.js';
import {RendererCapabilitiesSchema} from './renderer-capabilities.js';
import {
  ValidationResultSchema,
  ComponentCommonSchema,
  FunctionCallSchema,
  DataModelUpdateSchema,
} from './common-types.js';

describe('v1.0 Common Schemas', () => {
  it('validates ValidationResultSchema correctly', () => {
    const validResult = {
      valid: true,
      code: 'OK',
      message: 'Validation passed',
      severity: 'info',
    };
    const parsed = ValidationResultSchema.safeParse(validResult);
    assert.equal(parsed.success, true);

    const invalidResult = {code: 'FAIL'};
    const parsedInvalid = ValidationResultSchema.safeParse(invalidResult);
    assert.equal(parsedInvalid.success, false);
  });

  it('validates ComponentCommonSchema correctly', () => {
    const validCommon = {
      id: 'comp_1',
      catalogId: 'cat_1',
      accessibility: {
        label: 'Submit button',
        live: 'polite',
      },
    };
    const parsed = ComponentCommonSchema.safeParse(validCommon);
    assert.equal(parsed.success, true);
  });

  it('validates FunctionCallSchema correctly', () => {
    const validCall = {
      call: 'calculateTax',
      catalogId: 'finance_cat',
      args: {amount: 100},
    };
    const parsed = FunctionCallSchema.safeParse(validCall);
    assert.equal(parsed.success, true);
  });

  it('validates DataModelUpdateSchema correctly', () => {
    const validUpdate = {
      surfaceId: 'surf_1',
      path: '/user/name',
      value: 'Alice',
    };
    const parsed = DataModelUpdateSchema.safeParse(validUpdate);
    assert.equal(parsed.success, true);
  });
});

describe('v1.0 Agent-to-Renderer Messages', () => {
  it('validates CreateSurfaceMessageSchema with inline components and dataModel', () => {
    const msg = {
      version: 'v1.0',
      createSurface: {
        surfaceId: 'surf_main',
        catalogId: 'standard_cat',
        sendDataModel: true,
        components: [
          {
            component: 'Text',
            id: 'root',
            text: 'Hello World',
          },
        ],
        dataModel: {
          user: {name: 'Alice'},
        },
      },
    };
    const parsed = CreateSurfaceMessageSchema.safeParse(msg);
    assert.equal(parsed.success, true);

    const parsedUnion = AgentToRendererMessageSchema.safeParse(msg);
    assert.equal(parsedUnion.success, true);
  });

  it('validates UpdateComponentsMessageSchema', () => {
    const msg = {
      version: 'v1.0',
      updateComponents: {
        surfaceId: 'surf_main',
        components: [
          {
            component: 'Button',
            id: 'btn_1',
            label: 'Click me',
          },
        ],
      },
    };
    const parsed = UpdateComponentsMessageSchema.safeParse(msg);
    assert.equal(parsed.success, true);
  });

  it('validates UpdateDataModelMessageSchema', () => {
    const msg = {
      version: 'v1.0',
      updateDataModel: {
        surfaceId: 'surf_main',
        path: '/count',
        value: 42,
      },
    };
    const parsed = UpdateDataModelMessageSchema.safeParse(msg);
    assert.equal(parsed.success, true);
  });

  it('validates DeleteSurfaceMessageSchema', () => {
    const msg = {
      version: 'v1.0',
      deleteSurface: {
        surfaceId: 'surf_main',
      },
    };
    const parsed = DeleteSurfaceMessageSchema.safeParse(msg);
    assert.equal(parsed.success, true);
  });

  it('validates CallRendererFunctionMessageSchema', () => {
    const msg = {
      version: 'v1.0',
      callRendererFunction: {
        functionCallId: 'call_123',
        callFunction: {
          call: 'playAudio',
          catalogId: 'basic_catalog',
          args: {track: 'song.mp3'},
        },
      },
    };
    const parsed = CallRendererFunctionMessageSchema.safeParse(msg);
    assert.equal(parsed.success, true);
  });

  it('validates AgentFunctionResponseMessageSchema', () => {
    const msg = {
      version: 'v1.0',
      agentFunctionResponse: {
        functionCallId: 'call_456',
        value: {status: 'success'},
      },
    };
    const parsed = AgentFunctionResponseMessageSchema.safeParse(msg);
    assert.equal(parsed.success, true);
  });

  it('fails on invalid agent-to-renderer message', () => {
    const invalidMsg = {
      version: 'v1.0',
      createSurface: {
        // missing surfaceId
      },
    };
    const parsed = AgentToRendererMessageSchema.safeParse(invalidMsg);
    assert.equal(parsed.success, false);
  });
});

describe('v1.0 Renderer-to-Agent Messages', () => {
  it('validates RendererActionMessageSchema', () => {
    const msg = {
      version: 'v1.0',
      action: {
        name: 'submitForm',
        userMessage: 'User submitted form',
        surfaceId: 'surf_1',
        sourceComponentId: 'btn_submit',
        timestamp: '2026-08-12T12:00:00Z',
        context: {formData: {email: 'user@example.com'}},
      },
    };
    const parsed = RendererActionMessageSchema.safeParse(msg);
    assert.equal(parsed.success, true);

    const parsedUnion = RendererToAgentMessageSchema.safeParse(msg);
    assert.equal(parsedUnion.success, true);
  });

  it('validates CallAgentFunctionMessageSchema', () => {
    const msg = {
      version: 'v1.0',
      callAgentFunction: {
        surfaceId: 'surf_1',
        functionCallId: 'call_789',
        callFunction: {
          call: 'fetchUserData',
          args: {userId: 'usr_100'},
        },
      },
    };
    const parsed = CallAgentFunctionMessageSchema.safeParse(msg);
    assert.equal(parsed.success, true);
  });

  it('validates RendererFunctionResponseMessageSchema', () => {
    const msg = {
      version: 'v1.0',
      rendererFunctionResponse: {
        functionCallId: 'call_123',
        value: 'Audio played',
      },
    };
    const parsed = RendererFunctionResponseMessageSchema.safeParse(msg);
    assert.equal(parsed.success, true);
  });

  it('validates RendererErrorMessageSchema', () => {
    const msg = {
      version: 'v1.0',
      error: {
        code: 'VALIDATION_FAILED',
        surfaceId: 'surf_1',
        path: '/components/0/text',
        message: 'Field cannot be empty',
      },
    };
    const parsed = RendererErrorMessageSchema.safeParse(msg);
    assert.equal(parsed.success, true);
  });
});

describe('v1.0 Renderer Capabilities', () => {
  it('validates RendererCapabilitiesSchema', () => {
    const caps = {
      'v1.0': {
        supportedCatalogIds: ['std_cat', 'custom_cat'],
        inlineCatalogs: [],
      },
    };
    const parsed = RendererCapabilitiesSchema.safeParse(caps);
    assert.equal(parsed.success, true);
  });
});
