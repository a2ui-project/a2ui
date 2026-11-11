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
 * Finds the data paths an app reads on its first render, with a regular-expression scan, which is
 * enough for the single, model-written file a ReactApp holds.
 */

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
