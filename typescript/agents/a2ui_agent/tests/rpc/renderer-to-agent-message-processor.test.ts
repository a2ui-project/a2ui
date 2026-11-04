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

import {afterEach, describe, expect, test, vi} from 'vitest';

import * as agentSdk from '../../src/index.js';
import {
  A2uiCatalogError,
  A2uiRpcError,
  A2uiValidationError,
  type ActionMessage,
  AgentFunction,
  type AgentFunctionResponseMessage,
  Catalog,
  type CatalogApi,
  type ErrorMessage,
  type ProcessResult,
  type RendererFunctionResponseMessage,
  RendererToAgentMessageProcessor,
  RpcErrorCode,
} from '../../src/index.js';

function catalogWith(id: string, ...agentFunctions: AgentFunction[]): CatalogApi {
  return new Catalog(id, '1.0', [], []).copyWith({agentFunctions});
}

function call(
  name: string,
  options: {
    catalogId?: string;
    args?: Record<string, unknown>;
    functionCallId?: string;
    surfaceId?: string;
  } = {},
): Record<string, unknown> {
  const callFunction: Record<string, unknown> = {'@call': name};
  if (options.catalogId !== undefined) callFunction['catalogId'] = options.catalogId;
  if (options.args !== undefined) callFunction['args'] = options.args;
  return {
    version: '1.0',
    callAgentFunction: {
      surfaceId: options.surfaceId ?? 's1',
      functionCallId: options.functionCallId ?? 'call-1',
      callFunction,
    },
  };
}

/** The single `agentFunctionResponse` body of a handled `callAgentFunction`. */
function onlyResponse(
  result: ProcessResult,
): AgentFunctionResponseMessage['agentFunctionResponse'] {
  expect(result.handled).toBe(true);
  expect(result.replies).toHaveLength(1);
  const reply = result.replies[0] as AgentFunctionResponseMessage;
  expect(reply.version).toBe('1.0');
  return reply.agentFunctionResponse;
}

const ACTION: ActionMessage = {
  version: '1.0',
  action: {
    name: 'submit',
    surfaceId: 's1',
    sourceComponentId: 'btn',
    timestamp: '2026-01-01T00:00:00Z',
    context: {},
  },
};

const ERROR: ErrorMessage = {
  version: '1.0',
  error: {
    code: 'VALIDATION_FAILED',
    surfaceId: 's1',
    path: '/components/0/text',
    message: 'oops',
  },
};

const RENDERER_FUNCTION_RESPONSE: RendererFunctionResponseMessage = {
  version: '1.0',
  rendererFunctionResponse: {functionCallId: 'r1', value: 'en-GB'},
};

const echo = new AgentFunction({
  name: 'echo',
  returnType: 'object',
  schema: {
    type: 'object',
    properties: {
      text: {type: 'string'},
      tag: {type: 'string', default: 'default-tag'},
    },
    required: ['text'],
    additionalProperties: false,
  },
  handler: async (args, context) => {
    await Promise.resolve();
    return {args, context};
  },
});

describe('RendererToAgentMessageProcessor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('exports', () => {
    test('exports the processor from the package root and keeps the registry internal', () => {
      expect(agentSdk.RendererToAgentMessageProcessor).toBe(RendererToAgentMessageProcessor);
      expect('AgentFunctionRegistry' in agentSdk).toBe(false);
      expect('RendererMessageRouter' in agentSdk).toBe(false);
      expect('RendererFunctionCalls' in agentSdk).toBe(false);
    });
  });

  describe('callAgentFunction', () => {
    test('runs the handler with defaulted arguments and the call context', async () => {
      const processor = new RendererToAgentMessageProcessor({catalogs: [catalogWith('cat', echo)]});

      const body = onlyResponse(
        await processor.processMessage(
          call('echo', {catalogId: 'cat', args: {text: 'hi'}, functionCallId: 'Call_ABC-1'}),
        ),
      );

      expect(body).toEqual({
        functionCallId: 'Call_ABC-1',
        value: {
          args: {text: 'hi', tag: 'default-tag'},
          context: {catalogId: 'cat', surfaceId: 's1', functionCallId: 'Call_ABC-1'},
        },
      });
    });

    test('runs sync handlers, one-argument handlers, and replies null for undefined', async () => {
      const sync = new AgentFunction({name: 'sync', handler: () => 42});
      const oneArg = new AgentFunction({
        name: 'oneArg',
        schema: {type: 'object', properties: {n: {type: 'number'}}},
        handler: args => (args['n'] as number) * 2,
      });
      const noop = new AgentFunction({name: 'noop', returnType: 'void', handler: () => undefined});
      const processor = new RendererToAgentMessageProcessor({
        catalogs: [catalogWith('cat', sync, oneArg, noop)],
      });

      expect(onlyResponse(await processor.processMessage(call('sync'))).value).toBe(42);
      expect(
        onlyResponse(await processor.processMessage(call('oneArg', {args: {n: 21}}))).value,
      ).toBe(42);
      expect(onlyResponse(await processor.processMessage(call('noop')))).toEqual({
        functionCallId: 'call-1',
        value: null,
      });
    });

    test('resolves the catalog by catalogId, or by the function name when it is omitted', async () => {
      const inA = new AgentFunction({name: 'whoAmI', handler: () => 'a'});
      const inB = new AgentFunction({name: 'whoAmI', handler: () => 'b'});
      const onlyB = new AgentFunction({name: 'onlyB', handler: (_args, ctx) => ctx.catalogId});
      const processor = new RendererToAgentMessageProcessor({
        catalogs: [catalogWith('a', inA), catalogWith('b', inB, onlyB)],
      });

      expect(
        onlyResponse(await processor.processMessage(call('whoAmI', {catalogId: 'a'}))).value,
      ).toBe('a');
      expect(
        onlyResponse(await processor.processMessage(call('whoAmI', {catalogId: 'b'}))).value,
      ).toBe('b');
      expect(onlyResponse(await processor.processMessage(call('onlyB'))).value).toBe('b');

      const ambiguous = onlyResponse(await processor.processMessage(call('whoAmI')));
      expect(ambiguous.error?.code).toBe(RpcErrorCode.INVALID_FUNCTION_CALL);
      expect(ambiguous.error?.message).toContain('a, b');
    });

    test('replies UNKNOWN_FUNCTION for an unknown catalog, function or renderer function', async () => {
      const catalog = new Catalog(
        'cat',
        '1.0',
        [],
        [{name: 'formatRate', returnType: 'string', schema: echo.schema}],
      ).copyWith({agentFunctions: [echo]});
      const processor = new RendererToAgentMessageProcessor({catalogs: [catalog]});

      for (const message of [
        call('echo', {catalogId: 'nope'}),
        call('missing', {catalogId: 'cat'}),
        call('missing'),
        call('formatRate', {catalogId: 'cat'}),
      ]) {
        const body = onlyResponse(await processor.processMessage(message));
        expect(body.functionCallId).toBe('call-1');
        expect(body.error?.code).toBe(RpcErrorCode.UNKNOWN_FUNCTION);
        expect(body.value).toBeUndefined();
      }
    });

    test('guards against an agentOnly agent function built around the constructor', async () => {
      let ran = false;
      const fn = new AgentFunction({
        name: 'agentOnlyFn',
        handler: () => {
          ran = true;
        },
      });
      const catalog = catalogWith('cat', fn);
      (fn as {allowedCallers: string}).allowedCallers = 'agentOnly';
      const processor = new RendererToAgentMessageProcessor({catalogs: [catalog]});

      const body = onlyResponse(await processor.processMessage(call('agentOnlyFn')));

      expect(body.error?.code).toBe(RpcErrorCode.INVALID_FUNCTION_CALL);
      expect(ran).toBe(false);
    });

    test('replies INVALID_FUNCTION_CALL for arguments that fail validation', async () => {
      const processor = new RendererToAgentMessageProcessor({catalogs: [catalogWith('cat', echo)]});

      for (const args of [{}, {text: 1}, {text: 'hi', extra: true}]) {
        const body = onlyResponse(await processor.processMessage(call('echo', {args})));
        expect(body.error?.code).toBe(RpcErrorCode.INVALID_FUNCTION_CALL);
      }
    });

    test("replies with a handler's A2uiRpcError code and message, or EXECUTION_ERROR", async () => {
      const rateLimited = new AgentFunction({
        name: 'rateLimited',
        handler: () => {
          throw new A2uiRpcError('rate limit exceeded', 'RATE_LIMITED');
        },
      });
      const broken = new AgentFunction({
        name: 'broken',
        handler: async () => {
          throw new Error('boom');
        },
      });
      const throwsString = new AgentFunction({
        name: 'throwsString',
        handler: () => {
          throw 'plain';
        },
      });
      const processor = new RendererToAgentMessageProcessor({
        catalogs: [catalogWith('cat', rateLimited, broken, throwsString)],
      });

      expect(onlyResponse(await processor.processMessage(call('rateLimited')))).toEqual({
        functionCallId: 'call-1',
        error: {code: 'RATE_LIMITED', message: 'rate limit exceeded'},
      });
      expect(onlyResponse(await processor.processMessage(call('broken')))).toEqual({
        functionCallId: 'call-1',
        error: {code: RpcErrorCode.EXECUTION_ERROR, message: 'boom'},
      });
      expect(onlyResponse(await processor.processMessage(call('throwsString')))).toEqual({
        functionCallId: 'call-1',
        error: {code: RpcErrorCode.EXECUTION_ERROR, message: 'plain'},
      });
    });

    test('times out a slow handler with EXECUTION_ERROR', async () => {
      vi.useFakeTimers();
      const slow = new AgentFunction({
        name: 'slow',
        handler: () => new Promise(resolve => setTimeout(() => resolve('done'), 1000)),
      });
      const processor = new RendererToAgentMessageProcessor({
        catalogs: [catalogWith('cat', slow)],
        agentFunctionTimeoutMs: 20,
      });

      const pending = processor.processMessage(call('slow'));
      await vi.advanceTimersByTimeAsync(20);
      const body = onlyResponse(await pending);

      expect(body.error?.code).toBe(RpcErrorCode.EXECUTION_ERROR);
      expect(body.error?.message).toContain('timed out after 20ms');
      expect(vi.getTimerCount()).toBe(1);
    });

    test('clears the timeout when the handler finishes first', async () => {
      vi.useFakeTimers();
      const processor = new RendererToAgentMessageProcessor({
        catalogs: [catalogWith('cat', new AgentFunction({name: 'fast', handler: () => 'ok'}))],
        agentFunctionTimeoutMs: 1000,
      });

      expect(onlyResponse(await processor.processMessage(call('fast'))).value).toBe('ok');
      expect(vi.getTimerCount()).toBe(0);
    });

    test('has no timeout by default', async () => {
      vi.useFakeTimers();
      const slow = new AgentFunction({
        name: 'slow',
        handler: () => new Promise(resolve => setTimeout(() => resolve('done'), 60_000)),
      });
      const processor = new RendererToAgentMessageProcessor({catalogs: [catalogWith('cat', slow)]});

      const pending = processor.processMessage(call('slow'));
      await vi.advanceTimersByTimeAsync(60_000);

      expect(onlyResponse(await pending).value).toBe('done');
    });

    test('treats a validation error thrown by a handler as a handler error', async () => {
      const strict = new AgentFunction({
        name: 'strict',
        handler: () => {
          throw new A2uiValidationError('unsupported currency pair EUR/XYZ');
        },
      });
      const processor = new RendererToAgentMessageProcessor({
        catalogs: [catalogWith('cat', strict)],
      });

      const body = onlyResponse(await processor.processMessage(call('strict')));

      expect(body.error?.code).toBe(RpcErrorCode.EXECUTION_ERROR);
      expect(body.error?.message).toContain('unsupported currency pair EUR/XYZ');
    });

    test("treats a handler's own timeout error as a handler error", async () => {
      vi.useFakeTimers();
      const upstream = new AgentFunction({
        name: 'upstream',
        handler: async () => {
          throw new DOMException('upstream request timed out', 'TimeoutError');
        },
      });
      for (const agentFunctionTimeoutMs of [undefined, 30_000]) {
        const processor = new RendererToAgentMessageProcessor({
          catalogs: [catalogWith('cat', upstream)],
          agentFunctionTimeoutMs,
        });

        const body = onlyResponse(await processor.processMessage(call('upstream')));

        expect(body.error).toEqual({
          code: RpcErrorCode.EXECUTION_ERROR,
          message: 'upstream request timed out',
        });
      }
    });

    test('replies INVALID_FUNCTION_CALL for a call that carries a returnType', async () => {
      let ran = false;
      const fn = new AgentFunction({
        name: 'typed',
        returnType: 'number',
        handler: () => {
          ran = true;
          return 1;
        },
      });
      const processor = new RendererToAgentMessageProcessor({catalogs: [catalogWith('cat', fn)]});

      const body = onlyResponse(
        await processor.processMessage({
          version: '1.0',
          callAgentFunction: {
            surfaceId: 's1',
            functionCallId: 'rt-1',
            callFunction: {'@call': 'typed', catalogId: 'cat', returnType: 'number'},
          },
        }),
      );

      expect(body.functionCallId).toBe('rt-1');
      expect(body.error?.code).toBe(RpcErrorCode.INVALID_FUNCTION_CALL);
      expect(body.error?.message).toContain('returnType');
      expect(ran).toBe(false);
    });

    test('rejects two catalogs with the same id', () => {
      expect(
        () =>
          new RendererToAgentMessageProcessor({
            catalogs: [catalogWith('cat', echo), new Catalog('cat', '1.0', [], [])],
          }),
      ).toThrow(A2uiCatalogError);
      expect(
        () => new RendererToAgentMessageProcessor({catalogs: [catalogWith('a'), catalogWith('b')]}),
      ).not.toThrow();
    });

    test('rejects a timeout that is not greater than 0', () => {
      for (const agentFunctionTimeoutMs of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(
          () => new RendererToAgentMessageProcessor({catalogs: [], agentFunctionTimeoutMs}),
        ).toThrow(RangeError);
      }
    });

    test('raises a validation error for a missing or empty functionCallId', async () => {
      const processor = new RendererToAgentMessageProcessor({catalogs: [catalogWith('cat', echo)]});

      await expect(
        processor.processMessage(call('echo', {functionCallId: ''})),
      ).rejects.toBeInstanceOf(A2uiValidationError);
      await expect(
        processor.processMessage({
          version: '1.0',
          callAgentFunction: {surfaceId: 's1', callFunction: {'@call': 'echo'}},
        }),
      ).rejects.toBeInstanceOf(A2uiValidationError);
      await expect(
        processor.processMessage({version: '1.0', callAgentFunction: 'nope'}),
      ).rejects.toBeInstanceOf(A2uiValidationError);
    });

    test('replies INVALID_FUNCTION_CALL for an empty surfaceId without running the handler', async () => {
      let ran = false;
      const fn = new AgentFunction({
        name: 'tracked',
        handler: () => {
          ran = true;
        },
      });
      const processor = new RendererToAgentMessageProcessor({catalogs: [catalogWith('cat', fn)]});

      const body = onlyResponse(
        await processor.processMessage(call('tracked', {surfaceId: '', functionCallId: 'c-9'})),
      );

      expect(body.functionCallId).toBe('c-9');
      expect(body.error?.code).toBe(RpcErrorCode.INVALID_FUNCTION_CALL);
      expect(body.error?.message).toContain('surfaceId');
      expect(ran).toBe(false);
    });

    test('replies INVALID_FUNCTION_CALL for a malformed call that carries a functionCallId', async () => {
      const processor = new RendererToAgentMessageProcessor({catalogs: [catalogWith('cat', echo)]});
      const body = (extra: Record<string, unknown>) => ({
        surfaceId: 's1',
        functionCallId: 'c-bad',
        callFunction: {'@call': 'echo', args: {text: 'hi'}},
        ...extra,
      });

      for (const message of [
        {version: '1.0', callAgentFunction: body({}), extra: 1},
        {version: '1.0', callAgentFunction: body({extra: 1})},
        {version: '1.0', callAgentFunction: body({surfaceId: undefined})},
        {version: '1.0', callAgentFunction: body({callFunction: 'echo'})},
        {version: '1.0', callAgentFunction: body({callFunction: {'@call': ''}})},
        {version: '1.0', callAgentFunction: body({callFunction: {'@call': 'echo', extra: 1}})},
        {version: '1.0', callAgentFunction: body({callFunction: {'@call': 'echo', catalogId: 1}})},
        {version: '1.0', callAgentFunction: body({callFunction: {'@call': 'echo', args: []}})},
        {
          version: '1.0',
          callAgentFunction: body({callFunction: {'@call': 'echo', returnType: 'date'}}),
        },
      ]) {
        const response = onlyResponse(await processor.processMessage(message));
        expect(response.functionCallId).toBe('c-bad');
        expect(response.error?.code).toBe(RpcErrorCode.INVALID_FUNCTION_CALL);
      }
    });
  });

  describe('action, error and rendererFunctionResponse', () => {
    const cases = [
      {kind: 'action', option: 'onAction', message: ACTION, malformed: {action: {name: 'x'}}},
      {kind: 'error', option: 'onError', message: ERROR, malformed: {error: {code: 1}}},
      {
        kind: 'rendererFunctionResponse',
        option: 'onRendererFunctionResponse',
        message: RENDERER_FUNCTION_RESPONSE,
        malformed: {rendererFunctionResponse: {functionCallId: 'r1'}},
      },
    ] as const;

    for (const {kind, option, message, malformed} of cases) {
      test(`passes a valid ${kind} to ${option} and awaits it`, async () => {
        const received: unknown[] = [];
        const processor = new RendererToAgentMessageProcessor({
          catalogs: [],
          [option]: async (m: unknown) => {
            await new Promise(resolve => setTimeout(resolve, 5));
            received.push(m);
          },
        });

        const result = await processor.processMessage(structuredClone(message));

        expect(result).toEqual({handled: true, replies: []});
        expect(received).toEqual([message]);
      });

      test(`leaves a ${kind} unhandled, without validating it, when ${option} is not set`, async () => {
        const processor = new RendererToAgentMessageProcessor({catalogs: []});

        expect(await processor.processMessage(message)).toEqual({handled: false, replies: []});
        expect(await processor.processMessage({version: '1.0', ...malformed})).toEqual({
          handled: false,
          replies: [],
        });
      });

      test(`raises a validation error for a malformed ${kind} when ${option} is set`, async () => {
        const callback = vi.fn();
        const processor = new RendererToAgentMessageProcessor({catalogs: [], [option]: callback});

        await expect(
          processor.processMessage({version: '1.0', ...malformed}),
        ).rejects.toBeInstanceOf(A2uiValidationError);
        await expect(processor.processMessage({...message, version: '0.9'})).rejects.toBeInstanceOf(
          A2uiValidationError,
        );
        expect(callback).not.toHaveBeenCalled();
      });

      for (const [label, returned] of [
        ['false', false],
        ['a Promise of false', Promise.resolve(false)],
      ] as const) {
        test(`leaves a ${kind} unhandled when ${option} returns ${label}`, async () => {
          const received: unknown[] = [];
          const processor = new RendererToAgentMessageProcessor({
            catalogs: [],
            [option]: (m: unknown) => {
              received.push(m);
              return returned;
            },
          });

          expect(await processor.processMessage(message)).toEqual({handled: false, replies: []});
          expect(received).toEqual([message]);
        });
      }

      test(`handles a ${kind} when ${option} returns true or nothing`, async () => {
        for (const returned of [true, undefined, Promise.resolve(true), Promise.resolve()]) {
          const processor = new RendererToAgentMessageProcessor({
            catalogs: [],
            [option]: () => returned,
          });
          expect(await processor.processMessage(message)).toEqual({handled: true, replies: []});
        }
      });

      test(`propagates an error thrown by ${option}`, async () => {
        const processor = new RendererToAgentMessageProcessor({
          catalogs: [],
          [option]: () => {
            throw new Error(`${kind} failed`);
          },
        });

        await expect(processor.processMessage(message)).rejects.toThrow(`${kind} failed`);
      });
    }
  });

  describe('other messages', () => {
    test('raises a validation error for a message that is not an object', async () => {
      const processor = new RendererToAgentMessageProcessor({catalogs: []});

      for (const message of ['text', 42, null, undefined, [ACTION]]) {
        await expect(processor.processMessage(message)).rejects.toBeInstanceOf(A2uiValidationError);
      }
    });

    test("raises a validation error for a message whose version isn't '1.0'", async () => {
      const onAction = vi.fn();
      const processor = new RendererToAgentMessageProcessor({
        catalogs: [catalogWith('cat', echo)],
        onAction,
      });
      const withoutVersion = (message: Record<string, unknown>) => {
        const copy = {...message};
        delete copy['version'];
        return copy;
      };

      for (const message of [
        ACTION,
        ERROR,
        RENDERER_FUNCTION_RESPONSE,
        call('echo', {args: {text: 'hi'}}),
      ]) {
        await expect(processor.processMessage(withoutVersion(message))).rejects.toThrow(
          /version '1.0'/,
        );
        for (const version of ['v1.0', '0.9', 1, null]) {
          await expect(processor.processMessage({...message, version})).rejects.toBeInstanceOf(
            A2uiValidationError,
          );
        }
      }
      // Checked even when the kind's callback isn't set.
      await expect(
        new RendererToAgentMessageProcessor({catalogs: []}).processMessage({
          ...ERROR,
          version: 'v1.0',
        }),
      ).rejects.toBeInstanceOf(A2uiValidationError);
      expect(onAction).not.toHaveBeenCalled();
    });

    test('raises a validation error for an unknown message key or none', async () => {
      const processor = new RendererToAgentMessageProcessor({catalogs: [], onAction: vi.fn()});

      await expect(
        processor.processMessage({version: '1.0', updateComponents: {}}),
      ).rejects.toThrow(/updateComponents/);
      await expect(processor.processMessage({version: '1.0'})).rejects.toBeInstanceOf(
        A2uiValidationError,
      );
    });

    test('raises a validation error for more than one message key', async () => {
      const onAction = vi.fn();
      const processor = new RendererToAgentMessageProcessor({catalogs: [], onAction});

      await expect(
        processor.processMessage({...ACTION, error: ERROR.error}),
      ).rejects.toBeInstanceOf(A2uiValidationError);
      await expect(
        processor.processMessage({...call('echo'), action: ACTION.action}),
      ).rejects.toBeInstanceOf(A2uiValidationError);
      expect(onAction).not.toHaveBeenCalled();
    });
  });
});
