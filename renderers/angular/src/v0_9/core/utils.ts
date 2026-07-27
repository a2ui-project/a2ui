/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Normalizes a data model path by combining a relative path with a base context.
 *
 * This is used to create unique absolute paths for components within a repeating
 * collection or nested structure.
 *
 * @param path The relative or absolute path from the component properties.
 * @param dataContextPath The current base data context path.
 * @param index The index of the child component.
 * @returns A fully normalized absolute path for the indexed child.
 */
export function getNormalizedPath(
  path: string | undefined,
  dataContextPath: string,
  index: number,
): string {
  let normalized = path || '';
  if (!normalized.startsWith('/')) {
    const base = dataContextPath === '/' ? '' : dataContextPath;
    normalized = `${base}/${normalized}`;
  }
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return `${normalized}/${index}`;
}
