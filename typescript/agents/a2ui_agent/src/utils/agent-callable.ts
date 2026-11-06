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

import {
  A2uiValidationError,
  CatalogApi,
  isAtLeastVersion,
  PayloadValidator,
} from '../internal/web-core.js';

/**
 * Returns the names of functions the agent may call directly via `callRendererFunction`.
 *
 * Iterates catalogs in order and their functions in declaration order,
 * returning each unique function name on v1.0+ catalogs whose
 * `requiresUserActivation` is falsy and whose `allowedCallers` is
 * `'agentOnly'` or `'rendererOrAgent'`.
 *
 * @param catalogs Active catalogs in priority order.
 * @returns Function names eligible for standalone agent calls.
 */
export function agentCallableFunctions(catalogs: readonly CatalogApi[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const catalog of catalogs) {
    if (!catalog.protocolVersion || !isAtLeastVersion(catalog.protocolVersion, '1.0')) {
      continue;
    }
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

function resolveCatalog(
  name: string,
  catalogId: string | undefined,
  catalogs: readonly CatalogApi[],
): CatalogApi {
  if (catalogId !== undefined) {
    for (const catalog of catalogs) {
      if (catalog.id === catalogId) {
        return catalog;
      }
    }
    throw new A2uiValidationError(
      `Function '${name}' names catalog '${catalogId}', which is not active.`,
    );
  }
  for (const catalog of catalogs) {
    if (catalog.functions.has(name)) {
      return catalog;
    }
  }
  throw new A2uiValidationError(`Function '${name}' is not declared in any active catalog.`);
}

function validateNestedCalls(
  value: unknown,
  defaultCatalog: CatalogApi,
  catalogs: readonly CatalogApi[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      validateNestedCalls(item, defaultCatalog, catalogs);
    }
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, '@call') && typeof record['@call'] === 'string') {
    const nestedName = record['@call'];
    const rawCat = record['catalogId'];
    if (rawCat !== undefined && typeof rawCat !== 'string') {
      throw new A2uiValidationError(`Function '${nestedName}' catalogId must be a string.`);
    }
    const nestedCatalog = nestedName.startsWith('@')
      ? defaultCatalog
      : rawCat
        ? resolveCatalog(nestedName, rawCat, catalogs)
        : defaultCatalog;
    const rawNestedArgs = record['args'];
    if (
      rawNestedArgs !== undefined &&
      (typeof rawNestedArgs !== 'object' || rawNestedArgs === null || Array.isArray(rawNestedArgs))
    ) {
      throw new A2uiValidationError(`Function '${nestedName}' arguments must be an object.`);
    }
    new PayloadValidator(nestedCatalog, {
      allowUnknownElements: false,
    }).validateFunction(nestedName, rawNestedArgs as Record<string, unknown> | undefined);
    if (rawNestedArgs !== undefined) {
      validateNestedCalls(rawNestedArgs, defaultCatalog, catalogs);
    }
    return;
  }
  for (const item of Object.values(record)) {
    validateNestedCalls(item, defaultCatalog, catalogs);
  }
}

/**
 * Validates that a `callRendererFunction` message calls an agent-callable function.
 *
 * @param message An agent-to-renderer message object.
 * @param catalogs Active catalogs in priority order.
 * @throws {A2uiValidationError} If the target catalog is inactive, the function is
 *     undeclared, the function requires user activation or declares
 *     `allowedCallers: 'rendererOnly'`, or its arguments fail schema validation.
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
  const rawName = Object.hasOwn(callRecord, '@call') ? callRecord['@call'] : callRecord['call'];
  if (typeof rawName !== 'string' || rawName.length === 0) {
    return;
  }
  const rawCatalogId = callRecord['catalogId'];
  if (rawCatalogId !== undefined && typeof rawCatalogId !== 'string') {
    throw new A2uiValidationError(`Function '${rawName}' catalogId must be a string.`);
  }
  const catalogId = rawCatalogId && rawCatalogId.length > 0 ? rawCatalogId : undefined;
  const targetCatalog = resolveCatalog(rawName, catalogId, catalogs);
  const fn = targetCatalog.functions.get(rawName);
  if (fn === undefined) {
    throw new A2uiValidationError(
      `Function '${rawName}' is not declared in catalog '${targetCatalog.id}'.`,
    );
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
  const rawArgs = callRecord['args'];
  if (
    rawArgs !== undefined &&
    (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs))
  ) {
    throw new A2uiValidationError(`Function '${rawName}' arguments must be an object.`);
  }
  new PayloadValidator(targetCatalog, {
    allowUnknownElements: false,
  }).validateFunction(rawName, rawArgs as Record<string, unknown> | undefined);
  if (rawArgs !== undefined) {
    validateNestedCalls(rawArgs, targetCatalog, catalogs);
  }
}
