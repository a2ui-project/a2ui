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

import * as assert from 'node:assert';
import {afterEach, describe, it} from 'node:test';

import {SurfaceHarnessError, createSurfaceHarness, type SurfaceHarness} from '@a2ui/testing';
import type {A2uiMessage} from '@a2ui/web_core/v0_9';

import {A2UI_MIME_TYPE} from '../functions/callMcpTool.js';
import recipeCard from './fixtures/recipe_card.json' with {type: 'json'};
import recipeForm from './fixtures/recipe_form.json' with {type: 'json'};
import {
  BASIC_WITH_MCP_CATALOG_ID,
  createStubMcpClient,
  stubMcp,
  type StubMcpClient,
} from './index.js';

const RECIPE_CARD_URI = 'a2ui://recipe-card';

/** Issues a `tools/call` the way `callMcpTool` does. */
const callTool = (client: StubMcpClient, name: string, args?: Record<string, unknown>) =>
  client.request(
    {method: 'tools/call', params: {name, arguments: args}} as Parameters<
      StubMcpClient['request']
    >[0],
    undefined as unknown as Parameters<StubMcpClient['request']>[1],
  );

/** Wraps `updateDataModel` messages in the embedded resource a tool result carries. */
const a2uiBlock = (messages: unknown[]) => ({
  type: 'resource' as const,
  resource: {uri: 'a2ui://inline', mimeType: A2UI_MIME_TYPE, text: JSON.stringify(messages)},
});

/** A list whose rows each call the tool named by the row. */
const listPayload = [
  {version: 'v0.9', createSurface: {surfaceId: 'files', catalogId: BASIC_WITH_MCP_CATALOG_ID}},
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: 'files',
      path: '/',
      value: {
        entries: [
          {name: 'a.md', tool: 'read_text_file'},
          {name: 'docs', tool: 'list_directory'},
        ],
      },
    },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'files',
      components: [
        {id: 'root', component: 'List', children: {componentId: 'entry_button', path: '/entries'}},
        {
          id: 'entry_button',
          component: 'Button',
          child: 'entry_name',
          action: {
            functionCall: {
              call: 'callMcpTool',
              args: {name: {path: 'tool'}, arguments: {file: {path: 'name'}}},
            },
          },
        },
        {id: 'entry_name', component: 'Text', text: {path: 'name'}},
      ],
    },
  },
] as unknown as A2uiMessage[];

describe('createStubMcpClient', () => {
  it('answers tools/call from the stub and records the call', async () => {
    const client = createStubMcpClient({tools: {ping: 'pong', echo: args => args}});

    const text = await callTool(client, 'ping');
    const json = await callTool(client, 'echo', {a: 1});

    assert.deepStrictEqual(text, {content: [{type: 'text', text: 'pong'}]});
    assert.deepStrictEqual(json, {content: [{type: 'text', text: '{"a":1}'}]});
    assert.deepStrictEqual(client.calls, [
      {name: 'ping', arguments: {}},
      {name: 'echo', arguments: {a: 1}},
    ]);
  });

  it('serves resources as application/a2ui+json and lists tools with their meta', async () => {
    const client = createStubMcpClient({
      tools: {get_card: {content: []}},
      resources: {[RECIPE_CARD_URI]: [{createSurface: {surfaceId: 'c'}}] as A2uiMessage[]},
      toolMeta: {get_card: {ui: {resourceUri: RECIPE_CARD_URI}}},
    });

    const resource = await client.readResource({uri: RECIPE_CARD_URI});
    const {tools} = await client.listTools();

    assert.deepStrictEqual(resource.contents[0].mimeType, A2UI_MIME_TYPE);
    assert.deepStrictEqual(JSON.parse((resource.contents[0] as {text: string}).text), [
      {createSurface: {surfaceId: 'c'}},
    ]);
    assert.deepStrictEqual(client.reads, [RECIPE_CARD_URI]);
    assert.deepStrictEqual(tools[0]._meta, {ui: {resourceUri: RECIPE_CARD_URI}});
  });

  it('rejects unstubbed tools and resources by name', async () => {
    const client = createStubMcpClient();

    await assert.rejects(() => callTool(client, 'nope'), /Unstubbed MCP tool 'nope'/);
    await assert.rejects(() => client.readResource({uri: 'a2ui://nope'}), /Unstubbed MCP resource/);
  });

  it('reports pending work until every request has been answered', async () => {
    let release!: () => void;
    const client = createStubMcpClient({
      tools: {slow: () => new Promise<string>(resolve => (release = () => resolve('done')))},
    });

    const call = callTool(client, 'slow');
    assert.strictEqual(client.pending(), true);
    release();
    await client.settle();
    assert.strictEqual(client.pending(), false);
    await call;
  });
});

describe('stubMcp with createSurfaceHarness', () => {
  let h: SurfaceHarness | undefined;

  afterEach(() => {
    h?.dispose();
    h = undefined;
  });

  it('runs the recipe sample: form, tool call, and the card the tool names', async () => {
    const mcp = stubMcp({
      tools: {
        get_recipe_a2ui: args => ({
          content: [
            {type: 'text', text: 'Generated a recipe.'},
            a2uiBlock([
              {
                updateDataModel: {
                  surfaceId: 'recipe-card',
                  path: '/',
                  value: {
                    title: `${args['cookingStyle']} ${args['protein']}`,
                    rating: '4.8',
                    cookTime: '25 min',
                  },
                },
              },
            ]),
          ],
          _meta: {ui: {resourceUri: RECIPE_CARD_URI}},
        }),
      },
      resources: {[RECIPE_CARD_URI]: recipeCard as unknown as A2uiMessage[]},
    });
    h = await createSurfaceHarness({
      messages: recipeForm as unknown as A2uiMessage[],
      plugins: [mcp],
    });

    assert.deepStrictEqual(h.surfaces(), ['recipe-form']);
    assert.strictEqual(h.prop('title', 'text'), 'Customize Your Recipe');

    await h.setValue('cooking-style-picker', ['Grilled']);
    await h.setValue('protein-picker', ['Tofu']);
    await h.click('submit-button');

    assert.deepStrictEqual(mcp.calls, [
      {name: 'get_recipe_a2ui', arguments: {cookingStyle: ['Grilled'], protein: ['Tofu']}},
    ]);
    assert.deepStrictEqual(mcp.reads, [RECIPE_CARD_URI]);
    assert.deepStrictEqual(h.surfaces(), ['recipe-form', 'recipe-card']);
    assert.strictEqual(h.data('/title', 'recipe-card'), 'Grilled Tofu');
    assert.strictEqual(h.prop('title', 'text', {surfaceId: 'recipe-card'}), 'Grilled Tofu');
    assert.strictEqual(h.prop('cook-text', 'text', {surfaceId: 'recipe-card'}), '25 min');
    assert.ok(h.rendered('cook-text', {surfaceId: 'recipe-card'}));
    assert.deepStrictEqual(h.errors, []);
  });

  it('resolves the tool name and arguments from the clicked row', async () => {
    const mcp = stubMcp({tools: {read_text_file: 'contents', list_directory: 'listing'}});
    h = await createSurfaceHarness({messages: listPayload, plugins: [mcp]});

    await h.click('entry_button', {scope: '/entries/1'});

    assert.deepStrictEqual(mcp.calls, [{name: 'list_directory', arguments: {file: 'docs'}}]);
  });

  it('applies a UI resource the tool declares in tools/list', async () => {
    const mcp = stubMcp({
      tools: {
        read_text_file: {
          content: [
            a2uiBlock([{updateDataModel: {surfaceId: 'card', path: '/', value: {body: 'hello'}}}]),
          ],
        },
      },
      resources: {
        'a2ui://card': [
          {createSurface: {surfaceId: 'card', catalogId: BASIC_WITH_MCP_CATALOG_ID}},
          {
            updateComponents: {
              surfaceId: 'card',
              components: [{id: 'root', component: 'Text', text: {path: '/body'}}],
            },
          },
        ] as unknown as A2uiMessage[],
      },
      toolMeta: {read_text_file: {ui: {resourceUri: 'a2ui://card'}}},
    });
    h = await createSurfaceHarness({messages: listPayload, plugins: [mcp]});

    await h.click('entry_button', {scope: '/entries/0'});

    assert.deepStrictEqual(mcp.reads, ['a2ui://card']);
    assert.strictEqual(h.prop('root', 'text', {surfaceId: 'card'}), 'hello');
  });

  it('fails a click that calls a tool the test did not stub', async () => {
    const mcp = stubMcp();
    h = await createSurfaceHarness({messages: listPayload, plugins: [mcp]});

    await assert.rejects(
      () => h!.click('entry_button', {scope: '/entries/0'}),
      (error: unknown) => {
        assert.ok(error instanceof SurfaceHarnessError);
        assert.match(error.message, /click\('entry_button'\)/);
        assert.match(error.message, /Unstubbed MCP tool 'read_text_file'/);
        return true;
      },
    );
    assert.strictEqual(h.errors.length, 1);
    assert.strictEqual(h.errors[0].code, 'EXPRESSION_ERROR');
    assert.deepStrictEqual(mcp.calls, [{name: 'read_text_file', arguments: {file: 'a.md'}}]);
  });

  it('fails a click whose tool answers isError', async () => {
    const mcp = stubMcp({
      tools: {read_text_file: {isError: true, content: [{type: 'text', text: 'denied'}]}},
    });
    h = await createSurfaceHarness({messages: listPayload, plugins: [mcp]});

    await assert.rejects(() => h!.click('entry_button', {scope: '/entries/0'}), /denied/);
  });
});
