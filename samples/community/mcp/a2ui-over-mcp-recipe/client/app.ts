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

import {LitElement, html, css} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {Context, basicCatalog} from '@a2ui/lit/v0_9';
import '@a2ui/lit/v0_9'; // Registers <a2ui-surface>
import {provide} from '@lit/context';
import {renderMarkdown} from '@a2ui/markdown-it';
import {Catalog, DataContext, DataModel, MessageProcessor} from '@a2ui/web_core/v0_9';
import {createCallMcpToolImplementation} from '@a2ui/mcp-catalog';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';

// Recipe Studio Surface IDs
const RECIPE_FORM_SURFACE_ID = 'recipe-form';
const RECIPE_CARD_SURFACE_ID = 'recipe-card';

/** Entrypoint tool: returns the form UI the app opens with. */
const RECIPE_FORM_TOOL = 'get_recipe_form_a2ui';

export const BASIC_WITH_MCP_CATALOG_ID =
  'https://a2ui.org/specification/v0_9/catalogs/basic_with_mcp/catalog.json';

/**
 * Client name sent in `clientInfo` during the MCP initialization handshake.
 *
 * In the Model Context Protocol, `clientInfo` is an informational identifier
 * (similar to an HTTP User-Agent string) primarily used by servers for logging,
 * metrics, and debugging.
 */
export const MCP_CLIENT_NAME = 'a2ui-recipe-app';
export const MCP_CLIENT_VERSION = '1.0.0';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

@customElement('a2ui-recipe-app')
export class A2uiRecipeApp extends LitElement {
  @provide({context: Context.markdown})
  markdownRenderer = (value: string, options?: any) => {
    return Promise.resolve(renderMarkdown(value, options));
  };

  @state() private accessor connectionStatus: ConnectionStatus = 'disconnected';
  @state() private accessor statusMessage = 'Ready';

  /** The MCP client serving each tool, recorded during `tools/list`. */
  readonly clientsByTool = new Map<string, Client>();

  /**
   * The host's entire contribution to tool execution.
   *
   * A2UI payloads address tools by name only, so routing lives here; the MCP
   * catalog does everything else with the client this returns.
   */
  getMcpClientForTool = (toolName: string): Client => {
    const client = this.clientsByTool.get(toolName);
    if (!client) {
      throw new Error(`No connected MCP server advertises a tool named '${toolName}'.`);
    }
    return client;
  };

  readonly processor: MessageProcessor<any>;

  /** Basic Catalog components and functions, plus MCP tool execution. */
  private readonly catalog: Catalog<any>;

  constructor() {
    super();

    // `MessageProcessor` reads its catalog array lazily rather than copying it,
    // so the processor can be built before the catalog whose function needs it.
    const catalogs: Catalog<any>[] = [];
    this.processor = new MessageProcessor<any>(catalogs);
    this.catalog = new Catalog<any>(
      BASIC_WITH_MCP_CATALOG_ID,
      Array.from(basicCatalog.components.values()),
      [
        ...Array.from(basicCatalog.functions.values()),
        createCallMcpToolImplementation(this.getMcpClientForTool, this.processor),
      ],
    );
    catalogs.push(this.catalog);

    this.processor.onSurfaceCreated(surface => {
      this.requestUpdate();
      // Forward surface errors so they are never silently swallowed.
      surface.onError.subscribe(err => {
        console.error(`[A2UI Error on surface '${surface.id}']`, err);
        this.statusMessage = `Surface error on ${surface.id}: ${err.message || err.code}`;
      });
    });
  }

  /** Retrieves an active A2UI surface model by its ID. */
  getSurface(surfaceId: string) {
    return this.processor.model.getSurface(surfaceId);
  }

  /** Connects to the MCP server, then runs the tool that renders the form. */
  protected async firstUpdated() {
    const sseUrl =
      new URLSearchParams(window.location.search).get('sse_url') ||
      (import.meta as any).env?.VITE_SSE_URL ||
      'http://127.0.0.1:8000/sse';

    this.connectionStatus = 'connecting';
    this.statusMessage = `Connecting to MCP server at ${sseUrl}...`;

    try {
      const client = new Client(
        {name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION},
        {
          capabilities: {
            a2ui: {clientCapabilities: this.processor.getClientCapabilities()},
          } as any,
        },
      );
      await client.connect(new SSEClientTransport(new URL(sseUrl)));

      const serverName = client.getServerVersion()?.name;
      if (!serverName) {
        throw new Error(
          'Connected MCP server did not return a valid server name during initialization.',
        );
      }

      const {tools} = await client.listTools();
      for (const tool of tools) {
        if (this.clientsByTool.has(tool.name)) {
          throw new Error(`Tool '${tool.name}' is advertised more than once.`);
        }
        this.clientsByTool.set(tool.name, client);
      }

      this.connectionStatus = 'connected';
      this.statusMessage = `Loading UI from tool '${RECIPE_FORM_TOOL}'...`;

      // Surfaces invoke `callMcpTool` through their own `DataContext`. No
      // surface exists yet, so the entrypoint tool runs against a scratch
      // context; its arguments are literals, so nothing binds to it.
      const context = new DataContext(
        {dataModel: new DataModel({}), catalog: this.catalog} as any,
        '/',
      );
      await this.catalog.invoker('callMcpTool', {name: RECIPE_FORM_TOOL, arguments: {}}, context);

      this.statusMessage = `Connected to MCP Server [${serverName}] (${sseUrl})`;
    } catch (error: any) {
      console.error('Failed to initialize recipe app:', error);
      this.connectionStatus = 'error';
      this.statusMessage = `Connection failed: ${error.message || error}`;
    }
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 16px;
      color: #f8fafc;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 48px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 20px;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .logo .emoji {
      font-size: 32px;
      background: rgba(255, 90, 95, 0.15);
      border-radius: 12px;
      width: 52px;
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(255, 90, 95, 0.3);
    }

    .logo h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .logo p {
      margin: 4px 0 0 0;
      font-size: 13px;
      color: #94a3b8;
    }

    .status-badge {
      display: flex;
      align-items: center;
      gap: 10px;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 8px 16px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 500;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #64748b;
    }

    .status-dot.connected {
      background: #10b981;
      box-shadow: 0 0 12px rgba(16, 185, 129, 0.5);
    }

    .status-dot.connecting {
      background: #f59e0b;
      box-shadow: 0 0 12px rgba(245, 158, 11, 0.5);
    }

    .status-dot.error {
      background: #ef4444;
      box-shadow: 0 0 12px rgba(239, 68, 68, 0.5);
    }

    .status-text {
      color: #cbd5e1;
    }

    main {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      align-items: start;
    }

    @media (max-width: 900px) {
      main {
        grid-template-columns: 1fr;
      }
    }

    .section-card {
      background: rgba(30, 41, 59, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 24px;
      padding: 32px;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.3);
      position: relative;
      overflow: hidden;
      min-height: 480px;
    }

    .section-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 24px;
      color: #f1f5f9;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .section-title::before {
      content: '';
      display: inline-block;
      width: 4px;
      height: 16px;
      background: #ff5a5f;
      border-radius: 2px;
    }

    .placeholder-box {
      border: 2px dashed rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 48px 24px;
      text-align: center;
      color: #64748b;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 24px;
      min-height: 450px;
    }

    .placeholder-icon {
      width: 80px;
      height: 80px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ff5a5f;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    .placeholder-icon .material-symbols {
      font-size: 36px;
    }

    .placeholder-text h3 {
      margin: 0 0 8px 0;
      color: #f8fafc;
      font-size: 18px;
      font-weight: 600;
    }

    .placeholder-text p {
      margin: 0;
      font-size: 14px;
      color: #94a3b8;
      max-width: 320px;
      line-height: 1.6;
    }

    /* Custom Styling Overrides for A2UI Components */
    a2ui-surface {
      width: 100%;
    }

    /* Make form buttons and option pickers match our theme */
    :host {
      color-scheme: dark;
      --a2ui-color-primary: #ff5a5f;
      --a2ui-color-primary-hover: #e04b50;
      --a2ui-color-on-primary: #ffffff;
      --a2ui-color-on-surface: #cbd5e1;
      --a2ui-color-surface: rgba(255, 255, 255, 0.07);
      --a2ui-color-border: rgba(255, 255, 255, 0.12);
      --a2ui-choicepicker-label-color: #f1f5f9;
      --a2ui-color-secondary-hover: rgba(255, 255, 255, 0.12);
      --a2ui-text-caption-color: #94a3b8;
      --a2ui-border-radius: 16px;
      --a2ui-spacing-m: 12px;
      --a2ui-spacing-l: 20px;
    }
  `;

  render() {
    const formSurface = this.getSurface(RECIPE_FORM_SURFACE_ID);
    const recipeSurface = this.getSurface(RECIPE_CARD_SURFACE_ID);

    return html`
      <header>
        <div class="logo">
          <span class="emoji">👨‍🍳</span>
          <div>
            <h1>A2UIxMCP Recipe Studio</h1>
            <p>Interactive A2UI Mini-Apps driven by MCP Server Tools</p>
          </div>
        </div>

        <div class="status-badge">
          <div class="status-dot ${this.connectionStatus}"></div>
          <span class="status-text">${this.statusMessage}</span>
        </div>
      </header>

      <main>
        <section class="section-card">
          <div class="section-title">Recipe Preferences</div>
          ${formSurface
            ? html`<a2ui-surface .surface=${formSurface}></a2ui-surface>`
            : html`
                <div class="placeholder-box">
                  <div class="placeholder-icon">
                    <span class="material-symbols">tune</span>
                  </div>
                  <div class="placeholder-text">
                    <h3>Connecting to MCP Server...</h3>
                    <p>Loading interactive recipe configuration form.</p>
                  </div>
                </div>
              `}
        </section>

        <section class="section-card">
          <div class="section-title">Generated Recipe Card</div>
          ${recipeSurface
            ? html`<a2ui-surface .surface=${recipeSurface}></a2ui-surface>`
            : html`
                <div class="placeholder-box">
                  <div class="placeholder-icon">
                    <span class="material-symbols">shopping_cart</span>
                  </div>
                  <div class="placeholder-text">
                    <h3>Your recipe card will appear here</h3>
                    <p>
                      Select your preferred cooking style and protein option on the left, then click
                      <strong>"Get Recipe"</strong> to execute the MCP Tool.
                    </p>
                  </div>
                </div>
              `}
        </section>
      </main>
    `;
  }
}
