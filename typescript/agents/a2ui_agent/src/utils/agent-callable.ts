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

import {CatalogApi, isAtLeastVersion} from '../internal/web-core.js';

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
