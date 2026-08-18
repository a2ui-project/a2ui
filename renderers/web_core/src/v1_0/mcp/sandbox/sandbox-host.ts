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

import {McpSandboxHostOptions} from '../types.js';

/** Normalizes host origins for local development (treating localhost and 127.0.0.1 as equivalent). */
export function normalizeOrigin(origin: string): string {
  return origin.replace('://127.0.0.1', '://localhost');
}

/**
 * Controller class managing the communication lifecycle with a sandboxed MCP Apps iframe.
 */
export class McpSandboxHost {
  private iframe: HTMLIFrameElement | null = null;
  private htmlContent: string | null = null;
  private sandboxFlags?: string;
  private permissionsPolicy?: string;
  private toolCallArguments: Record<string, unknown> = {};
  private toolCallResult: Record<string, unknown> | null = null;
  private allowedToolNames: Set<string> | null = null;
  private isAttached = false;
  private isProxyReady = false;

  private readonly boundMessageHandler: (event: MessageEvent) => void;

  constructor(private readonly options: McpSandboxHostOptions = {}) {
    if (options.allowedTools) {
      this.allowedToolNames = new Set(options.allowedTools);
    }
    this.boundMessageHandler = (event: MessageEvent) => {
      void this.handleMessage(event);
    };
  }

  /**
   * Attaches this controller to a host iframe element and starts listening for messages.
   *
   * @param iframe The iframe element hosting the sandbox proxy.
   */
  attach(iframe: HTMLIFrameElement): void {
    if (this.isAttached) {
      this.detach();
    }
    this.iframe = iframe;
    this.isProxyReady = false;
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.boundMessageHandler);
    }
    this.isAttached = true;
  }

  /**
   * Detaches the controller and stops listening for message events.
   */
  detach(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', this.boundMessageHandler);
    }
    this.iframe = null;
    this.isProxyReady = false;
    this.isAttached = false;
  }

  /**
   * Disposes of this host controller.
   */
  dispose(): void {
    this.detach();
    this.htmlContent = null;
    this.toolCallResult = null;
  }

  /**
   * Updates the set of allowed tool names.
   *
   * @param tools Set or array of allowed tool names, or null to allow all.
   */
  setAllowedTools(tools: Set<string> | string[] | null): void {
    this.allowedToolNames = tools ? new Set(tools) : null;
  }

  /**
   * Loads an HTML bundle into the sandboxed view.
   *
   * @param html The HTML content string.
   * @param options Additional arguments and result data to pass to the view.
   */
  loadHtml(
    html: string,
    options?: {
      arguments?: Record<string, unknown>;
      result?: Record<string, unknown>;
      sandbox?: string;
      permissions?: string;
    },
  ): void {
    this.htmlContent = html;
    this.toolCallArguments = options?.arguments || {};
    this.toolCallResult = options?.result || null;
    this.sandboxFlags = options?.sandbox;
    this.permissionsPolicy = options?.permissions;

    this.options.onStatusChange?.('loading');

    // If proxy iframe is already ready, send resource immediately
    if (this.isProxyReady) {
      this.sendResourceReady();
    }
  }

  /**
   * Sends the resource payload notification to the sandbox proxy iframe.
   */
  private sendResourceReady(): void {
    if (!this.iframe?.contentWindow || !this.htmlContent) {
      return;
    }

    const targetOrigin = this.getExpectedOrigin();
    this.iframe.contentWindow.postMessage(
      {
        jsonrpc: '2.0',
        method: 'ui/notifications/sandbox-resource-ready',
        params: {
          html: this.htmlContent,
          sandbox: this.sandboxFlags,
          permissions: this.permissionsPolicy,
        },
      },
      targetOrigin,
    );
  }

  /**
   * Returns the expected target origin for postMessage communication.
   */
  private getExpectedOrigin(): string {
    if (this.options.allowedHostOrigin) {
      return this.options.allowedHostOrigin;
    }
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
    return '*';
  }

  /**
   * Handles incoming postMessage events from the sandbox proxy iframe.
   *
   * @param event The message event from window.
   */
  async handleMessage(event: MessageEvent): Promise<void> {
    if (!this.iframe || !this.iframe.contentWindow) {
      return;
    }

    // 1. Source check
    if (event.source !== this.iframe.contentWindow) {
      return;
    }

    // 2. Origin check
    const expectedOrigin = this.getExpectedOrigin();
    if (expectedOrigin !== '*') {
      if (normalizeOrigin(event.origin) !== normalizeOrigin(expectedOrigin)) {
        console.warn(
          `[McpSandboxHost] Rejected message from origin '${event.origin}', expected '${expectedOrigin}'`,
        );
        return;
      }
    }

    const data = event.data;
    if (!data || typeof data !== 'object') {
      return;
    }

    const target = event.source as Window;
    const responseOrigin = this.getExpectedOrigin();

    // 3. Dispatch based on JSON-RPC method
    if (data.method === 'ui/notifications/sandbox-proxy-ready') {
      this.isProxyReady = true;
      this.sendResourceReady();
    } else if (data.method === 'ping') {
      if (data.id != null) {
        target.postMessage(
          {
            jsonrpc: '2.0',
            id: data.id,
            result: {},
          },
          responseOrigin,
        );
      }
    } else if (data.method === 'ui/initialize') {
      if (data.id != null) {
        target.postMessage(
          {
            jsonrpc: '2.0',
            id: data.id,
            result: {
              protocolVersion: this.options.protocolVersion || '2026-01-26',
              hostInfo: this.options.hostInfo || {name: 'a2ui-mcp-sandbox-host', version: '1.0.0'},
              hostCapabilities: {
                serverTools: {},
              },
              hostContext: this.options.hostContext || {
                displayMode: 'inline',
                availableDisplayModes: ['inline'],
              },
            },
          },
          responseOrigin,
        );
      }
    } else if (data.method === 'ui/notifications/initialized') {
      this.options.onStatusChange?.('connected');

      target.postMessage(
        {
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-input',
          params: {arguments: this.toolCallArguments},
        },
        responseOrigin,
      );

      if (this.toolCallResult) {
        target.postMessage(
          {
            jsonrpc: '2.0',
            method: 'ui/notifications/tool-result',
            params: this.toolCallResult,
          },
          responseOrigin,
        );
      }
    } else if (data.method === 'ui/notifications/size-changed') {
      const height = data.params?.height;
      const width = data.params?.width;

      if (typeof height === 'number' && this.iframe) {
        this.iframe.style.height = `${height}px`;
      }
      if (typeof width === 'number' && this.iframe) {
        this.iframe.style.width = `${width}px`;
      }

      this.options.onSizeChanged?.({width, height});
    } else if (data.method === 'tools/call') {
      const toolName = data.params?.name;
      const toolArgs = data.params?.arguments || {};

      if (
        this.allowedToolNames &&
        (typeof toolName !== 'string' || !this.allowedToolNames.has(toolName))
      ) {
        if (data.id != null) {
          target.postMessage(
            {
              jsonrpc: '2.0',
              id: data.id,
              error: {
                code: -32000,
                message: `Tool '${toolName}' is not permitted by host policy.`,
              },
            },
            responseOrigin,
          );
        }
        return;
      }

      if (!this.options.mcpClient) {
        if (data.id != null) {
          target.postMessage(
            {
              jsonrpc: '2.0',
              id: data.id,
              error: {code: -32603, message: 'MCP Client is not configured on host.'},
            },
            responseOrigin,
          );
        }
        return;
      }

      try {
        const result = await this.options.mcpClient.callTool({
          name: toolName,
          arguments: toolArgs,
        });
        if (data.id != null) {
          target.postMessage(
            {
              jsonrpc: '2.0',
              id: data.id,
              result,
            },
            responseOrigin,
          );
        }
      } catch (err) {
        if (data.id != null) {
          const message = err instanceof Error ? err.message : String(err);
          target.postMessage(
            {
              jsonrpc: '2.0',
              id: data.id,
              error: {code: -32000, message},
            },
            responseOrigin,
          );
        }
      }
    }
  }
}
