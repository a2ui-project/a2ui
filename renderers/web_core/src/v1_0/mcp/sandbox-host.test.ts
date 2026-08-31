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

import * as assert from 'node:assert';
import {describe, it, beforeEach} from 'node:test';
import {McpSandboxHost, normalizeOrigin} from './sandbox/sandbox-host.js';
import {McpCallToolParams, McpCallToolResult, McpClientInterface} from './types.js';

class MockWindow {
  public postedMessages: Array<{message: any; targetOrigin: string}> = [];

  postMessage(message: any, targetOrigin: string) {
    this.postedMessages.push({message, targetOrigin});
  }
}

class MockIframeElement {
  public contentWindow = new MockWindow();
  public style = {height: '', width: ''};
}

class MockMcpClient implements McpClientInterface {
  public calls: McpCallToolParams[] = [];
  public returnResult: McpCallToolResult = {
    content: [{type: 'text', text: 'tool response'}],
  };

  async callTool(params: McpCallToolParams): Promise<McpCallToolResult> {
    this.calls.push(params);
    return this.returnResult;
  }
}

describe('McpSandboxHost', () => {
  let mockIframe: MockIframeElement;
  let mockClient: MockMcpClient;

  beforeEach(() => {
    mockIframe = new MockIframeElement();
    mockClient = new MockMcpClient();
  });

  it('normalizes localhost and 127.0.0.1 origins', () => {
    assert.strictEqual(normalizeOrigin('http://127.0.0.1:8000'), 'http://localhost:8000');
    assert.strictEqual(normalizeOrigin('http://localhost:8000'), 'http://localhost:8000');
  });

  it('handles sandbox-proxy-ready and sends resource payload', async () => {
    const host = new McpSandboxHost({
      allowedHostOrigin: 'http://localhost:3000',
    });
    host.attach(mockIframe as any);

    host.loadHtml('<h1>Hello Sandbox</h1>', {
      arguments: {key: 'val'},
      result: {status: 'ok'},
    });

    await host.handleMessage({
      origin: 'http://localhost:3000',
      source: mockIframe.contentWindow,
      data: {
        method: 'ui/notifications/sandbox-proxy-ready',
      },
    } as any);

    const messages = mockIframe.contentWindow.postedMessages;
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].message.method, 'ui/notifications/sandbox-resource-ready');
    assert.strictEqual(messages[0].message.params.html, '<h1>Hello Sandbox</h1>');
  });

  it('handles ping request', async () => {
    const host = new McpSandboxHost({
      allowedHostOrigin: 'http://localhost:3000',
    });
    host.attach(mockIframe as any);

    await host.handleMessage({
      origin: 'http://localhost:3000',
      source: mockIframe.contentWindow,
      data: {
        jsonrpc: '2.0',
        id: 42,
        method: 'ping',
      },
    } as any);

    const messages = mockIframe.contentWindow.postedMessages;
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].message.id, 42);
    assert.deepStrictEqual(messages[0].message.result, {});
  });

  it('handles ui/initialize handshake and responds with host info', async () => {
    const host = new McpSandboxHost({
      allowedHostOrigin: 'http://localhost:3000',
      protocolVersion: '2026-01-26',
      hostInfo: {name: 'custom-host', version: '2.0.0'},
    });
    host.attach(mockIframe as any);

    await host.handleMessage({
      origin: 'http://localhost:3000',
      source: mockIframe.contentWindow,
      data: {
        jsonrpc: '2.0',
        id: 101,
        method: 'ui/initialize',
      },
    } as any);

    const messages = mockIframe.contentWindow.postedMessages;
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].message.id, 101);
    assert.strictEqual(messages[0].message.result.protocolVersion, '2026-01-26');
    assert.strictEqual(messages[0].message.result.hostInfo.name, 'custom-host');
  });

  it('handles ui/notifications/initialized by delivering tool input and result', async () => {
    const host = new McpSandboxHost({
      allowedHostOrigin: 'http://localhost:3000',
    });
    host.attach(mockIframe as any);

    host.loadHtml('<div/>', {
      arguments: {query: 'test'},
      result: {answer: 42},
    });

    await host.handleMessage({
      origin: 'http://localhost:3000',
      source: mockIframe.contentWindow,
      data: {
        method: 'ui/notifications/initialized',
      },
    } as any);

    const messages = mockIframe.contentWindow.postedMessages;
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].message.method, 'ui/notifications/tool-input');
    assert.deepStrictEqual(messages[0].message.params.arguments, {query: 'test'});
    assert.strictEqual(messages[1].message.method, 'ui/notifications/tool-result');
    assert.deepStrictEqual(messages[1].message.params, {answer: 42});
  });

  it('handles size-changed notification and updates iframe style', async () => {
    let notifiedSize: any = null;
    const host = new McpSandboxHost({
      allowedHostOrigin: 'http://localhost:3000',
      onSizeChanged: size => {
        notifiedSize = size;
      },
    });
    host.attach(mockIframe as any);

    await host.handleMessage({
      origin: 'http://localhost:3000',
      source: mockIframe.contentWindow,
      data: {
        method: 'ui/notifications/size-changed',
        params: {height: 450, width: 600},
      },
    } as any);

    assert.strictEqual(mockIframe.style.height, '450px');
    assert.strictEqual(mockIframe.style.width, '600px');
    assert.deepStrictEqual(notifiedSize, {height: 450, width: 600});
  });

  it('executes allowed tool calls and blocks unauthorized tool calls', async () => {
    const host = new McpSandboxHost({
      allowedHostOrigin: 'http://localhost:3000',
      mcpClient: mockClient,
      allowedTools: ['allowed_tool'],
    });
    host.attach(mockIframe as any);

    // 1. Authorized tool call
    await host.handleMessage({
      origin: 'http://localhost:3000',
      source: mockIframe.contentWindow,
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'allowed_tool',
          arguments: {count: 5},
        },
      },
    } as any);

    assert.strictEqual(mockClient.calls.length, 1);
    assert.strictEqual(mockClient.calls[0].name, 'allowed_tool');

    const messages = mockIframe.contentWindow.postedMessages;
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].message.id, 1);
    assert.ok(messages[0].message.result);

    // 2. Unauthorized tool call
    await host.handleMessage({
      origin: 'http://localhost:3000',
      source: mockIframe.contentWindow,
      data: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'forbidden_tool',
          arguments: {},
        },
      },
    } as any);

    assert.strictEqual(mockClient.calls.length, 1); // No new call to client
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[1].message.id, 2);
    assert.strictEqual(messages[1].message.error.code, -32000);
  });

  it('rejects messages from invalid origins or sources', async () => {
    const host = new McpSandboxHost({
      allowedHostOrigin: 'http://localhost:3000',
    });
    host.attach(mockIframe as any);

    // Wrong origin
    await host.handleMessage({
      origin: 'http://malicious.com',
      source: mockIframe.contentWindow,
      data: {method: 'ping', id: 1},
    } as any);
    assert.strictEqual(mockIframe.contentWindow.postedMessages.length, 0);

    // Wrong source
    const foreignWindow = new MockWindow();
    await host.handleMessage({
      origin: 'http://localhost:3000',
      source: foreignWindow,
      data: {method: 'ping', id: 1},
    } as any);
    assert.strictEqual(foreignWindow.postedMessages.length, 0);
  });
});
