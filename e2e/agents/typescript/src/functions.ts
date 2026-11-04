/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The agent functions the test agent serves to a v1.0 renderer.
 *
 * A renderer calls them with `callAgentFunction`. `lookupPrice(sku)` answers after a delay, so a
 * test can observe the pending state of a value bound to it. `failingLookup()` always throws, so
 * a test can observe how a renderer settles a binding or halts an action when the agent's
 * function fails.
 */

import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

import {
  AgentFunction,
  AgentFunctionRegistry,
  type CatalogApi,
  type CatalogInterface,
  FileSystemCatalogProvider,
} from '@a2ui/agent';

export const LOOKUP_PRICE = 'lookupPrice';
export const FAILING_LOOKUP = 'failingLookup';

/** The prices `lookupPrice` knows. Any other SKU costs `DEFAULT_PRICE`. */
export const PRICES: Readonly<Record<string, string>> = {
  'sku-100': '$10.00',
  'sku-250': '$25.00',
  'sku-999': '$999.00',
};

export const DEFAULT_PRICE = '$9.99';

/** Everything that differs by protocol version when loading a basic catalog. */
export interface VersionProfile {
  /** The version as the scenario files write it. */
  readonly version: '0.9.1' | '1.0';
  /** The version as the agent SDK and the wire write it. */
  readonly wireVersion: 'v0.9' | '1.0';
  readonly catalogId: string;
  /** The basic catalog document, relative to the repository root. */
  readonly catalogPath: string;
}

export const V0_9: VersionProfile = {
  version: '0.9.1',
  wireVersion: 'v0.9',
  catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
  catalogPath: 'specification/v0_9/catalogs/basic/catalog.json',
};

export const V1_0: VersionProfile = {
  version: '1.0',
  wireVersion: '1.0',
  catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
  catalogPath: 'catalogs/basic/v1/catalog.json',
};

/** The versions the agent serves, oldest first. */
export const VERSIONS: readonly VersionProfile[] = [V0_9, V1_0];

/**
 * The repository root, found by walking up from this file.
 *
 * The file runs from `src/` under vitest and from `dist/src/` when built, so the root is the
 * nearest ancestor that holds the catalogs and the conformance suites.
 */
export function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (fs.existsSync(path.join(dir, 'catalogs')) && fs.existsSync(path.join(dir, 'conformance'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Could not find the repository root above ' + import.meta.url);
    }
    dir = parent;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function lookupPriceFunction(rpcDelayMs: number): AgentFunction {
  return new AgentFunction({
    name: LOOKUP_PRICE,
    returnType: 'string',
    schema: {
      type: 'object',
      properties: {sku: {type: 'string'}},
      required: ['sku'],
      additionalProperties: false,
    },
    description: 'Returns the price of a product by its SKU.',
    handler: async (args: Record<string, unknown>) => {
      if (rpcDelayMs > 0) {
        await sleep(rpcDelayMs);
      }
      return PRICES[String(args.sku).toLowerCase()] ?? DEFAULT_PRICE;
    },
  });
}

function failingLookupFunction(): AgentFunction {
  return new AgentFunction({
    name: FAILING_LOOKUP,
    returnType: 'string',
    schema: {type: 'object', properties: {}, additionalProperties: false},
    description: 'A lookup that always fails on the agent.',
    handler: () => {
      throw new Error(`${FAILING_LOOKUP} always fails.`);
    },
  });
}

/**
 * The basic catalog of `profile`, with the test agent's functions on v1.0.
 *
 * Agent functions exist from v1.0, so earlier versions get the plain basic catalog. The v1.0
 * copy keeps the basic catalog's id and declares the functions as agent-implemented, so the
 * renderer calls the agent for them.
 */
export function buildCatalog(
  profile: VersionProfile,
  options: {rpcDelayMs?: number; root?: string} = {},
): CatalogApi {
  const root = options.root ?? repoRoot();
  const catalog = new FileSystemCatalogProvider(
    path.join(root, profile.catalogPath),
    profile.wireVersion,
    profile.catalogId,
  ).load();
  if (profile.wireVersion !== '1.0') {
    return catalog;
  }
  return catalog.copyWith({
    agentFunctions: [lookupPriceFunction(options.rpcDelayMs ?? 0), failingLookupFunction()],
  });
}

/** A registry for the agent functions of `catalogs`, or undefined when they have none. */
export function buildRegistry(catalogs: readonly CatalogApi[]): AgentFunctionRegistry | undefined {
  if (!catalogs.some(catalog => catalog.agentFunctions.size > 0)) {
    return undefined;
  }
  // The registry reads only `id` and `agentFunctions`, which every catalog has, but its
  // parameter type asks for catalogs whose functions carry a renderer implementation.
  return new AgentFunctionRegistry(catalogs as unknown as Iterable<CatalogInterface>);
}
