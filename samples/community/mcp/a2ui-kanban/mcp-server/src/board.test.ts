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

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  assignTask,
  BoardError,
  createTask,
  findTask,
  KanbanBoard,
  moveTask,
  seedBoard,
} from './board.js';

function cardIds(board: ReturnType<typeof seedBoard>, columnId: string): string[] {
  const column = board.columns.find(candidate => candidate.id === columnId);
  assert.ok(column, `column ${columnId}`);
  return column.cards.map(card => card.id);
}

describe('seedBoard', () => {
  it('has four columns with Review limited to three cards', () => {
    const board = seedBoard();
    assert.deepEqual(
      board.columns.map(column => column.id),
      ['todo', 'in_progress', 'review', 'done'],
    );
    const review = board.columns[2];
    assert.equal(review.wipLimit, 3);
    assert.equal(review.cards.length, 3);
  });
});

describe('moveTask', () => {
  it('moves a card to the end of another column without mutating the input', () => {
    const before = seedBoard();
    const after = moveTask(before, 't1', 'review');
    assert.deepEqual(cardIds(after, 'in_progress'), ['t5']);
    assert.deepEqual(cardIds(after, 'review'), ['t2', 't6', 't7', 't1']);
    assert.deepEqual(cardIds(before, 'in_progress'), ['t1', 't5']);
  });

  it('inserts at an index and clamps it to the column length', () => {
    const atStart = moveTask(seedBoard(), 't8', 'todo', 0);
    assert.deepEqual(cardIds(atStart, 'todo'), ['t8', 't3', 't4']);
    const clamped = moveTask(seedBoard(), 't8', 'todo', 99);
    assert.deepEqual(cardIds(clamped, 'todo'), ['t3', 't4', 't8']);
  });

  it('accepts the column title in any case', () => {
    const after = moveTask(seedBoard(), 't2', 'Done');
    assert.deepEqual(cardIds(after, 'done'), ['t8', 't2']);
  });

  it('rejects unknown task and column ids', () => {
    assert.throws(() => moveTask(seedBoard(), 'nope', 'done'), BoardError);
    assert.throws(() => moveTask(seedBoard(), 't1', 'archive'), BoardError);
  });
});

describe('createTask', () => {
  it('adds a card with the next id to Todo by default', () => {
    const after = createTask(seedBoard(), {title: 'Write tests', assignee: 'Ana'});
    const location = findTask(after, 't9');
    assert.ok(location);
    assert.equal(location.column.id, 'todo');
    assert.deepEqual(location.card, {id: 't9', title: 'Write tests', assignee: 'Ana'});
  });

  it('adds a card to a named column and rejects empty titles', () => {
    const after = createTask(seedBoard(), {
      title: 'Hotfix',
      column: 'In progress',
      due: '2026-10-15',
    });
    assert.deepEqual(cardIds(after, 'in_progress'), ['t1', 't5', 't9']);
    assert.throws(() => createTask(seedBoard(), {title: '   '}), BoardError);
  });
});

describe('assignTask', () => {
  it('changes the assignee and leaves the position alone', () => {
    const after = assignTask(seedBoard(), 't3', 'Ben');
    const location = findTask(after, 't3');
    assert.ok(location);
    assert.equal(location.card.assignee, 'Ben');
    assert.equal(location.index, 0);
    assert.throws(() => assignTask(seedBoard(), 'nope', 'Ben'), BoardError);
  });
});

describe('KanbanBoard', () => {
  it('applies mutations in sequence and resets to the seed', () => {
    const board = new KanbanBoard();
    board.moveTask('t1', 'review');
    board.createTask({title: 'New'});
    assert.deepEqual(cardIds(board.current, 'review'), ['t2', 't6', 't7', 't1']);
    assert.equal(findTask(board.current, 't9')?.card.title, 'New');
    board.reset();
    assert.deepEqual(board.current, seedBoard());
  });
});
