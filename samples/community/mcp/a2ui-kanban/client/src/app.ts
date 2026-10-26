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
 * The chat UI: a message list, the agent's surfaces, a collapsible protocol
 * debug pane, and an input. The logic lives in `KanbanHost`; this element
 * renders it and connects the two servers: the agent over A2A and the MCP
 * server over Streamable HTTP.
 */

import {Context} from '@a2ui/lit';
import {renderMarkdown} from '@a2ui/markdown-it';
import {provide} from '@lit/context';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {css, html, LitElement, nothing} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {A2aAgentClient, DEFAULT_AGENT_URL} from './a2a.js';
import {
  formatDebugPayload,
  KanbanHost,
  singleServerResolver,
  summarizeDebugPayload,
  type DebugDirection,
  type DebugPanelId,
} from './host.js';

function defaultMcpHost(): string {
  if (typeof window !== 'undefined' && window.location.hostname) {
    return window.location.hostname;
  }
  return 'localhost';
}

/** Default URL of the MCP server's Streamable HTTP endpoint. */
export const DEFAULT_MCP_URL = `http://${defaultMcpHost()}:8788/mcp`;

/** Prompts of the storyline in the README, plus layout presets, one click away. */
const SUGGESTIONS = [
  'Show me the sprint board',
  'Move Write docs back to Todo',
  'Who owns the selected card and when is it due?',
  "What's left for Ana this week?",
  'Switch to the tabs layout',
  'Use the split inspector layout',
  'Wrap the board in cards layout',
];

function envUrl(name: string, fallback: string): string {
  const fromQuery = new URLSearchParams(window.location.search).get(name);
  const fromEnv = (import.meta as unknown as {env?: Record<string, string | undefined>}).env?.[
    `VITE_${name.toUpperCase()}`
  ];
  return fromQuery ?? fromEnv ?? fallback;
}

const DEFAULT_CHAT_WIDTH = 360;
const DEFAULT_DEBUG_WIDTH = 360;
const MIN_CHAT_WIDTH = 220;
const MIN_DEBUG_WIDTH = 240;
const MIN_APP_WIDTH = 260;
const DEFAULT_DEBUG_SECTION_HEIGHT = 220;
const MIN_DEBUG_SECTION_HEIGHT = 80;
const MAX_DEBUG_SECTION_HEIGHT = 900;
const KEYBOARD_RESIZE_STEP = 24;

/** Panels of the debug pane: the live data model plus one per observable hop. */
type DebugSectionId = 'data-model' | DebugPanelId;

const DEBUG_PANELS: ReadonlyArray<{
  id: DebugPanelId;
  title: string;
  emptyText: string;
  openByDefault: boolean;
}> = [
  {
    id: 'a2ui',
    title: 'A2UI · Agent ↔ Renderer',
    emptyText: 'No A2UI messages yet.',
    openByDefault: true,
  },
  {
    id: 'mcp-apps',
    title: 'MCP Apps · Host ↔ App',
    emptyText: 'No MCP Apps messages yet.',
    openByDefault: true,
  },
  {
    id: 'mcp-server',
    title: 'MCP · Host → Server',
    emptyText: 'No tool calls proxied for the app yet.',
    openByDefault: true,
  },
  {
    id: 'a2a',
    title: 'A2A · Host ↔ Agent',
    emptyText: 'No A2A requests sent yet.',
    openByDefault: false,
  },
];

const DIRECTION_LABEL: Record<DebugDirection, string> = {
  'agent-to-renderer': 'agent → renderer',
  'renderer-to-agent': 'renderer → agent',
  'host-to-app': 'host → app',
  'app-to-host': 'app → host',
  'host-to-server': 'host → server',
  'server-to-host': 'server → host',
  'host-to-agent': 'host → agent',
  'agent-to-host': 'agent → host',
};

/** `in` = towards the host/renderer, `out` = away from it. */
const DIRECTION_CLASS: Record<DebugDirection, 'in' | 'out'> = {
  'agent-to-renderer': 'in',
  'renderer-to-agent': 'out',
  'host-to-app': 'out',
  'app-to-host': 'in',
  'host-to-server': 'out',
  'server-to-host': 'in',
  'host-to-agent': 'out',
  'agent-to-host': 'in',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

@customElement('a2ui-kanban-chat')
export class KanbanChat extends LitElement {
  @provide({context: Context.markdown})
  readonly markdownRenderer = (value: string, options?: unknown) =>
    Promise.resolve(renderMarkdown(value, options as never));

  @state() private accessor draft = '';
  @state() private accessor version = 0;
  @state() private accessor debugOpen = true;
  @state() private accessor chatWidth = DEFAULT_CHAT_WIDTH;
  @state() private accessor debugWidth = DEFAULT_DEBUG_WIDTH;
  @state() private accessor activeResizer: 'chat' | 'debug' | null = null;
  @state() private accessor debugSectionHeights: Record<DebugSectionId, number> = {
    'data-model': DEFAULT_DEBUG_SECTION_HEIGHT,
    'a2ui': DEFAULT_DEBUG_SECTION_HEIGHT,
    'mcp-apps': DEFAULT_DEBUG_SECTION_HEIGHT,
    'mcp-server': DEFAULT_DEBUG_SECTION_HEIGHT,
    'a2a': DEFAULT_DEBUG_SECTION_HEIGHT,
  };
  @state() private accessor activeSectionResizer: DebugSectionId | null = null;

  private readonly mcpUrl = envUrl('mcp_url', DEFAULT_MCP_URL);
  private readonly agentUrl = envUrl('agent_url', DEFAULT_AGENT_URL);
  private detachDebugger: (() => void) | null = null;
  private detachResizeListeners: (() => void) | null = null;

  readonly host = new KanbanHost({
    agent: new A2aAgentClient(this.agentUrl, {
      onTraffic: (direction, payload) => this.host.recordDebug(direction, payload),
    }),
    getMcpClientForTool: singleServerResolver(async () => {
      const client = new Client({name: 'a2ui-kanban-chat', version: '1.0.0'});
      await client.connect(new StreamableHTTPClientTransport(new URL(this.mcpUrl)));
      return client;
    }),
    onChange: () => {
      this.version++;
    },
  });

  override connectedCallback() {
    super.connectedCallback();
    if (typeof window !== 'undefined') {
      this.detachDebugger = this.host.attachMcpFrameDebugger(window);
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.detachDebugger?.();
    this.detachDebugger = null;
    this.detachResizeListeners?.();
    this.detachResizeListeners = null;
  }

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
      padding: 10px 16px;
      border-bottom: 1px solid var(--chat-border, #d1d5db);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .header-meta {
      display: flex;
      align-items: baseline;
      gap: 12px;
      flex-wrap: wrap;
    }

    header h1 {
      font-size: 16px;
      margin: 0;
    }

    header .servers {
      font-size: 12px;
      color: var(--chat-muted, #4b5563);
    }

    .debug-toggle {
      font-size: 12px;
      padding: 5px 10px;
      background: var(--chat-surface-bg, #ffffff);
      color: var(--chat-accent, #1d4ed8);
      border: 1px solid var(--chat-accent, #1d4ed8);
      border-radius: 8px;
      cursor: pointer;
    }

    .workspace {
      display: grid;
      grid-template-columns: var(--chat-pane-width, 360px) 8px minmax(260px, 1fr);
      min-height: 0;
      overflow: hidden;
    }

    .workspace.with-debug {
      grid-template-columns:
        var(--chat-pane-width, 360px)
        8px
        minmax(260px, 1fr)
        8px
        var(--debug-pane-width, 360px);
    }

    .workspace.is-resizing {
      user-select: none;
      cursor: col-resize;
    }

    .workspace.is-resizing-vertical {
      user-select: none;
      cursor: row-resize;
    }

    .workspace.is-resizing .app-column,
    .workspace.is-resizing-vertical .app-column {
      pointer-events: none;
    }

    .pane-resizer {
      position: relative;
      cursor: col-resize;
      touch-action: none;
      background: transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      outline: none;
    }

    .pane-resizer::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 50%;
      width: 1px;
      transform: translateX(-50%);
      background: var(--chat-border, #d1d5db);
      transition:
        background-color 120ms ease,
        width 120ms ease;
    }

    .pane-resizer::after {
      content: '';
      width: 4px;
      height: 36px;
      border-radius: 999px;
      background: var(--chat-border, #d1d5db);
      transition:
        background-color 120ms ease,
        transform 120ms ease;
      z-index: 1;
    }

    .pane-resizer:hover::before,
    .pane-resizer:focus-visible::before,
    .pane-resizer.active::before {
      width: 2px;
      background: var(--chat-accent, #1d4ed8);
    }

    .pane-resizer:hover::after,
    .pane-resizer:focus-visible::after,
    .pane-resizer.active::after {
      background: var(--chat-accent, #1d4ed8);
      transform: scaleY(1.15);
    }

    .chat-column {
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto auto;
      min-height: 0;
      min-width: 0;
    }

    .app-column {
      overflow: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 0;
      min-width: 0;
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

    .surface a2ui-basic-row > * {
      min-width: 0;
    }

    .debug-pane {
      background: var(--chat-surface-bg, #ffffff);
      color: var(--chat-fg, #111827);
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
      overflow: auto;
      padding: 12px;
      gap: 12px;
    }

    .debug-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--chat-border, #d1d5db);
    }

    .debug-header h2 {
      font-size: 13px;
      margin: 0;
    }

    .debug-clear {
      font-size: 11px;
      padding: 3px 8px;
      background: var(--chat-surface-bg, #ffffff);
      color: var(--chat-accent, #1d4ed8);
      border: 1px solid var(--chat-accent, #1d4ed8);
      border-radius: 6px;
      cursor: pointer;
    }

    .debug-section {
      border: 1px solid var(--chat-border, #d1d5db);
      border-radius: 8px;
      background: var(--chat-bg, #f9fafb);
      overflow: hidden;
      flex-shrink: 0;
    }

    .debug-section > summary {
      cursor: pointer;
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 600;
      color: var(--chat-fg, #111827);
      background: var(--chat-surface-bg, #ffffff);
      border-bottom: 1px solid var(--chat-border, #d1d5db);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .debug-count {
      font-size: 11px;
      font-weight: 600;
      color: var(--chat-accent, #1d4ed8);
    }

    .debug-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
      box-sizing: border-box;
      overflow: auto;
    }

    .debug-section-resizer {
      height: 10px;
      cursor: row-resize;
      touch-action: none;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--chat-surface-bg, #ffffff);
      border-top: 1px solid var(--chat-border, #d1d5db);
      outline: none;
    }

    .debug-section-resizer::after {
      content: '';
      width: 36px;
      height: 4px;
      border-radius: 999px;
      background: var(--chat-border, #d1d5db);
      transition:
        background-color 120ms ease,
        transform 120ms ease;
    }

    .debug-section-resizer:hover::after,
    .debug-section-resizer:focus-visible::after,
    .debug-section-resizer.active::after {
      background: var(--chat-accent, #1d4ed8);
      transform: scaleX(1.15);
    }

    .debug-empty {
      font-size: 12px;
      color: var(--chat-muted, #4b5563);
      padding: 4px;
    }

    .debug-item {
      border: 1px solid var(--chat-border, #d1d5db);
      border-radius: 6px;
      background: var(--chat-surface-bg, #ffffff);
      padding: 6px 8px;
    }

    .debug-item-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--chat-accent, #1d4ed8);
      margin-bottom: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }

    .debug-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 999px;
      border: 1px solid var(--chat-border, #d1d5db);
      color: var(--chat-fg, #111827);
      background: var(--chat-bg, #f9fafb);
      font-family: system-ui, sans-serif;
    }

    .debug-badge-in {
      border-color: var(--chat-accent, #1d4ed8);
      color: var(--chat-accent, #1d4ed8);
    }

    .debug-badge-out {
      border-color: var(--chat-muted, #4b5563);
      color: var(--chat-muted, #4b5563);
    }

    .debug-badge-agent {
      border-color: var(--chat-accent, #1d4ed8);
      color: var(--chat-accent, #1d4ed8);
    }

    .debug-badge-app {
      border-color: var(--chat-fg, #111827);
    }

    .debug-badge-host {
      border-color: var(--chat-muted, #4b5563);
      color: var(--chat-muted, #4b5563);
    }

    .debug-board-columns {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .debug-column-chip {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 6px;
      background: var(--chat-code-bg, #f3f4f6);
      color: var(--chat-fg, #111827);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    .debug-json {
      margin: 0;
      font-size: 11px;
      line-height: 1.35;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--chat-fg, #111827);
      background: var(--chat-code-bg, #f3f4f6);
      padding: 6px;
      border-radius: 4px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
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
    const totalDebugMessages = host.debugMessageCount;
    const workspaceStyle = `--chat-pane-width: ${this.chatWidth}px; --debug-pane-width: ${this.debugWidth}px;`;
    const workspaceClasses = [
      'workspace',
      this.debugOpen ? 'with-debug' : '',
      this.activeResizer ? 'is-resizing' : '',
      this.activeSectionResizer ? 'is-resizing-vertical' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return html`
      <header>
        <div class="header-meta">
          <h1>Kanban showcase</h1>
          <span class="servers">agent ${this.agentUrl} · mcp ${this.mcpUrl}</span>
        </div>
        <button
          type="button"
          class="debug-toggle"
          aria-expanded=${this.debugOpen ? 'true' : 'false'}
          @click=${() => {
            this.debugOpen = !this.debugOpen;
          }}
        >
          ${this.debugOpen ? 'Hide debug pane' : 'Show debug pane'} (${totalDebugMessages})
        </button>
      </header>
      <div class=${workspaceClasses} style=${workspaceStyle}>
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
        ${this.renderResizer('chat', 'Resize chat pane')}
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
        ${this.debugOpen ? this.renderResizer('debug', 'Resize debug pane') : nothing}
        ${this.debugOpen ? this.renderDebugPane() : nothing}
      </div>
    `;
  }

  private renderResizer(kind: 'chat' | 'debug', label: string) {
    const isActive = this.activeResizer === kind;
    const valueNow = kind === 'chat' ? this.chatWidth : this.debugWidth;
    const valueMin = kind === 'chat' ? MIN_CHAT_WIDTH : MIN_DEBUG_WIDTH;
    return html`
      <div
        class="pane-resizer ${isActive ? 'active' : ''}"
        role="separator"
        aria-orientation="vertical"
        aria-label=${label}
        aria-valuenow=${valueNow}
        aria-valuemin=${valueMin}
        tabindex="0"
        data-resizer=${kind}
        title="${label} (drag or use Left/Right arrows, double-click to reset)"
        @pointerdown=${(event: PointerEvent) => this.startResize(kind, event)}
        @keydown=${(event: KeyboardEvent) => this.onResizerKeyDown(kind, event)}
        @dblclick=${() => this.resetPaneWidth(kind)}
      ></div>
    `;
  }

  private getWorkspaceWidth(): number {
    const workspace = this.renderRoot.querySelector('.workspace');
    if (workspace) {
      const rect = workspace.getBoundingClientRect();
      if (rect.width > 0) {
        return rect.width;
      }
    }
    return typeof window !== 'undefined' ? window.innerWidth : 1280;
  }

  private applyChatWidth(nextWidth: number, workspaceWidth = this.getWorkspaceWidth()): void {
    const reservedRight = (this.debugOpen ? this.debugWidth + 16 : 8) + MIN_APP_WIDTH;
    const maxChatWidth = Math.max(MIN_CHAT_WIDTH, workspaceWidth - reservedRight);
    this.chatWidth = Math.round(clamp(nextWidth, MIN_CHAT_WIDTH, maxChatWidth));
  }

  private applyDebugWidth(nextWidth: number, workspaceWidth = this.getWorkspaceWidth()): void {
    const reservedLeft = this.chatWidth + 16 + MIN_APP_WIDTH;
    const maxDebugWidth = Math.max(MIN_DEBUG_WIDTH, workspaceWidth - reservedLeft);
    this.debugWidth = Math.round(clamp(nextWidth, MIN_DEBUG_WIDTH, maxDebugWidth));
  }

  private startResize(kind: 'chat' | 'debug', event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.detachResizeListeners?.();

    const startX = event.clientX;
    const startChatWidth = this.chatWidth;
    const startDebugWidth = this.debugWidth;
    const workspaceWidth = this.getWorkspaceWidth();
    const handle = event.currentTarget as HTMLElement | null;
    try {
      handle?.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignore synthetic events where pointerId is not active.
    }

    this.activeResizer = kind;

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (kind === 'chat') {
        const delta = moveEvent.clientX - startX;
        this.applyChatWidth(startChatWidth + delta, workspaceWidth);
      } else {
        const delta = startX - moveEvent.clientX;
        this.applyDebugWidth(startDebugWidth + delta, workspaceWidth);
      }
    };

    const stopResize = () => {
      this.activeResizer = null;
      this.detachResizeListeners?.();
      this.detachResizeListeners = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    this.detachResizeListeners = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }

  private onResizerKeyDown(kind: 'chat' | 'debug', event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    if (kind === 'chat') {
      this.applyChatWidth(this.chatWidth + direction * KEYBOARD_RESIZE_STEP);
    } else {
      this.applyDebugWidth(this.debugWidth - direction * KEYBOARD_RESIZE_STEP);
    }
  }

  private resetPaneWidth(kind: 'chat' | 'debug'): void {
    if (kind === 'chat') {
      this.applyChatWidth(DEFAULT_CHAT_WIDTH);
    } else {
      this.applyDebugWidth(DEFAULT_DEBUG_WIDTH);
    }
  }

  private renderDebugPane() {
    const {host} = this;
    const hasMessages = host.debugMessageCount > 0;
    return html`
      <aside class="debug-pane" aria-label="Debug information">
        <div class="debug-header">
          <h2>Protocol Debug Inspector</h2>
          <button
            type="button"
            class="debug-clear"
            aria-label="Clear debug messages"
            ?disabled=${!hasMessages}
            @click=${() => {
              host.clearDebugMessages();
            }}
          >
            Clear
          </button>
        </div>
        ${this.renderDataModelPanel()}
        ${DEBUG_PANELS.map(panel =>
          this.renderDebugSection(panel.id, panel.title, panel.emptyText, panel.openByDefault),
        )}
      </aside>
    `;
  }

  /** The `/kanban` subtree of the surface data model: the hub every other panel writes to. */
  private renderDataModelPanel() {
    const kanban = this.host.kanbanDataModel();
    const keys = kanban ? Object.keys(kanban).filter(key => key !== 'toolResult') : [];
    const board = kanban?.['board'];
    const summary = kanban?.['summary'];
    const columns =
      board && typeof board === 'object' && Array.isArray((board as {columns?: unknown}).columns)
        ? ((board as {columns: Array<Record<string, unknown>>}).columns ?? [])
        : [];
    const body =
      kanban === null
        ? html`<div class="debug-empty">No surface yet; ask the agent to show the board.</div>`
        : html`
            ${columns.length > 0
              ? html`<div class="debug-item">
                  <div class="debug-item-label">board ${this.renderWriterBadge('board')}</div>
                  <div class="debug-board-columns">
                    ${columns.map(column => {
                      const cards = Array.isArray(column['cards']) ? column['cards'].length : 0;
                      const limit = column['wipLimit'];
                      return html`<span class="debug-column-chip"
                        >${String(column['title'] ?? column['id'])}:
                        ${cards}${typeof limit === 'number' ? `/${limit}` : ''}</span
                      >`;
                    })}
                  </div>
                </div>`
              : nothing}
            ${summary !== undefined
              ? html`<div class="debug-item">
                  <div class="debug-item-label">summary ${this.renderWriterBadge('summary')}</div>
                  <pre class="debug-json">${formatDebugPayload(summary)}</pre>
                </div>`
              : nothing}
            ${keys
              .filter(key => key !== 'board' && key !== 'summary')
              .map(
                key =>
                  html`<div class="debug-item">
                    <div class="debug-item-label">${key} ${this.renderWriterBadge(key)}</div>
                    <pre class="debug-json">${formatDebugPayload(kanban[key])}</pre>
                  </div>`,
              )}
          `;
    return this.renderDebugPanelShell(
      'data-model',
      'Data model (/kanban)',
      keys.length,
      body,
      true,
    );
  }

  private renderWriterBadge(key: string) {
    const writer = key === 'summary' ? 'host' : this.host.lastWriter[key];
    return writer
      ? html`<span class="debug-badge debug-badge-${writer}">last written by ${writer}</span>`
      : nothing;
  }

  private renderDebugSection(
    sectionId: DebugPanelId,
    title: string,
    emptyText: string,
    openByDefault: boolean,
  ) {
    const entries = this.host.debugLog[sectionId];
    const body =
      entries.length === 0
        ? html`<div class="debug-empty">${emptyText}</div>`
        : entries.map(
            (entry, index) => html`
              <div class="debug-item">
                <div class="debug-item-label">
                  #${index + 1}
                  <span class="debug-badge debug-badge-${DIRECTION_CLASS[entry.direction]}"
                    >${DIRECTION_LABEL[entry.direction]}</span
                  >
                  ${summarizeDebugPayload(entry.payload)}
                </div>
                <pre class="debug-json">${formatDebugPayload(entry.payload)}</pre>
              </div>
            `,
          );
    return this.renderDebugPanelShell(sectionId, title, entries.length, body, openByDefault);
  }

  private renderDebugPanelShell(
    sectionId: DebugSectionId,
    title: string,
    count: number,
    body: unknown,
    openByDefault: boolean,
  ) {
    const sectionHeight = this.debugSectionHeights[sectionId] ?? DEFAULT_DEBUG_SECTION_HEIGHT;
    const isActive = this.activeSectionResizer === sectionId;
    return html`
      <details class="debug-section" data-debug-section=${sectionId} ?open=${openByDefault}>
        <summary>
          <span>${title}</span>
          <span class="debug-count">${count}</span>
        </summary>
        <div class="debug-list" style="height: ${sectionHeight}px;">${body}</div>
        <div
          class="debug-section-resizer ${isActive ? 'active' : ''}"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize ${title} panel"
          aria-valuenow=${sectionHeight}
          aria-valuemin=${MIN_DEBUG_SECTION_HEIGHT}
          aria-valuemax=${MAX_DEBUG_SECTION_HEIGHT}
          tabindex="0"
          data-section-resizer=${sectionId}
          title="Resize ${title} panel height (drag or use Up/Down arrows, double-click to reset)"
          @pointerdown=${(event: PointerEvent) => this.startSectionResize(sectionId, event)}
          @keydown=${(event: KeyboardEvent) => this.onSectionResizerKeyDown(sectionId, event)}
          @dblclick=${() => this.resetSectionHeight(sectionId)}
        ></div>
      </details>
    `;
  }

  private applySectionHeight(sectionId: DebugSectionId, nextHeight: number): void {
    const clamped = Math.round(
      clamp(nextHeight, MIN_DEBUG_SECTION_HEIGHT, MAX_DEBUG_SECTION_HEIGHT),
    );
    this.debugSectionHeights = {
      ...this.debugSectionHeights,
      [sectionId]: clamped,
    };
  }

  private startSectionResize(sectionId: DebugSectionId, event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.detachResizeListeners?.();

    const startY = event.clientY;
    const startHeight = this.debugSectionHeights[sectionId] ?? DEFAULT_DEBUG_SECTION_HEIGHT;
    const handle = event.currentTarget as HTMLElement | null;
    try {
      handle?.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignore synthetic events where pointerId is not active.
    }

    this.activeSectionResizer = sectionId;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientY - startY;
      this.applySectionHeight(sectionId, startHeight + delta);
    };

    const stopResize = () => {
      this.activeSectionResizer = null;
      this.detachResizeListeners?.();
      this.detachResizeListeners = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    this.detachResizeListeners = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }

  private onSectionResizerKeyDown(sectionId: DebugSectionId, event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const current = this.debugSectionHeights[sectionId] ?? DEFAULT_DEBUG_SECTION_HEIGHT;
    this.applySectionHeight(sectionId, current + direction * KEYBOARD_RESIZE_STEP);
  }

  private resetSectionHeight(sectionId: DebugSectionId): void {
    this.applySectionHeight(sectionId, DEFAULT_DEBUG_SECTION_HEIGHT);
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
