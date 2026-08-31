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
import {describe, it} from 'node:test';
import {createMcpActionDispatcher} from './action-dispatcher.js';
import {A2UI_MIME_TYPE} from './constants.js';
import {McpCallToolParams, McpCallToolResult, McpClientInterface} from './types.js';

class MockEventSource<T> {
  private listeners: Array<(event: T) => void | Promise<void>> = [];

  subscribe(listener: (event: T) => void | Promise<void>) {
    this.listeners.push(listener);
    return {
      unsubscribe: () => {
        this.listeners = this.listeners.filter(l => l !== listener);
      },
    };
  }

  async emit(event: T): Promise<void> {
    for (const listener of this.listeners) {
      await listener(event);
    }
  }
}

class MockSurface {
  readonly onAction = new MockEventSource<any>();
  readonly errors: any[] = [];

  async dispatchError(error: any): Promise<void> {
    this.errors.push(error);
  }
}

class MockMcpClient implements McpClientInterface {
  public calls: McpCallToolParams[] = [];
  public returnResult: McpCallToolResult | null = null;
  public throwError: Error | null = null;

  async callTool(params: McpCallToolParams): Promise<McpCallToolResult> {
    this.calls.push(params);
    if (this.throwError) {
      throw this.throwError;
    }
    return (
      this.returnResult || {
        content: [],
      }
    );
  }
}

describe('MCP Action Dispatcher', () => {
  it('dispatches surface action to mcpClient.callTool and feeds messages into messageProcessor', async () => {
    const surface = new MockSurface();
    const mcpClient = new MockMcpClient();
    const processedMessages: any[] = [];

    const expectedMessage = {
      version: 'v1.0',
      updateDataModel: {surfaceId: 's1', value: {count: 5}},
    };

    mcpClient.returnResult = {
      content: [
        {
          type: 'resource',
          resource: {
            uri: 'a2ui://update',
            mimeType: A2UI_MIME_TYPE,
            text: JSON.stringify([expectedMessage]),
          },
        },
      ],
    };

    const mockProcessor = {
      processMessages: async (msgs: any[]) => {
        processedMessages.push(...msgs);
      },
    };

    const sub = createMcpActionDispatcher(surface, mcpClient, {
      messageProcessor: mockProcessor,
    });

    await surface.onAction.emit({
      name: 'increment_counter',
      context: {amount: 2},
    });

    assert.strictEqual(mcpClient.calls.length, 1);
    assert.strictEqual(mcpClient.calls[0].name, 'increment_counter');
    assert.deepStrictEqual(mcpClient.calls[0].arguments, {amount: 2});

    assert.strictEqual(processedMessages.length, 1);
    assert.deepStrictEqual(processedMessages[0], expectedMessage);

    sub.unsubscribe();
  });

  it('handles tool execution errors and notifies error callbacks', async () => {
    const surface = new MockSurface();
    const mcpClient = new MockMcpClient();
    mcpClient.throwError = new Error('Network timeout calling tool');

    const caughtErrors: any[] = [];

    createMcpActionDispatcher(surface, mcpClient, {
      onError: err => caughtErrors.push(err),
    });

    await surface.onAction.emit({
      name: 'failing_action',
      context: {},
    });

    assert.strictEqual(caughtErrors.length, 1);
    assert.strictEqual((caughtErrors[0] as Error).message, 'Network timeout calling tool');

    assert.strictEqual(surface.errors.length, 1);
    assert.strictEqual(surface.errors[0].code, 'MCP_TOOL_ERROR');
    assert.ok(surface.errors[0].message.includes('failing_action'));
  });

  it('stops listening after unsubscribe', async () => {
    const surface = new MockSurface();
    const mcpClient = new MockMcpClient();

    const sub = createMcpActionDispatcher(surface, mcpClient);

    await surface.onAction.emit({name: 'action_1', context: {}});
    assert.strictEqual(mcpClient.calls.length, 1);

    sub.unsubscribe();

    await surface.onAction.emit({name: 'action_2', context: {}});
    assert.strictEqual(mcpClient.calls.length, 1);
  });
});
