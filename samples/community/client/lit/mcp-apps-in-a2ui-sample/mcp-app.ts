/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {SignalWatcher} from '@lit-labs/signals';
import {provide} from '@lit/context';
import {LitElement, html, css, nothing, unsafeCSS} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {A2UIClient} from './client.js';
import {v0_8} from '@a2ui/lit';
import * as UI from '@a2ui/lit/ui';

// Register custom components
import {registerMcpComponents} from './ui/custom-components/register-components.js';
import {theme as uiTheme} from './theme/theme.js';
registerMcpComponents();

@customElement('a2ui-mcp-sample')
export class A2UIMcpSample extends SignalWatcher(LitElement) {
  @provide({context: UI.Context.themeContext})
  accessor theme: v0_8.Types.Theme = uiTheme;

  @provide({context: UI.Context.markdown})
  accessor markdownRenderer: v0_8.Types.MarkdownRenderer = async text => text; // Minimal, no MD needed likely

  @state()
  accessor #requesting = false;

  @state()
  accessor #processor = v0_8.Data.createSignalA2uiMessageProcessor();

  @state()
  accessor #logs: Array<{type: 'sent' | 'received'; data: any; expanded: boolean}> = [];

  #a2uiClient = new A2UIClient();

  connectedCallback() {
    super.connectedCallback();
    // Only send if we don't have surfaces yet and not already requesting
    if (this.#processor.getSurfaces().size === 0 && !this.#requesting) {
      this.#sendAndProcessMessage({request: 'Load MCP App'});
    }
  }

  static styles = [
    unsafeCSS(v0_8.Styles.structuralStyles),
    css`
      :host {
        display: block;
        max-width: 800px;
        margin: 20px auto;
        padding: 16px;
        background: #fff;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      .loading {
        text-align: center;
        padding: 20px;
      }
      .debug-panel {
        margin-top: 30px;
        padding: 16px;
        background: #1e1e1e;
        color: #d4d4d4;
        border-radius: 8px;
        font-family: monospace;
      }
      .debug-panel h3 {
        margin-top: 0;
        color: #569cd6;
      }
      .log-entries {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .log-entry {
        background: #252526;
        border-radius: 4px;
        cursor: pointer;
        overflow: hidden;
      }
      .log-entry:hover {
        background: #2a2a2d;
      }
      .log-header {
        display: flex;
        justify-content: space-between;
        padding: 8px 12px;
        align-items: center;
      }
      .log-type {
        font-weight: bold;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 0.8em;
      }
      .log-entry.sent .log-type {
        background: #0e639c;
        color: white;
      }
      .log-entry.received .log-type {
        background: #165a2c;
        color: white;
      }
      .log-summary {
        flex: 1;
        margin: 0 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .log-toggle {
        font-size: 0.8em;
      }
      .log-detail {
        margin: 0;
        padding: 12px;
        background: #1c1c1c;
        border-top: 1px solid #333;
        overflow-x: auto;
        font-size: 0.9em;
        color: #9cdcfe;
      }
    `,
  ];

  render() {
    if (this.#requesting && this.#processor.getSurfaces().size === 0) {
      return html`<div class="loading">Loading MCP App...</div>`;
    }

    const surfaces = Array.from(this.#processor.getSurfaces().values());

    return html`
      <h1>MCP App Standalone Sample</h1>
      <div id="surfaces">
        ${surfaces.map(
          surface => html`
            <a2ui-surface
              .surface=${{...surface}}
              .enableCustomElements=${true}
              @a2uiaction=${this.#handleAction}
            ></a2ui-surface>
          `,
        )}
      </div>

      <div class="debug-panel">
        <h3>Communication Log</h3>
        <div class="log-entries">
          ${this.#logs.map(
            (log, index) => html`
              <div class="log-entry ${log.type}" @click=${() => this.#toggleLog(index)}>
                <div class="log-header">
                  <span class="log-type">${log.type.toUpperCase()}</span>
                  <span class="log-summary">${this.#getLogSummary(log.data)}</span>
                  <span class="log-toggle">${log.expanded ? '▼' : '▶'}</span>
                </div>
                ${log.expanded
                  ? html` <pre class="log-detail">${JSON.stringify(log.data, null, 2)}</pre> `
                  : nothing}
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }

  #toggleLog(index: number) {
    this.#logs = this.#logs.map((log, i) =>
      i === index ? {...log, expanded: !log.expanded} : log,
    );
  }

  #getLogSummary(data: any): string {
    if (data.request) return `Request: ${data.request}`;
    if (data.userAction) return `Action: ${data.userAction.name}`;
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      if (first.beginRendering) return `Render: ${first.beginRendering.surfaceId}`;
      if (first.surfaceUpdate) return `Update: ${first.surfaceUpdate.surfaceId}`;
    }
    if (data.error) return `Error: ${data.error}`;
    return JSON.stringify(data).substring(0, 50) + '...';
  }

  async #handleAction(evt: v0_8.Events.StateEvent<'a2ui.action'>) {
    const [target] = evt.composedPath();
    if (!(target instanceof HTMLElement)) return;

    // Convert context to flat map as required by client message
    const context: Record<string, any> = {};
    if (evt.detail.action.context) {
      for (const item of evt.detail.action.context) {
        if (item.value.literalString) context[item.key] = item.value.literalString;
        else if (item.value.literalNumber) context[item.key] = item.value.literalNumber;
        else if (item.value.literalBoolean) context[item.key] = item.value.literalBoolean;
      }
    }

    const message: v0_8.Types.A2UIClientEventMessage = {
      userAction: {
        surfaceId: evt.detail.sourceComponentId,
        name: evt.detail.action.name,
        sourceComponentId: target.id,
        timestamp: new Date().toISOString(),
        context,
      },
    };

    await this.#sendAndProcessMessage(message);
  }

  async #sendAndProcessMessage(request: v0_8.Types.A2UIClientEventMessage) {
    this.#requesting = true;
    this.#logs = [...this.#logs, {type: 'sent', data: request, expanded: false}];
    try {
      const messages = await this.#a2uiClient.send(request);
      this.#logs = [...this.#logs, {type: 'received', data: messages, expanded: false}];
      this.#processor.processMessages(messages);
      this.requestUpdate();
    } catch (err) {
      console.error('Failed to send message:', err);
      this.#logs = [
        ...this.#logs,
        {type: 'received', data: {error: (err as Error).message}, expanded: false},
      ];
    } finally {
      this.#requesting = false;
    }
  }
}
