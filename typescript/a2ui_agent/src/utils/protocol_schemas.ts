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

import * as fs from 'fs';
import {A2uiCatalogError} from '../errors.js';
import {normalizeVersionString} from '../internal/web_core.js';
import {getProtocolSchemaPaths} from './catalog_path.js';

/**
 * Protocol schemas (server-to-client and common-types) loaded as raw JSON objects.
 */
export interface ProtocolSchemas {
  serverToClient: Record<string, unknown>;
  commonTypes: Record<string, unknown>;
}

const _protocolSchemasMemoMap = new Map<string, ProtocolSchemas>();

/**
 * Returns the memoized protocol schemas (server-to-client and common-types) for a given
 * protocol version.
 *
 * @param version Protocol version to load schemas for.
 * @returns Object containing the parsed server-to-client and common-types schemas.
 * @throws {A2uiCatalogError} If no schemas are available for the version, or reading/parsing fails.
 */
export function getProtocolSchemas(version: string): ProtocolSchemas {
  const normalized = normalizeVersionString(version);
  const memoized = _protocolSchemasMemoMap.get(normalized);
  if (memoized) {
    return memoized;
  }

  const paths = getProtocolSchemaPaths(version);

  let s2cContent: string;
  try {
    s2cContent = fs.readFileSync(paths.serverToClientPath, 'utf8');
  } catch (e: unknown) {
    throw new A2uiCatalogError(
      `Failed to read server-to-client schema file at ${paths.serverToClientPath}: ${(e as Error).message}`,
    );
  }

  let serverToClient: Record<string, unknown>;
  try {
    serverToClient = JSON.parse(s2cContent) as Record<string, unknown>;
  } catch (e: unknown) {
    throw new A2uiCatalogError(
      `Failed to parse JSON in server-to-client schema file at ${paths.serverToClientPath}: ${(e as Error).message}`,
    );
  }

  let commonTypesContent: string;
  try {
    commonTypesContent = fs.readFileSync(paths.commonTypesPath, 'utf8');
  } catch (e: unknown) {
    throw new A2uiCatalogError(
      `Failed to read common types schema file at ${paths.commonTypesPath}: ${(e as Error).message}`,
    );
  }

  let commonTypes: Record<string, unknown>;
  try {
    commonTypes = JSON.parse(commonTypesContent) as Record<string, unknown>;
  } catch (e: unknown) {
    throw new A2uiCatalogError(
      `Failed to parse JSON in common types schema file at ${paths.commonTypesPath}: ${(e as Error).message}`,
    );
  }

  const schemas: ProtocolSchemas = {serverToClient, commonTypes};
  _protocolSchemasMemoMap.set(normalized, schemas);
  return schemas;
}

/** @internal */
export function _clearProtocolSchemasMemoMapForTesting(): void {
  _protocolSchemasMemoMap.clear();
}
