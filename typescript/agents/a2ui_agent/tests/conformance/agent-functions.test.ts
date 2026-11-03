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
  A2uiCatalogError,
  A2uiRpcError,
  AgentFunction,
  type AgentFunctionContext,
  type AgentFunctionHandler,
  AgentFunctionRegistry,
  type CallRendererFunctionMessage,
  type CancellablePromise,
  Catalog,
  type CatalogApi,
  ComponentPruningTransformer,
  DirectJsonFormat,
  ExpressFormat,
  FunctionPruningTransformer,
  PromptGenerator,
  RendererFunctionCalls,
  RendererState,
  validatePayload,
} from '../../src/index.js';
import {classify, loadCases, type LoadedCase} from './loader.js';
import {conformancePath, errorClassFor, registerCase} from './suite-helpers.js';

const KNOWN_FAILURES = new Map<string, string>();

interface BehaviorSpec {
  returns?: unknown;
  returns_args?: boolean;
  returns_context?: boolean;
  raises?: {
    code?: string;
    message: string;
  };
}

interface AgentFunctionSpec {
  from_catalog?: boolean;
  returnType?: string;
  args?: Record<string, unknown>;
  allowedCallers?: string;
  requiresUserActivation?: boolean;
  description?: string;
  behavior?: BehaviorSpec;
}

interface CatalogWithAgentFunctionsSpec {
  catalog?: string | Record<string, unknown>;
  catalog_id?: string;
  protocol_version?: string;
  agent_functions?: Record<string, AgentFunctionSpec>;
  transformers?: Array<{
    component_pruning?: string[];
    function_pruning?: string[];
  }>;
}

function buildHandler(behavior?: BehaviorSpec): AgentFunctionHandler {
  if (!behavior) {
    return () => null;
  }
  if (behavior.raises) {
    const {code, message} = behavior.raises;
    return () => {
      if (code) {
        throw new A2uiRpcError(message, code);
      }
      throw new Error(message);
    };
  }
  if (behavior.returns_args) {
    return (args: Record<string, unknown>) => args;
  }
  if (behavior.returns_context) {
    return (_args: Record<string, unknown>, context: AgentFunctionContext) => ({
      catalogId: context.catalogId,
      surfaceId: context.surfaceId,
      functionCallId: context.functionCallId,
    });
  }
  if (Object.hasOwn(behavior, 'returns')) {
    const retVal = behavior.returns;
    return () => structuredClone(retVal);
  }
  return () => null;
}

function runRendererStateTracking(testCase: LoadedCase): void {
  const args = (testCase.args ?? {}) as {
    catalogs: CatalogWithAgentFunctionsSpec[];
  };
  const catalogs = args.catalogs.map(buildCatalogWithAgentFunctions);
  const calls = new RendererFunctionCalls();
  const state = new RendererState(catalogs, {rendererCalls: calls});
  const steps = (testCase.steps ?? []) as Array<Record<string, unknown>>;
  for (const step of steps) {
    if (step['apply'] !== undefined) {
      state.apply(step['apply'] as never);
    } else if (step['apply_fail'] !== undefined) {
      expect(() => state.apply(step['apply_fail'] as never)).toThrow();
    }
    if (step['expect_tracked_count'] !== undefined) {
      expect(calls.pendingCount).toBe(step['expect_tracked_count']);
    }
  }
}

function buildCatalogWithAgentFunctions(spec: CatalogWithAgentFunctionsSpec): CatalogApi {
  let base: CatalogApi;
  if (typeof spec.catalog === 'string') {
    const rawJson = JSON.parse(fs.readFileSync(conformancePath(spec.catalog), 'utf-8')) as Record<
      string,
      unknown
    >;
    base = Catalog.fromJson(rawJson);
  } else if (spec.catalog && typeof spec.catalog === 'object') {
    base = Catalog.fromJson(spec.catalog);
  } else {
    base = new Catalog(spec.catalog_id ?? 'test', [], [], {
      protocolVersion: (spec.protocol_version ?? '1.0') as never,
    });
  }

  const agentFunctions: AgentFunction[] = [];
  for (const [name, fnSpec] of Object.entries(spec.agent_functions ?? {})) {
    const handler = buildHandler(fnSpec.behavior);
    if (fnSpec.from_catalog) {
      const decl = base.functions.get(name);
      if (!decl) {
        throw new A2uiCatalogError(`Catalog '${base.id}' does not declare function '${name}'.`);
      }
      agentFunctions.push(AgentFunction.fromApi(decl, handler));
    } else {
      agentFunctions.push(
        new AgentFunction({
          name,
          returnType: (fnSpec.returnType ?? 'any') as never,
          schema: fnSpec.args,
          allowedCallers: fnSpec.allowedCallers as never,
          requiresUserActivation: fnSpec.requiresUserActivation,
          description: fnSpec.description,
          handler,
        }),
      );
    }
  }

  let catalog: CatalogApi = base.copyWith({agentFunctions});
  for (const transformer of spec.transformers ?? []) {
    if (transformer.function_pruning) {
      catalog = new FunctionPruningTransformer(transformer.function_pruning).transform(catalog);
    }
    if (transformer.component_pruning) {
      catalog = new ComponentPruningTransformer(transformer.component_pruning).transform(catalog);
    }
  }
  return catalog;
}

function expectThrowsCaseError(fn: () => void, testCase: LoadedCase): void {
  const expectedClass = errorClassFor(testCase);
  const expectError = testCase.expect_error as {message?: string} | undefined;
  let caught: unknown;
  try {
    fn();
  } catch (err: unknown) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(expectedClass);
  if (expectError?.message !== undefined) {
    expect((caught as Error).message).toContain(expectError.message);
  }
}

async function expectRejectsCaseError(
  fn: () => Promise<unknown>,
  testCase: LoadedCase,
): Promise<void> {
  const expectedClass = errorClassFor(testCase);
  const expectError = testCase.expect_error as {message?: string} | undefined;
  let caught: unknown;
  try {
    await fn();
  } catch (err: unknown) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(expectedClass);
  if (expectError?.message !== undefined) {
    expect((caught as Error).message).toContain(expectError.message);
  }
}

function runDeclareAgentFunctions(testCase: LoadedCase): void {
  const rawArgs = (testCase.args ?? {}) as Record<string, unknown>;
  const spec = (
    rawArgs['catalog'] &&
    typeof rawArgs['catalog'] === 'object' &&
    (Object.hasOwn(rawArgs['catalog'], 'catalog') ||
      Object.hasOwn(rawArgs['catalog'], 'agent_functions'))
      ? rawArgs['catalog']
      : rawArgs
  ) as CatalogWithAgentFunctionsSpec;

  if (testCase.expect_error) {
    expectThrowsCaseError(() => buildCatalogWithAgentFunctions(spec), testCase);
    return;
  }

  const catalog = buildCatalogWithAgentFunctions(spec);
  const expected = (testCase.expect ?? {}) as {
    functions?: string[];
    agent_functions?: string[];
    document_functions?: string[];
    to_json_functions?: Record<string, unknown>;
    prompt?: {
      format: string;
      contains?: string[];
      not_contains?: string[];
    };
  };

  if (expected.functions !== undefined) {
    expect([...catalog.functions.keys()]).toEqual(expected.functions);
  }
  if (expected.agent_functions !== undefined) {
    expect([...catalog.agentFunctions.keys()]).toEqual(expected.agent_functions);
  }
  if (expected.document_functions !== undefined) {
    const toJsonFunctions = (catalog.toJson().functions ?? {}) as Record<string, unknown>;
    expect(Object.keys(toJsonFunctions)).toEqual(expected.document_functions);
  }
  if (expected.to_json_functions !== undefined) {
    const toJsonFunctions = (catalog.toJson().functions ?? {}) as Record<string, unknown>;
    expect(Object.keys(toJsonFunctions)).toEqual(Object.keys(expected.to_json_functions));
    expect(toJsonFunctions).toEqual(expected.to_json_functions);
  }
  if (expected.prompt !== undefined) {
    const format =
      expected.prompt.format === 'direct_json'
        ? new DirectJsonFormat()
        : expected.prompt.format === 'express'
          ? new ExpressFormat()
          : (() => {
              throw new Error(`Unsupported prompt format: ${expected.prompt.format}`);
            })();
    const promptText = new PromptGenerator(format).generatePrompt([catalog]);
    for (const needle of expected.prompt.contains ?? []) {
      expect(promptText).toContain(needle);
    }
    for (const forbidden of expected.prompt.not_contains ?? []) {
      expect(promptText).not.toContain(forbidden);
    }
  }
}

async function runHandleAgentFunction(testCase: LoadedCase): Promise<void> {
  const args = (testCase.args ?? {}) as {
    catalogs: CatalogWithAgentFunctionsSpec[];
    message: Record<string, unknown>;
  };
  const catalogs = args.catalogs.map(buildCatalogWithAgentFunctions);
  const registry = new AgentFunctionRegistry(catalogs);

  if (testCase.expect_error) {
    await expectRejectsCaseError(() => registry.handle(args.message), testCase);
    return;
  }

  const response = await registry.handle(args.message);
  expect(response.version).toBe('1.0');
  const body = response.agentFunctionResponse;
  const expected = testCase.expect as {
    functionCallId: string;
    value?: unknown;
    error?: {code: string; message?: string};
  };

  expect(body.functionCallId).toBe(expected.functionCallId);
  if (Object.hasOwn(expected, 'value')) {
    expect(Object.hasOwn(body, 'error') && body.error !== undefined).toBe(false);
    expect(body.value).toEqual(expected.value);
  }
  if (Object.hasOwn(expected, 'error') && expected.error !== undefined) {
    expect(Object.hasOwn(body, 'value') && body.value !== undefined).toBe(false);
    expect(body.error?.code).toBe(expected.error.code);
    if (expected.error.message !== undefined) {
      expect(body.error?.message).toContain(expected.error.message);
    }
  }
}

function runValidatePayload(testCase: LoadedCase): void {
  const args = (testCase.args ?? {}) as {
    catalogs: CatalogWithAgentFunctionsSpec[];
    messages: unknown[];
  };
  const catalogs = args.catalogs.map(buildCatalogWithAgentFunctions);
  if (testCase.expect_error) {
    expectThrowsCaseError(() => validatePayload(catalogs, args.messages), testCase);
    return;
  }
  validatePayload(catalogs, args.messages);
}

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
    const catalogs = args.catalogs
      ? (args.catalogs as CatalogWithAgentFunctionsSpec[]).map(buildCatalogWithAgentFunctions)
      : undefined;
    const calls = new RendererFunctionCalls({
      defaultTimeoutMs: args.default_timeout_ms,
      maxPending: args.max_pending,
      catalogs,
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

describe('Conformance: agent_functions.yaml', () => {
  const cases = loadCases([conformancePath('agent/agent_functions.yaml')]);

  test('suite is not empty', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const testCase of cases) {
    const verdict = classify(testCase);
    const run = async () => {
      switch (testCase.action) {
        case 'declare_agent_functions':
          runDeclareAgentFunctions(testCase);
          return;
        case 'handle_agent_function':
          await runHandleAgentFunction(testCase);
          return;
        case 'validate_payload':
          runValidatePayload(testCase);
          return;
        case 'call_renderer_function':
          await runCallRendererFunction(testCase);
          return;
        case 'renderer_state_tracking':
          runRendererStateTracking(testCase);
          return;
        default:
          throw new Error(`Unhandled conformance action: ${testCase.action}`);
      }
    };

    if (verdict.runnable) {
      registerCase(testCase, KNOWN_FAILURES, run);
    } else {
      test.skip(`${testCase.action} · ${testCase.name} (${verdict.reason})`, run);
    }
  }
});
