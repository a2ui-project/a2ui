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
 * These tests point the sandbox at an inert same-origin page and play the proxy and the
 * application themselves, in the JSON-RPC framing of the MCP Apps protocol. The scenarios under
 * `tests/` exercise the real proxy and a real application built on the App SDK.
 */

import example from '../../../../../catalogs/mcp/examples/01_data-binding.json' with {type: 'json'};
import {ErrorCode} from '@modelcontextprotocol/sdk/types.js';
import {PROXY_READY_NOTIFICATION, RESOURCE_READY_NOTIFICATION} from '../shared/sandbox/sandbox.js';
import {
  configureSandbox,
  resetSandboxConfig,
  resolveSandboxUrl,
} from '../shared/sandbox/sandbox_config.js';
import {
  catalogPropertyNames,
  FrameTestHarness,
  openFrameInbox,
  parseExampleMessages,
  postFromFrame,
  settle,
  waitFor,
  type FrameInbox,
} from '../testing/frame_test_support.js';
import {
  A2uiMcpApp,
  decodeHtmlContent,
  DEFAULT_MCP_APP_TITLE,
  MCP_APP_INNER_SANDBOX,
  McpAppApi,
} from './mcp_app.js';
import {
  DATA_MODEL_CHANGE_METHOD,
  DATA_MODEL_UPDATE_METHOD,
  DEFAULT_MCP_APP_HOST_INFO,
  FUNCTION_CALL_METHOD,
} from './mcp_app_bridge.js';

const SURFACE_ID = 'gallery-mcp-app-data-binding';
const COMPONENT_ID = 'score_app';
const SPLIT_SCHEMA = {
  type: 'object',
  properties: {value: {type: 'string'}, separator: {type: 'string'}},
  required: ['value', 'separator'],
  additionalProperties: false,
};

describe('McpApp', () => {
  let harness: FrameTestHarness;
  let inbox: FrameInbox | null;
  let nextId = 1;

  const exampleComponent = () => {
    const components = example.messages.flatMap(
      message => message.updateComponents?.components ?? [],
    );
    return components.find(component => component.id === COMPONENT_ID)!;
  };

  async function renderExample() {
    const element = await harness.renderComponent(COMPONENT_ID);
    const frame = element.querySelector('iframe')!;
    expect(frame).withContext('the frame is rendered').not.toBeNull();
    inbox = await openFrameInbox(frame, resolveSandboxUrl('html').href);
    return {element, frame, inbox};
  }

  /** Sends a JSON-RPC request from the app and returns its id. */
  function request(frame: HTMLIFrameElement, method: string, params: unknown): number {
    const id = nextId++;
    postFromFrame(frame, {jsonrpc: '2.0', id, method, params});
    return id;
  }

  function notify(frame: HTMLIFrameElement, method: string, params: unknown): void {
    postFromFrame(frame, {jsonrpc: '2.0', method, params});
  }

  /**
   * Plays the app's `ui/initialize` handshake and returns the result and the update the host
   * sends once the app reports initialized.
   */
  async function initializeApp(frame: HTMLIFrameElement, messages: FrameInbox) {
    const updatesBefore = messages.ofMethod(DATA_MODEL_UPDATE_METHOD).length;
    const id = request(frame, 'ui/initialize', {
      appInfo: {name: 'Score pad', version: '1.0.0'},
      appCapabilities: {availableDisplayModes: ['inline']},
      protocolVersion: '2026-01-26',
    });
    const response = await messages.response(id);
    notify(frame, 'ui/notifications/initialized', {});
    const update = await messages.next(DATA_MODEL_UPDATE_METHOD, updatesBefore);
    return {response, update};
  }

  beforeEach(() => {
    configureSandbox({baseUrl: '/a2ui-fixtures/inert/'});
    harness = new FrameTestHarness(SURFACE_ID, parseExampleMessages(example));
    inbox = null;
  });

  afterEach(() => {
    inbox?.dispose();
    harness.dispose();
    resetSandboxConfig();
  });

  it('declares exactly the properties of the catalog schema', () => {
    expect(Object.keys(McpAppApi.schema.shape).sort()).toEqual(catalogPropertyNames('McpApp'));
    expect(A2uiMcpApp.name).toBe('McpApp');
    expect(A2uiMcpApp.tagName).toBe('a2ui-mcp-app');
  });

  it('renders the HTML-mode proxy frame, titled after the component', async () => {
    const {element, frame} = await renderExample();

    expect(element.tagName.toLowerCase()).toBe('a2ui-mcp-app');
    expect(element.shadowRoot).toBeNull();
    expect(frame.src).toBe(resolveSandboxUrl('html').href);
    expect(frame.hasAttribute('sandbox')).toBeFalse();
    expect(frame.title).toBe('Score pad');
    expect(element.style.height).toBe('');
  });

  it('prefers the accessibility label as the frame title and falls back to a default', async () => {
    const {element, frame} = await renderExample();

    harness.updateComponent({...exampleComponent(), accessibility: {label: 'Points'}});
    await element.updateComplete;
    expect(frame.title).toBe('Points');

    harness.updateComponent({...exampleComponent(), title: undefined, accessibility: undefined});
    await element.updateComplete;
    expect(frame.title).toBe(DEFAULT_MCP_APP_TITLE);
  });

  it('answers the proxy with the markup and the scripts-only sandbox flags', async () => {
    const {frame, inbox: messages} = await renderExample();

    notify(frame, PROXY_READY_NOTIFICATION, {});

    const ready = await messages.next(RESOURCE_READY_NOTIFICATION);
    const html = ready.params!['html'] as string;
    expect(html).toContain('<button id="add">Add point</button>');
    expect(ready.params!['htmlContent']).toBe(html);
    expect(ready.params!['sandbox']).toBe(MCP_APP_INNER_SANDBOX);
    expect(ready.params!['sandbox']).not.toContain('allow-same-origin');
    expect(ready.params!['url']).toBeUndefined();
  });

  it('decodes url_encoded content and reloads when the content changes', async () => {
    const {element, frame, inbox: messages} = await renderExample();
    notify(frame, PROXY_READY_NOTIFICATION, {});
    await messages.next(RESOURCE_READY_NOTIFICATION);

    harness.updateComponent({
      ...exampleComponent(),
      htmlContent: `url_encoded:${encodeURIComponent('<p>Ünïcödé & <b>bold</b></p>')}`,
    });
    await element.updateComplete;

    const ready = await messages.next(RESOURCE_READY_NOTIFICATION, 1);
    expect(ready.params!['html']).toBe('<p>Ünïcödé & <b>bold</b></p>');
    expect(element.querySelector('iframe')).toBe(frame);
  });

  it('returns an empty string on malformed percent-encoding without throwing', () => {
    expect(decodeHtmlContent('url_encoded:%E0%A4%A')).toBe('');
  });

  it('loads nothing for empty content', async () => {
    const {element, frame, inbox: messages} = await renderExample();
    notify(frame, PROXY_READY_NOTIFICATION, {});
    await messages.next(RESOURCE_READY_NOTIFICATION);

    harness.updateComponent({...exampleComponent(), htmlContent: ''});
    await element.updateComplete;
    await settle();

    expect(messages.ofMethod(RESOURCE_READY_NOTIFICATION).length).toBe(1);
  });

  it('completes the MCP Apps handshake and pushes the bound data of the example', async () => {
    const {frame, inbox: messages} = await renderExample();

    const {response, update} = await initializeApp(frame, messages);

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({
      protocolVersion: '2026-01-26',
      hostInfo: DEFAULT_MCP_APP_HOST_INFO,
      hostCapabilities: {openLinks: {}, logging: {}, serverTools: {}},
      hostContext: {containerDimensions: {width: jasmine.any(Number), height: jasmine.any(Number)}},
    });
    expect(update.params).toEqual({key: 'player', value: {name: 'Ada', score: 0}});
  });

  it('dispatches allowed tool calls as actions of the component and rejects the rest', async () => {
    const {frame, inbox: messages} = await renderExample();
    await initializeApp(frame, messages);

    const allowed = request(frame, 'tools/call', {
      name: 'save_score',
      arguments: {name: 'Ada', score: 3},
    });
    const action = await harness.nextAction('save_score');
    expect(action.context).toEqual({name: 'Ada', score: 3});
    expect(action.sourceComponentId).toBe(COMPONENT_ID);
    expect(action.surfaceId).toBe(SURFACE_ID);
    expect((await messages.response(allowed)).result).toEqual({content: []});

    const denied = request(frame, 'tools/call', {name: 'delete_everything', arguments: {}});
    const rejection = await messages.response(denied);
    expect(rejection.error?.code).toBe(ErrorCode.InvalidParams);
    expect(rejection.error?.message).toContain("Tool 'delete_everything' is not allowed");
    await settle();
    expect(harness.actions.length).toBe(1);
  });

  it('writes data-model-change notifications to the bound path without echoing them', async () => {
    const {frame, inbox: messages} = await renderExample();
    await initializeApp(frame, messages);

    notify(frame, DATA_MODEL_CHANGE_METHOD, {key: 'player', subpath: '/score', value: 4});
    await waitFor(() => harness.surface.dataModel.get('/player/score') === 4, 'score written');

    notify(frame, DATA_MODEL_CHANGE_METHOD, {key: 'player', value: {name: 'Bob', score: 5}});
    await waitFor(() => harness.surface.dataModel.get('/player/name') === 'Bob', 'name written');

    await settle();
    expect(messages.ofMethod(DATA_MODEL_UPDATE_METHOD).length).toBe(1);
  });

  it('drops data changes for keys that are not bound or with forbidden subpaths', async () => {
    const {frame, inbox: messages} = await renderExample();
    await initializeApp(frame, messages);
    const warn = spyOn(console, 'warn');

    notify(frame, DATA_MODEL_CHANGE_METHOD, {key: 'other', value: 1});
    notify(frame, DATA_MODEL_CHANGE_METHOD, {
      key: 'player',
      subpath: '/__proto__',
      value: {admin: true},
    });
    await waitFor(() => warn.calls.count() === 2, 'two warnings logged');

    expect(harness.surface.dataModel.get('/other')).toBeUndefined();
    expect(harness.surface.dataModel.get('/player')).toEqual({name: 'Ada', score: 0});
  });

  it('pushes surface data changes to the app', async () => {
    const {frame, inbox: messages} = await renderExample();
    await initializeApp(frame, messages);

    harness.setData('/player/score', 7);
    const update = await messages.next(DATA_MODEL_UPDATE_METHOD, 1);
    expect(update.params).toEqual({key: 'player', subpath: '/score', value: 7});

    harness.setData('/player', {name: 'Cy', score: 9});
    await waitFor(
      () => messages.ofMethod(DATA_MODEL_UPDATE_METHOD).length === 4,
      'field updates received',
    );
    expect(
      messages
        .ofMethod(DATA_MODEL_UPDATE_METHOD)
        .slice(2)
        .map(m => m.params),
    ).toEqual(
      jasmine.arrayWithExactContents([
        {key: 'player', subpath: '/name', value: 'Cy'},
        {key: 'player', subpath: '/score', value: 9},
      ]),
    );
  });

  it('runs the catalog functions the app is allowed to call, with validated arguments', async () => {
    const {frame, inbox: messages} = await renderExample();
    await initializeApp(frame, messages);
    harness.updateComponent({...exampleComponent(), allowedFunctions: {split: SPLIT_SCHEMA}});

    const split = request(frame, FUNCTION_CALL_METHOD, {
      call: 'split',
      args: {value: 'a,b', separator: ','},
    });
    expect((await messages.response(split)).result).toEqual({
      status: 'success',
      result: ['a', 'b'],
    });

    const unlisted = request(frame, FUNCTION_CALL_METHOD, {call: 'jmespath', args: {}});
    expect((await messages.response(unlisted)).error?.code).toBe(ErrorCode.InvalidParams);

    const invalid = request(frame, FUNCTION_CALL_METHOD, {call: 'split', args: {value: 1}});
    const rejection = await messages.response(invalid);
    expect(rejection.error?.code).toBe(ErrorCode.InvalidParams);
    expect(rejection.error?.data).toEqual({errors: [jasmine.stringContaining('separator')]});
  });

  it('applies the size the app asks for', async () => {
    const {element, frame, inbox: messages} = await renderExample();
    await initializeApp(frame, messages);

    notify(frame, 'ui/notifications/size-changed', {height: 140});

    await waitFor(() => frame.style.height === '140px', 'frame resized');
    expect(element.style.height).toBe('140px');
  });

  it('ignores protocol messages that do not come from the frame', async () => {
    const {frame, inbox: messages} = await renderExample();
    await initializeApp(frame, messages);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {jsonrpc: '2.0', id: 99, method: 'tools/call', params: {name: 'save_score'}},
        origin: window.location.origin,
        source: window,
      }),
    );
    await settle();

    expect(harness.actions.length).toBe(0);
  });

  it('closes the bridge when the element is removed', async () => {
    const {frame, inbox: messages} = await renderExample();
    await initializeApp(frame, messages);

    harness.clear();
    postFromFrame(frame, {
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: {name: 'save_score', arguments: {}},
    });
    postFromFrame(frame, {
      jsonrpc: '2.0',
      method: DATA_MODEL_CHANGE_METHOD,
      params: {key: 'player', subpath: '/score', value: 3},
    });
    await settle();

    expect(harness.actions.length).toBe(0);
    expect(harness.surface.dataModel.get('/player/score')).toBe(0);
  });

  it('connects a fresh bridge when the content changes', async () => {
    const {element, frame, inbox: messages} = await renderExample();
    await initializeApp(frame, messages);

    harness.updateComponent({...exampleComponent(), htmlContent: '<p>Second app</p>'});
    await element.updateComplete;
    const {response, update} = await initializeApp(frame, messages);

    expect(response.error).toBeUndefined();
    expect(update.params).toEqual({key: 'player', value: {name: 'Ada', score: 0}});
    expect(messages.ofMethod(DATA_MODEL_UPDATE_METHOD).length).toBe(2);
  });
});
