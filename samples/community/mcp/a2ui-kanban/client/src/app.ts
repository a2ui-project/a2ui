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

/**
 * The chat UI: a message list, the agent's surfaces and an input. The logic
 * lives in `KanbanHost`; this element renders it and connects the two
 * servers: the agent over A2A and the MCP server over Streamable HTTP.
 */

import {Context} from '@a2ui/lit';
import {renderMarkdown} from '@a2ui/markdown-it';
import {provide} from '@lit/context';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {css, html, LitElement, nothing} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {A2aAgentClient, DEFAULT_AGENT_URL} from './a2a.js';
import {KanbanHost, singleServerResolver} from './host.js';

function defaultMcpHost(): string {
  if (typeof window !== 'undefined' && window.location.hostname) {
    return window.location.hostname;
  }
  return 'localhost';
}

/** Default URL of the MCP server's Streamable HTTP endpoint. */
export const DEFAULT_MCP_URL = `http://${defaultMcpHost()}:8788/mcp`;

/** Prompts of the storyline in the README, one click away. */
const SUGGESTIONS = [
  'Show me the sprint board',
  'Move Write docs back to Todo',
  'Who owns the selected card and when is it due?',
  "What's left for Ana this week?",
];

function envUrl(name: string, fallback: string): string {
  const fromQuery = new URLSearchParams(window.location.search).get(name);
  const fromEnv = (import.meta as unknown as {env?: Record<string, string | undefined>}).env?.[
    `VITE_${name.toUpperCase()}`
  ];
  return fromQuery ?? fromEnv ?? fallback;
}

@customElement('a2ui-kanban-chat')
export class KanbanChat extends LitElement {
  @provide({context: Context.markdown})
  readonly markdownRenderer = (value: string, options?: unknown) =>
    Promise.resolve(renderMarkdown(value, options as never));

  @state() private accessor draft = '';
  @state() private accessor version = 0;

  private readonly mcpUrl = envUrl('mcp_url', DEFAULT_MCP_URL);
  private readonly agentUrl = envUrl('agent_url', DEFAULT_AGENT_URL);

  readonly host = new KanbanHost({
    agent: new A2aAgentClient(this.agentUrl),
    getMcpClientForTool: singleServerResolver(async () => {
      const client = new Client({name: 'a2ui-kanban-chat', version: '1.0.0'});
      await client.connect(new StreamableHTTPClientTransport(new URL(this.mcpUrl)));
      return client;
    }),
    onChange: () => {
      this.version++;
    },
  });

  static override styles = css`
    :host {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      height: 100vh;
      font-family: system-ui, sans-serif;
      color: var(--chat-fg, #111827);
      --a2ui-sandboxed-frame-height: 620px;
    }

    header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--chat-border, #d1d5db);
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
    }

    header h1 {
      font-size: 16px;
      margin: 0;
    }

    header .servers {
      font-size: 12px;
      color: var(--chat-muted, #4b5563);
    }

    .workspace {
      display: grid;
      grid-template-columns: minmax(340px, 440px) minmax(0, 1fr);
      min-height: 0;
      overflow: hidden;
    }

    .chat-column {
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto auto;
      min-height: 0;
      border-right: 1px solid var(--chat-border, #d1d5db);
    }

    .app-column {
      overflow: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 0;
    }

    .app-placeholder {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px dashed var(--chat-border, #d1d5db);
      border-radius: 12px;
      color: var(--chat-muted, #4b5563);
      font-size: 14px;
      padding: 24px;
      text-align: center;
    }

    .log {
      overflow: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .entry {
      max-width: 85%;
      padding: 8px 12px;
      border-radius: 12px;
      white-space: pre-wrap;
      line-height: 1.4;
    }

    .entry.user {
      align-self: flex-end;
      background: var(--chat-primary-bg, #1d4ed8);
      color: var(--chat-primary-fg, #ffffff);
    }

    .entry.agent {
      align-self: flex-start;
      background: var(--chat-agent-bg, #e5e7eb);
      color: var(--chat-fg, #111827);
    }

    .entry.system {
      align-self: center;
      font-size: 12px;
      color: var(--chat-muted, #4b5563);
    }

    .surface {
      background: var(--chat-surface-bg, #ffffff);
      color: var(--chat-fg, #111827);
      border: 1px solid var(--chat-border, #d1d5db);
      border-radius: 12px;
      padding: 12px;
    }

    form {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--chat-border, #d1d5db);
    }

    input {
      flex: 1;
      font: inherit;
      padding: 8px 10px;
      background: var(--chat-input-bg, #ffffff);
      color: var(--chat-fg, #111827);
      border: 1px solid var(--chat-border, #d1d5db);
      border-radius: 8px;
    }

    button {
      font: inherit;
      padding: 8px 14px;
      border-radius: 8px;
      border: 1px solid var(--chat-primary-bg, #1d4ed8);
      background: var(--chat-primary-bg, #1d4ed8);
      color: var(--chat-primary-fg, #ffffff);
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px 16px;
      border-top: 1px solid var(--chat-border, #d1d5db);
    }

    .suggestions button {
      background: var(--chat-surface-bg, #ffffff);
      color: var(--chat-accent, #1d4ed8);
      border-color: var(--chat-accent, #1d4ed8);
      font-size: 12px;
      padding: 4px 10px;
    }
  `;

  override render() {
    // `version` is read so Lit re-renders when the host changes.
    void this.version;
    const {host} = this;
    return html`
      <header>
        <h1>Kanban showcase</h1>
        <span class="servers">agent ${this.agentUrl} · mcp ${this.mcpUrl}</span>
      </header>
      <div class="workspace">
        <section class="chat-column" aria-label="Chat">
          <div class="log">
            ${host.entries.map(entry => html`<div class="entry ${entry.role}">${entry.text}</div>`)}
            ${host.isBusy ? html`<div class="entry system">Thinking...</div>` : nothing}
          </div>
          <div class="suggestions">
            ${SUGGESTIONS.map(
              text =>
                html`<button type="button" ?disabled=${host.isBusy} @click=${() => this.send(text)}>
                  ${text}
                </button>`,
            )}
          </div>
          <form @submit=${this.onSubmit}>
            <input
              aria-label="Message to the agent"
              placeholder="Ask the agent about the board"
              .value=${this.draft}
              @input=${(event: InputEvent) => {
                this.draft = (event.target as HTMLInputElement).value;
              }}
            />
            <button type="submit" ?disabled=${host.isBusy || this.draft.trim() === ''}>Send</button>
          </form>
        </section>
        <section class="app-column" aria-label="MCP App">
          ${host.surfaces.length > 0
            ? host.surfaces.map(
                surface =>
                  html`<div class="surface">
                    <a2ui-surface .surface=${surface}></a2ui-surface>
                  </div>`,
              )
            : html`<div class="app-placeholder">
                Ask the agent to show the sprint board to open the interactive MCP App here.
              </div>`}
        </section>
      </div>
    `;
  }

  private readonly onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const text = this.draft;
    this.draft = '';
    void this.send(text);
  };

  private async send(text: string): Promise<void> {
    await this.host.sendUserText(text);
    await this.updateComplete;
    const log = this.renderRoot.querySelector('.log');
    log?.scrollTo({top: log.scrollHeight});
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'a2ui-kanban-chat': KanbanChat;
  }
}
