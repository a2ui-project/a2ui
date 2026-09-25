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

import {IFRAME_CATALOG_ID} from '@a2ui/catalog-iframe';
import {MCP_CATALOG_ID} from '@a2ui/catalog-mcp';
import {basicCatalog, LitComponentApi} from '@a2ui/lit/v0_9';
import {Catalog, DataContext, MessageProcessor} from '@a2ui/web_core/v0_9';
import {createDemoCatalogs} from '../src/demo-catalogs';

describe('createDemoCatalogs', () => {
  let catalogs: Catalog<LitComponentApi>[];
  let processor: MessageProcessor<LitComponentApi>;
  let iframe: Catalog<LitComponentApi>;
  let mcp: Catalog<LitComponentApi>;

  beforeEach(() => {
    catalogs = [basicCatalog];
    processor = new MessageProcessor(catalogs);
    catalogs.push(...createDemoCatalogs(processor));
    [iframe, mcp] = catalogs.slice(1);
  });

  it('registers one catalog per example catalog id', () => {
    expect(processor.getClientCapabilities()['v0.9']?.supportedCatalogIds).toEqual([
      basicCatalog.id,
      IFRAME_CATALOG_ID,
      MCP_CATALOG_ID,
    ]);
  });

  it('composes the iframe catalog from the basic and frame components', () => {
    expect([...iframe.components.keys()]).toEqual([
      ...basicCatalog.components.keys(),
      'WebAppFrameUrl',
      'WebAppFrameSrcdoc',
    ]);
    expect([...iframe.functions.keys()]).toEqual([...basicCatalog.functions.keys()]);
  });

  it('composes the MCP catalog from the basic components, McpApp and the MCP functions', () => {
    expect([...mcp.components.keys()]).toEqual([...basicCatalog.components.keys(), 'McpApp']);
    expect([...mcp.functions.keys()]).toEqual([
      ...basicCatalog.functions.keys(),
      'callMcpTool',
      'jmespath',
      'split',
      'regexCapture',
      'regexReplace',
      'updateDataModel',
    ]);
  });

  it('rejects MCP tool calls with a message that names the missing server', async () => {
    const surfaceId = 'demo-catalogs-test';
    processor.processMessages([
      {version: 'v0.9', createSurface: {surfaceId, catalogId: MCP_CATALOG_ID}},
    ]);
    const surface = processor.model.getSurface(surfaceId);
    if (surface === undefined) {
      throw new Error(`Surface ${surfaceId} was not created.`);
    }
    const context = new DataContext(surface, '/');

    await expectAsync(
      (async () => mcp.invoker('callMcpTool', {name: 'save_score'}, context))(),
    ).toBeRejectedWithError(/not connected to an MCP server.*'save_score'/);

    processor.processMessages([{version: 'v0.9', deleteSurface: {surfaceId}}]);
  });
});
