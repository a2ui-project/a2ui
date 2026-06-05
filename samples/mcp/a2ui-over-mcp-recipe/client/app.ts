/**
 * Copyright 2026 Google LLC
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

import {LitElement, html, css, nothing} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog, Context} from '@a2ui/lit/v0_9';
import '@a2ui/lit/v0_9'; // Registers <a2ui-surface>
import {provide} from '@lit/context';
import {renderMarkdown} from '@a2ui/markdown-it';

// Model Context Protocol SDK
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';

const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json';

@customElement('a2ui-recipe-app')
export class A2uiRecipeApp extends LitElement {
  @provide({context: Context.markdown})
  markdownRenderer = (value: string, options?: any) => {
    return Promise.resolve(renderMarkdown(value, options));
  };

  @state() private accessor connectionStatus:
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'error' = 'disconnected';
  @state() private accessor statusMessage = 'Ready';
  @state() private accessor recipeLoading = false;

  private mcpClient: Client | null = null;

  // Maintain separate processors and surface models for form and recipe card
  private formProcessor!: MessageProcessor<any>;
  private recipeProcessor!: MessageProcessor<any>;

  @state() private accessor formSurface: any = null;
  @state() private accessor recipeSurface: any = null;

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
      gap: 12px;
    }

    .logo span.emoji {
      font-size: 32px;
    }

    .logo h1 {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(to right, #ff5a5f, #ff9094);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .status-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 99px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 13px;
      font-weight: 500;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #64748b;
    }

    .status-dot.connecting {
      background: #3b82f6;
      box-shadow: 0 0 8px #3b82f6;
      animation: pulse 1.5s infinite ease-in-out;
    }

    .status-dot.connected {
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
    }

    .status-dot.error {
      background: #ef4444;
      box-shadow: 0 0 8px #ef4444;
    }

    .main-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 32px;
    }

    @media (min-width: 800px) {
      .main-grid {
        grid-template-columns: 450px 1fr;
      }
    }

    .section-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 24px;
      padding: 32px;
      transition:
        transform 0.3s ease,
        box-shadow 0.3s ease;
      display: flex;
      flex-direction: column;
      gap: 20px;
      position: relative;
    }

    .section-card:hover {
      box-shadow: 0 10px 30px -15px rgba(0, 0, 0, 0.5);
    }

    .section-title {
      font-size: 18px;
      font-weight: 700;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 12px;
    }

    .placeholder-box {
      border: 2px dashed rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      padding: 64px 32px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      color: #64748b;
      gap: 16px;
      min-height: 400px;
    }

    .placeholder-icon {
      font-size: 48px;
      color: rgba(255, 255, 255, 0.15);
    }

    .placeholder-text h3 {
      color: #cbd5e1;
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .placeholder-text p {
      font-size: 14px;
      max-width: 320px;
      line-height: 1.5;
    }

    .loader-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 24px;
      min-height: 450px;
    }

    .spinner {
      width: 50px;
      height: 50px;
      border: 4px solid rgba(255, 255, 255, 0.05);
      border-top-color: #ff5a5f;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    .loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(15, 23, 42, 0.75);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
      z-index: 10;
      animation: fadeIn 0.2s ease-out;
    }

    .loading-text {
      color: #cbd5e1;
      font-size: 15px;
      font-weight: 500;
      text-align: center;
    }

    /* Custom Styling Overrides for A2UI Components */
    a2ui-surface {
      width: 100%;
    }

    /* Make form buttons and option pickers match our premium theme */
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

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    @keyframes pulse {
      0%,
      100% {
        opacity: 0.6;
      }
      50% {
        opacity: 1;
      }
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
  `;

  constructor() {
    super();
    this.initializeA2UI();
  }

  private initializeA2UI() {
    // 1. Form Processor Setup
    this.formProcessor = new MessageProcessor([basicCatalog], async action => {
      console.log('Form Action Received:', action);
      if (action.name === 'generate_recipe') {
        await this.generateRecipe(action.context);
      }
    });

    // 2. Recipe Card Processor Setup
    this.recipeProcessor = new MessageProcessor([basicCatalog], async action => {
      console.log('Recipe Card Action:', action);
    });
  }

  protected async firstUpdated() {
    await this.connectMcp();
  }

  private async connectMcp() {
    this.connectionStatus = 'connecting';

    const urlParams = new URLSearchParams(window.location.search);
    const sseUrl =
      urlParams.get('sse_url') ||
      (import.meta as any).env?.VITE_SSE_URL ||
      'http://127.0.0.1:8000/sse';

    this.statusMessage = `Connecting to MCP server at ${sseUrl}...`;

    try {
      // Establish SSE client transport
      const transport = new SSEClientTransport(new URL(sseUrl));

      this.mcpClient = new Client(
        {
          name: 'a2ui-recipe-app-client',
          version: '1.0.0',
        },
        {
          capabilities: {
            a2ui: {
              clientCapabilities: {
                'v0.9': {
                  supportedCatalogIds: [BASIC_CATALOG_ID],
                },
              },
            },
          } as any,
        },
      );

      await this.mcpClient.connect(transport);
      this.connectionStatus = 'connected';
      this.statusMessage = `Connected to MCP Server (${sseUrl})`;

      await this.loadFormResource();
    } catch (error: any) {
      console.error('MCP Connection Error:', error);
      this.connectionStatus = 'error';
      this.statusMessage = `Connection failed: ${error.message || error}`;
    }
  }

  private async loadFormResource() {
    if (!this.mcpClient) return;

    try {
      this.statusMessage = 'Fetching recipe form...';
      const result = await this.mcpClient.readResource({
        uri: 'a2ui://recipe-form',
      });

      const a2uiContent = result.contents.find(
        (c: any) =>
          c.mimeType === 'application/a2ui+json' || c.mimeType === 'application/json+a2ui',
      );

      if (!a2uiContent || !('text' in a2uiContent)) {
        throw new Error('Resource does not contain valid A2UI JSON data.');
      }

      const parsed = JSON.parse(a2uiContent.text);

      // Process form messages into the surface model
      this.formProcessor.processMessages(parsed);
      this.formSurface = this.formProcessor.model.getSurface('recipe-form');
      this.statusMessage = 'Form loaded successfully';
    } catch (error: any) {
      console.error('Failed to load resource recipe form:', error);
      this.connectionStatus = 'error';
      this.statusMessage = `Form load failed: ${error.message || error}`;
    }
  }

  private async generateRecipe(context: any) {
    if (!this.mcpClient) return;

    this.recipeLoading = true;
    this.statusMessage = 'Generating dynamic recipe card...';

    try {
      // Make MCP Tool Call
      const result = await this.mcpClient.callTool({
        name: 'get_recipe_a2ui',
        arguments: context || {},
      });

      const contentArray = result.content as any[];

      // Extract the returned A2UI embedded resource
      const embedded = contentArray.find((c: any) => c.type === 'resource');
      if (!embedded || !embedded.resource || !embedded.resource.text) {
        throw new Error('Tool did not return a valid recipe A2UI payload.');
      }

      const parsed = JSON.parse(embedded.resource.text);

      // Clear previous recipe surfaces
      for (const surfaceId of Array.from(this.recipeProcessor.model.surfacesMap.keys())) {
        this.recipeProcessor.model.deleteSurface(surfaceId);
      }

      // Process the new recipe card
      this.recipeProcessor.processMessages(parsed);
      this.recipeSurface = this.recipeProcessor.model.getSurface('recipe-card');
      this.statusMessage = 'Recipe card generated!';
    } catch (error: any) {
      console.error('Error generating recipe:', error);
      this.statusMessage = `Generation failed: ${error.message || error}`;
    } finally {
      this.recipeLoading = false;
    }
  }

  render() {
    return html`
      <header>
        <div class="logo">
          <span class="emoji">👨‍🍳</span>
          <h1>A2UIxMCP Recipe Studio</h1>
        </div>
        <div class="status-badge">
          <span class="status-dot ${this.connectionStatus}"></span>
          <span>${this.statusMessage}</span>
        </div>
      </header>

      <main class="main-grid">
        <!-- Left Column: The Customization Form -->
        <section class="section-card">
          <div class="section-title">Configure Choices</div>
          ${this.formSurface
            ? html`<a2ui-surface .surface=${this.formSurface}></a2ui-surface>`
            : html`
                <div class="loader-box">
                  <div class="spinner"></div>
                  <div>Loading settings form...</div>
                </div>
              `}
        </section>

        <!-- Right Column: The Generated Recipe Card -->
        <section class="section-card">
          <div class="section-title">Generated Recipe Card</div>

          ${this.recipeSurface
            ? html`<a2ui-surface .surface=${this.recipeSurface}></a2ui-surface>`
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
          ${this.recipeLoading
            ? html`
                <div class="loading-overlay">
                  <div class="spinner"></div>
                  <div class="loading-text">Customizing layout and cooking details...</div>
                </div>
              `
            : nothing}
        </section>
      </main>
    `;
  }
}
