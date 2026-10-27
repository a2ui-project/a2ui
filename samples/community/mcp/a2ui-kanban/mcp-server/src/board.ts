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
 * The in-memory Kanban board the MCP server owns. Pure data and operations;
 * `server.ts` exposes them as MCP tools.
 */

/** One card on the board. */
export interface Card {
  readonly id: string;
  readonly title: string;
  readonly assignee?: string;
  /** Due date as `YYYY-MM-DD`. */
  readonly due?: string;
  readonly tags?: readonly string[];
}

/** One column of the board with its cards in display order. */
export interface Column {
  readonly id: string;
  readonly title: string;
  /** Work-in-progress limit; the server reports it but does not enforce it. */
  readonly wipLimit?: number;
  readonly cards: readonly Card[];
}

/** The whole board, as every tool returns it in `structuredContent`. */
export interface Board {
  readonly columns: readonly Column[];
}

/** Thrown for unknown task or column ids; tools report it as an error result. */
export class BoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardError';
  }
}

/** Arguments of `createTask`. */
export interface CreateTaskInput {
  readonly title: string;
  readonly column?: string;
  readonly assignee?: string;
  readonly due?: string;
  readonly tags?: readonly string[];
}

/** The sprint board every server starts with (and `reset` returns to). */
export function seedBoard(): Board {
  return {
    columns: [
      {
        id: 'todo',
        title: 'Todo',
        cards: [
          {id: 't3', title: 'Migrate DB', assignee: 'Ana', due: '2026-10-17', tags: ['backend']},
          {
            id: 't4',
            title: 'Design onboarding',
            assignee: 'Chloe',
            due: '2026-10-22',
            tags: ['design'],
          },
        ],
      },
      {
        id: 'in_progress',
        title: 'In progress',
        cards: [
          {id: 't1', title: 'Fix login', assignee: 'Ana', due: '2026-10-16', tags: ['bug']},
          {
            id: 't5',
            title: 'Upgrade CI runners',
            assignee: 'Ben',
            due: '2026-10-15',
            tags: ['infra'],
          },
        ],
      },
      {
        id: 'review',
        title: 'Review',
        wipLimit: 3,
        cards: [
          {id: 't2', title: 'Write docs', assignee: 'Ben', due: '2026-10-20', tags: ['docs']},
          {
            id: 't6',
            title: 'Audit permissions',
            assignee: 'Chloe',
            due: '2026-10-18',
            tags: ['security'],
          },
          {
            id: 't7',
            title: 'Add dark mode',
            assignee: 'Ana',
            due: '2026-10-21',
            tags: ['frontend'],
          },
        ],
      },
      {
        id: 'done',
        title: 'Done',
        cards: [{id: 't8', title: 'Release 1.2', assignee: 'Ben', due: '2026-10-10'}],
      },
    ],
  };
}

/** Where a task sits on the board. */
export interface TaskLocation {
  readonly card: Card;
  readonly column: Column;
  readonly index: number;
}

/** Finds a task on a board. */
export function findTask(board: Board, taskId: string): TaskLocation | undefined {
  for (const column of board.columns) {
    const index = column.cards.findIndex(card => card.id === taskId);
    if (index !== -1) {
      return {card: column.cards[index], column, index};
    }
  }
  return undefined;
}

/**
 * Moves a task to a column, at `index` or at the end. Returns the new board;
 * the input is not mutated. Column ids are matched by id, or by title
 * case-insensitively so that "Done" works as well as "done".
 */
export function moveTask(board: Board, taskId: string, toColumn: string, index?: number): Board {
  const location = findTask(board, taskId);
  if (!location) {
    throw new BoardError(`Unknown task id: ${taskId}`);
  }
  const target = resolveColumn(board, toColumn);
  const columns = board.columns.map(column => {
    let cards = column.cards.filter(card => card.id !== taskId);
    if (column.id === target.id) {
      const at = index === undefined ? cards.length : Math.max(0, Math.min(index, cards.length));
      cards = [...cards.slice(0, at), location.card, ...cards.slice(at)];
    }
    return {...column, cards};
  });
  return {columns};
}

/** Adds a task to a column (`todo` by default) and returns the new board. */
export function createTask(board: Board, input: CreateTaskInput): Board {
  const title = input.title.trim();
  if (title === '') {
    throw new BoardError('A task needs a title');
  }
  const target = resolveColumn(board, input.column ?? 'todo');
  const card: Card = {
    id: nextTaskId(board),
    title,
    ...(input.assignee ? {assignee: input.assignee} : {}),
    ...(input.due ? {due: input.due} : {}),
    ...(input.tags && input.tags.length > 0 ? {tags: [...input.tags]} : {}),
  };
  return {
    columns: board.columns.map(column =>
      column.id === target.id ? {...column, cards: [...column.cards, card]} : column,
    ),
  };
}

/** Changes the assignee of a task and returns the new board. */
export function assignTask(board: Board, taskId: string, assignee: string): Board {
  if (!findTask(board, taskId)) {
    throw new BoardError(`Unknown task id: ${taskId}`);
  }
  return {
    columns: board.columns.map(column => ({
      ...column,
      cards: column.cards.map(card => (card.id === taskId ? {...card, assignee} : card)),
    })),
  };
}

function resolveColumn(board: Board, idOrTitle: string): Column {
  const wanted = idOrTitle.trim().toLowerCase();
  const column = board.columns.find(
    candidate => candidate.id === wanted || candidate.title.toLowerCase() === wanted,
  );
  if (!column) {
    throw new BoardError(`Unknown column: ${idOrTitle}`);
  }
  return column;
}

function nextTaskId(board: Board): string {
  let max = 0;
  for (const column of board.columns) {
    for (const card of column.cards) {
      const match = /^t(\d+)$/.exec(card.id);
      if (match) {
        max = Math.max(max, Number(match[1]));
      }
    }
  }
  return `t${max + 1}`;
}

/** The mutable board of one server process. */
export class KanbanBoard {
  private board: Board;

  constructor(initial: Board = seedBoard()) {
    this.board = initial;
  }

  /** The current board. Boards are immutable values, so no copy is needed. */
  get current(): Board {
    return this.board;
  }

  reset(): Board {
    this.board = seedBoard();
    return this.board;
  }

  moveTask(taskId: string, toColumn: string, index?: number): Board {
    this.board = moveTask(this.board, taskId, toColumn, index);
    return this.board;
  }

  createTask(input: CreateTaskInput): Board {
    this.board = createTask(this.board, input);
    return this.board;
  }

  assignTask(taskId: string, assignee: string): Board {
    this.board = assignTask(this.board, taskId, assignee);
    return this.board;
  }
}
