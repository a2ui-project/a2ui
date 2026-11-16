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

import {type FunctionApi} from '@a2ui/web_core';
import {expect, test} from 'vitest';

import {
  A2uiRpcError,
  A2uiValidationError,
  AgentFunction,
  type AgentFunctionContext,
  type AgentFunctionHandler,
  type AgentFunctionResponseMessage,
  Catalog,
  type CatalogApi,
  RendererToAgentMessageProcessor,
  type RendererToAgentMessageProcessorOptions,
  validatePayload,
} from '../../src/index.js';
import {classify, loadCases, type LoadedCase} from './loader.js';
import {conformancePath, describeSuite, errorClassFor} from './suite-helpers.js';

const KNOWN_FAILURES = new Map<string, string>();

interface BehaviorSpec {
  returns?: unknown;
  returns_args?: boolean;
  returns_context?: boolean;
  raises?: {
    code?: string;
    validation?: true;
    message: string;
  };
}

interface AgentFunctionSpec {
  name?: string;
  from_api?: boolean;
  returnType?: string;
  args?: Record<string, unknown>;
  description?: string;
  requiresUserActivation?: boolean;
  behavior?: BehaviorSpec;
}

interface CatalogWithAgentFunctionsSpec {
  catalog: string | Record<string, unknown>;
  agent_functions?: Record<string, AgentFunctionSpec>;
}

type CallbackKind = 'action' | 'error' | 'rendererFunctionResponse';

/** Counts the calls to the handlers of a case's agent functions. */
interface HandlerCalls {
  count: number;
}

/** Builds the handler `behavior` describes, counting its calls in `calls`. */
function buildCountingHandler(calls: HandlerCalls, behavior?: BehaviorSpec): AgentFunctionHandler {
  const handler = buildHandler(behavior);
  return (args, context) => {
    calls.count++;
    return handler(args, context);
  };
}

function buildHandler(behavior?: BehaviorSpec): AgentFunctionHandler {
  if (!behavior) {
    return () => null;
  }
  if (behavior.raises) {
    const {code, validation, message} = behavior.raises;
    return () => {
      if (code) {
        throw new A2uiRpcError(message, code);
      }
      if (validation) {
        throw new A2uiValidationError(message);
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

function buildCatalogWithAgentFunctions(
  spec: CatalogWithAgentFunctionsSpec,
  calls: HandlerCalls,
): CatalogApi {
  const base =
    typeof spec.catalog === 'string'
      ? Catalog.fromJson(
          JSON.parse(fs.readFileSync(conformancePath(spec.catalog), 'utf-8')) as Record<
            string,
            unknown
          >,
        )
      : Catalog.fromJson(spec.catalog);

  const agentFunctions: AgentFunction[] = [];
  for (const [key, fnSpec] of Object.entries(spec.agent_functions ?? {})) {
    const name = fnSpec.name ?? key;
    const handler = buildCountingHandler(calls, fnSpec.behavior);
    if (fnSpec.from_api) {
      // The catalog's own declaration, or else a foreign one built from the
      // case's signature, which the catalog must refuse.
      let declaration: FunctionApi | undefined = base.functions.get(name);
      if (declaration === undefined) {
        const signature = new AgentFunction<Record<string, unknown>, string>({
          name,
          returnType: fnSpec.returnType ?? 'any',
          schema: fnSpec.args,
          description: fnSpec.description,
          requiresUserActivation: fnSpec.requiresUserActivation,
          handler,
        });
        declaration = {
          name,
          returnType: signature.returnType,
          schema: signature.schema,
          description: signature.description,
          requiresUserActivation: signature.requiresUserActivation,
        };
      }
      agentFunctions.push(AgentFunction.fromApi(declaration, handler));
    } else {
      if (fnSpec.returnType === undefined || fnSpec.args === undefined) {
        throw new Error(
          `Direct AgentFunctionDeclaration '${name}' must specify args and returnType.`,
        );
      }
      agentFunctions.push(
        new AgentFunction<Record<string, unknown>, string>({
          name,
          returnType: fnSpec.returnType,
          schema: fnSpec.args,
          description: fnSpec.description,
          requiresUserActivation: fnSpec.requiresUserActivation,
          handler,
        }),
      );
    }
  }
  return base.copyWith({agentFunctions});
}

/** The categories an `AgentFunctionExpectError` may name. */
const AGENT_FUNCTION_ERROR_CATEGORIES = new Set(['CatalogError', 'ValidationError']);

/**
 * Checks a caught error against the case's `AgentFunctionExpectError`.
 *
 * `category` is required, so a case can't pass on an unrelated error, and `message` is a
 * literal substring of the error's text.
 */
function expectCaseError(caught: unknown, testCase: LoadedCase): void {
  const expectError = testCase.expect_error as Record<string, unknown>;
  expect(typeof expectError).toBe('object');
  const unknownKeys = Object.keys(expectError).filter(
    key => key !== 'category' && key !== 'message',
  );
  expect(unknownKeys, 'Unhandled expect_error keys').toEqual([]);
  expect(AGENT_FUNCTION_ERROR_CATEGORIES.has(expectError['category'] as string)).toBe(true);
  expect(caught).toBeInstanceOf(errorClassFor(testCase));
  if (expectError['message'] !== undefined) {
    expect((caught as Error).message).toContain(expectError['message'] as string);
  }
}

function expectThrowsCaseError(fn: () => void, testCase: LoadedCase): void {
  let caught: unknown;
  try {
    fn();
  } catch (err: unknown) {
    caught = err;
  }
  expectCaseError(caught, testCase);
}

async function expectRejectsCaseError(
  fn: () => Promise<unknown>,
  testCase: LoadedCase,
): Promise<void> {
  let caught: unknown;
  try {
    await fn();
  } catch (err: unknown) {
    caught = err;
  }
  expectCaseError(caught, testCase);
}

function runDeclareAgentFunctions(testCase: LoadedCase): void {
  const {catalog: spec} = (testCase.args ?? {}) as {catalog: CatalogWithAgentFunctionsSpec};

  const calls: HandlerCalls = {count: 0};

  if (testCase.expect_error) {
    expectThrowsCaseError(() => buildCatalogWithAgentFunctions(spec, calls), testCase);
    expect(calls.count).toBe(0);
    return;
  }

  const catalog = buildCatalogWithAgentFunctions(spec, calls);
  const expected = testCase.expect as {
    functions: string[];
    agent_functions: string[];
    document_functions: string[];
  };
  const sorted = (names: Iterable<string>) => [...names].sort();

  expect(sorted(catalog.functions.keys())).toEqual(sorted(expected.functions));
  expect(sorted(catalog.agentFunctions.keys())).toEqual(sorted(expected.agent_functions));
  const documentFunctions = (catalog.toJson().functions ?? {}) as Record<string, unknown>;
  expect(sorted(Object.keys(documentFunctions))).toEqual(sorted(expected.document_functions));
}

async function runHandleAgentFunction(testCase: LoadedCase): Promise<void> {
  const args = (testCase.args ?? {}) as {
    catalogs: CatalogWithAgentFunctionsSpec[];
    message: Record<string, unknown>;
  };
  const calls: HandlerCalls = {count: 0};
  const build = () =>
    new RendererToAgentMessageProcessor({
      catalogs: args.catalogs.map(spec => buildCatalogWithAgentFunctions(spec, calls)),
    });

  if (testCase.expect_error) {
    await expectRejectsCaseError(async () => build().processMessage(args.message), testCase);
    expect(calls.count).toBe(0);
    return;
  }

  const result = await build().processMessage(args.message);
  expect(result.handled).toBe(true);
  expect(result.replies).toHaveLength(1);
  const response = result.replies[0] as AgentFunctionResponseMessage;
  expect(Object.keys(response).sort()).toEqual(['agentFunctionResponse', 'version']);
  expect(response.version).toBe('1.0');
  const body = response.agentFunctionResponse;
  const expected = testCase.expect as {
    functionCallId: string;
    value?: unknown;
    error?: {code: string; message?: string};
  };

  expect(body.functionCallId).toBe(expected.functionCallId);
  if (Object.hasOwn(expected, 'error') && expected.error !== undefined) {
    expect(Object.keys(body).sort()).toEqual(['error', 'functionCallId']);
    expect(body.error).toBeDefined();
    expect(Object.keys(body.error!).sort()).toEqual(['code', 'message']);
    expect(typeof body.error!.message).toBe('string');
    expect(body.error!.message.length).toBeGreaterThan(0);
    expect(body.error!.code).toBe(expected.error.code);
    if (expected.error.message !== undefined) {
      expect(body.error!.message).toContain(expected.error.message);
    }
    expectHandlerSkippedIfRejected(expected.error.code, calls);
  } else {
    expect(Object.keys(body).sort()).toEqual(['functionCallId', 'value']);
    expect(body.value).toEqual(expected.value);
  }
}

function runValidatePayload(testCase: LoadedCase): void {
  const args = (testCase.args ?? {}) as {
    catalogs: CatalogWithAgentFunctionsSpec[];
    messages: unknown[];
  };
  const calls: HandlerCalls = {count: 0};
  const build = () => args.catalogs.map(spec => buildCatalogWithAgentFunctions(spec, calls));
  if (testCase.expect_error) {
    expectThrowsCaseError(() => validatePayload(build(), args.messages), testCase);
    expect(calls.count).toBe(0);
    return;
  }
  validatePayload(build(), args.messages);
}

/** Error codes of replies to calls that the agent rejects before running the handler. */
const REJECTED_CALL_CODES = new Set(['INVALID_FUNCTION_CALL', 'UNKNOWN_FUNCTION']);

/** Checks that no handler ran when the expected reply rejects the call. */
function expectHandlerSkippedIfRejected(code: string, calls: HandlerCalls): void {
  if (REJECTED_CALL_CODES.has(code)) {
    expect(calls.count, `a handler ran for a call rejected with ${code}`).toBe(0);
  }
}

/**
 * Compares the replies sent with the expected ones exactly, except that an
 * expected `error.message` is a substring of the one sent and may be left out.
 */
function expectReplies(actual: unknown[], expected: Array<Record<string, unknown>>): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((want, i) => {
    const got = structuredClone(actual[i]) as Record<string, unknown>;
    const wantBody = want['agentFunctionResponse'] as Record<string, unknown> | undefined;
    const gotBody = got['agentFunctionResponse'] as Record<string, unknown> | undefined;
    if (
      wantBody !== undefined &&
      typeof wantBody === 'object' &&
      wantBody !== null &&
      Object.hasOwn(wantBody, 'error') &&
      wantBody['error'] !== undefined
    ) {
      expect(gotBody).toBeDefined();
      const wantError = wantBody['error'] as {code: string; message?: string};
      const gotError = gotBody!['error'] as Record<string, unknown> | undefined;
      expect(gotError).toBeDefined();
      expect(Object.keys(gotError!).sort()).toEqual(['code', 'message']);
      expect(typeof gotError!['message']).toBe('string');
      expect((gotError!['message'] as string).length).toBeGreaterThan(0);
      if (wantError.message === undefined) {
        delete gotError!['message'];
      } else {
        expect(gotError!['message'] as string).toContain(wantError.message);
        gotError!['message'] = wantError.message;
      }
    }
    expect(got).toEqual(want);
  });
}

async function runProcessRendererMessage(testCase: LoadedCase): Promise<void> {
  const args = (testCase.args ?? {}) as {
    catalog?: CatalogWithAgentFunctionsSpec;
    catalogs?: CatalogWithAgentFunctionsSpec[];
    callbacks?: Array<CallbackKind | {kind: CallbackKind; declines: true}>;
    message: unknown;
  };
  const received: Array<{kind: CallbackKind; message: unknown}> = [];
  // Each callback records the message it receives; a declining one returns false.
  const callbacks = new Map<CallbackKind, (message: unknown) => boolean | void>();
  for (const entry of args.callbacks ?? []) {
    const {kind, declines} = typeof entry === 'string' ? {kind: entry, declines: false} : entry;
    callbacks.set(kind, (message: unknown) => {
      received.push({kind, message});
      return declines ? false : undefined;
    });
  }
  const catalogSpecs = args.catalogs ?? (args.catalog ? [args.catalog] : []);
  const calls: HandlerCalls = {count: 0};
  const build = () => {
    const options: RendererToAgentMessageProcessorOptions = {
      catalogs: catalogSpecs.map(spec => buildCatalogWithAgentFunctions(spec, calls)),
      onAction: callbacks.get('action'),
      onError: callbacks.get('error'),
      onRendererFunctionResponse: callbacks.get('rendererFunctionResponse'),
    };
    return new RendererToAgentMessageProcessor(options);
  };

  if (testCase.expect_error) {
    await expectRejectsCaseError(async () => build().processMessage(args.message), testCase);
    expect(received).toEqual([]);
    expect(calls.count).toBe(0);
    return;
  }

  const processor = build();

  const result = await processor.processMessage(args.message);
  const expected = testCase.expect as {
    handled: boolean;
    replies?: Array<Record<string, unknown>>;
    callback?: {kind: CallbackKind; message: unknown};
  };
  expect(result.handled).toBe(expected.handled);
  expectReplies(result.replies, expected.replies ?? []);
  for (const reply of expected.replies ?? []) {
    const error = (reply['agentFunctionResponse'] as {error?: {code: string}} | undefined)?.error;
    if (error !== undefined) {
      expectHandlerSkippedIfRejected(error.code, calls);
    }
  }
  expect(normalizeTimestamps(received)).toEqual(
    normalizeTimestamps(expected.callback ? [expected.callback] : []),
  );
}

/**
 * Writes every `timestamp` that is an ISO 8601 instant in one spelling, so
 * `2026-01-01T00:00:00Z` and `2026-01-01T00:00:00.000Z` compare equal.
 */
function normalizeTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeTimestamps);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (key === 'timestamp' && typeof item === 'string') {
          const instant = new Date(item);
          return [key, Number.isNaN(instant.getTime()) ? item : instant.toISOString()];
        }
        return [key, normalizeTimestamps(item)];
      }),
    );
  }
  return value;
}

const cases = loadCases([conformancePath('agent/agent_functions.yaml')]);

test('agent_functions.yaml is not empty', () => {
  expect(cases.length).toBeGreaterThan(0);
});

describeSuite(
  'Conformance: agent_functions.yaml',
  cases,
  async testCase => {
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
      case 'process_renderer_message':
        await runProcessRendererMessage(testCase);
        return;
      default:
        throw new Error(`Unhandled conformance action: ${testCase.action}`);
    }
  },
  {
    knownFailures: KNOWN_FAILURES,
    skipReason: testCase => {
      const verdict = classify(testCase);
      return verdict.runnable ? undefined : verdict.reason;
    },
  },
);
