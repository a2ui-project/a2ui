/*
 * Copyright 2026 Google LLC
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
 * Static checks on app source that run before it is compiled: which modules it imports and which
 * data paths it reads on its first render. Both are regular-expression scans, which is enough for
 * the single, model-written file a ReactApp holds.
 */

/** Modules the import map of an app frame provides (bridge protocol section 9). */
export const AVAILABLE_MODULES: readonly string[] = [
  'a2ui',
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
];

const IMPORT_PATTERN =
  /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** The module specifiers a source imports, in order of first appearance. */
export function findImports(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2];
    if (specifier) {
      found.add(specifier);
    }
  }
  return [...found];
}

/** The imported modules that the frame doesn't provide. */
export function findUnavailableImports(source: string): string[] {
  return findImports(source).filter(specifier => !AVAILABLE_MODULES.includes(specifier));
}

const PATH_CALL_PATTERN =
  /\b(?:useData|getData|subscribe)\s*(?:<[^>()]*>)?\s*\(\s*(['"`])([^'"`$]*)\1/g;

/**
 * The data paths passed as string literals to `useData`, `getData` and `subscribe`, which the
 * runtime asks for in `reactApp/initialize` so they are known before the first render.
 * Paths built at runtime (template literals with `${}`, variables) are skipped.
 */
export function findDataPaths(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(PATH_CALL_PATTERN)) {
    found.add(match[2]);
  }
  return [...found];
}
