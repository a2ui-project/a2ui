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
 * Those suites spell their keys in snake_case (`expect_error`, `catalog_id`), unlike the
 * legacy suites that `conformance.test.ts` runs.
 */

import * as path from 'path';
import {expect, test} from 'vitest';

import {CatalogApi} from '../../src/internal/web-core.js';
import {
  A2uiCatalogError,
  A2uiValidationError,
  CatalogConfig,
  CatalogTransformer,
  ComponentPruningTransformer,
  FileSystemCatalogProvider,
  FunctionPruningTransformer,
  ParseError,
} from '../../src/index.js';
import {CONFORMANCE_ROOT, LoadedCase} from './loader.js';

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
export function conformancePath(relative: string): string {
  return path.resolve(CONFORMANCE_ROOT, relative);
}

/** The error class for the category a case names in `expect_error`. */
export function errorClassFor(testCase: LoadedCase): new (...args: never[]) => Error {
  const expectError = testCase.expect_error as {category?: string} | undefined;
  const category = expectError?.category ?? '';
  const errorClass = ERROR_BY_CATEGORY[category];
  if (!errorClass) {
    throw new Error(`Unknown error category '${category}' in case ${testCase.name}`);
  }
  return errorClass;
}

/** Loads the registrations a case lists into catalog configs, with their transformers. */
export async function loadRegistrations(
  registrations: CatalogRegistration[],
): Promise<CatalogConfig[]> {
  return Promise.all(
    registrations.map(async registration => {
      const catalog = await new FileSystemCatalogProvider(
        conformancePath(registration.catalog),
      ).load();
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
    }),
  );
}

/** Asserts a catalog declares exactly the named components and, if given, functions. */
export function expectCatalogContents(
  catalog: CatalogApi,
  expected: {components?: string[]; functions?: string[]},
): void {
  if (expected.components) {
    expect([...catalog.components.keys()].sort()).toEqual([...expected.components].sort());
  }
  if (expected.functions) {
    expect([...catalog.functions.keys()].sort()).toEqual([...expected.functions].sort());
  }
}

/**
 * Registers one case with vitest, as an expected failure when it is listed in
 * `knownFailures`.
 *
 * An expected failure still runs, and the suite asserts that it fails, so fixing the gap
 * turns the test red and prompts removing the entry.
 */
export function registerCase(
  testCase: LoadedCase,
  knownFailures: ReadonlyMap<string, string>,
  run: () => Promise<void>,
): void {
  const title = `${testCase.action} · ${testCase.name}`;
  const knownFailure = knownFailures.get(testCase.name);
  if (knownFailure) {
    test.fails(`${title} (known gap: ${knownFailure})`, run);
  } else {
    test(title, run);
  }
}
