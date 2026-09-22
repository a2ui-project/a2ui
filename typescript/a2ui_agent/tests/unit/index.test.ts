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

import {describe, it, expect} from 'vitest';

// We import the entire module to verify all public symbols are exposed correctly.
import * as a2uiAgent from '../../src/index.js';

describe('Public Barrel Exports', () => {
  it('exports all expected Phase 0 symbols', () => {
    // Basic types and factory
    expect(a2uiAgent.basicCatalog).toBeDefined();

    // Errors
    expect(a2uiAgent.A2uiError).toBeDefined();
    expect(a2uiAgent.A2uiValidationError).toBeDefined();
    expect(a2uiAgent.A2uiDataError).toBeDefined();
    expect(a2uiAgent.A2uiExpressionError).toBeDefined();
    expect(a2uiAgent.A2uiStateError).toBeDefined();
    expect(a2uiAgent.A2uiIntegrityError).toBeDefined();
    expect(a2uiAgent.A2uiRecursionError).toBeDefined();
    expect(a2uiAgent.ParseError).toBeDefined();
    expect(a2uiAgent.A2uiCatalogError).toBeDefined();
  });

  it('exports all expected Phase 1A symbols', () => {
    expect(a2uiAgent.Parser).toBeDefined();
    expect(a2uiAgent.PromptGenerator).toBeDefined();
  });

  it('exports all expected Phase 1B symbols', () => {
    // Transformers
    expect(a2uiAgent.ComponentPruningTransformer).toBeDefined();
    expect(a2uiAgent.FunctionPruningTransformer).toBeDefined();

    // Providers
    expect(a2uiAgent.FileSystemCatalogProvider).toBeDefined();
    expect(a2uiAgent.InMemoryCatalogProvider).toBeDefined();

    // Config and Resolver
    expect(a2uiAgent.CatalogConfig).toBeDefined();
    expect(a2uiAgent.resolveCatalogs).toBeDefined();
  });

  it('does not leak internal namespace symbols', () => {
    // A private import shouldn't leak from the barrel.
    // Basic spot check for internal/web_core.ts items not directly requested:
    expect((a2uiAgent as Record<string, unknown>).validateRecursionAndPaths).toBeUndefined();
    expect((a2uiAgent as Record<string, unknown>).MessageProcessor).toBeUndefined();
  });
});
