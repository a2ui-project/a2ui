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

import {A2uiValidationError, CatalogApi, FunctionApi} from '../internal/web-core.js';

/**
 * Returns the names of functions the agent may call directly via `callRendererFunction`.
 *
 * Iterates catalogs in order and their functions in declaration order,
 * returning each unique function name whose `requiresUserActivation` is
 * falsy and whose `allowedCallers` is `'agentOnly'` or `'rendererOrAgent'`.
 *
 * @param catalogs Active catalogs in priority order.
 * @returns Function names eligible for standalone agent calls.
 */
export function agentCallableFunctions(catalogs: readonly CatalogApi[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const catalog of catalogs) {
    for (const fn of catalog.functions.values()) {
      if (
        !fn.requiresUserActivation &&
        (fn.allowedCallers === 'agentOnly' || fn.allowedCallers === 'rendererOrAgent') &&
        !seen.has(fn.name)
      ) {
        seen.add(fn.name);
        names.push(fn.name);
      }
    }
  }
  return names;
}

function findFunction(
  name: string,
  catalogId: string | undefined,
  catalogs: readonly CatalogApi[],
): FunctionApi | undefined {
  if (catalogId !== undefined) {
    for (const catalog of catalogs) {
      if (catalog.id === catalogId) {
        return catalog.functions.get(name);
      }
    }
    return undefined;
  }
  for (const catalog of catalogs) {
    const fn = catalog.functions.get(name);
    if (fn !== undefined) {
      return fn;
    }
  }
  return undefined;
}

/**
 * Validates that a `callRendererFunction` message calls an agent-callable function.
 *
 * Unknown catalogs or functions are left to schema and processor validation.
 *
 * @param message An agent-to-renderer message object.
 * @param catalogs Active catalogs in priority order.
 * @throws {A2uiValidationError} If the target function requires user activation or
 *     declares `allowedCallers: 'rendererOnly'`.
 */
export function checkAgentCallable(
  message: Record<string, unknown>,
  catalogs: readonly CatalogApi[],
): void {
  const callRenderer = message['callRendererFunction'];
  if (typeof callRenderer !== 'object' || callRenderer === null || Array.isArray(callRenderer)) {
    return;
  }
  const callFn = (callRenderer as Record<string, unknown>)['callFunction'];
  if (typeof callFn !== 'object' || callFn === null || Array.isArray(callFn)) {
    return;
  }
  const callRecord = callFn as Record<string, unknown>;
  const rawName = '@call' in callRecord ? callRecord['@call'] : callRecord['call'];
  if (typeof rawName !== 'string' || rawName.length === 0) {
    return;
  }
  const rawCatalogId = callRecord['catalogId'];
  const catalogId =
    typeof rawCatalogId === 'string' && rawCatalogId.length > 0 ? rawCatalogId : undefined;
  const fn = findFunction(rawName, catalogId, catalogs);
  if (fn === undefined) {
    return;
  }
  if (fn.requiresUserActivation) {
    throw new A2uiValidationError(
      `Function '${rawName}' cannot be called by the agent (requiresUserActivation is true).`,
    );
  }
  const allowedCallers = fn.allowedCallers ?? 'rendererOnly';
  if (allowedCallers !== 'agentOnly' && allowedCallers !== 'rendererOrAgent') {
    throw new A2uiValidationError(
      `Function '${rawName}' cannot be called by the agent (allowedCallers is ${allowedCallers}).`,
    );
  }
}
