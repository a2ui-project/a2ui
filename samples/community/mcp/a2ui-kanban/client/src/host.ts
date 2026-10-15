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
 * The chat host's logic without the UI: the `MessageProcessor` with the basic
 * and MCP catalogs, the summary subscription, turns to the agent and the
 * `a2ui.mcpAppMessage` actions coming back from the board app. `app.ts` wraps
 * it in a Lit element; the tests drive it directly.
 */

import type {Part} from '@a2a-js/sdk';
import {
  configureMcpCatalog,
  mcpCatalog,
  type McpClientResolver,
  type McpToolClient,
} from '@a2ui/catalog-mcp';
import {
  basicCatalog,
  MessageProcessor,
  type ActionPayload,
  type SurfaceModel,
} from '@a2ui/web_core/v1_0';
import {a2uiDataPart, type AgentClient, type AgentReply} from './a2a.js';
import {attachBoardSummary, BOARD_PATH, KANBAN_SURFACE_ID} from './summary.js';

/** Action name the `McpApp` host dispatches for an app's `ui/message` request. */
export const MCP_APP_MESSAGE_ACTION = 'a2ui.mcpAppMessage';

/** Data model keys that are too big or too raw to send with every turn. */
const OMITTED_DATA_MODEL_KEYS: ReadonlySet<string> = new Set(['board', 'toolResult']);

/** One line of the conversation. */
export interface ChatEntry {
  readonly role: 'user' | 'agent' | 'system';
  readonly text: string;
}

/** What the host needs from its surroundings. */
export interface KanbanHostOptions {
  readonly agent: AgentClient;
  /** Resolves the MCP client that runs a tool the board app calls. */
  readonly getMcpClientForTool: McpClientResolver;
  /** Called after every change the UI should reflect. */
  readonly onChange?: () => void;
}

/** A content block of a `ui/message` request, as the `McpApp` host forwards it. */
interface MessageContentBlock {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly _meta?: unknown;
}

export class KanbanHost {
  readonly processor: MessageProcessor;
  readonly entries: ChatEntry[] = [];
  private busy = false;
  private readonly detachSummary = new Map<string, () => void>();

  constructor(private readonly options: KanbanHostOptions) {
    this.processor = new MessageProcessor(
      [basicCatalog, mcpCatalog],
      action => {
        void this.handleAction(action);
      },
      {version: 'v1.0'},
    );
    configureMcpCatalog({
      getMcpClientForTool: options.getMcpClientForTool,
      processor: this.processor,
    });
    this.processor.model.onSurfaceCreated.subscribe(surface => {
      this.detachSummary.get(surface.id)?.();
      this.detachSummary.set(surface.id, attachBoardSummary(surface));
      surface.onError.subscribe(error => {
        this.push('system', `Surface error on ${surface.id}: ${error.message ?? String(error)}`);
      });
      this.notify();
    });
    this.processor.model.onSurfaceDeleted.subscribe(surfaceId => {
      this.detachSummary.get(surfaceId)?.();
      this.detachSummary.delete(surfaceId);
      this.notify();
    });
  }

  /** Whether a turn is in flight. */
  get isBusy(): boolean {
    return this.busy;
  }

  /** The surfaces to render, in creation order. */
  get surfaces(): SurfaceModel[] {
    return [...this.processor.model.surfacesMap.values()];
  }

  /** The board surface, once the agent has created it. */
  get boardSurface(): SurfaceModel | undefined {
    return this.processor.model.getSurface(KANBAN_SURFACE_ID);
  }

  /** Sends what the user typed. */
  async sendUserText(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed === '') {
      return;
    }
    this.push('user', trimmed);
    await this.sendTurn([{kind: 'text', text: trimmed}]);
  }

  /**
   * Handles an action from any surface. `a2ui.mcpAppMessage` is the board app
   * talking to the agent (channel D): its text becomes a user turn, and the
   * action itself travels along as an A2UI `action` message, so the agent
   * also sees the structured event in the text block's `_meta`.
   */
  async handleAction(action: ActionPayload): Promise<void> {
    if (action.name !== MCP_APP_MESSAGE_ACTION) {
      this.push('system', `Action ${action.name} from ${action.sourceComponentId}`);
      return;
    }
    const text = messageText(action.context['content']);
    this.push('user', text === '' ? '(message from the board app)' : text);
    const parts: Part[] = [];
    if (text !== '') {
      parts.push({kind: 'text', text});
    }
    parts.push(
      a2uiDataPart({
        version: 'v1.0',
        action: {
          name: action.name,
          surfaceId: action.surfaceId,
          sourceComponentId: action.sourceComponentId,
          timestamp: action.timestamp,
          context: action.context,
        },
      }),
    );
    await this.sendTurn(parts);
  }

  /**
   * The renderer data model that accompanies every turn (channel B): the
   * surface data model without the board itself, which the agent reads with
   * `list_board`, and without the raw tool result.
   */
  rendererDataModel(): Record<string, unknown> | null {
    const surface = this.boardSurface;
    if (!surface) {
      return null;
    }
    const kanban = surface.dataModel.get<Record<string, unknown> | undefined>('/kanban');
    if (!kanban || typeof kanban !== 'object' || Array.isArray(kanban)) {
      return null;
    }
    const trimmed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(kanban)) {
      if (!OMITTED_DATA_MODEL_KEYS.has(key)) {
        trimmed[key] = value;
      }
    }
    return {version: 'v1.0', surfaces: {[KANBAN_SURFACE_ID]: {kanban: trimmed}}};
  }

  /** The board as the host currently has it, for the UI status line. */
  currentBoard(): unknown {
    return this.boardSurface?.dataModel.get(BOARD_PATH);
  }

  private async sendTurn(parts: Part[]): Promise<void> {
    const dataModel = this.rendererDataModel();
    if (dataModel) {
      parts.push(a2uiDataPart(dataModel));
    }
    this.busy = true;
    this.notify();
    try {
      const reply = await this.options.agent.send(parts);
      this.applyReply(reply);
    } catch (error) {
      this.push('system', `Agent error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy = false;
      this.notify();
    }
  }

  private applyReply(reply: AgentReply): void {
    if (reply.a2uiMessages.length > 0) {
      this.processor.processMessages(reply.a2uiMessages);
    }
    for (const text of reply.texts) {
      this.push('agent', text);
    }
  }

  private push(role: ChatEntry['role'], text: string): void {
    this.entries.push({role, text});
    this.notify();
  }

  private notify(): void {
    this.options.onChange?.();
  }
}

/** Joins the text blocks of a `ui/message` content array. */
export function messageText(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map(block =>
      block && typeof block === 'object' && (block as MessageContentBlock).type === 'text'
        ? String((block as MessageContentBlock).text ?? '')
        : '',
    )
    .filter(text => text !== '')
    .join('\n');
}

/** Connects one MCP client lazily and hands it to every tool the app calls. */
export function singleServerResolver(connect: () => Promise<McpToolClient>): McpClientResolver {
  let client: Promise<McpToolClient> | null = null;
  return () => {
    client ??= connect().catch(error => {
      client = null;
      throw error;
    });
    return client;
  };
}
