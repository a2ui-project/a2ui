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

import {Catalog, type CatalogApi} from '@a2ui/web_core/catalog';
import type {JsonSchemaValidator} from '@a2ui/web_core/schema-engine';

import {memoizeByValidator} from './catalog_support.js';
import McpCatalogDocument from './catalog.json' with {type: 'json'};

/** The ID of the MCP catalog, as its published document declares it. */
export const MCP_CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json';

/** The published MCP catalog document (`catalogs/mcp/v1/catalog.json`). */
export const MCP_CATALOG_DOCUMENT: Readonly<Record<string, unknown>> = McpCatalogDocument;

/**
 * Loads the MCP catalog document as a schema-only catalog: the component and
 * function APIs, without their implementations. Memoised per validator.
 *
 * @param validator A JSON Schema validator, such as `createAjvValidator()`
 *   from `@a2ui/validator-ajv`.
 * @throws {A2uiConfigurationError} If `validator` is missing.
 */
export const loadMcpCatalogApi: (validator: JsonSchemaValidator) => CatalogApi = memoizeByValidator(
  validator => Catalog.fromJson(McpCatalogDocument, '1.0', MCP_CATALOG_ID, {validator}),
);

/**
 * Returns the API of the function `name` of the MCP catalog document.
 *
 * @throws {Error} If the document has no such function.
 */
export function mcpFunctionApi(validator: JsonSchemaValidator, name: string) {
  const api = loadMcpCatalogApi(validator).functions.get(name);
  if (!api) {
    throw new Error(`The MCP catalog document has no function '${name}'.`);
  }
  return api;
}
