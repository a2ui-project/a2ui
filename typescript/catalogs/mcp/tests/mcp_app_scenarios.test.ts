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
 * Real-frame scenarios. The component loads the real sandbox proxy from `/a2ui-sandbox/`, which
 * Karma serves from `dist/sandbox/`, and a real MCP App built on the App SDK,
 * `fixtures/apps/test_app.ts`, bundled into `fixtures/generated/` and inlined into the
 * component's `htmlContent`. The app reports what it observes through tool calls and takes its
 * commands from the data model, so the tests never reach into the sandboxed frame; see the
 * fixture for the commands.
 */

import type {A2uiClientAction} from '@a2ui/web_core/v0_9';
import {ErrorCode} from '@modelcontextprotocol/sdk/types.js';
import {MCP_CATALOG_ID} from '../src/catalog.js';
import {MCP_APP_INNER_SANDBOX} from '../src/components/mcp_app.js';
import {DEFAULT_MCP_APP_HOST_INFO} from '../src/components/mcp_app_bridge.js';
import {resetSandboxConfig, resolveSandboxUrl} from '../src/shared/sandbox/sandbox_config.js';
import {
  FrameTestHarness,
  innerFrameOf,
  parseExampleMessages,
  settle,
  waitFor,
} from '../src/testing/frame_test_support.js';

const SURFACE_ID = 'mcp-app-scenarios';
const COMPONENT_ID = 'app';
const APP_SCRIPT_URL = new URL('/a2ui-fixtures/generated/test_app.js', window.location.origin).href;

/** The tools the fixture application reports through, plus one the tests call on purpose. */
const ALLOWED_TOOLS = [
  'app_ready',
  'data_seen',
  'tool_result',
  'function_result',
  'navigate_top_result',
  'unknown_command',
  'saved',
];

const SPLIT_SCHEMA = {
  type: 'object',
  properties: {value: {type: 'string'}, separator: {type: 'string'}},
  required: ['value', 'separator'],
  additionalProperties: false,
};

function appHtml(script: string): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head><meta charset="utf-8" /><title>Test app</title></head>',
    `<body><script>${script}</script></body>`,
    '</html>',
  ].join('\n');
}

function surfaceMessages(html: string) {
  return parseExampleMessages({
    messages: [
      {version: 'v0.9', createSurface: {surfaceId: SURFACE_ID, catalogId: MCP_CATALOG_ID}},
      {
        version: 'v0.9',
        updateDataModel: {surfaceId: SURFACE_ID, value: {counter: {count: 1, label: 'clicks'}}},
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: SURFACE_ID,
          components: [
            {
              id: COMPONENT_ID,
              component: 'McpApp',
              title: 'Scenario app',
              htmlContent: html,
              allowedTools: ALLOWED_TOOLS,
              allowedFunctions: {split: SPLIT_SCHEMA},
              data: {
                paths: {count: '/counter/count', label: '/counter/label', command: '/command'},
              },
            },
          ],
        },
      },
    ],
  });
}

describe('McpApp with the real sandbox proxy and an App SDK application', () => {
  let html: string;
  let harness: FrameTestHarness;
  let commandSequence = 0;
  const pageHref = window.location.href;

  beforeAll(async () => {
    const response = await fetch(APP_SCRIPT_URL);
    expect(response.ok).withContext('fixture app bundle served').toBeTrue();
    const script = await response.text();
    expect(script).not.toContain('</script>');
    html = appHtml(script);
  });

  afterEach(() => {
    harness.dispose();
    resetSandboxConfig();
  });

  /** Sends a command to the application by writing it to the bound `command` path. */
  function command(payload: Record<string, unknown>): void {
    harness.setData('/command', JSON.stringify({...payload, seq: ++commandSequence}));
  }

  /** Waits for a reported action whose context matches `expected`. */
  async function reported(
    name: string,
    expected: Record<string, unknown>,
  ): Promise<A2uiClientAction> {
    const matches = (action: A2uiClientAction) =>
      Object.entries(expected).every(
        ([key, value]) => JSON.stringify(action.context[key]) === JSON.stringify(value),
      );
    await waitFor(
      () => harness.actionsNamed(name).some(matches),
      `${name} reported with ${JSON.stringify(expected)}`,
    );
    return harness.actionsNamed(name).find(matches)!;
  }

  async function startApp() {
    harness = new FrameTestHarness(SURFACE_ID, surfaceMessages(html));
    const element = await harness.renderComponent(COMPONENT_ID);
    const frame = element.querySelector('iframe')!;
    const ready = await harness.nextAction('app_ready');
    return {element, frame, ready};
  }

  it('boots the application through the proxy and completes the handshake', async () => {
    const {frame, ready} = await startApp();

    expect(frame.src).toBe(resolveSandboxUrl('html').href);
    expect(frame.hasAttribute('sandbox')).toBeFalse();
    expect(ready.surfaceId).toBe(SURFACE_ID);
    expect(ready.sourceComponentId).toBe(COMPONENT_ID);
    expect(ready.context['hostInfo']).toEqual(DEFAULT_MCP_APP_HOST_INFO);
    expect(ready.context['hostCapabilities']).toEqual({
      openLinks: {},
      logging: {},
      serverTools: {},
    });
    expect(ready.context['hostContext']).toEqual({
      containerDimensions: {width: jasmine.any(Number), height: jasmine.any(Number)},
    });
    expect(ready.context['location']).toEqual({href: 'about:srcdoc'});
    expect(ready.context['sandboxed']).toBeTrue();
  });

  it('sends the bound data once the application is initialized', async () => {
    await startApp();

    await reported('data_seen', {key: 'count', value: 1});
    await reported('data_seen', {key: 'label', value: 'clicks'});
  });

  it('runs the application in an inner frame with scripts only', async () => {
    const {frame} = await startApp();

    const inner = innerFrameOf(frame)!;
    expect(inner).not.toBeNull();
    expect(inner.getAttribute('sandbox')).toBe(MCP_APP_INNER_SANDBOX);
    expect(inner.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(inner.getAttribute('sandbox')).not.toContain('allow-top-navigation');
    expect(inner.getAttribute('srcdoc')).toContain('<title>Test app</title>');
    expect(inner.hasAttribute('src')).toBeFalse();
  });

  it('carries tool calls, data changes and function calls over the bridge', async () => {
    await startApp();

    command({kind: 'call_tool', name: 'saved', args: {count: 2}});
    const saved = await harness.nextAction('saved');
    expect(saved.context).toEqual({count: 2});
    expect(saved.sourceComponentId).toBe(COMPONENT_ID);
    const result = await reported('tool_result', {name: 'saved', status: 'success'});
    expect(result.context['result']).toEqual(jasmine.objectContaining({content: []}));

    harness.setData('/counter/count', 5);
    await reported('data_seen', {key: 'count', value: 5});

    command({kind: 'set', key: 'count', value: 6});
    await waitFor(
      () => harness.surface.dataModel.get('/counter/count') === 6,
      'count written by the application',
    );

    command({
      kind: 'call_function',
      call: 'split',
      callId: 'split-1',
      args: {value: 'a,b', separator: ','},
    });
    const split = await reported('function_result', {callId: 'split-1'});
    expect(split.context).toEqual(
      jasmine.objectContaining({call: 'split', status: 'success', result: ['a', 'b']}),
    );

    await settle();
    expect(harness.actionsNamed('data_seen').some(a => a.context['value'] === 6))
      .withContext('the application does not get its own write back')
      .toBeFalse();
  });

  it('resizes the frame when the application asks, within the limits', async () => {
    const {element, frame} = await startApp();
    expect(element.style.height).toBe('');

    command({kind: 'resize', height: 320});
    await waitFor(() => frame.style.height === '320px', 'frame resized');
    expect(element.style.height).toBe('320px');

    command({kind: 'resize', height: 99999});
    await waitFor(() => frame.style.height === '2000px', 'height clamped');
  });

  it('rejects what the allowlists do not cover', async () => {
    await startApp();

    command({kind: 'call_tool', name: 'not_declared', args: {}});
    const tool = await reported('tool_result', {name: 'not_declared', status: 'error'});
    expect(tool.context['error']).toEqual(
      jasmine.objectContaining({name: 'McpError', code: ErrorCode.InvalidParams}),
    );

    command({kind: 'call_function', call: 'jmespath', callId: 'j-1', args: {}});
    const unlisted = await reported('function_result', {callId: 'j-1', status: 'error'});
    expect(unlisted.context['error']).toEqual(
      jasmine.objectContaining({code: ErrorCode.InvalidParams}),
    );

    command({kind: 'call_function', call: 'split', callId: 'split-2', args: {value: 1}});
    const invalid = await reported('function_result', {callId: 'split-2', status: 'error'});
    expect(invalid.context['error']).toEqual(
      jasmine.objectContaining({code: ErrorCode.InvalidParams}),
    );

    command({kind: 'set', key: 'unbound', value: 'x'});
    await settle();
    expect(harness.actionsNamed('not_declared').length).toBe(0);
    expect(harness.surface.dataModel.get('/unbound')).toBeUndefined();
    expect(harness.surface.dataModel.get('/counter/count')).toBe(1);
  });

  it('keeps the application from navigating the host page', async () => {
    await startApp();

    command({kind: 'navigate_top', url: 'about:blank'});

    const result = await reported('navigate_top_result', {blocked: true});
    expect(result.context['error']).toBe('SecurityError');
    expect(window.location.href).toBe(pageHref);
  });
});
