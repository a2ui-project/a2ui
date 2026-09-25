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

/**
 * Smoke test of the `@a2ui/catalog-mcp/functions` entry point as a Node agent consumes it: the
 * built package is imported by its published name, in a process without a DOM.
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import * as functions from '@a2ui/catalog-mcp/functions';
import {
  createMcpCatalogFunctions,
  DATA_FUNCTIONS,
  MCP_CATALOG_ID,
  type McpClientResolver,
} from '@a2ui/catalog-mcp/functions';

describe('@a2ui/catalog-mcp/functions', () => {
  it('loads without a DOM', () => {
    assert.equal(typeof window, 'undefined');
    assert.equal(typeof document, 'undefined');
    assert.equal(
      MCP_CATALOG_ID,
      'https://a2ui.org/specification/v0_9/catalogs/mcp/mcp_catalog.json',
    );
  });

  it('exposes the catalog id, the functions and their factories', () => {
    assert.deepEqual(Object.keys(functions).sort(), [
      'A2UI_MIME_TYPE',
      'CallMcpToolApi',
      'DATA_FUNCTIONS',
      'DATA_FUNCTION_APIS',
      'JmespathApi',
      'JmespathImplementation',
      'MCP_CATALOG_ID',
      'RegexCaptureApi',
      'RegexCaptureImplementation',
      'RegexReplaceApi',
      'RegexReplaceImplementation',
      'SplitApi',
      'SplitImplementation',
      'UpdateDataModelApi',
      'UpdateDataModelImplementation',
      'createCallMcpToolImplementation',
      'createMcpCatalogFunctions',
      'isThenable',
    ]);
    assert.deepEqual(
      DATA_FUNCTIONS.map(fn => fn.name),
      ['jmespath', 'split', 'regexCapture', 'regexReplace', 'updateDataModel'],
    );
  });

  it('builds the full function list around a host MCP client resolver', () => {
    const resolver: McpClientResolver = () => null;
    const all = createMcpCatalogFunctions(resolver, new MessageProcessor([]));
    assert.deepEqual(
      all.map(fn => fn.name),
      ['callMcpTool', 'jmespath', 'split', 'regexCapture', 'regexReplace', 'updateDataModel'],
    );
  });
});
