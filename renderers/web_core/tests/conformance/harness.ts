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

import {existsSync, readFileSync} from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse as parseYaml} from 'yaml';

/**
 * Locates the repository's `conformance/` directory.
 *
 * Walks up from this module so the suites load whether the tests run from
 * `src/` or from the compiled output in `dist/`.
 */
function conformanceRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, 'conformance');
    if (existsSync(path.join(candidate, 'conformance_schema.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate the conformance/ directory above ${dir}.`);
    }
    dir = parent;
  }
}

/**
 * Resolves a path from a conformance case against the `conformance/` directory.
 */
export function resolveConformancePath(relativePath: string): string {
  return path.join(conformanceRoot(), relativePath);
}

/**
 * Loads a conformance suite, for example `core/data_model.yaml`.
 */
export function loadConformanceSuite<T = Record<string, unknown>>(suite: string): T[] {
  const file = resolveConformancePath(suite);
  if (!existsSync(file)) {
    throw new Error(`Conformance suite not found: ${file}`);
  }
  const parsed = parseYaml(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`Conformance suite ${suite} must be a list of cases.`);
  }
  return parsed as T[];
}
