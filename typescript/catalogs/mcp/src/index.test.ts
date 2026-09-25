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

import catalogJson from './catalog.json' with {type: 'json'};
import * as componentsEntry from './components/index.js';
import * as functionsEntry from './functions.js';
import {
  A2uiMcpApp,
  configureSandbox,
  createMcpCatalogFunctions,
  DATA_FUNCTIONS,
  MCP_CATALOG_ID,
  McpAppBridge,
  mcpCatalog,
  resetSandboxConfig,
  resolveSandboxUrl,
} from './index.js';

describe('@a2ui/catalog-mcp entry point', () => {
  afterEach(() => {
    resetSandboxConfig();
  });

  it('exposes the $id of the bundled catalog schema', () => {
    expect(MCP_CATALOG_ID).toBe(catalogJson['$id']);
    expect(Object.keys(catalogJson['components'])).toEqual(['McpApp']);
  });

  it('exposes the catalog with the McpApp component and the data functions', () => {
    expect(mcpCatalog.id).toBe(MCP_CATALOG_ID);
    expect([...mcpCatalog.components.values()]).toEqual([A2uiMcpApp]);
    expect([...mcpCatalog.functions.values()]).toEqual(DATA_FUNCTIONS);
  });

  it('exposes the sandbox configuration and the bridge', () => {
    configureSandbox({baseUrl: '/frames/'});
    expect(
      resolveSandboxUrl('html', {
        documentBase: 'https://app.example/',
        hostOrigin: 'https://app.example',
      }).pathname,
    ).toBe('/frames/sandbox.html');
    expect(typeof McpAppBridge).toBe('function');
  });

  it('exposes what the components entry point exposes', () => {
    expect(componentsEntry.A2uiMcpApp).toBe(A2uiMcpApp);
    expect(componentsEntry.McpAppBridge).toBe(McpAppBridge);
  });

  it('exposes what the functions entry point exposes', () => {
    expect(createMcpCatalogFunctions).toBe(functionsEntry.createMcpCatalogFunctions);
    expect(DATA_FUNCTIONS).toBe(functionsEntry.DATA_FUNCTIONS);
  });
});
