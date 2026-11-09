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

import jsonToolResultExample from '../../../../catalogs/mcp/v1/examples/mcp-json-tool-result.json' with {type: 'json'};
import textToolResultExample from '../../../../catalogs/mcp/v1/examples/mcp-text-tool-result.json' with {type: 'json'};
import scene3dExample from '../../../../catalogs/mcp/v1/examples/mcp-app-3d-geometry.json' with {type: 'json'};
import {
  DataContext,
  isWebComponentImplementation,
  MessageProcessor,
  type WebComponentImplementation,
} from '@a2ui/web_core/v1_0';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import catalogJson from './catalog.json' with {type: 'json'};
import {MCP_CATALOG_ID, mcpCatalog} from './catalog.js';
import {A2uiMcpApp} from './components/mcp_app.js';
import {CallMcpToolImplementation, type McpToolClient} from './functions/callMcpTool.js';
import {TransformDataImplementation} from './functions/transform_data.js';
import {RegexCaptureImplementation} from './functions/regex_capture.js';
import {SplitImplementation} from './functions/split.js';
import {UpdateDataModelImplementation} from './functions/update_data_model.js';
import {configureMcpCatalog, resetMcpCatalogConfig} from './mcp_catalog_config.js';
import {EXAMPLE_CATALOGS, parseExampleMessages} from './testing/frame_test_support.js';

/**
 * An MCP client whose only tool returns `result`, the shape of a headless tool, recording the calls
 * it receives.
 */
function createToolClient(result: CallToolResult): McpToolClient & {
  readonly calls: Array<{name: string; arguments: unknown}>;
} {
  const calls: Array<{name: string; arguments: unknown}> = [];
  return {
    calls,
    request: (async (request: {params: {name: string; arguments: unknown}}) => {
      calls.push({name: request.params.name, arguments: request.params.arguments});
      return result;
    }) as McpToolClient['request'],
    readResource: async () => ({contents: []}),
    listTools: async () => ({tools: []}),
  };
}

/** Reads the `action` of the component `id` from the last `updateComponents` of `example`. */
function actionOf(example: {readonly messages: readonly unknown[]}, id: string): unknown {
  for (const message of example.messages as ReadonlyArray<{
    updateComponents?: {components: ReadonlyArray<{id: string; action?: unknown}>};
  }>) {
    for (const component of message.updateComponents?.components ?? []) {
      if (component.id === id) {
        return component.action;
      }
    }
  }
  throw new Error(`No component '${id}' in the example.`);
}

const toolCallExample = {
  messages: [
    {
      version: '1.0',
      createSurface: {
        surfaceId: 'gallery-mcp-app-tool-call',
        catalogId: 'https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json',
      },
    },
    {
      version: '1.0',
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
      version: '1.0',
      createSurface: {
        surfaceId: 'gallery-mcp-app-data-binding',
        catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
      },
    },
    {
      version: '1.0',
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
      version: '1.0',
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
    expect(mcpCatalog.functions.get('transformData')).toBe(TransformDataImplementation);
    expect(mcpCatalog.functions.get('updateDataModel')).toBe(UpdateDataModelImplementation);
    expect(mcpCatalog.functions.get('split')).toBe(SplitImplementation);
    expect(mcpCatalog.functions.get('regexCapture')).toBe(RegexCaptureImplementation);
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

  it('processes the 3D geometry showcase example next to the basic catalog', () => {
    const processor = new MessageProcessor<WebComponentImplementation>([...EXAMPLE_CATALOGS]);
    processor.processMessages(parseExampleMessages(scene3dExample));
    const surface = processor.model.getSurface('gallery-mcp-app-3d-geometry')!;
    expect(surface).toBeDefined();
    expect(surface.componentsModel.get('scene3d_app')?.type).toBe('McpApp');
    expect(surface.componentsModel.get('scene3d_context_text')?.type).toBe('Text');
    surface.dispose();
  });

  describe('the JSON tool result example', () => {
    const issues = [
      {number: 12, title: 'Button ignores variant', state: 'open', labels: ['bug']},
      {number: 9, title: 'Add a date picker', state: 'closed', labels: []},
      {number: 15, title: 'Document catalogId on calls', state: 'open', labels: ['docs']},
    ];
    let processor: MessageProcessor<WebComponentImplementation>;
    let client: ReturnType<typeof createToolClient>;
    let errors: unknown[];

    beforeEach(() => {
      processor = new MessageProcessor<WebComponentImplementation>([...EXAMPLE_CATALOGS]);
      // The tool sends the issues both as JSON text and as structured content.
      client = createToolClient({
        content: [{type: 'text', text: JSON.stringify(issues)}],
        structuredContent: {issues},
      });
      configureMcpCatalog({getMcpClientForTool: () => client, processor});
      errors = [];
      processor.processMessages(parseExampleMessages(jsonToolResultExample));
      processor.model.getSurface('gallery-mcp-json-tool-result')!.onError.subscribe(error => {
        errors.push(error);
      });
    });

    afterEach(() => {
      processor.model.getSurface('gallery-mcp-json-tool-result')?.dispose();
      resetMcpCatalogConfig();
    });

    it('processes next to the basic catalog, with the list bound to /issues', () => {
      const surface = processor.model.getSurface('gallery-mcp-json-tool-result')!;
      expect(surface.componentsModel.get('load_button')?.type).toBe('Button');
      expect(surface.componentsModel.get('issue_list')?.type).toBe('Column');
      expect(surface.dataModel.get('/issues')).toEqual([]);
      expect(errors).toEqual([]);
    });

    it('runs the first button action: the json of the payload is shaped and written to /issues', async () => {
      const surface = processor.model.getSurface('gallery-mcp-json-tool-result')!;
      const context = new DataContext(surface, '/');

      await context.resolveAction(
        actionOf(jsonToolResultExample, 'load_button') as Record<string, unknown>,
      );

      expect(client.calls).toEqual([
        {name: 'list_issues', arguments: {repository: 'a2ui-project/a2ui'}},
      ]);
      expect(surface.dataModel.get('/issues')).toEqual([
        {number: '12', title: 'Button ignores variant'},
        {number: '15', title: 'Document catalogId on calls'},
      ]);
      expect(errors).toEqual([]);
    });

    it('runs the second button action: the payload is written to /issueResponse', async () => {
      const surface = processor.model.getSurface('gallery-mcp-json-tool-result')!;
      const context = new DataContext(surface, '/');

      await context.resolveAction(
        actionOf(jsonToolResultExample, 'load_all_button') as Record<string, unknown>,
      );

      expect(surface.dataModel.get('/issueResponse/toolName')).toBe('list_issues');
      expect(surface.dataModel.get('/issueResponse/toolInput')).toEqual({
        repository: 'a2ui-project/a2ui',
      });
      expect(surface.dataModel.get('/issueResponse/structuredContent/issues')).toEqual(issues);
      expect(surface.dataModel.get('/issueResponse/json')).toEqual(issues);
      expect(errors).toEqual([]);
    });
  });

  describe('the text tool result example', () => {
    // The shape of a Tavily search result: a header, then one record per result.
    const searchOutput = [
      'Detailed Results:',
      'Title: A2UI protocol\nURL: https://a2ui.org\nContent: Agent-to-user interface.',
      'Title: A2UI on GitHub\nURL: https://github.com/a2ui-project/a2ui\nContent: Source code.',
    ].join('\n\n');
    let processor: MessageProcessor<WebComponentImplementation>;
    let client: ReturnType<typeof createToolClient>;
    let errors: unknown[];

    beforeEach(() => {
      processor = new MessageProcessor<WebComponentImplementation>([...EXAMPLE_CATALOGS]);
      client = createToolClient({content: [{type: 'text', text: searchOutput}]});
      configureMcpCatalog({getMcpClientForTool: () => client, processor});
      errors = [];
      processor.processMessages(parseExampleMessages(textToolResultExample));
      processor.model.getSurface('gallery-mcp-text-tool-result')!.onError.subscribe(error => {
        errors.push(error);
      });
    });

    afterEach(() => {
      processor.model.getSurface('gallery-mcp-text-tool-result')?.dispose();
      resetMcpCatalogConfig();
    });

    it('processes next to the basic catalog, with the list bound to /results', () => {
      const surface = processor.model.getSurface('gallery-mcp-text-tool-result')!;
      expect(surface.componentsModel.get('search_button')?.type).toBe('Button');
      expect(surface.componentsModel.get('result_list')?.type).toBe('Column');
      expect(surface.dataModel.get('/results')).toEqual([]);
      expect(errors).toEqual([]);
    });

    it('runs the button action: the records are split, captured, shaped and written to /results', async () => {
      const surface = processor.model.getSurface('gallery-mcp-text-tool-result')!;
      const context = new DataContext(surface, '/');

      await context.resolveAction(
        actionOf(textToolResultExample, 'search_button') as Record<string, unknown>,
      );

      expect(client.calls).toEqual([{name: 'tavily-search', arguments: {query: 'A2UI protocol'}}]);
      expect(surface.dataModel.get('/results')).toEqual([
        {title: 'A2UI protocol', url: 'https://a2ui.org'},
        {title: 'A2UI on GitHub', url: 'https://github.com/a2ui-project/a2ui'},
      ]);
      expect(errors).toEqual([]);
    });
  });
});
