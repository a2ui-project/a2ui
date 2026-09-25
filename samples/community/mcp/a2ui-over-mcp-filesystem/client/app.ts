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

/**
 * Client application for the A2UI-over-MCP filesystem browser sample.
 *
 * Connects to a filesystem MCP server and loads the static A2UI payload
 * (`a2ui_filesystem.json`). All tool calls and data transformations are
 * defined declaratively in the payload.
 */

import {Context, basicCatalog} from '@a2ui/lit/v0_9';
import '@a2ui/lit/v0_9'; // Registers <a2ui-surface>.
import {renderMarkdown} from '@a2ui/markdown-it';
import {createMcpCatalogFunctions} from '@a2ui/catalog-mcp';
import {Catalog, MessageProcessor, type A2uiMessage, type SurfaceModel} from '@a2ui/web_core/v0_9';
import {provide} from '@lit/context';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';

import surfaceMessages from '../a2ui_filesystem.json';

/** Catalog ID combining basic A2UI components with MCP catalog functions. */
export const CATALOG_ID =
  'https://a2ui.org/specification/v0_9/catalogs/basic_with_mcp/catalog.json';

/** Local proxy endpoint forwarding requests to the MCP server. */
export const MCP_ENDPOINT = '/mcp';

@customElement('a2ui-filesystem-app')
export class A2uiFilesystemApp extends LitElement {
  /** Markdown renderer for displaying file contents and formatted text. */
  @provide({context: Context.markdown})
  markdownRenderer = (value: string, options?: unknown) =>
    Promise.resolve(renderMarkdown(value, options as never));

  readonly processor: MessageProcessor<any>;

  @state() accessor surface: SurfaceModel<any> | undefined;
  @state() private accessor error = '';

  private mcpClient?: Client;

  constructor() {
    super();
    const catalogs: Array<Catalog<any>> = [];
    this.processor = new MessageProcessor<any>(catalogs);
    catalogs.push(
      new Catalog<any>(CATALOG_ID, Array.from(basicCatalog.components.values()), [
        ...Array.from(basicCatalog.functions.values()),
        ...createMcpCatalogFunctions(() => this.mcpClient, this.processor),
      ]),
    );

    this.processor.onSurfaceCreated(surface => {
      this.surface = surface;
      surface.onError.subscribe(event => {
        this.error = event.message ?? String(event.code);
      });
    });
  }

  override async connectedCallback() {
    super.connectedCallback();
    try {
      this.mcpClient = new Client(
        {name: 'a2ui-filesystem-browser', version: '1.0.0'},
        {capabilities: {a2ui: {clientCapabilities: this.processor.getClientCapabilities()}} as any},
      );
      await this.mcpClient.connect(
        new StreamableHTTPClientTransport(new URL(MCP_ENDPOINT, window.location.origin)),
      );
      this.processor.processMessages(structuredClone(surfaceMessages) as unknown as A2uiMessage[]);
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
      max-width: 1400px;
      margin: 0 auto;
      padding: 32px 24px;
      box-sizing: border-box;
      color: #f1f5f9;
      color-scheme: dark;

      /* A2UI Design Tokens */
      --a2ui-color-primary: #3b82f6;
      --a2ui-color-primary-hover: #2563eb;
      --a2ui-color-on-primary: #ffffff;
      --a2ui-color-secondary: #1e293b;
      --a2ui-color-secondary-hover: #334155;
      --a2ui-color-on-secondary: #f1f5f9;
      --a2ui-color-surface: #151e2e;
      --a2ui-color-on-surface: #f1f5f9;
      --a2ui-color-border: rgba(255, 255, 255, 0.08);
      --a2ui-color-input: #0b1120;
      --a2ui-color-on-input: #f8fafc;
      --a2ui-color-on-background: #f1f5f9;

      --a2ui-border-radius: 12px;
      --a2ui-border-width: 1px;
      --a2ui-spacing-xs: 4px;
      --a2ui-spacing-s: 8px;
      --a2ui-spacing-m: 12px;
      --a2ui-spacing-l: 16px;
      --a2ui-spacing-xl: 24px;

      --a2ui-card-background: #151e2e;
      --a2ui-card-border: 1px solid rgba(255, 255, 255, 0.08);
      --a2ui-card-border-radius: 14px;
      --a2ui-card-padding: 20px;
      --a2ui-card-box-shadow:
        0 10px 30px -10px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04);
      --a2ui-card-margin: 0;

      --a2ui-button-border-radius: 8px;
      --a2ui-button-padding: 8px 16px;
      --a2ui-button-margin: 0;
      --a2ui-button-font-weight: 500;
      --a2ui-button-border: 1px solid rgba(255, 255, 255, 0.12);
      --a2ui-button-background: #1e293b;

      --a2ui-textfield-border: 1px solid rgba(255, 255, 255, 0.12);
      --a2ui-textfield-border-radius: 8px;
      --a2ui-textfield-padding: 9px 13px;
      --a2ui-textfield-color-border-focus: #3b82f6;
      --a2ui-label-font-size: 13px;
      --a2ui-label-font-weight: 600;

      --a2ui-list-padding: 0;
      --a2ui-list-gap: 2px;
      --a2ui-text-caption-color: #94a3b8;
      --a2ui-icon-size: 18px;
      --a2ui-icon-color: #60a5fa;

      --a2ui-row-gap: 12px;
      --a2ui-column-gap: 16px;
    }

    .error {
      margin-bottom: 20px;
      padding: 14px 18px;
      border-radius: 10px;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    a2ui-surface {
      display: block;
      width: 100%;
    }
  `;

  render() {
    return html`
      ${this.error ? html`<p class="error">${this.error}</p>` : ''}
      ${this.surface ? html`<a2ui-surface .surface=${this.surface}></a2ui-surface>` : ''}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'a2ui-filesystem-app': A2uiFilesystemApp;
  }
}
