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

import {describe, expect, test} from 'vitest';

import {
  A2uiValidationError,
  AgentFunction,
  AgentFunctionRegistry,
  Catalog,
  RendererFunctionCalls,
  RendererMessageRouter,
} from '../../src/index.js';

describe('RendererMessageRouter', () => {
  test('routes callAgentFunction to AgentFunctionRegistry and returns response', async () => {
    const fn = new AgentFunction({
      name: 'ping',
      returnType: 'string',
      handler: () => 'pong',
    });
    const cat = new Catalog('cat', '1.0', [], [], {
      agentFunctions: [fn],
    });
    const registry = new AgentFunctionRegistry([cat]);
    const router = new RendererMessageRouter({registry});

    const out = await router.route({
      version: '1.0',
      callAgentFunction: {
        surfaceId: 's1',
        functionCallId: 'c1',
        callFunction: {'@call': 'ping', catalogId: 'cat'},
      },
    });

    expect(out).toEqual({
      version: '1.0',
      agentFunctionResponse: {
        functionCallId: 'c1',
        value: 'pong',
      },
    });
  });

  test('routes rendererFunctionResponse to RendererFunctionCalls and returns null', async () => {
    const rendererCalls = new RendererFunctionCalls();
    const router = new RendererMessageRouter({rendererCalls});

    const [, result] = rendererCalls.call({
      catalogId: 'cat',
      name: 'getLocale',
      functionCallId: 'r1',
    });

    const out = await router.route({
      version: '1.0',
      rendererFunctionResponse: {
        functionCallId: 'r1',
        value: 'en',
      },
    });

    expect(out).toBeNull();
    await expect(result).resolves.toBe('en');
  });

  test('routes action and error messages to onAction and onError callbacks', async () => {
    const actions: Array<Record<string, unknown>> = [];
    const errors: Array<Record<string, unknown>> = [];
    const router = new RendererMessageRouter({
      onAction: async msg => {
        await Promise.resolve();
        actions.push(msg as Record<string, unknown>);
      },
      onError: msg => {
        errors.push(msg as Record<string, unknown>);
      },
    });

    const actionMsg = {
      version: '1.0' as const,
      action: {
        name: 'submit',
        surfaceId: 's1',
        sourceComponentId: 'btn',
        timestamp: '2026-01-01T00:00:00Z',
        context: {},
      },
    };
    const errorMsg = {
      version: '1.0' as const,
      error: {
        code: 'GENERIC_ERROR',
        surfaceId: 's1',
        message: 'oops',
      },
    };

    expect(await router.route(actionMsg)).toBeNull();
    expect(await router.route(errorMsg)).toBeNull();
    expect(actions).toEqual([actionMsg]);
    expect(errors).toEqual([errorMsg]);
  });

  test('falls back to onUnhandled when handler is unconfigured or key is unknown', async () => {
    const unhandled: Array<Record<string, unknown>> = [];
    const router = new RendererMessageRouter({
      onUnhandled: async msg => {
        await Promise.resolve();
        unhandled.push(msg);
      },
    });

    const msg1 = {
      version: '1.0',
      callAgentFunction: {
        surfaceId: 's1',
        functionCallId: 'c1',
        callFunction: {'@call': 'ping'},
      },
    };
    const msg2 = {
      version: '1.0',
      rendererFunctionResponse: {functionCallId: 'r1', value: 1},
    };
    const msg3 = {
      version: '1.0',
      action: {name: 'a', surfaceId: 's1', sourceComponentId: 'b', timestamp: 't', context: {}},
    };
    const msg4 = {
      version: '1.0',
      error: {code: 'E', surfaceId: 's1', message: 'm'},
    };
    const msg5 = {
      version: '1.0',
      unknownKey: {},
    };

    for (const m of [msg1, msg2, msg3, msg4, msg5]) {
      expect(await router.route(m)).toBeNull();
    }
    expect(unhandled).toEqual([msg1, msg2, msg3, msg4, msg5]);

    const emptyRouter = new RendererMessageRouter();
    expect(await emptyRouter.route(msg5)).toBeNull();
  });

  test('rejects non-object messages and messages with multiple payload keys', async () => {
    const router = new RendererMessageRouter();

    await expect(router.route('not-an-object' as never)).rejects.toThrow(A2uiValidationError);
    await expect(router.route([] as never)).rejects.toThrow(A2uiValidationError);
    await expect(
      router.route({
        version: '1.0',
        action: {},
        error: {},
      }),
    ).rejects.toThrow(A2uiValidationError);
  });
});
