/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Component, signal, ViewChild, ElementRef, AfterViewInit} from '@angular/core';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';

// Per the MCP Apps spec, a tool that omits `_meta.ui.visibility` defaults to
// ["model", "app"], i.e. it is app-callable. We name that permissive fallback
// so the host's default is explicit rather than a bare `true`. This is a
// sample-friendly default; a stricter host may prefer to deny tools that don't
// explicitly opt into "app" visibility.
// Spec: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
const APP_CALLABLE_WHEN_VISIBILITY_UNDECLARED = true;

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App implements AfterViewInit {
  @ViewChild('appIframe') appIframe!: ElementRef<HTMLIFrameElement>;

  protected readonly status = signal<string>('Not connected');

  private htmlContent: string | null = null;
  // Input arguments and result of the tools/call that instantiated the View,
  // delivered via ui/notifications/tool-input and ui/notifications/tool-result.
  private toolCallArguments: Record<string, unknown> = {};
  private toolCallResult: Record<string, unknown> | null = null;
  private messageListenerAdded = false;
  protected readonly mcpAppHtmlUrl = signal<string | null>(null);
  protected readonly isAppLoading = signal<boolean>(false);
  protected readonly selectedApp = signal<'editor' | 'basic'>('editor');

  private mcpClient: Client | null = null;

  // Tools the View may invoke, derived from each tool's declared
  // _meta.ui.visibility. Per the MCP Apps spec an absent declaration defaults
  // to ["model", "app"], i.e. app-callable (see
  // APP_CALLABLE_WHEN_VISIBILITY_UNDECLARED above for the spec link).
  private allowedTools = new Set<string>();

  ngAfterViewInit() {
    if (this.messageListenerAdded) return;
    this.messageListenerAdded = true;

    window.addEventListener('message', event => {
      // Security: Validate origin
      if (event.origin !== window.location.origin) return;

      if (!this.appIframe) return;
      const iframe = this.appIframe.nativeElement;
      if (event.source !== iframe.contentWindow) return;

      const target = event.source as Window;
      const data = event.data;

      if (data?.method === 'ui/notifications/sandbox-proxy-ready') {
        if (this.htmlContent) {
          console.log('[Host] Sandbox proxy ready, sending resource...');
          iframe.contentWindow?.postMessage(
            {
              jsonrpc: '2.0',
              method: 'ui/notifications/sandbox-resource-ready',
              params: {
                html: this.htmlContent,
              },
            },
            window.location.origin,
          );
        }
      } else if (data?.method === 'ping') {
        if (data.id != null && target) {
          target.postMessage(
            {
              jsonrpc: '2.0',
              id: data.id,
              result: {},
            },
            window.location.origin,
          );
        }
      } else if (data?.method === 'ui/initialize') {
        if (data.id != null && target) {
          target.postMessage(
            {
              jsonrpc: '2.0',
              id: data.id,
              result: {
                protocolVersion: '2026-01-26',
                hostInfo: {name: 'a2ui-mcp-apps-host', version: '1.0.0'},
                hostCapabilities: {
                  serverTools: {},
                },
                hostContext: {
                  displayMode: 'inline',
                  availableDisplayModes: ['inline'],
                },
              },
            },
            window.location.origin,
          );
        }
      } else if (data?.method === 'ui/notifications/initialized') {
        // The host must not message the View before this notification; once it
        // arrives, deliver the instantiating tool call's input and result.
        target.postMessage(
          {
            jsonrpc: '2.0',
            method: 'ui/notifications/tool-input',
            params: {arguments: this.toolCallArguments},
          },
          window.location.origin,
        );
        if (this.toolCallResult) {
          target.postMessage(
            {
              jsonrpc: '2.0',
              method: 'ui/notifications/tool-result',
              params: this.toolCallResult,
            },
            window.location.origin,
          );
        }
      } else if (data?.method === 'ui/notifications/size-changed') {
        const height = data.params?.height;
        if (typeof height === 'number') {
          iframe.style.height = `${height}px`;
        }
      } else if (data?.method === 'tools/call') {
        const toolName = data.params?.name;

        if (typeof toolName !== 'string' || !this.allowedTools.has(toolName)) {
          console.warn(`[Host] Blocked unauthorized tool call: ${toolName}`);
          if (data.id != null && target) {
            target.postMessage(
              {
                jsonrpc: '2.0',
                id: data.id,
                error: {code: -32000, message: `Tool '${toolName}' is not whitelisted.`},
              },
              window.location.origin,
            );
          }
          return;
        }

        if (data.id != null && target && this.mcpClient) {
          this.mcpClient
            .callTool({
              name: toolName,
              arguments: data.params?.arguments || {},
            })
            .then(result => {
              target.postMessage(
                {
                  jsonrpc: '2.0',
                  id: data.id,
                  result,
                },
                window.location.origin,
              );
            })
            .catch(error => {
              target.postMessage(
                {
                  jsonrpc: '2.0',
                  id: data.id,
                  error: {code: -32000, message: error.message},
                },
                window.location.origin,
              );
            });
        }
      }
    });
  }

  onAppChange(value: string) {
    if (value === 'editor' || value === 'basic') {
      this.selectedApp.set(value);
    } else {
      console.error(`[Host] Invalid app selected: ${value}`);
    }
  }

  async connectAndLoadApp() {
    this.status.set('Connecting to MCP Server...');
    this.isAppLoading.set(true);

    try {
      // 1. Connect to SSE
      const transport = new SSEClientTransport(new URL('http://127.0.0.1:8000/sse'));
      const client = new Client(
        {
          name: 'editor-host',
          version: '1.0.0',
        },
        {
          capabilities: {},
        },
      );

      this.status.set('Initializing MCP Client...');
      await client.connect(transport);
      this.mcpClient = client;

      const toolName = this.selectedApp() === 'editor' ? 'get_editor_app' : 'get_basic_app';

      // 2. Discover the tool's predeclared UI template (_meta.ui.resourceUri)
      // and which tools the View may call (_meta.ui.visibility).
      this.status.set('Listing tools...');
      const {tools} = await client.listTools();
      this.allowedTools = new Set(
        tools
          .filter(tool => {
            const visibility = (tool._meta as any)?.ui?.visibility;
            return Array.isArray(visibility)
              ? visibility.includes('app')
              : APP_CALLABLE_WHEN_VISIBILITY_UNDECLARED;
          })
          .map(tool => tool.name),
      );

      const entryTool = tools.find(tool => tool.name === toolName);
      const resourceUri = (entryTool?._meta as any)?.ui?.resourceUri;
      if (typeof resourceUri !== 'string' || !resourceUri.startsWith('ui://')) {
        throw new Error(`Tool '${toolName}' does not declare a ui:// resource in _meta.ui`);
      }

      // 3. Call the tool; its result is delivered to the View via
      // ui/notifications/tool-result once the View reports initialized.
      this.status.set('Calling MCP App tool...');
      const result = await client.callTool({
        name: toolName,
        arguments: {},
      });
      this.toolCallArguments = {};
      this.toolCallResult = result as Record<string, unknown>;

      this.status.set(`Reading resource: ${resourceUri}`);

      // 4. Read the resource
      const appResource = await client.readResource({uri: resourceUri});
      const htmlContentObj = appResource.contents.find(
        (c: any) => c.mimeType === 'text/html;profile=mcp-app' || 'text' in c,
      ) as any;

      if (!htmlContentObj || typeof htmlContentObj.text !== 'string') {
        throw new Error('Resource did not return valid HTML content');
      }

      this.htmlContent = htmlContentObj.text as string;
      this.status.set('App loaded successfully!');

      if (this.appIframe && this.appIframe.nativeElement) {
        this.appIframe.nativeElement.src =
          '/sandbox_iframe/sandbox.html?disable_security_self_test=true';
      }
    } catch (e: any) {
      this.status.set(`Error: ${e.message}`);
    } finally {
      this.isAppLoading.set(false);
    }
  }
}
