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

import {describe, expect, test} from 'vitest';

import {
  A2uiRpcError,
  AgentFunction,
  type AgentFunctionContext,
  type AgentFunctionHandler,
  type AgentFunctionResponseMessage,
  Catalog,
  type CatalogApi,
  type FunctionApi,
  RendererToAgentMessageProcessor,
  type RendererToAgentMessageProcessorOptions,
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
  name?: string;
  from_api?: boolean;
  returnType?: string;
  args?: Record<string, unknown>;
  description?: string;
  behavior?: BehaviorSpec;
}

interface CatalogWithAgentFunctionsSpec {
  catalog: string | Record<string, unknown>;
  agent_functions?: Record<string, AgentFunctionSpec>;
}

type CallbackKind = 'action' | 'error' | 'rendererFunctionResponse';

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

function buildCatalogWithAgentFunctions(spec: CatalogWithAgentFunctionsSpec): CatalogApi {
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
    const handler = buildHandler(fnSpec.behavior);
    const direct = (): AgentFunction =>
      new AgentFunction({
        name,
        returnType: (fnSpec.returnType ?? 'any') as never,
        schema: fnSpec.args,
        description: fnSpec.description,
        handler,
      });
    if (fnSpec.from_api) {
      // The catalog's own declaration, or else a foreign one built from the
      // case's signature, which the catalog must refuse.
      let declaration: FunctionApi | undefined = base.functions.get(name);
      if (declaration === undefined) {
        const signature = direct();
        declaration = {
          name,
          returnType: signature.returnType,
          schema: signature.schema,
          description: signature.description,
        };
      }
      agentFunctions.push(AgentFunction.fromApi(declaration, handler));
    } else {
      agentFunctions.push(direct());
    }
  }
  return base.copyWith({agentFunctions});
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
  const {catalog: spec} = (testCase.args ?? {}) as {catalog: CatalogWithAgentFunctionsSpec};

  if (testCase.expect_error) {
    expectThrowsCaseError(() => buildCatalogWithAgentFunctions(spec), testCase);
    return;
  }

  const catalog = buildCatalogWithAgentFunctions(spec);
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
  const catalogs = args.catalogs.map(buildCatalogWithAgentFunctions);
  const processor = new RendererToAgentMessageProcessor({catalogs});

  if (testCase.expect_error) {
    await expectRejectsCaseError(() => processor.processMessage(args.message), testCase);
    return;
  }

  const result = await processor.processMessage(args.message);
  expect(result.handled).toBe(true);
  expect(result.replies).toHaveLength(1);
  const response = result.replies[0] as AgentFunctionResponseMessage;
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

/**
 * Compares the replies sent with the expected ones exactly, except that an
 * expected `error.message` is a substring of the one sent and may be left out.
 */
function expectReplies(actual: unknown[], expected: Array<Record<string, unknown>>): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((want, i) => {
    const got = structuredClone(actual[i]) as Record<string, Record<string, unknown>>;
    const wantBody = (want['agentFunctionResponse'] ?? {}) as Record<string, unknown>;
    const gotBody = got['agentFunctionResponse'];
    const wantError = wantBody['error'] as {message?: string} | undefined;
    const gotError = gotBody?.['error'] as {message?: string} | undefined;
    if (wantError !== undefined && gotError !== undefined) {
      if (wantError.message === undefined) {
        delete gotError.message;
      } else {
        expect(gotError.message).toContain(wantError.message);
        gotError.message = wantError.message;
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
  const build = () => {
    const options: RendererToAgentMessageProcessorOptions = {
      catalogs: catalogSpecs.map(buildCatalogWithAgentFunctions),
      onAction: callbacks.get('action'),
      onError: callbacks.get('error'),
      onRendererFunctionResponse: callbacks.get('rendererFunctionResponse'),
    };
    return new RendererToAgentMessageProcessor(options);
  };

  if (testCase.expect_error) {
    await expectRejectsCaseError(async () => build().processMessage(args.message), testCase);
    expect(received).toEqual([]);
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
  expect(received).toEqual(expected.callback ? [expected.callback] : []);
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
        case 'process_renderer_message':
          await runProcessRendererMessage(testCase);
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
