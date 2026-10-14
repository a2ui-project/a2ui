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

import scene3dExample from '../../../../catalogs/mcp/v1/examples/mcp-app-3d-geometry.json' with {type: 'json'};
import orderSummaryExample from '../../../../catalogs/mcp/v1/examples/mcp-app-order-summary.json' with {type: 'json'};
import sheetMusicExample from '../../../../catalogs/mcp/v1/examples/mcp-app-sheet-music.json' with {type: 'json'};
import {
  isWebComponentImplementation,
  MessageProcessor,
  type WebComponentImplementation,
} from '@a2ui/web_core/v1_0';
import catalogJson from './catalog.json' with {type: 'json'};
import {MCP_CATALOG_ID, mcpCatalog} from './catalog.js';
import {A2uiMcpApp} from './components/mcp_app.js';
import {CallMcpToolImplementation} from './functions/callMcpTool.js';
import {EXAMPLE_CATALOGS, parseExampleMessages} from './testing/frame_test_support.js';

const toolCallExample = {
  messages: [
    {
      version: 'v1.0',
      createSurface: {
        surfaceId: 'gallery-mcp-app-tool-call',
        catalogId: 'https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json',
      },
    },
    {
      version: 'v1.0',
      updateComponents: {
        surfaceId: 'gallery-mcp-app-tool-call',
        components: [
          {
            id: 'root',
            component: 'McpApp',
            title: 'Feedback form',
            allowedTools: ['submit_feedback'],
            htmlContent: '<!doctype html><html><body><p>Feedback</p></body></html>',
          },
        ],
      },
    },
  ],
};

const dataBindingExample = {
  messages: [
    {
      version: 'v1.0',
      createSurface: {
        surfaceId: 'gallery-mcp-app-data-binding',
        catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
      },
    },
    {
      version: 'v1.0',
      updateDataModel: {
        surfaceId: 'gallery-mcp-app-data-binding',
        value: {
          player: {
            name: 'Ada',
            score: 0,
          },
        },
      },
    },
    {
      version: 'v1.0',
      updateComponents: {
        surfaceId: 'gallery-mcp-app-data-binding',
        components: [
          {
            id: 'root',
            component: 'Column',
            children: ['name_field', 'score_app'],
          },
          {
            id: 'name_field',
            component: 'TextField',
            label: 'Player name',
            value: {
              '@path': '/player/name',
            },
          },
          {
            id: 'score_app',
            component: 'McpApp',
            catalogId: 'https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json',
            title: 'Score pad',
            allowedTools: ['save_score'],
            data: {
              paths: {
                player: '/player',
              },
            },
            htmlContent: '<!doctype html><html><body><p>Score</p></body></html>',
          },
        ],
      },
    },
  ],
};

describe('mcpCatalog', () => {
  it('is identified by the $id of the catalog schema', () => {
    expect(mcpCatalog.id).toBe(MCP_CATALOG_ID);
    expect(mcpCatalog.id).toBe(catalogJson['$id']);
  });

  it('implements every component of the catalog schema, and nothing else', () => {
    expect([...mcpCatalog.components.keys()]).toEqual(Object.keys(catalogJson['components']));
    expect(mcpCatalog.components.get('McpApp')).toBe(A2uiMcpApp);
  });

  it('implements every function of the catalog schema, and nothing else', () => {
    expect([...mcpCatalog.functions.keys()].sort()).toEqual(
      Object.keys(catalogJson['functions']).sort(),
    );
    expect(mcpCatalog.functions.get('callMcpTool')).toBe(CallMcpToolImplementation);
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

  it('processes the data binding example next to the basic catalog', () => {
    const processor = new MessageProcessor<WebComponentImplementation>([...EXAMPLE_CATALOGS]);

    processor.processMessages(parseExampleMessages(dataBindingExample));

    const surface = processor.model.getSurface('gallery-mcp-app-data-binding')!;
    expect(surface.componentsModel.get('score_app')?.type).toBe('McpApp');
    expect(surface.componentsModel.get('name_field')?.type).toBe('TextField');
    expect(surface.dataModel.get('/player')).toEqual({name: 'Ada', score: 0});
    surface.dispose();
  });

  it('processes all showcase examples next to the basic catalog', () => {
    const processor = new MessageProcessor<WebComponentImplementation>([...EXAMPLE_CATALOGS]);
    const cases = [
      {
        example: orderSummaryExample,
        surfaceId: 'gallery-mcp-app-order-summary',
        appId: 'order_app',
      },
      {example: sheetMusicExample, surfaceId: 'gallery-mcp-app-sheet-music', appId: 'music_app'},
      {example: scene3dExample, surfaceId: 'gallery-mcp-app-3d-geometry', appId: 'scene3d_app'},
    ];

    for (const {example, surfaceId, appId} of cases) {
      processor.processMessages(parseExampleMessages(example));
      const surface = processor.model.getSurface(surfaceId)!;
      expect(surface).withContext(surfaceId).toBeDefined();
      expect(surface.componentsModel.get(appId)?.type).withContext(appId).toBe('McpApp');
      surface.dispose();
    }
  });
});
