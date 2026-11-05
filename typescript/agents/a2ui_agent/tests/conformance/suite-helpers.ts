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

/**
 * Shared helpers for the harnesses that run the agent suites written against the module
 * blueprint (`conformance/agent/*.yaml` and `conformance/agent/direct-json/*.yaml`).
 *
 * Those suites write their keys in snake_case (`expect_error`, `catalog_id`), unlike the
 * legacy suites that `conformance.test.ts` runs.
 */

import {resolve} from 'path';

import {describe, expect, test} from 'vitest';

import {
  A2uiCatalogError,
  A2uiCompilationError,
  A2uiCompilationParseError,
  A2uiCompilationValidationError,
  A2uiError,
  A2uiValidationError,
  AgentToRendererMessage,
  CatalogConfig,
  CatalogTransformer,
  ComponentPruningTransformer,
  FileSystemCatalogProvider,
  FunctionPruningTransformer,
  ParseError,
  Parser,
  validatePayload,
} from '../../src/index.js';
import {CatalogApi} from '../../src/internal/web-core.js';
import {CONFORMANCE_ROOT, KNOWN_FAILURES, LoadedCase, SUPERSEDED, UNSUPPORTED} from './loader.js';
import {
  ActiveCase,
  recordCase,
  registerAfterEachManifestRecorder,
  setActiveCase,
} from './manifest.js';

export {KNOWN_FAILURES, SUPERSEDED, UNSUPPORTED};

/** Thrown when a conformance case or sub-object contains an unrecognized YAML key. */
export class UnknownConformanceKeyError extends Error {
  constructor(where: string, unknownKeys: string[]) {
    super(`Unknown conformance keys at ${where}: ${unknownKeys.join(', ')}`);
    this.name = 'UnknownConformanceKeyError';
  }
}

/** Common metadata keys allowed at the top level of every conformance case. */
export const CASE_METADATA_KEYS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'features',
  'action',
  'sourceFile',
]);

/** Keys recognized inside an `expect_error` block. */
export const EXPECT_ERROR_KEYS: ReadonlySet<string> = new Set([
  'category',
  'message',
  'message_is_regex',
  'details',
]);

/** Keys recognized inside a catalog expectation block. */
export const CATALOG_EXPECT_KEYS: ReadonlySet<string> = new Set([
  'catalog_id',
  'protocol_version',
  'components',
  'functions',
  'serialized_defs_contain',
  'serialized_defs_omit',
]);

/**
 * Throws `UnknownConformanceKeyError` if `obj` contains any keys not in `allowed`.
 */
export function assertKnownKeys(
  obj: Record<string, unknown> | undefined | null,
  allowed: ReadonlySet<string>,
  where: string,
): void {
  if (!obj || typeof obj !== 'object') {
    return;
  }
  const unknown = Object.keys(obj)
    .filter(k => !allowed.has(k))
    .sort();
  if (unknown.length > 0) {
    throw new UnknownConformanceKeyError(where, unknown);
  }
}

/** Error categories the suites name, mapped to the SDK's error classes. */
const ERROR_BY_CATEGORY: Record<string, new (...args: never[]) => Error> = {
  CatalogError: A2uiCatalogError,
  ParseError: ParseError,
  ValidationError: A2uiValidationError,
};

/** A catalog registration as the suites write it. */
export interface CatalogRegistration {
  catalog: string;
  transformers?: Array<{component_pruning?: string[]; function_pruning?: string[]}>;
}

/** Resolves a path the suites give relative to `conformance/`. */
/** The suite's category for an error, or the error's class name if it has none. */
export function categoryOf(error: unknown): string {
  if (error instanceof ParseError || error instanceof A2uiCompilationParseError) {
    return 'ParseError';
  }
  if (error instanceof A2uiValidationError || error instanceof A2uiCompilationValidationError) {
    return 'ValidationError';
  }
  if (error instanceof A2uiCatalogError) return 'CatalogError';
  return (error as Error).constructor.name;
}

export function conformancePath(relative: string): string {
  return resolve(CONFORMANCE_ROOT, relative);
}

/** The error class for the category a case names in `expect_error`. */
export function errorClassFor(testCase: LoadedCase): new (...args: never[]) => Error {
  const expectError = testCase.expect_error as {category?: string; message?: string} | undefined;
  if (expectError && typeof expectError === 'object') {
    assertKnownKeys(expectError as Record<string, unknown>, EXPECT_ERROR_KEYS, 'expect_error');
  }
  const category = expectError?.category ?? '';
  const errorClass = ERROR_BY_CATEGORY[category];
  if (!errorClass) {
    throw new Error(`Unknown error category '${category}' in case ${testCase.name}`);
  }
  return errorClass;
}

/**
 * Runs `fn` and asserts that it throws the error class and optional message pattern
 * specified in `testCase.expect_error`.
 */
export function assertExpectedError(fn: () => unknown, testCase: LoadedCase): void {
  const expectError = testCase.expect_error as {category?: string; message?: string} | undefined;
  const errorClass = errorClassFor(testCase);
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, `Expected case ${testCase.name} to throw`).toBeInstanceOf(errorClass);
  if (expectError?.message) {
    expect((thrown as Error).message).toMatch(new RegExp(expectError.message, 'i'));
  }
}

/**
 * Compiles one block and checks its messages on their own.
 *
 * A conformance `compile` case fixes the messages an agent sends for one block, so they are
 * checked the way `validatePayload` checks a payload: a surface that the block updates
 * without creating is assumed to exist. A failure to compile that isn't an `A2uiError` is
 * thrown as `A2uiCompilationError`, as `parseResponse` throws it.
 */
export function compileChecked(parser: Parser, content: string): AgentToRendererMessage[] {
  let messages: AgentToRendererMessage[];
  try {
    messages = parser.compile(content);
  } catch (e) {
    if (e instanceof A2uiError) throw e;
    const reason = e instanceof Error ? e.message : String(e);
    throw new A2uiCompilationError(`Failed to compile A2UI block: ${reason}`, {
      rawContent: content,
    });
  }
  validatePayload(parser.catalogs, messages);
  return messages;
}

/** Loads the registrations a case lists into catalog configs, with their transformers. */
export function loadRegistrations(registrations: CatalogRegistration[]): CatalogConfig[] {
  return registrations.map(registration => {
    const catalog = new FileSystemCatalogProvider(conformancePath(registration.catalog)).load();
    const transformers: CatalogTransformer[] = [];
    for (const transformer of registration.transformers ?? []) {
      if (transformer.component_pruning) {
        transformers.push(new ComponentPruningTransformer(transformer.component_pruning));
      }
      if (transformer.function_pruning) {
        transformers.push(new FunctionPruningTransformer(transformer.function_pruning));
      }
    }
    return new CatalogConfig(catalog, transformers);
  });
}

/** Asserts a catalog declares the expected id, protocol version, components, and functions. */
export function expectCatalogContents(
  catalog: CatalogApi,
  expected: {
    catalog_id?: string;
    protocol_version?: string;
    components?: string[];
    functions?: string[];
    serialized_defs_contain?: string[];
    serialized_defs_omit?: string[];
  },
): void {
  assertKnownKeys(expected as Record<string, unknown>, CATALOG_EXPECT_KEYS, 'expect.catalog');
  if (expected.catalog_id !== undefined) {
    expect(catalog.id).toBe(expected.catalog_id);
  }
  if (expected.protocol_version !== undefined) {
    expect(catalog.protocolVersion).toBe(expected.protocol_version);
  }
  if (expected.components) {
    expect([...catalog.components.keys()].sort()).toEqual([...expected.components].sort());
  }
  if (expected.functions) {
    expect([...catalog.functions.keys()].sort()).toEqual([...expected.functions].sort());
  }
}

/**
 * Registers one case with vitest, as an expected failure when it is listed in
 * `knownFailures` or as a skip when `skipReason` is given.
 *
 * An expected failure still runs, and the suite asserts that it fails, so fixing the gap
 * turns the test red and prompts removing the entry.
 */
export function registerCase(
  testCase: LoadedCase,
  knownFailures: ReadonlyMap<string, string>,
  run: () => void | Promise<void>,
  skipReason?: string,
): void {
  const title = `${testCase.action} · ${testCase.name}`;
  const compositeKey = `${testCase.sourceFile}::${testCase.name}`;
  const effectiveSkip =
    skipReason ?? UNSUPPORTED.get(compositeKey) ?? UNSUPPORTED.get(testCase.name);
  if (effectiveSkip) {
    test(`${title} (${effectiveSkip})`, ctx => {
      const active: ActiveCase = {
        suite: testCase.sourceFile,
        name: testCase.name,
        skipReason: effectiveSkip,
        recorded: true,
      };
      setActiveCase(ctx.task, active);
      recordCase(testCase.sourceFile, testCase.name, 'skipped', effectiveSkip);
      ctx.skip(effectiveSkip);
    });
    return;
  }
  const knownFailure =
    knownFailures.get(compositeKey) ??
    knownFailures.get(testCase.name) ??
    knownFailures.get(title) ??
    KNOWN_FAILURES.get(compositeKey) ??
    KNOWN_FAILURES.get(testCase.name);
  const wrappedRun = async (ctx: {task: object}) => {
    const active: ActiveCase = {
      suite: testCase.sourceFile,
      name: testCase.name,
      knownFailure,
    };
    setActiveCase(ctx.task, active);
    try {
      await run();
    } catch (err) {
      if (err instanceof UnknownConformanceKeyError && knownFailure) {
        active.unexpectedError = err;
        return;
      }
      throw err;
    }
  };
  if (knownFailure) {
    test.fails(`${title} (known gap: ${knownFailure})`, wrappedRun);
  } else {
    test(title, wrappedRun);
  }
}

export interface DescribeSuiteOptions {
  knownFailures?: ReadonlyMap<string, string>;
  skipReason?: (testCase: LoadedCase) => string | undefined;
}

/**
 * Declares a Vitest `describe` block for one or more conformance suites, registers the
 * `afterEach` manifest recorder, and registers each loaded case.
 */
export function describeSuite(
  suiteTitle: string,
  cases: readonly LoadedCase[],
  run: (testCase: LoadedCase) => void | Promise<void>,
  options: DescribeSuiteOptions = {},
): void {
  const knownFailures = options.knownFailures ?? new Map<string, string>();
  describe(suiteTitle, () => {
    registerAfterEachManifestRecorder();
    for (const testCase of cases) {
      const reason = options.skipReason?.(testCase);
      registerCase(testCase, knownFailures, () => run(testCase), reason);
    }
  });
}
