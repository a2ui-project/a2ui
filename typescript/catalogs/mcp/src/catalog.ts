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

import {
  type Catalog,
  type FunctionImplementation,
  memoizeByValidator,
} from '@a2ui/web_core/catalog';
import type {JsonSchemaValidator} from '@a2ui/web_core/schema-engine';

import {type A2uiMcpApp, createMcpAppImplementation} from './components/mcp_app.js';
import {loadMcpCatalogApi} from './document.js';
import {createCallMcpToolImplementation} from './functions/callMcpTool.js';
import {createRegexCaptureImplementation} from './functions/regex_capture.js';
import {createSplitImplementation} from './functions/split.js';
import {createTransformDataImplementation} from './functions/transform_data.js';
import {createUpdateDataModelImplementation} from './functions/update_data_model.js';

export {MCP_CATALOG_DOCUMENT, MCP_CATALOG_ID, loadMcpCatalogApi} from './document.js';

/** The MCP catalog with the `McpApp` element and its function implementations. */
export type McpCatalog = Catalog<A2uiMcpApp, FunctionImplementation>;

/** The implementations of the MCP catalog's functions, by name. */
const FUNCTIONS: Readonly<
  Record<string, (validator: JsonSchemaValidator) => FunctionImplementation>
> = {
  callMcpTool: validator => createCallMcpToolImplementation(validator),
  transformData: createTransformDataImplementation,
  updateDataModel: createUpdateDataModelImplementation,
  split: createSplitImplementation,
  regexCapture: createRegexCaptureImplementation,
};

/**
 * Builds the A2UI MCP catalog (`catalogs/mcp/v1/catalog.json`): the `McpApp` component and the
 * `callMcpTool`, `transformData`, `updateDataModel`, `split` and `regexCapture` functions, with
 * `validator` checking their properties and arguments against the catalog document. Its
 * `callMcpTool` uses the configuration set with `configureMcpCatalog`. Memoised per validator.
 *
 * @param validator A JSON Schema validator, such as `createAjvValidator()` from
 *     `@a2ui/validator-ajv`.
 * @throws {A2uiConfigurationError} If `validator` is missing.
 */
export const createMcpCatalog: (validator: JsonSchemaValidator) => McpCatalog = memoizeByValidator(
  validator => {
    const api = loadMcpCatalogApi(validator);
    const functions = [...api.functions.keys()].map(name => {
      const implement = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
      if (!implement) {
        throw new Error(`The MCP catalog has no implementation of function '${name}'.`);
      }
      return implement(validator);
    });
    return api.withEntries<A2uiMcpApp, FunctionImplementation>(
      [createMcpAppImplementation(validator)],
      functions,
    );
  },
);
