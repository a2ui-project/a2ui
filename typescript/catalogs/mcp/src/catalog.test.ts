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

import toolCallExample from '../../../../catalogs/mcp/examples/00_inline-tool-call.json' with {type: 'json'};
import dataBindingExample from '../../../../catalogs/mcp/examples/01_data-binding.json' with {type: 'json'};
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {
  isWebComponentImplementation,
  type WebComponentImplementation,
} from '@a2ui/web_core/v0_9/universal';
import catalogJson from './catalog.json' with {type: 'json'};
import {MCP_CATALOG_ID, mcpCatalog} from './catalog.js';
import {A2uiMcpApp} from './components/mcp_app.js';
import {CallMcpToolApi, DATA_FUNCTIONS} from './functions.js';
import {createComposedCatalog, parseExampleMessages} from './testing/frame_test_support.js';

describe('mcpCatalog', () => {
  it('is identified by the $id of the catalog schema', () => {
    expect(mcpCatalog.id).toBe(MCP_CATALOG_ID);
    expect(mcpCatalog.id).toBe(catalogJson['$id']);
  });

  it('implements every component of the catalog schema, and nothing else', () => {
    expect([...mcpCatalog.components.keys()]).toEqual(Object.keys(catalogJson['components']));
    expect(mcpCatalog.components.get('McpApp')).toBe(A2uiMcpApp);
  });

  it('implements every function of the catalog schema except callMcpTool', () => {
    const schemaFunctions = Object.keys(catalogJson['functions']).filter(
      name => name !== CallMcpToolApi.name,
    );
    expect([...mcpCatalog.functions.keys()].sort()).toEqual(schemaFunctions.sort());
    expect([...mcpCatalog.functions.values()]).toEqual(DATA_FUNCTIONS);
  });

  it('registers universal components with a2ui- prefixed tag names', () => {
    for (const component of mcpCatalog.components.values()) {
      expect(isWebComponentImplementation(component)).withContext(component.name).toBeTrue();
      expect(component.tagName)
        .withContext(component.name)
        .toMatch(/^a2ui-[a-z-]+$/);
    }
  });

  it('is enough on its own to process the messages of the tool call example', () => {
    const processor = new MessageProcessor<WebComponentImplementation>([mcpCatalog]);

    processor.processMessages(parseExampleMessages(toolCallExample));

    const surface = processor.model.getSurface('gallery-mcp-app-tool-call')!;
    expect(surface.catalog).toBe(mcpCatalog);
    expect(surface.componentsModel.get('root')?.type).toBe('McpApp');
    surface.dispose();
  });

  it('processes the data binding example once composed with the basic catalog', () => {
    const processor = new MessageProcessor<WebComponentImplementation>([createComposedCatalog()]);

    processor.processMessages(parseExampleMessages(dataBindingExample));

    const surface = processor.model.getSurface('gallery-mcp-app-data-binding')!;
    expect(surface.componentsModel.get('score_app')?.type).toBe('McpApp');
    expect(surface.componentsModel.get('name_field')?.type).toBe('TextField');
    expect(surface.dataModel.get('/player')).toEqual({name: 'Ada', score: 0});
    surface.dispose();
  });
});
