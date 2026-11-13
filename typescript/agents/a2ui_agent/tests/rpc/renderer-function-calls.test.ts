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

import {type FunctionApi} from '@a2ui/web_core';
import {afterEach, describe, expect, test, vi} from 'vitest';
import * as z from 'zod/v4';

import {
  A2uiCatalogError,
  A2uiRpcError,
  AgentFunction,
  DEFAULT_RENDERER_CALL_TIMEOUT_MS,
  Catalog,
  type CatalogApi,
  RendererFunctionCalls,
  RendererToAgentMessageProcessor,
  RpcErrorCode,
} from '../../src/index.js';

describe('RendererFunctionCalls', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('exports DEFAULT_RENDERER_CALL_TIMEOUT_MS (30000) and no seconds-based constant', async () => {
    expect(DEFAULT_RENDERER_CALL_TIMEOUT_MS).toBe(30_000);
    const api: Record<string, unknown> = await import('../../src/index.js');
    expect(api['DEFAULT_RENDERER_CALL_TIMEOUT']).toBeUndefined();
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

    // An explicit null error alongside a value is malformed, as the
    // processor's schema has it, so the call fails instead of resolving.
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
    await expect(nullErrResult).rejects.toMatchObject({code: RpcErrorCode.UNKNOWN_ERROR});
  });

  test('validates call arguments, identifiers, duplicate IDs, and maxPending', () => {
    const calls = new RendererFunctionCalls({maxPending: 2});

    expect(() => calls.call({catalogId: 'cat', name: 'fn', timeoutMs: 0})).toThrow(RangeError);

    expect(() => calls.call({catalogId: '', name: 'fn'})).toThrow(A2uiRpcError);

    expect(() => calls.call({catalogId: 'cat', name: 'bad-name'})).toThrow(A2uiRpcError);

    expect(() => calls.call({catalogId: 'cat', name: 'fn', args: {'bad-arg': 1}})).toThrow(
      A2uiRpcError,
    );

    expect(() => calls.call({catalogId: 'cat', name: ''})).toThrowError(
      expect.objectContaining({
        code: RpcErrorCode.INVALID_FUNCTION_CALL,
        message: expect.stringContaining('needs a function name'),
      }),
    );

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
    expect(
      calls.resolve({
        version: '1.0',
        rendererFunctionResponse: {functionCallId: 'c1', value: 'en'},
      }),
    ).toBe(false);

    // ID and slot can now be reused
    const [, result2] = calls.call({
      catalogId: 'cat',
      name: 'getLocale',
      functionCallId: 'c1',
    });
    expect(
      calls.resolve({
        version: '1.0',
        rendererFunctionResponse: {functionCallId: 'c1', value: 'fr'},
      }),
    ).toBe(true);
    await expect(result2).resolves.toBe('fr');
  });

  test('treats an empty surfaceId as omitted', () => {
    const calls = new RendererFunctionCalls();
    const [message] = calls.call({
      catalogId: 'cat',
      name: 'fn',
      surfaceId: '',
      functionCallId: 'c1',
    });

    expect(message.callRendererFunction).toEqual({
      functionCallId: 'c1',
      callFunction: {'@call': 'fn', catalogId: 'cat', args: {}},
    });
    expect(Object.hasOwn(message.callRendererFunction, 'surfaceId')).toBe(false);
    calls.dispose();
  });

  test('ignores responses without a usable or pending functionCallId', async () => {
    const calls = new RendererFunctionCalls();
    const [, result] = calls.call({
      catalogId: 'cat',
      name: 'getLocale',
      functionCallId: 'c1',
    });

    const ignored: unknown[] = [
      'not-an-object',
      {version: '1.0'},
      {version: '1.0', rendererFunctionResponse: 'c1'},
      {version: '1.0', rendererFunctionResponse: {value: 'en'}},
      {version: '1.0', rendererFunctionResponse: {functionCallId: '', value: 'en'}},
      {version: '1.0', rendererFunctionResponse: {functionCallId: 'other', value: 'en'}},
      {version: '1.0', rendererFunctionResponse: {functionCallId: 'other'}},
    ];

    for (const message of ignored) {
      expect(calls.resolve(message as never)).toBe(false);
    }

    expect(calls.pendingCount).toBe(1);

    calls.resolve({
      version: '1.0',
      rendererFunctionResponse: {functionCallId: 'c1', value: 'de'},
    });
    await expect(result).resolves.toBe('de');
  });

  test('fails a pending call right away on a malformed response that carries its id', async () => {
    const malformed: Array<Record<string, unknown>> = [
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
      {version: '1.0', rendererFunctionResponse: {functionCallId: 'c1', error: null}},
      {
        version: '1.0',
        rendererFunctionResponse: {functionCallId: 'c1', value: 'en', error: null},
      },
      {
        version: '1.0',
        rendererFunctionResponse: {functionCallId: 'c1', value: 'en', extra: 1},
      },
      {version: '1.1', rendererFunctionResponse: {functionCallId: 'c1', value: 'en'}},
      {version: 'v1.0', rendererFunctionResponse: {functionCallId: 'c1', value: 'en'}},
      {rendererFunctionResponse: {functionCallId: 'c1', value: 'en'}},
    ];

    vi.useFakeTimers();
    for (const bad of malformed) {
      const calls = new RendererFunctionCalls();
      const [, result] = calls.call({catalogId: 'cat', name: 'getLocale', functionCallId: 'c1'});

      expect(calls.resolve(bad as never)).toBe(true);

      expect(calls.pendingCount).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      await expect(result).rejects.toMatchObject({
        code: RpcErrorCode.UNKNOWN_ERROR,
        functionCallId: 'c1',
      });
    }
  });

  test('settling a call clears its timeout', async () => {
    vi.useFakeTimers();
    const calls = new RendererFunctionCalls({defaultTimeoutMs: 1000});
    const [, result] = calls.call({catalogId: 'cat', name: 'getLocale', functionCallId: 'c1'});
    expect(vi.getTimerCount()).toBe(1);

    calls.resolve({
      version: '1.0',
      rendererFunctionResponse: {functionCallId: 'c1', value: 'en'},
    });

    expect(vi.getTimerCount()).toBe(0);
    await expect(result).resolves.toBe('en');

    const [, failed] = calls.call({catalogId: 'cat', name: 'getLocale', functionCallId: 'c2'});
    calls.resolve({
      version: '1.0',
      rendererFunctionResponse: {functionCallId: 'c2', error: {code: 'E', message: 'm'}},
    });
    expect(vi.getTimerCount()).toBe(0);
    await expect(failed).rejects.toMatchObject({code: 'E', functionCallId: 'c2'});

    const [, cancelled] = calls.call({catalogId: 'cat', name: 'getLocale'});
    cancelled.cancel();
    expect(vi.getTimerCount()).toBe(0);
    await expect(cancelled).rejects.toMatchObject({code: RpcErrorCode.CANCELLED});
  });

  test('times out with TIMEOUT and disposes pending calls with CANCELLED', async () => {
    vi.useFakeTimers();
    const calls = new RendererFunctionCalls({defaultTimeoutMs: 50});
    const [, timedOut] = calls.call({catalogId: 'cat', name: 'slow', functionCallId: 't1'});
    const [, perCall] = calls.call({
      catalogId: 'cat',
      name: 'slow',
      functionCallId: 't2',
      timeoutMs: 1000,
    });

    vi.advanceTimersByTime(50);
    await expect(timedOut).rejects.toMatchObject({
      code: RpcErrorCode.TIMEOUT,
      functionCallId: 't1',
    });
    expect(calls.pendingCount).toBe(1);

    calls.dispose('shutting down');
    expect(calls.disposed).toBe(true);
    await expect(perCall).rejects.toMatchObject({
      code: RpcErrorCode.CANCELLED,
      message: expect.stringContaining('shutting down'),
    });
    expect(() => calls.call({catalogId: 'cat', name: 'fn'})).toThrowError(
      expect.objectContaining({code: RpcErrorCode.DISPOSED}),
    );
  });

  test('settles a call with a null value', async () => {
    const calls = new RendererFunctionCalls();
    const [, result] = calls.call({catalogId: 'cat', name: 'getLocale', functionCallId: 'c1'});

    expect(
      calls.resolve({
        version: '1.0',
        rendererFunctionResponse: {functionCallId: 'c1', value: null},
      }),
    ).toBe(true);

    await expect(result).resolves.toBeNull();
  });

  test('a response after dispose settles nothing', async () => {
    const calls = new RendererFunctionCalls();
    const [, result] = calls.call({catalogId: 'cat', name: 'getLocale', functionCallId: 'c1'});
    let settledWith: unknown = 'unsettled';
    result.then(
      value => {
        settledWith = {value};
      },
      (err: unknown) => {
        settledWith = err;
      },
    );

    calls.dispose();
    for (const late of [
      {version: '1.0', rendererFunctionResponse: {functionCallId: 'c1', value: 'en'}},
      {version: '1.0', rendererFunctionResponse: {functionCallId: 'c1', error: null}},
    ]) {
      expect(calls.resolve(late as never)).toBe(false);
    }

    expect(calls.isPending('c1')).toBe(false);
    expect(calls.pendingCount).toBe(0);
    await expect(result).rejects.toMatchObject({
      code: RpcErrorCode.CANCELLED,
      functionCallId: 'c1',
    });
    expect(settledWith).toBeInstanceOf(A2uiRpcError);
  });

  test('plugs into RendererToAgentMessageProcessor as onRendererFunctionResponse', async () => {
    const calls = new RendererFunctionCalls();
    const processor = new RendererToAgentMessageProcessor({
      catalogs: [new Catalog('cat', '1.0', [], [])],
      onRendererFunctionResponse: calls.resolve,
    });
    const [, result] = calls.call<string>({
      catalogId: 'cat',
      name: 'getLocale',
      functionCallId: 'r1',
    });

    const processed = await processor.processMessage({
      version: '1.0',
      rendererFunctionResponse: {functionCallId: 'r1', value: 'en-GB'},
    });

    expect(processed).toEqual({handled: true, replies: []});
    await expect(result).resolves.toBe('en-GB');

    // A response to a call it didn't make, such as one the model wrote, or a
    // duplicate, is declined, so it reaches the model.
    for (const functionCallId of ['call_1', 'r1']) {
      expect(
        await processor.processMessage({
          version: '1.0',
          rendererFunctionResponse: {functionCallId, value: 'x'},
        }),
      ).toEqual({handled: false, replies: []});
    }
  });

  test('resolve returns true when it settles or fails a pending call', async () => {
    const calls = new RendererFunctionCalls();
    const [, ok] = calls.call({catalogId: 'cat', name: 'getLocale', functionCallId: 'ok'});
    const [, failed] = calls.call({catalogId: 'cat', name: 'getLocale', functionCallId: 'bad'});

    expect(
      calls.resolve({version: '1.0', rendererFunctionResponse: {functionCallId: 'ok', value: 1}}),
    ).toBe(true);
    expect(
      calls.resolve({
        version: '1.0',
        rendererFunctionResponse: {functionCallId: 'bad', error: {code: 'E', message: 'm'}},
      }),
    ).toBe(true);
    expect(
      calls.resolve({version: '1.0', rendererFunctionResponse: {functionCallId: 'ok', value: 2}}),
    ).toBe(false);
    await expect(ok).resolves.toBe(1);
    await expect(failed).rejects.toMatchObject({code: 'E'});
  });

  test('supports disabling defaultTimeoutMs with null', async () => {
    vi.useFakeTimers();
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
  });

  describe('with catalogs', () => {
    const fn = (name: string, extra: Partial<FunctionApi> = {}): FunctionApi => ({
      name,
      returnType: 'string',
      schema: z.object({}),
      ...extra,
    });
    const device: CatalogApi = new Catalog<never, FunctionApi>(
      'device',
      '1.0',
      [],
      [
        fn('getLocale', {allowedCallers: 'rendererOrAgent'}),
        fn('getClock', {allowedCallers: 'agentOnly'}),
        fn('formatDate', {allowedCallers: 'rendererOnly'}),
        fn('formatName'),
        fn('confirm', {allowedCallers: 'rendererOrAgent', requiresUserActivation: true}),
      ],
    );
    const other: CatalogApi = new Catalog<never, FunctionApi>(
      'other',
      '1.0',
      [],
      [fn('ping', {allowedCallers: 'agentOnly'})],
    );

    function expectRejected(
      calls: RendererFunctionCalls,
      catalogId: string,
      name: string,
      code: string,
      message: string,
    ): void {
      vi.useFakeTimers();
      expect(() => calls.call({catalogId, name, functionCallId: 'c1'})).toThrowError(
        expect.objectContaining({
          code,
          functionCallId: 'c1',
          message: expect.stringContaining(message),
        }),
      );
      expect(calls.pendingCount).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }

    test('calls a rendererOrAgent or agentOnly function', async () => {
      const calls = new RendererFunctionCalls({catalogs: [device, other]});

      const [message, locale] = calls.call<string>({
        catalogId: 'device',
        name: 'getLocale',
        functionCallId: 'c1',
      });
      expect(message.callRendererFunction.callFunction).toEqual({
        '@call': 'getLocale',
        catalogId: 'device',
        args: {},
      });
      calls.resolve({
        version: '1.0',
        rendererFunctionResponse: {functionCallId: 'c1', value: 'en'},
      });
      await expect(locale).resolves.toBe('en');

      const [, clock] = calls.call({catalogId: 'device', name: 'getClock'});
      const [, ping] = calls.call({catalogId: 'other', name: 'ping'});
      expect(calls.pendingCount).toBe(2);
      calls.dispose();
      await expect(clock).rejects.toMatchObject({code: RpcErrorCode.CANCELLED});
      await expect(ping).rejects.toMatchObject({code: RpcErrorCode.CANCELLED});
    });

    test('rejects an unknown catalog or function with UNKNOWN_FUNCTION', () => {
      const calls = new RendererFunctionCalls({catalogs: [device]});

      expectRejected(calls, 'nope', 'getLocale', RpcErrorCode.UNKNOWN_FUNCTION, "'nope'");
      expectRejected(calls, 'device', 'missing', RpcErrorCode.UNKNOWN_FUNCTION, "'missing'");
    });

    test('rejects an agent function with UNKNOWN_FUNCTION', () => {
      const withAgentFunction = device.copyWith({
        agentFunctions: [AgentFunction.fromApi(device.functions.get('getLocale')!, () => 'en')],
      });
      const calls = new RendererFunctionCalls({catalogs: [withAgentFunction]});

      expectRejected(
        calls,
        'device',
        'getLocale',
        RpcErrorCode.UNKNOWN_FUNCTION,
        "Catalog 'device' has no renderer function 'getLocale'.",
      );
    });

    test('rejects a rendererOnly function, or one whose allowedCallers is omitted', () => {
      const calls = new RendererFunctionCalls({catalogs: [device]});

      for (const name of ['formatDate', 'formatName']) {
        expectRejected(
          calls,
          'device',
          name,
          RpcErrorCode.INVALID_FUNCTION_CALL,
          'the agent may not call it',
        );
      }
    });

    test('rejects a function that requires user activation', () => {
      const calls = new RendererFunctionCalls({catalogs: [device]});

      expectRejected(
        calls,
        'device',
        'confirm',
        RpcErrorCode.INVALID_FUNCTION_CALL,
        'no user gesture',
      );
    });

    test('checks the target after the empty-name, empty-catalogId and duplicate-id checks', () => {
      const calls = new RendererFunctionCalls({catalogs: [device]});
      calls.call({catalogId: 'device', name: 'getLocale', functionCallId: 'dup'});

      expect(() => calls.call({catalogId: 'nope', name: ''})).toThrowError(
        expect.objectContaining({message: expect.stringContaining('needs a function name')}),
      );
      expect(() => calls.call({catalogId: '', name: 'missing'})).toThrowError(
        expect.objectContaining({message: expect.stringContaining('catalogId')}),
      );
      expect(() =>
        calls.call({catalogId: 'nope', name: 'missing', functionCallId: 'dup'}),
      ).toThrowError(expect.objectContaining({code: RpcErrorCode.DUPLICATE}));
      calls.dispose();
    });

    test('does not check calls without catalogs', () => {
      const calls = new RendererFunctionCalls();
      const [message] = calls.call({catalogId: 'device', name: 'formatDate'});

      expect(message.callRendererFunction.callFunction['@call']).toBe('formatDate');
      calls.dispose();
    });

    test('rejects two catalogs with the same id', () => {
      expect(
        () =>
          new RendererFunctionCalls({
            catalogs: [device, new Catalog<never, FunctionApi>('device', '1.0', [], [])],
          }),
      ).toThrow(A2uiCatalogError);
      expect(() => new RendererFunctionCalls({catalogs: []})).not.toThrow();
    });
  });

  describe('call checks', () => {
    function expectInvalid(
      calls: RendererFunctionCalls,
      options: Parameters<RendererFunctionCalls['call']>[0],
      code: string,
      message: string,
    ): void {
      vi.useFakeTimers();
      const pending = calls.pendingCount;
      const timers = vi.getTimerCount();
      expect(() => calls.call(options)).toThrowError(
        expect.objectContaining({code, message: expect.stringContaining(message)}),
      );
      expect(calls.pendingCount).toBe(pending);
      expect(vi.getTimerCount()).toBe(timers);
    }

    test('rejects a timeout that is not a finite number greater than 0', () => {
      const calls = new RendererFunctionCalls();
      for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '10' as never]) {
        expect(() => calls.call({catalogId: 'cat', name: 'fn', timeoutMs})).toThrow(RangeError);
      }
      for (const defaultTimeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => new RendererFunctionCalls({defaultTimeoutMs})).toThrow(RangeError);
      }
      expect(calls.pendingCount).toBe(0);
    });

    test('checks the timeout before disposal', () => {
      const calls = new RendererFunctionCalls();
      calls.dispose();
      expect(() => calls.call({catalogId: 'cat', name: 'fn', timeoutMs: 0})).toThrow(RangeError);
      expect(() => calls.call({catalogId: 'cat', name: 'fn'})).toThrowError(
        expect.objectContaining({code: RpcErrorCode.DISPOSED}),
      );
    });

    test('a runtime null timeout uses the default, and only a null default means no limit', async () => {
      vi.useFakeTimers();
      const calls = new RendererFunctionCalls({defaultTimeoutMs: 50});
      const [, nullTimeout] = calls.call({
        catalogId: 'cat',
        name: 'fn',
        timeoutMs: null as unknown as number,
      });
      vi.advanceTimersByTime(50);
      await expect(nullTimeout).rejects.toMatchObject({code: RpcErrorCode.TIMEOUT});

      const unlimited = new RendererFunctionCalls({defaultTimeoutMs: null});
      unlimited.call({catalogId: 'cat', name: 'fn'});
      expect(vi.getTimerCount()).toBe(0);
      const [, overridden] = unlimited.call({catalogId: 'cat', name: 'fn', timeoutMs: 10});
      vi.advanceTimersByTime(10);
      await expect(overridden).rejects.toMatchObject({code: RpcErrorCode.TIMEOUT});
      unlimited.dispose();
    });

    test('checks a given empty functionCallId before a duplicate id', () => {
      const calls = new RendererFunctionCalls();
      expectInvalid(
        calls,
        {catalogId: 'cat', name: 'fn', functionCallId: ''},
        RpcErrorCode.INVALID_FUNCTION_CALL,
        'functionCallId',
      );
      const [message] = calls.call({catalogId: 'cat', name: 'fn'});
      expect(message.callRendererFunction.functionCallId.length).toBeGreaterThan(0);
      calls.dispose();
    });

    test('checks duplicate ids and maxPending before the name and catalogId', () => {
      const calls = new RendererFunctionCalls({maxPending: 1});
      calls.call({catalogId: 'cat', name: 'fn', functionCallId: 'id-1'});
      expectInvalid(
        calls,
        {catalogId: '', name: '', functionCallId: 'id-1'},
        RpcErrorCode.DUPLICATE,
        'id-1',
      );
      expectInvalid(
        calls,
        {catalogId: '', name: '', functionCallId: 'id-2'},
        RpcErrorCode.TOO_MANY_PENDING,
        'limit is 1',
      );
      calls.dispose();
    });

    test('checks an empty name before an empty catalogId', () => {
      const calls = new RendererFunctionCalls();
      expectInvalid(
        calls,
        {catalogId: '', name: ''},
        RpcErrorCode.INVALID_FUNCTION_CALL,
        'needs a function name',
      );
      expectInvalid(
        calls,
        {catalogId: '', name: 'bad-name'},
        RpcErrorCode.INVALID_FUNCTION_CALL,
        'catalogId',
      );
    });

    test('rejects a name that is not an identifier or starts with @', () => {
      const calls = new RendererFunctionCalls();
      for (const name of ['get-location', '@index', '1st']) {
        expectInvalid(
          calls,
          {catalogId: 'cat', name},
          RpcErrorCode.INVALID_FUNCTION_CALL,
          `'${name}'`,
        );
      }
    });

    test('rejects args that are not a JSON object', () => {
      const calls = new RendererFunctionCalls();
      for (const args of [[1, 2], 'x', 1, null, new Map(), new Date(0)]) {
        expectInvalid(
          calls,
          {catalogId: 'cat', name: 'fn', args: args as never},
          RpcErrorCode.INVALID_FUNCTION_CALL,
          'must be a JSON object',
        );
      }
    });

    test('rejects an argument key that is not an identifier', () => {
      const calls = new RendererFunctionCalls();
      expectInvalid(
        calls,
        {catalogId: 'cat', name: 'fn', args: {'bad-arg': 1}},
        RpcErrorCode.INVALID_FUNCTION_CALL,
        "'bad-arg'",
      );
    });

    test('rejects argument values that are not JSON values, recursively', () => {
      const calls = new RendererFunctionCalls();
      const cyclic: Record<string, unknown> = {};
      cyclic['self'] = cyclic;
      const bad: unknown[] = [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        undefined,
        () => 1,
        10n,
        Symbol('s'),
        new Date(0),
        new Map(),
        [1, Number.NaN],
        {nested: {deeper: [Number.POSITIVE_INFINITY]}},
        new Array(2),
        cyclic,
      ];
      for (const value of bad) {
        expectInvalid(
          calls,
          {catalogId: 'cat', name: 'fn', args: {value}},
          RpcErrorCode.INVALID_FUNCTION_CALL,
          "Argument 'value'",
        );
      }
    });

    test('accepts JSON argument values, and leaves nested @call and @path objects alone', () => {
      const calls = new RendererFunctionCalls();
      const shared = {a: 1};
      const args = {
        n: null,
        b: true,
        s: 'x',
        i: -1.5e3,
        list: [1, 'two', [false, {x: null}]],
        obj: {inner: {deep: [0]}},
        dataRef: {'@path': '/user/name'},
        nested: {'@call': 'formatDate', args: {value: 0}},
        sharedTwice: [shared, shared],
        bare: Object.assign(Object.create(null), {k: 1}),
      };

      const [message] = calls.call({catalogId: 'cat', name: 'fn', args});

      expect(message.callRendererFunction.callFunction.args).toEqual(args);
      calls.dispose();
    });

    test('checks the args before the catalogs', () => {
      const catalog = new Catalog<never, FunctionApi>(
        'cat',
        '1.0',
        [],
        [{name: 'formatLocal', returnType: 'string', schema: z.object({})}],
      );
      const calls = new RendererFunctionCalls({catalogs: [catalog]});

      expectInvalid(
        calls,
        {catalogId: 'cat', name: 'formatLocal', args: {'bad-arg': 1}},
        RpcErrorCode.INVALID_FUNCTION_CALL,
        "'bad-arg'",
      );
      expectInvalid(
        calls,
        {catalogId: 'cat', name: 'formatLocal', args: {value: Number.NaN}},
        RpcErrorCode.INVALID_FUNCTION_CALL,
        "Argument 'value'",
      );
      expectInvalid(
        calls,
        {catalogId: 'cat', name: 'formatLocal'},
        RpcErrorCode.INVALID_FUNCTION_CALL,
        'the agent may not call it',
      );
    });
  });

  test('isPending follows a call from call to resolve, timeout, cancel and dispose', async () => {
    vi.useFakeTimers();
    const calls = new RendererFunctionCalls({defaultTimeoutMs: 50});
    expect(calls.isPending('resolved')).toBe(false);

    const [, resolved] = calls.call({catalogId: 'cat', name: 'fn', functionCallId: 'resolved'});
    const [, timedOut] = calls.call({catalogId: 'cat', name: 'fn', functionCallId: 'timed-out'});
    const [, cancelled] = calls.call({catalogId: 'cat', name: 'fn', functionCallId: 'cancelled'});
    const [, disposed] = calls.call({
      catalogId: 'cat',
      name: 'fn',
      functionCallId: 'disposed',
      timeoutMs: 1000,
    });
    for (const id of ['resolved', 'timed-out', 'cancelled', 'disposed']) {
      expect(calls.isPending(id)).toBe(true);
    }

    calls.resolve({
      version: '1.0',
      rendererFunctionResponse: {functionCallId: 'resolved', value: 1},
    });
    expect(calls.isPending('resolved')).toBe(false);
    await expect(resolved).resolves.toBe(1);

    cancelled.cancel();
    expect(calls.isPending('cancelled')).toBe(false);
    await expect(cancelled).rejects.toMatchObject({code: RpcErrorCode.CANCELLED});

    vi.advanceTimersByTime(50);
    expect(calls.isPending('timed-out')).toBe(false);
    await expect(timedOut).rejects.toMatchObject({code: RpcErrorCode.TIMEOUT});
    expect(calls.isPending('disposed')).toBe(true);

    calls.dispose();
    expect(calls.isPending('disposed')).toBe(false);
    await expect(disposed).rejects.toMatchObject({code: RpcErrorCode.CANCELLED});
    expect(calls.isPending('unknown')).toBe(false);
  });
});
