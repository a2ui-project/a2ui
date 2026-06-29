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

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App implements AfterViewInit {
  @ViewChild('appIframe') appIframe!: ElementRef<HTMLIFrameElement>;

  protected readonly status = signal<string>('Not connected');

  private htmlContent: string | null = null;
  private messageListenerAdded = false;
  protected readonly mcpAppHtmlUrl = signal<string | null>(null);
  protected readonly isAppLoading = signal<boolean>(false);
  protected readonly selectedApp = signal<'editor' | 'basic'>('editor');

  private mcpClient: Client | null = null;

  private readonly allowedTools = new Set([
    'fetch_counter_a2ui',
    'increase_counter',
    'smart_editor_get_controls',
    'smart_editor_apply',
  ]);

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
      } else if (data?.method === 'ui/ping') {
        if (data.id && target) {
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
        if (data.id && target) {
          target.postMessage(
            {
              jsonrpc: '2.0',
              id: data.id,
              result: {
                hostCapabilities: {
                  displayModes: ['inline'],
                },
              },
            },
            window.location.origin,
          );
        }
      } else if (data?.method === 'ui/resize') {
        const height = data.params?.height;
        if (typeof height === 'number') {
          iframe.style.height = `${height}px`;
        }
      } else if (data?.method?.startsWith('ui/')) {
        // Generic tool relay for unknown verbs
        const toolName = data.method.replace('ui/', '');

        if (!this.allowedTools.has(toolName)) {
          console.warn(`[Host] Blocked unauthorized tool call: ${toolName}`);
          if (data.id && target) {
            target.postMessage(
              {
                jsonrpc: '2.0',
                id: data.id,
                error: {message: `Tool '${toolName}' is not whitelisted.`},
              },
              window.location.origin,
            );
          }
          return;
        }

        if (data.id && target && this.mcpClient) {
          this.mcpClient
            .callTool({
              name: toolName,
              arguments: data.params || {},
            })
            .then(result => {
              target.postMessage(
                {
                  jsonrpc: '2.0',
                  id: data.id,
                  result: result.content,
                },
                window.location.origin,
              );
            })
            .catch(error => {
              target.postMessage(
                {
                  jsonrpc: '2.0',
                  id: data.id,
                  error: {message: error.message},
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

      this.status.set('Calling MCP App tool...');
      const toolName = this.selectedApp() === 'editor' ? 'get_editor_app' : 'get_basic_app';

      // 2. Call the tool to get the app
      const result = await client.callTool({
        name: toolName,
        arguments: {},
      });

      // 3. Extract resource URI
      const resourceContent = (result.content as any[]).find((c: any) => c.type === 'resource');
      if (!resourceContent || !resourceContent.resource?.uri) {
        throw new Error('Tool did not return a resource URI');
      }

      const resourceUri = resourceContent.resource.uri;
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
