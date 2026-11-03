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

import fs from 'node:fs';

import {describe, expect, test, vi} from 'vitest';

import {
  A2uiRpcError,
  type CallRendererFunctionMessage,
  type CancellablePromise,
  RendererFunctionCalls,
} from '../../src/index.js';
import {classify, loadCases, type LoadedCase} from './loader.js';
import {conformancePath, registerCase} from './suite-helpers.js';

const KNOWN_FAILURES = new Map<string, string>();

const SUITE = 'agent/renderer_function_calls.yaml';

interface TrackedCall {
  message: CallRendererFunctionMessage;
  result: CancellablePromise<unknown>;
  state:
    | {status: 'pending'}
    | {status: 'resolved'; value: unknown}
    | {status: 'rejected'; error: A2uiRpcError};
}

interface CallStepSpec {
  call?: {
    label: string;
    catalogId: string;
    name: string;
    args?: Record<string, unknown>;
    surfaceId?: string;
    timeout_ms?: number | null;
    functionCallId?: string;
  };
  respond?: {
    call?: string;
    functionCallId?: string;
    value?: unknown;
    error?: {code: string; message: string};
  };
  advance_ms?: number;
  dispose?: {reason?: string};
  expect_message?: {
    version: string;
    callRendererFunction: Record<string, unknown>;
  };
  expect_error?: {code: string; message?: string};
  expect_pending_count?: number;
  expect_calls?: Record<
    string,
    'pending' | {value: unknown} | {error: {code: string; message?: string}}
  >;
}

async function runCallRendererFunction(testCase: LoadedCase): Promise<void> {
  vi.useFakeTimers();
  try {
    const args = (testCase.args ?? {}) as {
      default_timeout_ms?: number | null;
      max_pending?: number | null;
    };
    const calls = new RendererFunctionCalls({
      defaultTimeoutMs: args.default_timeout_ms,
      maxPending: args.max_pending,
    });
    const byLabel = new Map<string, TrackedCall>();
    const steps = (testCase.steps ?? []) as CallStepSpec[];

    for (const step of steps) {
      if (step.call !== undefined) {
        const c = step.call;
        const doCall = () =>
          calls.call({
            catalogId: c.catalogId,
            name: c.name,
            args: c.args,
            surfaceId: c.surfaceId,
            timeoutMs: c.timeout_ms,
            functionCallId: c.functionCallId,
          });

        if (step.expect_error !== undefined) {
          let caught: unknown;
          try {
            doCall();
          } catch (err: unknown) {
            caught = err;
          }
          expect(caught).toBeInstanceOf(A2uiRpcError);
          expect((caught as A2uiRpcError).code).toBe(step.expect_error.code);
          if (step.expect_error.message !== undefined) {
            expect((caught as A2uiRpcError).message).toContain(step.expect_error.message);
          }
        } else {
          const [message, result] = doCall();
          const tracked: TrackedCall = {
            message,
            result,
            state: {status: 'pending'},
          };
          result.then(
            value => {
              tracked.state = {status: 'resolved', value};
            },
            (err: unknown) => {
              tracked.state = {status: 'rejected', error: err as A2uiRpcError};
            },
          );
          byLabel.set(c.label, tracked);

          if (step.expect_message !== undefined) {
            expect(message.version).toBe(step.expect_message.version);
            const actualBody = {...message.callRendererFunction} as Record<string, unknown>;
            const expectedBody = {...step.expect_message.callRendererFunction};
            expect(typeof actualBody['functionCallId']).toBe('string');
            expect((actualBody['functionCallId'] as string).length).toBeGreaterThan(0);
            if (!Object.hasOwn(expectedBody, 'functionCallId')) {
              delete actualBody['functionCallId'];
            }
            expect(actualBody).toEqual(expectedBody);
          }
        }
      } else if (step.respond !== undefined) {
        const r = step.respond;
        const callId =
          r.call !== undefined
            ? byLabel.get(r.call)!.message.callRendererFunction.functionCallId
            : (r.functionCallId as string);
        const respBody: Record<string, unknown> = {functionCallId: callId};
        if (Object.hasOwn(r, 'value')) {
          respBody['value'] = r.value;
        }
        if (Object.hasOwn(r, 'error') && r.error !== undefined) {
          respBody['error'] = r.error;
        }
        calls.resolve({
          version: '1.0',
          rendererFunctionResponse: respBody as never,
        });
      } else if (step.advance_ms !== undefined) {
        vi.advanceTimersByTime(step.advance_ms);
      } else if (step.dispose !== undefined) {
        const d = step.dispose ?? {};
        if (d.reason !== undefined) {
          calls.dispose(d.reason);
        } else {
          calls.dispose();
        }
      } else {
        throw new Error(`Unknown step in ${testCase.name}: ${JSON.stringify(step)}`);
      }

      // Flush microtasks so `.then()` handlers on settled promises update `tracked.state`.
      await Promise.resolve();

      if (step.expect_pending_count !== undefined) {
        expect(calls.pendingCount).toBe(step.expect_pending_count);
      }

      if (step.expect_calls !== undefined) {
        for (const [label, expectedState] of Object.entries(step.expect_calls)) {
          const tracked = byLabel.get(label);
          expect(tracked, `tracked call '${label}'`).toBeDefined();
          if (expectedState === 'pending') {
            expect(tracked!.state.status).toBe('pending');
          } else if ('value' in expectedState) {
            expect(tracked!.state).toEqual({
              status: 'resolved',
              value: expectedState.value,
            });
          } else if ('error' in expectedState) {
            expect(tracked!.state.status).toBe('rejected');
            if (tracked!.state.status === 'rejected') {
              expect(tracked!.state.error).toBeInstanceOf(A2uiRpcError);
              expect(tracked!.state.error.code).toBe(expectedState.error.code);
              expect(tracked!.state.error.functionCallId).toBe(
                tracked!.message.callRendererFunction.functionCallId,
              );
              if (expectedState.error.message !== undefined) {
                expect(tracked!.state.error.message).toContain(expectedState.error.message);
              }
            }
          }
        }
      }
    }
  } finally {
    vi.useRealTimers();
  }
}

describe('Conformance: renderer_function_calls.yaml', () => {
  const suitePath = conformancePath(SUITE);
  if (!fs.existsSync(suitePath)) {
    test.skip(`${SUITE} is not in this checkout`, () => {});
    return;
  }
  const cases = loadCases([suitePath]);

  test('suite is not empty', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const testCase of cases) {
    const verdict = classify(testCase);
    const run = async () => {
      if (testCase.action !== 'call_renderer_function') {
        throw new Error(`Unhandled conformance action: ${testCase.action}`);
      }
      await runCallRendererFunction(testCase);
    };

    if (verdict.runnable) {
      registerCase(testCase, KNOWN_FAILURES, run);
    } else {
      test.skip(`${testCase.action} · ${testCase.name} (${verdict.reason})`, run);
    }
  }
});
