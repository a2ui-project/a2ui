/*
 * Copyright 2026 Google LLC
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

import type {ComponentApi, FunctionApi, JsonSchemaObject} from './types.js';

/**
 * Returns copies of catalog entries that carry their definitions.
 *
 * The built-in basic catalogs pair their code-defined entries with the
 * definitions generated from their published documents this way. The result
 * lists the entries with a definition first, in the order of `definitions`,
 * which is the order of the published document, and then the remaining
 * entries, such as system functions, in their own order.
 *
 * @param entries The components or functions defined in code.
 * @param definitions Definitions by entry name.
 * @returns New entry objects; `entries` are left unchanged.
 */
export function withDefinitions<E extends ComponentApi | FunctionApi>(
  entries: readonly E[],
  definitions: Readonly<Record<string, JsonSchemaObject>>,
): E[] {
  const remaining = new Map(entries.map(entry => [entry.name, entry]));
  const result: E[] = [];
  for (const [name, definition] of Object.entries(definitions)) {
    const entry = remaining.get(name);
    if (!entry) continue;
    remaining.delete(name);
    result.push({...entry, definition});
  }
  result.push(...remaining.values());
  return result;
}
