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
 * The board app's MCP Apps protocol wiring, built on the `App` class of
 * `@modelcontextprotocol/ext-apps`. `createBoardApp` is also what the tests
 * drive over an in-memory transport; `main.ts` connects it to the host.
 *
 * Channels, as the sample README names them:
 *
 * - A, agent to app: `ui/notifications/data-model-update` for the `board`
 *   binding (and the initial `ui/notifications/tool-result`) re-renders.
 * - B, agent reads app state: `ui/update-model-context` after every change.
 * - C, app to sibling components: `ui/notifications/data-model-change` on
 *   `board` after a drag.
 * - D, app to agent: `tools/call move_task` plus `ui/message`.
 */

import {App} from '@modelcontextprotocol/ext-apps';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {z} from 'zod';
import {
  boardFromToolResult,
  columnOf,
  modelContextFor,
  moveCard,
  renderBoard,
  sameBoard,
  type Board,
  type Card,
  type ViewState,
} from './render.js';

/** Binding key of the board in the component's `data.paths`. */
export const BOARD_DATA_KEY = 'board';

/** Method of the host's notification when a bound value changes. */
export const DATA_MODEL_UPDATE_METHOD = 'ui/notifications/data-model-update';

/** Method of the app's notification to write a bound value. */
export const DATA_MODEL_CHANGE_METHOD = 'ui/notifications/data-model-change';

const DataModelUpdateNotificationSchema = z.object({
  method: z.literal(DATA_MODEL_UPDATE_METHOD),
  params: z.object({key: z.string(), subpath: z.string().optional(), value: z.unknown()}),
});

/** Structured description of a board event, carried in the `_meta` of a `ui/message` text block. */
export type KanbanEvent =
  | {readonly event: 'moved'; readonly taskId: string; readonly from: string; readonly to: string}
  | {readonly event: 'split-request'; readonly task: Card};

/**
 * The A2UI extension notifications are not part of the `App` notification
 * types, so they go through the protocol's generic `notification`, which is
 * what `App` does for its own notifications.
 */
interface ExtensionSender {
  notification(notification: {method: string; params: Record<string, unknown>}): Promise<void>;
}

/** The board app and the hooks the entry point and the tests use. */
export interface BoardApp {
  readonly app: App;
  /** The current view state. */
  readonly state: () => ViewState;
  /** Connects to the host; `transport` defaults to the parent window. */
  connect(transport?: Transport): Promise<void>;
  /** Simulates a drop: what the drag handlers call. */
  move(taskId: string, toColumn: string, index?: number): Promise<void>;
  select(taskId: string): void;
  filter(assignee: string | null): void;
  split(card: Card): Promise<void>;
}

function logError(what: string): (error: unknown) => void {
  return error => {
    console.error(`[kanban-app] ${what}:`, error);
  };
}

/** Options of {@link createBoardApp}. */
export interface BoardAppOptions {
  /** Whether the SDK reports the document size to the host; off in tests without a layout. */
  readonly autoResize?: boolean;
}

/** Creates the app that renders into `root`. */
export function createBoardApp(root: HTMLElement, options: BoardAppOptions = {}): BoardApp {
  const app = new App(
    {name: 'Kanban board', version: '1.0.0'},
    {availableDisplayModes: ['inline']},
    {autoResize: options.autoResize ?? true},
  );
  const sender = app as unknown as ExtensionSender;
  let state: ViewState = {board: null, selectedTaskId: null, filter: null};

  const handlers = {
    onSelect: (taskId: string) => select(taskId),
    onFilter: (assignee: string | null) => filter(assignee),
    onMove: (taskId: string, toColumn: string, index?: number) => {
      move(taskId, toColumn, index).catch(logError('move failed'));
    },
    onSplit: (card: Card) => {
      split(card).catch(logError('split request failed'));
    },
  };

  function render(): void {
    renderBoard(root, state, handlers);
  }

  /** Publishes the model context (channel B); a no-op before the board arrives. */
  function publishModelContext(): void {
    const context = modelContextFor(state);
    if (!context) {
      return;
    }
    app
      .updateModelContext({structuredContent: context as unknown as Record<string, unknown>})
      .catch(logError('update-model-context failed'));
  }

  function setState(next: ViewState): void {
    state = next;
    render();
    publishModelContext();
  }

  /** Applies a board that came from the host or the server; ignores an identical one. */
  function applyBoard(board: Board | null): void {
    if (!board || sameBoard(board, state.board)) {
      return;
    }
    setState({...state, board});
  }

  /** Writes the board to its bound path, so sibling components re-render (channel C). */
  function publishBoard(board: Board): void {
    sender
      .notification({method: DATA_MODEL_CHANGE_METHOD, params: {key: BOARD_DATA_KEY, value: board}})
      .catch(logError('data-model-change failed'));
  }

  function select(taskId: string): void {
    setState({...state, selectedTaskId: state.selectedTaskId === taskId ? null : taskId});
  }

  function filter(assignee: string | null): void {
    setState({...state, filter: assignee});
  }

  async function move(taskId: string, toColumn: string, index?: number): Promise<void> {
    const board = state.board;
    if (!board) {
      return;
    }
    const from = columnOf(board, taskId);
    const card = from?.cards.find(candidate => candidate.id === taskId);
    const to = board.columns.find(column => column.id === toColumn);
    if (!from || !card || !to || (from.id === to.id && index === undefined)) {
      return;
    }
    const optimistic = moveCard(board, taskId, toColumn, index);
    setState({...state, board: optimistic});
    publishBoard(optimistic);

    let result: Awaited<ReturnType<typeof app.callServerTool>>;
    try {
      result = await app.callServerTool({
        name: 'move_task',
        arguments: {taskId, toColumn, ...(index !== undefined ? {index} : {})},
      });
    } catch (error) {
      applyBoard(board);
      publishBoard(board);
      throw error;
    }
    const confirmed = boardFromToolResult(result);
    if (result.isError || !confirmed) {
      // The server refused the move: fall back to what it has.
      applyBoard(board);
      publishBoard(board);
      return;
    }
    if (!sameBoard(confirmed, optimistic)) {
      applyBoard(confirmed);
      publishBoard(confirmed);
    }
    if (from.id !== to.id) {
      await sendEvent(`Moved "${card.title}" from ${from.title} to ${to.title}.`, {
        event: 'moved',
        taskId,
        from: from.id,
        to: to.id,
      });
    }
  }

  async function split(card: Card): Promise<void> {
    await sendEvent(`Please split "${card.title}" into smaller subtasks.`, {
      event: 'split-request',
      task: card,
    });
  }

  /** Posts a chat message to the host (channel D), with the event in the text block's `_meta`. */
  async function sendEvent(text: string, event: KanbanEvent): Promise<void> {
    await app.sendMessage({
      role: 'user',
      content: [{type: 'text', text, _meta: {kanban: event}}],
    });
  }

  app.ontoolresult = params => {
    applyBoard(boardFromToolResult(params));
  };
  app.setNotificationHandler(DataModelUpdateNotificationSchema, notification => {
    const {key, subpath, value} = notification.params;
    if (key !== BOARD_DATA_KEY) {
      return;
    }
    if (!subpath) {
      applyBoard(boardFromToolResult({structuredContent: value}));
    } else if (subpath === '/columns') {
      applyBoard(boardFromToolResult({structuredContent: {columns: value}}));
    }
  });
  app.onhostcontextchanged = context => {
    applyTheme(root, context.theme);
  };

  render();

  return {
    app,
    state: () => state,
    async connect(transport?: Transport) {
      await app.connect(transport);
      applyTheme(root, app.getHostContext()?.theme);
      publishModelContext();
    },
    move,
    select,
    filter,
    split,
  };
}

function applyTheme(root: HTMLElement, theme: string | undefined): void {
  if (theme === 'dark' || theme === 'light') {
    root.ownerDocument.documentElement.dataset['theme'] = theme;
  }
}
