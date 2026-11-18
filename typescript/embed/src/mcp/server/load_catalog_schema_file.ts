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

/// <reference types="node" />

import {readFileSync} from 'node:fs';
import {
  CatalogSchemaFileSchema,
  checkContractVersion,
  type CatalogSchemaFile,
} from '../../contract/index.js';

/**
 * Reads a catalog schema file, given as a path or URL to the JSON file or as its parsed content,
 * and checks its shape and contract version.
 *
 * @throws If the file cannot be read or parsed, does not have the catalog schema file shape, was
 *     written for an incompatible contract version, or has no catalog.
 */
export function loadCatalogSchemaFile(source: string | URL | object): CatalogSchemaFile {
  const description =
    typeof source === 'object' && !(source instanceof URL)
      ? 'The catalog schema'
      : `The catalog schema file "${String(source)}"`;
  let content: unknown = source;
  if (typeof source === 'string' || source instanceof URL) {
    try {
      content = JSON.parse(readFileSync(source, 'utf8'));
    } catch (error) {
      throw new Error(`${description} could not be read: ${errorMessage(error)}`);
    }
  }
  const parsed = CatalogSchemaFileSchema.safeParse(content);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${description} is invalid: ${details}`);
  }
  const versionCheck = checkContractVersion(parsed.data.contractVersion);
  if (!versionCheck.ok) {
    throw new Error(`${description} is not supported: ${versionCheck.reason}`);
  }
  if (Object.keys(parsed.data.catalogs).length === 0) {
    throw new Error(`${description} has no catalogs.`);
  }
  return parsed.data;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
