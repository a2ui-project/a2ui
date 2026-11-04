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
  A2uiRpcError,
  A2uiValidationError,
  AgentFunction,
  AgentFunctionRegistry,
  Catalog,
  RpcErrorCode,
} from '../../src/index.js';

describe('AgentFunctionRegistry', () => {
  test('indexes agent functions by catalogId and name and exposes get() and functions', () => {
    const fnA = new AgentFunction({
      name: 'getRates',
      returnType: 'number',
      schema: {type: 'object', properties: {base: {type: 'string'}}},
      handler: () => 1.08,
    });
    const fnB = new AgentFunction({
      name: 'getBalance',
      returnType: 'number',
      handler: () => 100,
    });
    const cat1 = new Catalog('cat1', '1.0', [], [], {
      agentFunctions: [fnA],
    });
    const cat2 = new Catalog('cat2', '1.0', [], [], {
      agentFunctions: [fnB],
    });

    const registry = new AgentFunctionRegistry([cat1, cat2]);
    expect(registry.get('cat1', 'getRates')).toBe(fnA);
    expect(registry.get('cat2', 'getBalance')).toBe(fnB);
    expect(registry.get('cat1', 'unknown')).toBeUndefined();
    expect(registry.get('unknown', 'getRates')).toBeUndefined();
    expect(registry.functions.get('cat1')?.get('getRates')).toBe(fnA);
    expect(registry.functions.get('cat2')?.get('getBalance')).toBe(fnB);
  });

  test('validates constructor options (maxConcurrency and timeoutMs)', () => {
    expect(() => new AgentFunctionRegistry([], {maxConcurrency: 0})).toThrow(RangeError);
    expect(() => new AgentFunctionRegistry([], {maxConcurrency: -1})).toThrow(RangeError);
    expect(() => new AgentFunctionRegistry([], {maxConcurrency: 1.5})).toThrow(RangeError);
    expect(() => new AgentFunctionRegistry([], {timeoutMs: 0})).toThrow(RangeError);
    expect(() => new AgentFunctionRegistry([], {timeoutMs: -50})).toThrow(RangeError);
  });

  test('executes async and sync handlers and returns agentFunctionResponse', async () => {
    const asyncFn = new AgentFunction({
      name: 'asyncEcho',
      returnType: 'object',
      schema: {
        type: 'object',
        properties: {
          text: {type: 'string'},
          tag: {type: 'string', default: 'default-tag'},
        },
        required: ['text'],
      },
      handler: async (args, ctx) => {
        await Promise.resolve();
        return {args, ctx};
      },
    });
    const voidFn = new AgentFunction({
      name: 'noop',
      returnType: 'void',
      handler: () => undefined,
    });
    const cat = new Catalog('cat', '1.0', [], [], {
      agentFunctions: [asyncFn, voidFn],
    });
    const registry = new AgentFunctionRegistry([cat]);

    const res = await registry.handle({
      version: '1.0',
      callAgentFunction: {
        surfaceId: 's1',
        functionCallId: 'call-1',
        callFunction: {
          '@call': 'asyncEcho',
          catalogId: 'cat',
          args: {text: 'hi'},
        },
      },
    });
    expect(res).toEqual({
      version: '1.0',
      agentFunctionResponse: {
        functionCallId: 'call-1',
        value: {
          args: {text: 'hi', tag: 'default-tag'},
          ctx: {catalogId: 'cat', surfaceId: 's1', functionCallId: 'call-1'},
        },
      },
    });

    const voidRes = await registry.handle({
      version: '1.0',
      callAgentFunction: {
        surfaceId: 's1',
        functionCallId: 'call-void',
        callFunction: {
          '@call': 'noop',
          catalogId: 'cat',
        },
      },
    });
    expect(voidRes).toEqual({
      version: '1.0',
      agentFunctionResponse: {
        functionCallId: 'call-void',
        value: null,
      },
    });
  });

  test('enforces maxConcurrency limit across concurrent calls', async () => {
    let active = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];

    const fn = new AgentFunction({
      name: 'work',
      returnType: 'number',
      handler: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>(resolve => resolvers.push(resolve));
        active--;
        return peak;
      },
    });
    const cat = new Catalog('cat', '1.0', [], [], {
      agentFunctions: [fn],
    });
    const registry = new AgentFunctionRegistry([cat], {maxConcurrency: 2});

    const p1 = registry.handle({
      version: '1.0',
      callAgentFunction: {
        surfaceId: 's1',
        functionCallId: 'c1',
        callFunction: {'@call': 'work', catalogId: 'cat'},
      },
    });
    const p2 = registry.handle({
      version: '1.0',
      callAgentFunction: {
        surfaceId: 's1',
        functionCallId: 'c2',
        callFunction: {'@call': 'work', catalogId: 'cat'},
      },
    });
    const p3 = registry.handle({
      version: '1.0',
      callAgentFunction: {
        surfaceId: 's1',
        functionCallId: 'c3',
        callFunction: {'@call': 'work', catalogId: 'cat'},
      },
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active).toBe(2);
    expect(resolvers.length).toBe(2);

    resolvers.shift()!();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active).toBe(2);
    expect(resolvers.length).toBe(2);

    resolvers.shift()!();
    resolvers.shift()!();

    const results = await Promise.all([p1, p2, p3]);
    expect(peak).toBe(2);
    expect(results.map(r => r.agentFunctionResponse.functionCallId)).toEqual(['c1', 'c2', 'c3']);
  });

  test('times out slow handlers with EXECUTION_ERROR and supports per-call timeout override', async () => {
    const slowFn = new AgentFunction({
      name: 'slow',
      returnType: 'string',
      handler: async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return 'done';
      },
    });
    const cat = new Catalog('cat', '1.0', [], [], {
      agentFunctions: [slowFn],
    });
    const registry = new AgentFunctionRegistry([cat], {timeoutMs: 20});

    const res = await registry.handle({
      version: '1.0',
      callAgentFunction: {
        surfaceId: 's1',
        functionCallId: 'c-timeout',
        callFunction: {'@call': 'slow', catalogId: 'cat'},
      },
    });
    expect(res.agentFunctionResponse.error?.code).toBe(RpcErrorCode.EXECUTION_ERROR);
    expect(res.agentFunctionResponse.error?.message).toContain('timed out');

    await expect(
      registry.handle(
        {
          version: '1.0',
          callAgentFunction: {
            surfaceId: 's1',
            functionCallId: 'c-invalid-timeout',
            callFunction: {'@call': 'slow', catalogId: 'cat'},
          },
        },
        {timeoutMs: 0},
      ),
    ).rejects.toThrow(RangeError);
  });

  test('supports AbortSignal cancellation', async () => {
    const controller = new AbortController();
    const slowFn = new AgentFunction({
      name: 'slow',
      returnType: 'string',
      handler: async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return 'done';
      },
    });
    const cat = new Catalog('cat', '1.0', [], [], {
      agentFunctions: [slowFn],
    });
    const registry = new AgentFunctionRegistry([cat]);

    const promise = registry.handle(
      {
        version: '1.0',
        callAgentFunction: {
          surfaceId: 's1',
          functionCallId: 'c-abort',
          callFunction: {'@call': 'slow', catalogId: 'cat'},
        },
      },
      {signal: controller.signal},
    );
    controller.abort();
    const res = await promise;
    expect(res.agentFunctionResponse.error?.code).toBe(RpcErrorCode.CANCELLED);
  });

  test('dispose() rejects in-flight calls and future handle() calls with DISPOSED', async () => {
    let started!: () => void;
    const startedPromise = new Promise<void>(resolve => {
      started = resolve;
    });
    const fn = new AgentFunction({
      name: 'hang',
      returnType: 'string',
      handler: async () => {
        started();
        await new Promise(() => {});
        return 'never';
      },
    });
    const cat = new Catalog('cat', '1.0', [], [], {
      agentFunctions: [fn],
    });
    const registry = new AgentFunctionRegistry([cat]);

    const inFlight = registry.handle({
      version: '1.0',
      callAgentFunction: {
        surfaceId: 's1',
        functionCallId: 'c-in-flight',
        callFunction: {'@call': 'hang', catalogId: 'cat'},
      },
    });

    await startedPromise;
    expect(registry.disposed).toBe(false);
    registry.dispose();
    expect(registry.disposed).toBe(true);
    // Idempotent second call
    registry.dispose();

    await expect(inFlight).rejects.toMatchObject({
      code: RpcErrorCode.DISPOSED,
      functionCallId: 'c-in-flight',
    });

    await expect(
      registry.handle({
        version: '1.0',
        callAgentFunction: {
          surfaceId: 's1',
          functionCallId: 'c-after-dispose',
          callFunction: {'@call': 'hang', catalogId: 'cat'},
        },
      }),
    ).rejects.toMatchObject({
      code: RpcErrorCode.DISPOSED,
    });
  });

  test('validates envelope edge cases (missing functionCallId vs malformed with functionCallId)', async () => {
    const registry = new AgentFunctionRegistry([]);

    await expect(registry.handle('not-an-object' as never)).rejects.toThrow(A2uiValidationError);
    await expect(
      registry.handle({
        version: '1.0',
        callAgentFunction: {
          surfaceId: 's1',
          functionCallId: '',
          callFunction: {'@call': 'fn'},
        },
      }),
    ).rejects.toThrow(A2uiValidationError);

    const wrongVer = await registry.handle({
      version: '0.9',
      callAgentFunction: {
        surfaceId: 's1',
        functionCallId: 'c-wrong-ver',
        callFunction: {'@call': 'fn'},
      },
    });
    expect(wrongVer.agentFunctionResponse.functionCallId).toBe('c-wrong-ver');
    expect(wrongVer.agentFunctionResponse.error?.code).toBe(RpcErrorCode.INVALID_FUNCTION_CALL);

    const missingSurface = await registry.handle({
      version: '1.0',
      callAgentFunction: {
        functionCallId: 'c-no-surface',
        callFunction: {'@call': 'fn'},
      },
    });
    expect(missingSurface.agentFunctionResponse.functionCallId).toBe('c-no-surface');
    expect(missingSurface.agentFunctionResponse.error?.code).toBe(
      RpcErrorCode.INVALID_FUNCTION_CALL,
    );
  });

  test('propagates custom A2uiRpcError code and rawMessage from handler', async () => {
    const fn = new AgentFunction({
      name: 'failCustom',
      returnType: 'string',
      handler: () => {
        throw new A2uiRpcError('rate limit exceeded', 'RATE_LIMITED');
      },
    });
    const cat = new Catalog('cat', '1.0', [], [], {
      agentFunctions: [fn],
    });
    const registry = new AgentFunctionRegistry([cat]);

    const res = await registry.handle({
      version: '1.0',
      callAgentFunction: {
        surfaceId: 's1',
        functionCallId: 'c-custom',
        callFunction: {'@call': 'failCustom', catalogId: 'cat'},
      },
    });
    expect(res.agentFunctionResponse).toEqual({
      functionCallId: 'c-custom',
      error: {
        code: 'RATE_LIMITED',
        message: 'rate limit exceeded',
      },
    });
  });

  test('times out, aborts, and disposes calls while queued behind maxConcurrency', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const invoked: string[] = [];

    const gatedFn = new AgentFunction({
      name: 'gated',
      returnType: 'string',
      handler: async (_args, ctx) => {
        invoked.push(ctx.functionCallId);
        await firstGate;
        return ctx.functionCallId;
      },
    });
    const cat = new Catalog('cat', '1.0', [], [], {
      agentFunctions: [gatedFn],
    });
    const registry = new AgentFunctionRegistry([cat], {maxConcurrency: 1});

    const pActive = registry.handle({
      version: '1.0',
      callAgentFunction: {
        surfaceId: 's1',
        functionCallId: 'c-active',
        callFunction: {'@call': 'gated', catalogId: 'cat'},
      },
    });

    const pQueuedTimeout = registry.handle(
      {
        version: '1.0',
        callAgentFunction: {
          surfaceId: 's1',
          functionCallId: 'c-queued-timeout',
          callFunction: {'@call': 'gated', catalogId: 'cat'},
        },
      },
      {timeoutMs: 20},
    );

    const abortController = new AbortController();
    const pQueuedAbort = registry.handle(
      {
        version: '1.0',
        callAgentFunction: {
          surfaceId: 's1',
          functionCallId: 'c-queued-abort',
          callFunction: {'@call': 'gated', catalogId: 'cat'},
        },
      },
      {signal: abortController.signal},
    );
    abortController.abort();

    const [timedOutRes, abortedRes] = await Promise.all([pQueuedTimeout, pQueuedAbort]);
    expect(timedOutRes.agentFunctionResponse.error?.code).toBe(RpcErrorCode.EXECUTION_ERROR);
    expect(abortedRes.agentFunctionResponse.error?.code).toBe(RpcErrorCode.CANCELLED);
    expect(invoked).toEqual(['c-active']);

    releaseFirst();
    const activeRes = await pActive;
    expect(activeRes.agentFunctionResponse.value).toBe('c-active');
    expect(invoked).toEqual(['c-active']);
  });
});
