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

import {fileURLToPath} from 'url';
import * as path from 'path';
import {A2uiCatalogError} from '../errors.js';
import {normalizeVersionString} from '../internal/web_core.js';

/**
 * Protocol versions whose basic catalog JSON ships inside `@a2ui/web_core`, mapped to the
 * directory name that holds it.
 *
 * Keys are the normalised, unprefixed version. Adding a version here is all that is needed
 * to make {@link getBasicCatalogPath} serve it, provided web_core ships the JSON.
 */
const CATALOG_DIRECTORY_BY_VERSION: Record<string, string> = {
  '1.0': 'v1_0',
};

/**
 * Resolves the absolute path to a basic catalog JSON file inside `@a2ui/web_core`.
 *
 * The JSON is copied into the package's `dist` tree next to its entry point, so the path is
 * derived from the resolved entry point rather than from any assumption about where this
 * package sits on disk. That keeps it working whether web_core is a workspace sibling or an
 * installed dependency.
 *
 * @param version Protocol version to resolve, in any of the spellings a catalog can use.
 * @returns Absolute filesystem path to the catalog JSON.
 * @throws {A2uiCatalogError} If the version has no shipped catalog, or the package cannot
 *     be resolved.
 */
export function getBasicCatalogPath(version: string): string {
  const directory = CATALOG_DIRECTORY_BY_VERSION[normalizeVersionString(version)];
  if (!directory) {
    const supported = Object.keys(CATALOG_DIRECTORY_BY_VERSION)
      .map(v => `'v${v}'`)
      .join(', ');
    throw new A2uiCatalogError(
      `No basic catalog is available for protocol version '${version}'. Supported: ${supported}.`,
    );
  }

  let entryPoint: string;
  try {
    entryPoint = fileURLToPath(import.meta.resolve('@a2ui/web_core'));
  } catch (e: unknown) {
    throw new A2uiCatalogError(
      `Failed to resolve the '@a2ui/web_core' package: ${(e as Error).message}`,
    );
  }

  // The entry point is <web_core>/dist/src/index.js, and the copied schemas live alongside
  // it under the same directory, as <version>/schemas/catalogs/basic/catalog.json.
  return path.resolve(path.dirname(entryPoint), directory, 'schemas/catalogs/basic/catalog.json');
}
