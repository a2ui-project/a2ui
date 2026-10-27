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
 * Pure helpers of the board app: board arithmetic, the model context the app
 * publishes, and DOM rendering. `board.ts` wires them to the MCP Apps SDK.
 */

import type {Board, Card, Column} from '../src/board.js';

export type {Board, Card, Column};

/** Per-column numbers the app publishes in its model context. */
export interface ColumnStat {
  readonly id: string;
  readonly title: string;
  readonly count: number;
  readonly wipLimit?: number;
  readonly overLimit: boolean;
}

/** The selected card with its column, as published in the model context. */
export interface Selection {
  readonly taskId: string;
  readonly title: string;
  readonly assignee?: string;
  readonly due?: string;
  readonly column: string;
}

/** What the app tells the host with `ui/update-model-context`. */
export interface ModelContext {
  readonly selection: Selection | null;
  readonly filter: string | null;
  readonly columns: readonly ColumnStat[];
}

/** The app's view state. */
export interface ViewState {
  readonly board: Board | null;
  readonly selectedTaskId: string | null;
  /** Assignee filter, or `null` for every card. */
  readonly filter: string | null;
}

/** What the rendered board calls back into. */
export interface BoardHandlers {
  onSelect(taskId: string): void;
  onFilter(assignee: string | null): void;
  onMove(taskId: string, toColumn: string, index?: number): void;
  onSplit(card: Card): void;
}

/** MIME type used by the drag payload. */
const DRAG_TYPE = 'application/x-kanban-task';

/** Counts the cards per column and flags columns over their WIP limit. */
export function columnStats(board: Board): ColumnStat[] {
  return board.columns.map(column => ({
    id: column.id,
    title: column.title,
    count: column.cards.length,
    ...(column.wipLimit !== undefined ? {wipLimit: column.wipLimit} : {}),
    overLimit: column.wipLimit !== undefined && column.cards.length > column.wipLimit,
  }));
}

/** Finds the column holding a task. */
export function columnOf(board: Board, taskId: string): Column | undefined {
  return board.columns.find(column => column.cards.some(card => card.id === taskId));
}

/** The model context for a view state; `null` selection when the card is gone. */
export function modelContextFor(state: ViewState): ModelContext | null {
  if (!state.board) {
    return null;
  }
  let selection: Selection | null = null;
  if (state.selectedTaskId !== null) {
    const column = columnOf(state.board, state.selectedTaskId);
    const card = column?.cards.find(candidate => candidate.id === state.selectedTaskId);
    if (column && card) {
      selection = {
        taskId: card.id,
        title: card.title,
        ...(card.assignee !== undefined ? {assignee: card.assignee} : {}),
        ...(card.due !== undefined ? {due: card.due} : {}),
        column: column.title,
      };
    }
  }
  return {selection, filter: state.filter, columns: columnStats(state.board)};
}

/** Moves a card locally, so the UI updates before the server confirms. */
export function moveCard(board: Board, taskId: string, toColumn: string, index?: number): Board {
  const from = columnOf(board, taskId);
  const card = from?.cards.find(candidate => candidate.id === taskId);
  if (!card || !board.columns.some(column => column.id === toColumn)) {
    return board;
  }
  return {
    columns: board.columns.map(column => {
      let cards = column.cards.filter(candidate => candidate.id !== taskId);
      if (column.id === toColumn) {
        const at = index === undefined ? cards.length : Math.max(0, Math.min(index, cards.length));
        cards = [...cards.slice(0, at), card, ...cards.slice(at)];
      }
      return {...column, cards};
    }),
  };
}

/** Whether two boards hold the same data; used to break update loops with the host. */
export function sameBoard(a: Board | null, b: Board | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Reads a board out of a `tools/call` result or a `ui/notifications/tool-result` payload. */
export function boardFromToolResult(result: {
  structuredContent?: unknown;
  content?: unknown;
}): Board | null {
  if (isBoard(result.structuredContent)) {
    return result.structuredContent;
  }
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
        try {
          const parsed: unknown = JSON.parse(block['text']);
          if (isBoard(parsed)) {
            return parsed;
          }
        } catch {
          // Not JSON; try the next block.
        }
      }
    }
  }
  return null;
}

/** Whether a value has the shape of a board. */
export function isBoard(value: unknown): value is Board {
  return (
    isRecord(value) &&
    Array.isArray(value['columns']) &&
    value['columns'].every(
      column =>
        isRecord(column) && typeof column['id'] === 'string' && Array.isArray(column['cards']),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Distinct assignees across the board, for the filter control. */
export function assignees(board: Board): string[] {
  const names = new Set<string>();
  for (const column of board.columns) {
    for (const card of column.cards) {
      if (card.assignee) {
        names.add(card.assignee);
      }
    }
  }
  return [...names].sort();
}

/** Replaces the children of `root` with the board for `state`, animating moved cards (FLIP). */
export function renderBoard(root: HTMLElement, state: ViewState, handlers: BoardHandlers): void {
  const previousPositions = captureCardPositions(root);
  root.textContent = '';
  const doc = root.ownerDocument;
  if (!state.board) {
    const empty = doc.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Waiting for the board...';
    root.append(empty);
    return;
  }
  root.append(renderToolbar(doc, state, handlers));
  const columns = doc.createElement('div');
  columns.className = 'columns';
  for (const column of state.board.columns) {
    columns.append(renderColumn(doc, column, state, handlers));
  }
  root.append(columns);
  animateCardTransitions(root, previousPositions);
}

interface CardPosition {
  readonly rect: DOMRect;
  readonly columnId: string | undefined;
}

function captureCardPositions(root: HTMLElement): Map<string, CardPosition> {
  const positions = new Map<string, CardPosition>();
  for (const card of Array.from(root.querySelectorAll<HTMLElement>('li.card[data-task-id]'))) {
    const taskId = card.dataset['taskId'];
    const rect = card.getBoundingClientRect();
    if (taskId && (rect.width > 0 || rect.height > 0)) {
      const columnId = card.closest<HTMLElement>('.column')?.dataset['columnId'];
      positions.set(taskId, {rect, columnId});
    }
  }
  return positions;
}

function animateCardTransitions(
  root: HTMLElement,
  previousPositions: Map<string, CardPosition>,
): void {
  if (previousPositions.size === 0) {
    return;
  }
  for (const card of Array.from(root.querySelectorAll<HTMLElement>('li.card[data-task-id]'))) {
    const taskId = card.dataset['taskId'];
    if (!taskId) {
      continue;
    }
    const nextRect = card.getBoundingClientRect();
    if (nextRect.width === 0 && nextRect.height === 0) {
      continue;
    }
    const previous = previousPositions.get(taskId);
    if (!previous) {
      if (typeof card.animate === 'function') {
        card.animate(
          [
            {opacity: 0, transform: 'translateY(10px) scale(0.96)'},
            {opacity: 1, transform: 'translateY(0) scale(1)'},
          ],
          {duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)'},
        );
      }
      continue;
    }
    const dx = previous.rect.left - nextRect.left;
    const dy = previous.rect.top - nextRect.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
      continue;
    }
    const nextColumnId = card.closest<HTMLElement>('.column')?.dataset['columnId'];
    const changedColumn = previous.columnId !== nextColumnId;
    if (changedColumn) {
      card.classList.add('moving');
    }
    if (typeof card.animate === 'function') {
      const animation = card.animate(
        changedColumn
          ? [
              {transform: `translate(${dx}px, ${dy}px) scale(1)`},
              {
                transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 10}px) scale(1.04)`,
                offset: 0.45,
              },
              {transform: 'translate(0, 0) scale(1)'},
            ]
          : [{transform: `translate(${dx}px, ${dy}px)`}, {transform: 'translate(0, 0)'}],
        {
          duration: changedColumn ? 460 : 300,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
      );
      if (changedColumn) {
        const clearMoving = () => card.classList.remove('moving');
        animation.addEventListener?.('finish', clearMoving);
        animation.addEventListener?.('cancel', clearMoving);
      }
    } else if (changedColumn) {
      card.classList.remove('moving');
    }
  }
}

function renderToolbar(doc: Document, state: ViewState, handlers: BoardHandlers): HTMLElement {
  const toolbar = doc.createElement('div');
  toolbar.className = 'toolbar';
  const label = doc.createElement('label');
  label.textContent = 'Assignee ';
  const select = doc.createElement('select');
  select.className = 'filter';
  select.append(new Option('Everyone', ''));
  for (const name of assignees(state.board!)) {
    select.append(new Option(name, name));
  }
  select.value = state.filter ?? '';
  select.addEventListener('change', () => {
    handlers.onFilter(select.value === '' ? null : select.value);
  });
  label.append(select);
  toolbar.append(label);
  return toolbar;
}

function renderColumn(
  doc: Document,
  column: Column,
  state: ViewState,
  handlers: BoardHandlers,
): HTMLElement {
  const section = doc.createElement('section');
  section.className = 'column';
  section.dataset['columnId'] = column.id;
  const overLimit = column.wipLimit !== undefined && column.cards.length > column.wipLimit;
  if (overLimit) {
    section.classList.add('over-limit');
  }

  const heading = doc.createElement('h2');
  heading.textContent = column.title;
  const count = doc.createElement('span');
  count.className = 'count';
  count.textContent =
    column.wipLimit === undefined
      ? String(column.cards.length)
      : `${column.cards.length}/${column.wipLimit}`;
  heading.append(count);
  section.append(heading);

  const list = doc.createElement('ul');
  list.className = 'cards';
  list.setAttribute('aria-label', `${column.title} cards`);
  list.addEventListener('dragover', event => {
    if (event.dataTransfer?.types.includes(DRAG_TYPE)) {
      event.preventDefault();
      list.classList.add('drop-target');
    }
  });
  list.addEventListener('dragleave', () => {
    list.classList.remove('drop-target');
  });
  list.addEventListener('drop', event => {
    event.preventDefault();
    list.classList.remove('drop-target');
    const taskId = event.dataTransfer?.getData(DRAG_TYPE);
    if (taskId) {
      handlers.onMove(taskId, column.id, dropIndex(list, event.clientY));
    }
  });

  for (const card of column.cards) {
    if (state.filter !== null && card.assignee !== state.filter) {
      continue;
    }
    list.append(renderCard(doc, card, column, state, handlers));
  }
  section.append(list);
  return section;
}

/** Index of the card the pointer is above, so a drop lands where the card was dragged. */
function dropIndex(list: HTMLElement, clientY: number): number | undefined {
  const items = Array.from(list.querySelectorAll<HTMLElement>('li.card'));
  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return i;
    }
  }
  return undefined;
}

function renderCard(
  doc: Document,
  card: Card,
  column: Column,
  state: ViewState,
  handlers: BoardHandlers,
): HTMLElement {
  const item = doc.createElement('li');
  item.className = 'card';
  item.dataset['taskId'] = card.id;
  item.draggable = true;
  item.tabIndex = 0;
  item.setAttribute('role', 'button');
  item.setAttribute('aria-pressed', String(state.selectedTaskId === card.id));
  if (state.selectedTaskId === card.id) {
    item.classList.add('selected');
  }
  item.addEventListener('dragstart', event => {
    event.dataTransfer?.setData(DRAG_TYPE, card.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    item.classList.add('dragging');
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
  });
  item.addEventListener('click', () => {
    handlers.onSelect(card.id);
  });
  item.addEventListener('keydown', event => {
    if (event.target !== item) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handlers.onSelect(card.id);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const neighbour = adjacentColumn(state.board!, column.id, event.key === 'ArrowLeft' ? -1 : 1);
      if (neighbour) {
        event.preventDefault();
        handlers.onMove(card.id, neighbour.id);
      }
    }
  });

  const title = doc.createElement('div');
  title.className = 'title';
  title.textContent = card.title;
  item.append(title);

  const meta = doc.createElement('div');
  meta.className = 'meta';
  const parts: string[] = [];
  if (card.assignee) {
    parts.push(card.assignee);
  }
  if (card.due) {
    parts.push(`due ${card.due}`);
  }
  meta.textContent = parts.join(' · ');
  item.append(meta);

  if (card.tags && card.tags.length > 0) {
    const tags = doc.createElement('div');
    tags.className = 'tags';
    for (const tag of card.tags) {
      const chip = doc.createElement('span');
      chip.className = 'tag';
      chip.textContent = tag;
      tags.append(chip);
    }
    item.append(tags);
  }

  const actions = doc.createElement('div');
  actions.className = 'actions';
  const split = doc.createElement('button');
  split.type = 'button';
  split.className = 'split';
  split.textContent = 'Ask agent to split';
  split.setAttribute('aria-label', `Ask the agent to split ${card.title}`);
  split.addEventListener('click', event => {
    event.stopPropagation();
    handlers.onSplit(card);
  });
  actions.append(split);
  item.append(actions);
  return item;
}

/** The column `offset` places left (-1) or right (+1) of `columnId`. */
export function adjacentColumn(board: Board, columnId: string, offset: -1 | 1): Column | undefined {
  const index = board.columns.findIndex(column => column.id === columnId);
  if (index === -1) {
    return undefined;
  }
  return board.columns[index + offset];
}
