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

import {afterEach, expect, test, vi} from 'vitest';
import {z} from 'zod';

import {
  A2uiRpcError,
  type CallRendererFunctionMessage,
  type CancellablePromise,
  Catalog,
  type CatalogApi,
  RendererFunctionCalls,
  RendererToAgentMessageProcessor,
} from '../../src/index.js';
import {classify, loadCases, type LoadedCase} from './loader.js';
import {conformancePath, describeSuite, errorClassFor} from './suite-helpers.js';

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
    /** Any JSON value, so a case can pass args that aren't an object. */
    args?: unknown;
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
  expect_error?: Record<string, unknown>;
  expect_pending_count?: number;
  expect_calls?: Record<
    string,
    'pending' | {value: unknown} | {error: {code: string; message?: string}}
  >;
}

interface CatalogSpec {
  catalogId: string;
  functions?: Record<
    string,
    {
      allowedCallers?: 'rendererOnly' | 'agentOnly' | 'rendererOrAgent';
      requiresUserActivation?: boolean;
    }
  >;
}

/**
 * Builds a v1.0 catalog in code (not from a document), whose functions take
 * any object and set allowedCallers and requiresUserActivation only when the
 * case does.
 */
function buildCatalog(spec: CatalogSpec): CatalogApi {
  const functions = Object.entries(spec.functions ?? {}).map(([name, fn]) => ({
    name,
    returnType: 'any' as const,
    schema: z.object({}).passthrough(),
    ...(fn.allowedCallers !== undefined ? {allowedCallers: fn.allowedCallers} : {}),
    ...(fn.requiresUserActivation !== undefined
      ? {requiresUserActivation: fn.requiresUserActivation}
      : {}),
  }));
  return new Catalog(spec.catalogId, '1.0', [], functions);
}

/**
 * Checks that an `expect_error` names only `allowed` keys and gives each
 * `required` one as a non-empty string, so a misspelled or empty expectation
 * fails instead of passing on any error.
 */
function checkExpectErrorShape(
  expectError: unknown,
  allowed: ReadonlySet<string>,
  required: string,
): Record<string, unknown> {
  expect(expectError, 'expect_error must be an object').toBeTypeOf('object');
  expect(expectError).not.toBeNull();
  expect(Array.isArray(expectError), 'expect_error must be an object').toBe(false);
  const spec = expectError as Record<string, unknown>;
  const unknownKeys = Object.keys(spec).filter(key => !allowed.has(key));
  expect(unknownKeys, 'Unhandled expect_error keys').toEqual([]);
  expect(typeof spec[required], `expect_error.${required} must be a string`).toBe('string');
  expect((spec[required] as string).length).toBeGreaterThan(0);
  for (const key of allowed) {
    if (key !== required && spec[key] !== undefined) {
      expect(typeof spec[key], `expect_error.${key} must be a string`).toBe('string');
    }
  }
  return spec;
}

/** The keys of a case's `RendererCallsBuildError`. */
const CASE_EXPECT_ERROR_KEYS = new Set(['category', 'message']);

/** The categories a `RendererCallsBuildError` may name. */
const CASE_EXPECT_ERROR_CATEGORIES = new Set(['CatalogError']);

/** The keys of a `call` step's `RendererCallError`. */
const STEP_EXPECT_ERROR_KEYS = new Set(['code', 'message']);

async function runCallRendererFunction(testCase: LoadedCase): Promise<void> {
  vi.useFakeTimers();
  const args = (testCase.args ?? {}) as {
    default_timeout_ms?: number | null;
    max_pending?: number | null;
    catalogs?: CatalogSpec[];
  };
  const build = () =>
    new RendererFunctionCalls({
      defaultTimeoutMs: args.default_timeout_ms,
      maxPending: args.max_pending,
      catalogs: args.catalogs?.map(buildCatalog),
    });

  if (testCase.expect_error !== undefined) {
    const expectError = checkExpectErrorShape(
      testCase.expect_error,
      CASE_EXPECT_ERROR_KEYS,
      'category',
    );
    expect(CASE_EXPECT_ERROR_CATEGORIES.has(expectError['category'] as string)).toBe(true);
    let caught: unknown;
    try {
      build();
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(errorClassFor(testCase));
    if (expectError['message'] !== undefined) {
      // A literal substring, not a pattern.
      expect((caught as Error).message).toContain(expectError['message'] as string);
    }
    return;
  }

  const calls = build();
  const processor = new RendererToAgentMessageProcessor({
    catalogs: [],
    onRendererFunctionResponse: calls.resolve,
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
          args: c.args as Record<string, unknown> | undefined,
          surfaceId: c.surfaceId,
          timeoutMs: c.timeout_ms ?? undefined,
          functionCallId: c.functionCallId,
        });

      if (step.expect_error !== undefined) {
        const expectError = checkExpectErrorShape(
          step.expect_error,
          STEP_EXPECT_ERROR_KEYS,
          'code',
        );
        let caught: unknown;
        try {
          doCall();
        } catch (err: unknown) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(A2uiRpcError);
        expect((caught as A2uiRpcError).code).toBe(expectError['code']);
        if (expectError['message'] !== undefined) {
          // A literal substring, not a pattern.
          expect((caught as A2uiRpcError).message).toContain(expectError['message'] as string);
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
      const owned = calls.isPending(callId);
      const result = await processor.processMessage({
        version: '1.0',
        rendererFunctionResponse: respBody,
      });
      expect(result).toEqual({handled: owned, replies: []});
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
            expect(typeof tracked!.state.error.message).toBe('string');
            expect(tracked!.state.error.message.length).toBeGreaterThan(0);
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
}

afterEach(() => {
  vi.useRealTimers();
});

const suitePath = conformancePath(SUITE);
if (fs.existsSync(suitePath)) {
  const cases = loadCases([suitePath]);

  test('renderer_function_calls.yaml is not empty', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  describeSuite(
    'Conformance: renderer_function_calls.yaml',
    cases,
    async testCase => {
      if (testCase.action !== 'call_renderer_function') {
        throw new Error(`Unhandled conformance action: ${testCase.action}`);
      }
      await runCallRendererFunction(testCase);
    },
    {
      knownFailures: KNOWN_FAILURES,
      skipReason: testCase => {
        const verdict = classify(testCase);
        return verdict.runnable ? undefined : verdict.reason;
      },
    },
  );
} else {
  test.skip(`${SUITE} is not in this checkout`, () => {});
}
