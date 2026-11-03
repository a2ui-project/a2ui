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

import {describe, expect, test, vi} from 'vitest';

import {
  A2uiRpcError,
  DEFAULT_RENDERER_CALL_TIMEOUT,
  DEFAULT_RENDERER_CALL_TIMEOUT_MS,
  RendererFunctionCalls,
  RpcErrorCode,
} from '../../src/index.js';

describe('RendererFunctionCalls', () => {
  test('exports DEFAULT_RENDERER_CALL_TIMEOUT_MS (30000) and DEFAULT_RENDERER_CALL_TIMEOUT (30.0)', () => {
    expect(DEFAULT_RENDERER_CALL_TIMEOUT_MS).toBe(30_000);
    expect(DEFAULT_RENDERER_CALL_TIMEOUT).toBe(30.0);
  });

  test('validates constructor options (defaultTimeoutMs and maxPending)', () => {
    expect(() => new RendererFunctionCalls({defaultTimeoutMs: 0})).toThrow(RangeError);
    expect(() => new RendererFunctionCalls({defaultTimeoutMs: -10})).toThrow(RangeError);
    expect(() => new RendererFunctionCalls({maxPending: 0})).toThrow(RangeError);
    expect(() => new RendererFunctionCalls({maxPending: -1})).toThrow(RangeError);
    expect(() => new RendererFunctionCalls({maxPending: 1.5})).toThrow(RangeError);
  });

  test('supports both tuple and named property destructuring from call()', async () => {
    const calls = new RendererFunctionCalls();
    const pending = calls.call<string>({
      catalogId: 'cat',
      name: 'getLocale',
      args: {fallback: 'en'},
      surfaceId: 's1',
      functionCallId: 'call-1',
    });

    const [tupleMsg, tupleResult] = pending;
    const {message, result, functionCallId, cancel} = pending;

    expect(tupleMsg).toBe(message);
    expect(tupleResult).toBe(result);
    expect(functionCallId).toBe('call-1');
    expect(typeof cancel).toBe('function');

    calls.resolve({
      version: '1.0',
      rendererFunctionResponse: {
        functionCallId: 'call-1',
        value: 'en-US',
      },
    });

    await expect(result).resolves.toBe('en-US');
    expect(calls.pendingCount).toBe(0);

    // Explicit null error alongside value resolves value.
    const [, nullErrResult] = calls.call<string>({
      catalogId: 'cat',
      name: 'getLocale',
      functionCallId: 'call-null-err',
    });
    calls.resolve({
      version: '1.0',
      rendererFunctionResponse: {
        functionCallId: 'call-null-err',
        value: 'fr-FR',
        error: null,
      } as never,
    });
    await expect(nullErrResult).resolves.toBe('fr-FR');
  });

  test('validates call arguments, identifiers, duplicate IDs, and maxPending', () => {
    const calls = new RendererFunctionCalls({maxPending: 2});

    expect(() => calls.call({catalogId: 'cat', name: 'fn', timeoutMs: 0})).toThrow(RangeError);

    expect(() => calls.call({catalogId: '', name: 'fn'})).toThrow(A2uiRpcError);

    expect(() => calls.call({catalogId: 'cat', name: 'bad-name'})).toThrow(A2uiRpcError);

    expect(() => calls.call({catalogId: 'cat', name: 'fn', args: {'bad-arg': 1}})).toThrow(
      A2uiRpcError,
    );

    expect(() => calls.call({catalogId: 'cat', name: 'fn', surfaceId: ''})).toThrow(A2uiRpcError);

    expect(() => calls.call({catalogId: 'cat', name: 'fn', functionCallId: ''})).toThrow(
      A2uiRpcError,
    );

    calls.call({catalogId: 'cat', name: 'fn', functionCallId: 'id-1'});
    expect(() => calls.call({catalogId: 'cat', name: 'fn', functionCallId: 'id-1'})).toThrowError(
      expect.objectContaining({
        code: RpcErrorCode.DUPLICATE,
        functionCallId: 'id-1',
      }),
    );

    calls.call({catalogId: 'cat', name: 'fn', functionCallId: 'id-2'});
    expect(() => calls.call({catalogId: 'cat', name: 'fn', functionCallId: 'id-3'})).toThrowError(
      expect.objectContaining({
        code: RpcErrorCode.TOO_MANY_PENDING,
        functionCallId: 'id-3',
      }),
    );

    calls.dispose();
  });

  test('cancelling a call rejects with CANCELLED, frees its slot, and ignores later responses', async () => {
    const calls = new RendererFunctionCalls({maxPending: 1});
    const [, result] = calls.call({
      catalogId: 'cat',
      name: 'getLocale',
      functionCallId: 'c1',
    });

    expect(calls.pendingCount).toBe(1);
    result.cancel('user aborted');
    expect(calls.pendingCount).toBe(0);

    await expect(result).rejects.toMatchObject({
      code: RpcErrorCode.CANCELLED,
      functionCallId: 'c1',
    });

    // Late response is ignored
    calls.resolve({
      version: '1.0',
      rendererFunctionResponse: {functionCallId: 'c1', value: 'en'},
    });

    // ID and slot can now be reused
    const [, result2] = calls.call({
      catalogId: 'cat',
      name: 'getLocale',
      functionCallId: 'c1',
    });
    calls.resolve({
      version: '1.0',
      rendererFunctionResponse: {functionCallId: 'c1', value: 'fr'},
    });
    await expect(result2).resolves.toBe('fr');
  });

  test('ignores malformed rendererFunctionResponse messages without throwing', async () => {
    const calls = new RendererFunctionCalls();
    const [, result] = calls.call({
      catalogId: 'cat',
      name: 'getLocale',
      functionCallId: 'c1',
    });

    const malformed: unknown[] = [
      'not-an-object',
      {version: '0.9', rendererFunctionResponse: {functionCallId: 'c1', value: 'en'}},
      {
        version: '1.0',
        extra: 1,
        rendererFunctionResponse: {functionCallId: 'c1', value: 'en'},
      },
      {version: '1.0', rendererFunctionResponse: {functionCallId: 'c1'}},
      {
        version: '1.0',
        rendererFunctionResponse: {
          functionCallId: 'c1',
          value: 'en',
          error: {code: 'E', message: 'm'},
        },
      },
      {
        version: '1.0',
        rendererFunctionResponse: {
          functionCallId: 'c1',
          error: {code: '', message: 'm'},
        },
      },
    ];

    for (const bad of malformed) {
      calls.resolve(bad as never);
    }

    expect(calls.pendingCount).toBe(1);

    calls.resolve({
      version: '1.0',
      rendererFunctionResponse: {functionCallId: 'c1', value: 'de'},
    });
    await expect(result).resolves.toBe('de');
  });

  test('supports disabling defaultTimeoutMs with null', async () => {
    vi.useFakeTimers();
    try {
      const calls = new RendererFunctionCalls({defaultTimeoutMs: null});
      const [, result] = calls.call({
        catalogId: 'cat',
        name: 'getLocale',
        functionCallId: 'c-no-timeout',
      });

      vi.advanceTimersByTime(120_000);
      expect(calls.pendingCount).toBe(1);

      calls.resolve({
        version: '1.0',
        rendererFunctionResponse: {functionCallId: 'c-no-timeout', value: 'ja'},
      });
      await expect(result).resolves.toBe('ja');
    } finally {
      vi.useRealTimers();
    }
  });
});
