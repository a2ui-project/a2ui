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
 * The sibling summary next to the board (channel C). The agent only writes
 * `/kanban/board`; the host derives `/kanban/summary` from it with a data
 * model subscription, and the sibling `Text` components bind to the summary.
 * The board app writes the same path when the user drags a card, so the
 * counters follow without a round trip to the agent.
 */

import type {SurfaceModel} from '@a2ui/web_core/v1_0';

/** Surface id the agent creates for the board. */
export const KANBAN_SURFACE_ID = 'kanban';

/** Data model path of the board (bound to the app's `board` key). */
export const BOARD_PATH = '/kanban/board';

/** Data model path of the selected card (written from the app's model context). */
export const SELECTION_PATH = '/kanban/selection';

/** Data model path the sibling components read. */
export const SUMMARY_PATH = '/kanban/summary';

/** What the sibling `Text` components show. */
export interface BoardSummary {
  readonly todoText: string;
  readonly doneText: string;
  readonly wipText: string;
  readonly overLimit: boolean;
}

interface BoardLike {
  readonly columns: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly wipLimit?: number;
    readonly cards: readonly unknown[];
  }>;
}

interface SelectionLike {
  readonly title: string;
  readonly assignee?: string;
  readonly due?: string;
  readonly column?: string;
}

function isBoardLike(value: unknown): value is BoardLike {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const columns = (value as {columns?: unknown}).columns;
  return (
    Array.isArray(columns) &&
    columns.every(
      column =>
        typeof column === 'object' &&
        column !== null &&
        typeof (column as {id?: unknown}).id === 'string' &&
        Array.isArray((column as {cards?: unknown}).cards),
    )
  );
}

function isSelectionLike(value: unknown): value is SelectionLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {title?: unknown}).title === 'string'
  );
}

/** Derives the summary texts from a board; `null` when the value is not a board. */
export function summarizeBoard(board: unknown): BoardSummary | null {
  if (!isBoardLike(board)) {
    return null;
  }
  const count = (id: string) => board.columns.find(column => column.id === id)?.cards.length ?? 0;
  const limited = board.columns.filter(column => column.wipLimit !== undefined);
  const over = limited.filter(column => column.cards.length > (column.wipLimit ?? Infinity));
  const wipText =
    limited.length === 0
      ? 'No WIP limits'
      : limited
          .map(column =>
            column.cards.length > (column.wipLimit ?? Infinity)
              ? `${column.title} ${column.cards.length}/${column.wipLimit} (over limit)`
              : `${column.title} ${column.cards.length}/${column.wipLimit}`,
          )
          .join(', ');
  return {
    todoText: `Todo: ${count('todo')}`,
    doneText: `Done: ${count('done')}`,
    wipText,
    overLimit: over.length > 0,
  };
}

/** One line about the selected card, or a hint when nothing is selected. */
export function describeSelection(selection: unknown): string {
  if (!isSelectionLike(selection)) {
    return 'No card selected';
  }
  const details = [selection.assignee, selection.due ? `due ${selection.due}` : undefined].filter(
    (part): part is string => part !== undefined,
  );
  const where = selection.column ? ` in ${selection.column}` : '';
  return details.length > 0
    ? `Selected: ${selection.title}${where} (${details.join(', ')})`
    : `Selected: ${selection.title}${where}`;
}

/**
 * Keeps `/kanban/summary` in step with `/kanban/board` and `/kanban/selection`
 * on a surface. Returns a function that stops the subscriptions.
 */
export function attachBoardSummary(surface: SurfaceModel): () => void {
  const {dataModel} = surface;
  const writeSummary = (board: unknown) => {
    const summary = summarizeBoard(board);
    if (summary) {
      dataModel.set(SUMMARY_PATH, {
        ...summary,
        selectionText: describeSelection(dataModel.get(SELECTION_PATH)),
      });
      if (
        dataModel.get('/kanban/toolResult') !== undefined &&
        dataModel.get('/kanban/toolResult') !== board
      ) {
        dataModel.set('/kanban/toolResult', board);
      }
    }
  };
  const writeSelection = (selection: unknown) => {
    if (dataModel.get(SUMMARY_PATH) !== undefined) {
      dataModel.set(`${SUMMARY_PATH}/selectionText`, describeSelection(selection));
    }
  };
  const boardSubscription = dataModel.subscribe(BOARD_PATH, writeSummary);
  const selectionSubscription = dataModel.subscribe(SELECTION_PATH, writeSelection);
  writeSummary(dataModel.get(BOARD_PATH));
  return () => {
    boardSubscription.unsubscribe();
    selectionSubscription.unsubscribe();
  };
}
