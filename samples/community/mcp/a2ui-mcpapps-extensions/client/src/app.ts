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

import {LitElement, html, css, nothing} from 'lit';
import {customElement, state, query} from 'lit/decorators.js';
import {provide} from '@lit/context';
import {renderMarkdown} from '@a2ui/markdown-it';
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog, Context} from '@a2ui/lit/v0_9';
import '@a2ui/lit/v0_9'; // Registers <a2ui-surface>

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';

import {
  buildMcpUiClientCapabilities,
  createMcpActionDispatcher,
  extractA2uiFromToolResult,
  McpActionDispatcherSubscription,
  McpSandboxHost,
} from '@a2ui/web_core/v1_0';

export interface LogEntry {
  time: string;
  type: 'info' | 'action' | 'message' | 'error';
  text: string;
}

@customElement('a2ui-mcp-dualmode-app')
export class A2uiMcpDualModeApp extends LitElement {
  @provide({context: Context.markdown})
  markdownRenderer = (value: string, options?: any) => {
    return Promise.resolve(renderMarkdown(value, options));
  };

  @state() accessor mode: 'native' | 'fallback' = 'native';
  @state() accessor connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error' =
    'disconnected';
  @state() accessor serverUrl = 'http://127.0.0.1:8000/sse';
  @state() accessor statusMessage = 'Ready';
  @state() accessor logs: LogEntry[] = [];
  @state() accessor surface: any = null;

  @query('#appIframe') accessor appIframe!: HTMLIFrameElement;

  private mcpClient: Client | null = null;
  private processor!: MessageProcessor<any>;
  private actionSubscription: McpActionDispatcherSubscription | null = null;
  private sandboxHost: McpSandboxHost | null = null;

  static styles = css`
    :host {
      display: block;
      max-width: 1000px;
      margin: 0 auto;
      padding: 32px 16px;
      font-family:
        -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #f8fafc;
    }

    header {
      margin-bottom: 24px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 16px;
    }

    h1 {
      margin: 0 0 8px 0;
      font-size: 26px;
      font-weight: 700;
      color: #ffffff;
    }

    p.subtitle {
      margin: 0;
      color: #94a3b8;
      font-size: 14px;
    }

    .mode-selector {
      display: flex;
      gap: 12px;
      margin: 20px 0;
    }

    .mode-btn {
      flex: 1;
      padding: 14px 18px;
      border-radius: 10px;
      border: 2px solid rgba(255, 255, 255, 0.1);
      background: rgba(30, 41, 59, 0.7);
      color: #94a3b8;
      cursor: pointer;
      text-align: left;
      transition: all 0.2s ease;
    }

    .mode-btn:hover {
      background: rgba(51, 65, 85, 0.8);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .mode-btn.active {
      border-color: #3b82f6;
      background: rgba(59, 130, 246, 0.15);
      color: #ffffff;
    }

    .mode-btn .title {
      font-weight: 700;
      font-size: 15px;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .mode-btn .desc {
      font-size: 12px;
      color: #94a3b8;
      line-height: 1.4;
    }

    .toolbar {
      display: flex;
      gap: 12px;
      align-items: center;
      background: #1e293b;
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 24px;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .toolbar input {
      flex: 1;
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #f8fafc;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 14px;
    }

    button.btn-connect {
      padding: 8px 20px;
      background: #2563eb;
      color: #ffffff;
      font-weight: 600;
      font-size: 14px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.15s;
    }

    button.btn-connect:hover {
      background: #1d4ed8;
    }

    button.btn-disconnect {
      padding: 8px 20px;
      background: #dc2626;
      color: #ffffff;
      font-weight: 600;
      font-size: 14px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }

    .status-badge {
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-transform: capitalize;
    }

    .status-badge.disconnected {
      background: rgba(100, 116, 139, 0.2);
      color: #94a3b8;
    }
    .status-badge.connecting {
      background: rgba(234, 179, 8, 0.2);
      color: #eab308;
    }
    .status-badge.connected {
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
    }
    .status-badge.error {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
    }

    .render-container {
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 24px;
      min-height: 280px;
      margin-bottom: 24px;
    }

    .banner {
      display: inline-block;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 6px;
      margin-bottom: 16px;
    }

    .banner.native {
      background: rgba(59, 130, 246, 0.2);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.3);
    }

    .banner.fallback {
      background: rgba(245, 158, 11, 0.2);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    iframe.sandbox-frame {
      width: 100%;
      height: 320px;
      border: none;
      background: transparent;
      border-radius: 8px;
    }

    .log-panel {
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 16px;
      font-family: monospace;
      font-size: 12px;
      max-height: 220px;
      overflow-y: auto;
    }

    .log-panel h3 {
      margin: 0 0 8px 0;
      font-size: 13px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .log-entry {
      margin-bottom: 4px;
      line-height: 1.4;
    }

    .log-entry.info {
      color: #94a3b8;
    }
    .log-entry.action {
      color: #38bdf8;
    }
    .log-entry.message {
      color: #4ade80;
    }
    .log-entry.error {
      color: #f87171;
    }
  `;

  addLog(type: LogEntry['type'], text: string) {
    const time = new Date().toLocaleTimeString();
    this.logs = [...this.logs.slice(-50), {time, type, text}];
  }

  setMode(newMode: 'native' | 'fallback') {
    if (this.mode === newMode) return;
    this.mode = newMode;
    this.addLog('info', `Switched mode to: ${newMode}`);
    if (this.connectionStatus === 'connected') {
      void this.disconnect().then(() => this.connect());
    }
  }

  async connect() {
    this.connectionStatus = 'connecting';
    this.statusMessage = 'Connecting to MCP Server...';
    this.addLog('info', `Connecting to ${this.serverUrl} (${this.mode} mode)...`);

    try {
      const isNative = this.mode === 'native';
      const clientCaps = buildMcpUiClientCapabilities({
        enableNativeA2ui: isNative,
        enableHtmlApp: !isNative,
      });

      const transport = new SSEClientTransport(new URL(this.serverUrl));
      const client = new Client(
        {name: 'a2ui-dualmode-host', version: '1.0.0'},
        {capabilities: clientCaps},
      );

      await client.connect(transport);
      this.mcpClient = client;
      this.connectionStatus = 'connected';
      this.statusMessage = `Connected (${isNative ? 'Native Mode' : 'Iframe Sandbox Mode'})`;
      this.addLog('info', 'MCP Client handshake successful.');

      if (isNative) {
        // Native A2UI Mode
        this.processor = new MessageProcessor([basicCatalog]);
        this.surface = this.processor.model.getSurface('counter-surface') || null;

        this.processor.model.onSurfaceCreated.subscribe(s => {
          this.surface = s;
          this.requestUpdate();
        });

        this.actionSubscription = createMcpActionDispatcher(
          this.processor.model,
          this.mcpClient as any,
          {
            messageProcessor: this.processor,
            onError: err => {
              this.addLog('error', `Action dispatcher error: ${String(err)}`);
            },
          },
        );

        this.addLog('action', 'Calling get_counter_app tool (native=true)...');
        const res = await this.mcpClient.callTool({
          name: 'get_counter_app',
          arguments: {native: true},
        });

        const messages = extractA2uiFromToolResult(res as any);
        if (messages && messages.length > 0) {
          this.addLog('message', `Received ${messages.length} A2UI message(s) from tool.`);
          await this.processor.processMessages(messages as any);
          this.surface = this.processor.model.getSurface('counter-surface');
        }
      } else {
        // Iframe Sandbox Mode
        this.sandboxHost = new McpSandboxHost({
          mcpClient: this.mcpClient as any,
          allowedTools: ['increment_counter', 'decrement_counter', 'reset_counter'],
          onStatusChange: status => {
            this.addLog('info', `Sandbox status: ${status}`);
          },
        });

        await this.updateComplete;
        if (this.appIframe) {
          this.sandboxHost.attach(this.appIframe);
        }

        this.addLog('info', 'Reading resource ui://counter/app for fallback HTML...');
        const res = await (this.mcpClient as any).readResource({uri: 'ui://counter/app'});
        if (res.contents && res.contents.length > 0) {
          const htmlContent = res.contents[0].text;
          this.sandboxHost.loadHtml(htmlContent);
          this.addLog('info', 'Loaded fallback HTML into sandbox host.');
        }
      }
    } catch (err) {
      this.connectionStatus = 'error';
      this.statusMessage = `Connection failed: ${String(err)}`;
      this.addLog('error', `Connection error: ${String(err)}`);
    }
  }

  async disconnect() {
    if (this.actionSubscription) {
      this.actionSubscription.unsubscribe();
      this.actionSubscription = null;
    }
    if (this.sandboxHost) {
      this.sandboxHost.dispose();
      this.sandboxHost = null;
    }
    if (this.mcpClient) {
      await this.mcpClient.close();
      this.mcpClient = null;
    }
    this.surface = null;
    this.connectionStatus = 'disconnected';
    this.statusMessage = 'Disconnected';
    this.addLog('info', 'Disconnected from server.');
  }

  render() {
    return html`
      <header>
        <h1>A2UI over MCP Apps</h1>
        <p class="subtitle">Dual-Mode Client Demonstration (Native A2UI vs Sandboxed Iframe)</p>
      </header>

      <div class="mode-selector">
        <button
          class="mode-btn ${this.mode === 'native' ? 'active' : ''}"
          @click=${() => this.setMode('native')}
        >
          <div class="title">⚡ Native A2UI Mode (Preferred)</div>
          <div class="desc">
            Direct DOM rendering with @a2ui/lit components and automatic action dispatching to MCP
            tools. Zero iframe overhead.
          </div>
        </button>

        <button
          class="mode-btn ${this.mode === 'fallback' ? 'active' : ''}"
          @click=${() => this.setMode('fallback')}
        >
          <div class="title">🛡️ Iframe Sandboxed Mode (Fallback)</div>
          <div class="desc">
            Isolated double-iframe sandbox executing self-contained HTML MCP App via JSON-RPC
            postMessage bridge.
          </div>
        </button>
      </div>

      <div class="toolbar">
        <input
          type="text"
          .value=${this.serverUrl}
          @input=${(e: Event) => (this.serverUrl = (e.target as HTMLInputElement).value)}
          ?disabled=${this.connectionStatus === 'connected' ||
          this.connectionStatus === 'connecting'}
        />

        <span class="status-badge ${this.connectionStatus}">${this.connectionStatus}</span>

        ${this.connectionStatus === 'connected'
          ? html`<button class="btn-disconnect" @click=${() => this.disconnect()}>
              Disconnect
            </button>`
          : html`<button
              class="btn-connect"
              @click=${() => this.connect()}
              ?disabled=${this.connectionStatus === 'connecting'}
            >
              ${this.connectionStatus === 'connecting' ? 'Connecting...' : 'Connect'}
            </button>`}
      </div>

      <div class="render-container">
        ${this.mode === 'native'
          ? html`
              <div class="banner native">⚡ Native Mode: Direct Host Component Rendering</div>
              ${this.surface
                ? html`<a2ui-surface .surface=${this.surface}></a2ui-surface>`
                : html`<p style="color: #64748b;">
                    Connect to the server to render the native A2UI surface.
                  </p>`}
            `
          : html`
              <div class="banner fallback">🛡️ Fallback Mode: Isolated Double-Iframe Sandbox</div>
              <iframe
                id="appIframe"
                class="sandbox-frame"
                src="/sandbox_proxy.html"
                title="MCP App Sandbox"
              ></iframe>
            `}
      </div>

      <div class="log-panel">
        <h3>Live Event & Message Log</h3>
        ${this.logs.length === 0
          ? html`<div style="color: #475569;">No events logged yet.</div>`
          : this.logs.map(
              log =>
                html`<div class="log-entry ${log.type}">
                  [${log.time}] [${log.type.toUpperCase()}] ${log.text}
                </div>`,
            )}
      </div>
    `;
  }
}
