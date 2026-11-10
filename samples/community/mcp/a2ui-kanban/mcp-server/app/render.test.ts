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

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {seedBoard} from '../src/board.js';
import {
  adjacentColumn,
  boardFromToolResult,
  columnStats,
  modelContextFor,
  moveCard,
  renderBoard,
  sameBoard,
  type BoardHandlers,
} from './render.js';

function handlers(): BoardHandlers {
  return {onSelect: vi.fn(), onFilter: vi.fn(), onMove: vi.fn(), onSplit: vi.fn()};
}

describe('columnStats', () => {
  it('counts cards and flags columns over their WIP limit', () => {
    const stats = columnStats(moveCard(seedBoard(), 't1', 'review'));
    expect(stats).toEqual([
      {id: 'todo', title: 'Todo', count: 2, overLimit: false},
      {id: 'in_progress', title: 'In progress', count: 1, overLimit: false},
      {id: 'review', title: 'Review', count: 4, wipLimit: 3, overLimit: true},
      {id: 'done', title: 'Done', count: 1, overLimit: false},
    ]);
  });
});

describe('modelContextFor', () => {
  it('is null until a board arrives', () => {
    expect(modelContextFor({board: null, selectedTaskId: 't1', filter: null})).toBeNull();
  });

  it('describes the selected card with its column and the active filter', () => {
    const context = modelContextFor({board: seedBoard(), selectedTaskId: 't3', filter: 'Ana'});
    expect(context?.selection).toEqual({
      taskId: 't3',
      title: 'Migrate DB',
      assignee: 'Ana',
      due: '2026-10-17',
      column: 'Todo',
    });
    expect(context?.filter).toBe('Ana');
    expect(context?.columns.map(column => column.count)).toEqual([2, 2, 3, 1]);
  });

  it('drops a selection whose card no longer exists', () => {
    const context = modelContextFor({board: seedBoard(), selectedTaskId: 'gone', filter: null});
    expect(context?.selection).toBeNull();
  });
});

describe('moveCard', () => {
  it('moves between columns and returns the same board for unknown ids', () => {
    const board = seedBoard();
    const moved = moveCard(board, 't8', 'todo', 1);
    expect(moved.columns[0].cards.map(card => card.id)).toEqual(['t3', 't8', 't4']);
    expect(moved.columns[3].cards).toEqual([]);
    expect(moveCard(board, 'nope', 'todo')).toBe(board);
    expect(moveCard(board, 't8', 'nope')).toBe(board);
  });
});

describe('boardFromToolResult', () => {
  it('prefers structuredContent and falls back to a JSON text block', () => {
    const board = seedBoard();
    expect(boardFromToolResult({structuredContent: board})).toEqual(board);
    expect(boardFromToolResult({content: [{type: 'text', text: JSON.stringify(board)}]})).toEqual(
      board,
    );
    expect(boardFromToolResult({content: [{type: 'text', text: 'not a board'}]})).toBeNull();
    expect(boardFromToolResult({structuredContent: {columns: 'nope'}})).toBeNull();
  });
});

describe('sameBoard and adjacentColumn', () => {
  it('compares by value and finds neighbours', () => {
    expect(sameBoard(seedBoard(), seedBoard())).toBe(true);
    expect(sameBoard(seedBoard(), moveCard(seedBoard(), 't1', 'done'))).toBe(false);
    expect(adjacentColumn(seedBoard(), 'todo', 1)?.id).toBe('in_progress');
    expect(adjacentColumn(seedBoard(), 'todo', -1)).toBeUndefined();
    expect(adjacentColumn(seedBoard(), 'nope', 1)).toBeUndefined();
  });
});

describe('renderBoard', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('main');
    document.body.append(root);
  });

  afterEach(() => {
    document.body.textContent = '';
  });

  it('renders a placeholder without a board', () => {
    renderBoard(root, {board: null, selectedTaskId: null, filter: null}, handlers());
    expect(root.querySelector('.empty')?.textContent).toBe('Waiting for the board...');
    expect(root.querySelectorAll('.column').length).toBe(0);
  });

  it('renders every column with its count, limit and cards', () => {
    renderBoard(root, {board: seedBoard(), selectedTaskId: 't1', filter: null}, handlers());
    const columns = root.querySelectorAll<HTMLElement>('.column');
    expect(columns.length).toBe(4);
    expect(columns[2].querySelector('h2')?.textContent).toBe('Review3/3');
    expect(columns[2].classList.contains('over-limit')).toBe(false);
    expect(root.querySelectorAll('li.card').length).toBe(8);
    const selected = root.querySelector('li.card.selected');
    expect(selected?.getAttribute('data-task-id')).toBe('t1');
    expect(selected?.getAttribute('aria-pressed')).toBe('true');
    expect(selected?.querySelector('.meta')?.textContent).toBe('Ana · due 2026-10-16');
  });

  it('marks a column over its limit', () => {
    const board = moveCard(seedBoard(), 't1', 'review');
    renderBoard(root, {board, selectedTaskId: null, filter: null}, handlers());
    const review = root.querySelector('.column[data-column-id="review"]');
    expect(review?.classList.contains('over-limit')).toBe(true);
    expect(review?.querySelector('.count')?.textContent).toBe('4/3');
  });

  it('hides cards outside the assignee filter and offers every assignee', () => {
    renderBoard(root, {board: seedBoard(), selectedTaskId: null, filter: 'Ana'}, handlers());
    expect(root.querySelectorAll('li.card').length).toBe(3);
    const options = Array.from(root.querySelectorAll('select.filter option')).map(
      o => o.textContent,
    );
    expect(options).toEqual(['Everyone', 'Ana', 'Ben', 'Chloe']);
    expect((root.querySelector('select.filter') as HTMLSelectElement).value).toBe('Ana');
  });

  it('dispatches select, filter, split and keyboard moves to the handlers', () => {
    const h = handlers();
    renderBoard(root, {board: seedBoard(), selectedTaskId: null, filter: null}, h);
    const card = root.querySelector<HTMLElement>('li.card[data-task-id="t1"]')!;
    card.click();
    expect(h.onSelect).toHaveBeenCalledWith('t1');

    card.querySelector<HTMLButtonElement>('button.split')!.click();
    expect(h.onSplit).toHaveBeenCalledWith(expect.objectContaining({id: 't1', title: 'Fix login'}));
    expect(h.onSelect).toHaveBeenCalledTimes(1);

    card.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(h.onMove).toHaveBeenCalledWith('t1', 'review');
    card.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    expect(h.onSelect).toHaveBeenCalledTimes(2);

    const split = card.querySelector<HTMLButtonElement>('button.split')!;
    const enterOnSplit = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    split.dispatchEvent(enterOnSplit);
    expect(enterOnSplit.defaultPrevented).toBe(false);
    expect(h.onSelect).toHaveBeenCalledTimes(2);

    const select = root.querySelector<HTMLSelectElement>('select.filter')!;
    select.value = 'Ben';
    select.dispatchEvent(new Event('change'));
    expect(h.onFilter).toHaveBeenCalledWith('Ben');
  });

  it('moves a dropped card into the column under the pointer', () => {
    const h = handlers();
    renderBoard(root, {board: seedBoard(), selectedTaskId: null, filter: null}, h);
    const done = root.querySelector<HTMLElement>('.column[data-column-id="done"] ul.cards')!;
    const dataTransfer = {
      types: ['application/x-kanban-task'],
      getData: () => 't1',
    } as unknown as DataTransfer;
    const over = new Event('dragover', {bubbles: true, cancelable: true}) as DragEvent;
    Object.defineProperty(over, 'dataTransfer', {value: dataTransfer});
    done.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(done.classList.contains('drop-target')).toBe(true);

    const drop = new Event('drop', {bubbles: true, cancelable: true}) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', {value: dataTransfer});
    // jsdom lays nothing out, so every card rect is at 0; a negative pointer lands before the first card.
    Object.defineProperty(drop, 'clientY', {value: -1});
    done.dispatchEvent(drop);
    expect(h.onMove).toHaveBeenCalledWith('t1', 'done', 0);
    expect(done.classList.contains('drop-target')).toBe(false);
  });

  it('animates cards that move across columns with FLIP keyframes', () => {
    const h = handlers();
    renderBoard(root, {board: seedBoard(), selectedTaskId: null, filter: null}, h);
    const beforeCard = root.querySelector<HTMLElement>('li.card[data-task-id="t2"]')!;
    vi.spyOn(beforeCard, 'getBoundingClientRect').mockReturnValue(new DOMRect(420, 120, 180, 72));

    const animateSpy = vi.fn().mockReturnValue({addEventListener: vi.fn()});
    const originalAnimate = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = animateSpy;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this === beforeCard) {
        return new DOMRect(420, 120, 180, 72);
      }
      if (this.dataset['taskId'] === 't2') {
        return new DOMRect(20, 180, 180, 72);
      }
      return new DOMRect(0, 0, 0, 0);
    };

    try {
      const moved = moveCard(seedBoard(), 't2', 'todo');
      renderBoard(root, {board: moved, selectedTaskId: null, filter: null}, h);

      const afterCard = root.querySelector<HTMLElement>('li.card[data-task-id="t2"]')!;
      expect(afterCard.classList.contains('moving')).toBe(true);
      expect(animateSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({transform: 'translate(400px, -60px) scale(1)'}),
          expect.objectContaining({transform: 'translate(0, 0) scale(1)'}),
        ]),
        expect.objectContaining({duration: 460}),
      );
    } finally {
      HTMLElement.prototype.animate = originalAnimate;
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });
});
