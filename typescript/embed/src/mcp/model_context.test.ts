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
import {afterEach, beforeEach, describe, it, mock} from 'node:test';

import {
  formatModelContext,
  MODEL_CONTEXT_DEBOUNCE_MS,
  ModelContextSync,
  type SharedDataModel,
} from './model_context.js';

describe('formatModelContext', () => {
  it('formats each data model as JSON under its surface ID', () => {
    const text = formatModelContext(
      [
        {surfaceId: 'a', dataModel: {name: 'Ada'}},
        {surfaceId: 'b', dataModel: undefined},
      ],
      1000,
    );

    assert.equal(
      text,
      'A2UI surface "a" data model:\n{"name":"Ada"}\n\nA2UI surface "b" data model:\n{}',
    );
  });

  it('quotes the surface ID, so it cannot read as part of the text', () => {
    const text = formatModelContext([{surfaceId: 'x" data model:\n', dataModel: {}}], 1000);

    assert.equal(text, 'A2UI surface "x\\" data model:\\n" data model:\n{}');
  });

  it('leaves out the largest data models until the rest fits, without partial JSON', () => {
    const big = {rows: 'x'.repeat(100)};
    const text = formatModelContext(
      [
        {surfaceId: 'small', dataModel: {n: 1}},
        {surfaceId: 'big', dataModel: big},
        {surfaceId: 'medium', dataModel: {rows: 'y'.repeat(20)}},
      ],
      40,
    );

    assert.equal(
      text,
      'A2UI surface "small" data model:\n{"n":1}\n\n' +
        `A2UI surface "big" data model was left out: its JSON is ${JSON.stringify(big).length} ` +
        'bytes, above the 40 byte limit.\n\n' +
        'A2UI surface "medium" data model:\n{"rows":"yyyyyyyyyyyyyyyyyyyy"}',
    );
  });

  it('counts the limit in UTF-8 bytes', () => {
    const text = formatModelContext([{surfaceId: 'a', dataModel: {v: 'é'.repeat(10)}}], 20);

    assert.match(text, /left out: its JSON is 28 bytes/);
  });
});

describe('ModelContextSync', () => {
  let sent: Array<string | undefined>;
  let sync: ModelContextSync;
  const surfaces = (name: string): SharedDataModel[] => [{surfaceId: 'a', dataModel: {name}}];

  beforeEach(() => {
    mock.timers.enable({apis: ['setTimeout']});
    sent = [];
    sync = new ModelContextSync(text => sent.push(text), 1000);
  });

  afterEach(() => mock.timers.reset());

  it('sends the latest data models once the changes stop', () => {
    sync.schedule(() => surfaces('A'));
    mock.timers.tick(MODEL_CONTEXT_DEBOUNCE_MS - 1);
    sync.schedule(() => surfaces('B'));
    mock.timers.tick(MODEL_CONTEXT_DEBOUNCE_MS - 1);
    assert.deepEqual(sent, []);

    mock.timers.tick(1);

    assert.deepEqual(sent, ['A2UI surface "a" data model:\n{"name":"B"}']);
  });

  it('refreshes and clears only a context it sent', () => {
    sync.refresh(() => surfaces('A'));
    sync.clear();
    assert.deepEqual(sent, []);

    sync.schedule(() => surfaces('A'));
    mock.timers.tick(MODEL_CONTEXT_DEBOUNCE_MS);
    sync.refresh(() => []);
    sync.clear();

    assert.deepEqual(sent, ['A2UI surface "a" data model:\n{"name":"A"}', undefined]);
  });

  it('cancels a pending update on clear', () => {
    sync.schedule(() => surfaces('A'));
    sync.clear();
    mock.timers.tick(MODEL_CONTEXT_DEBOUNCE_MS);

    assert.deepEqual(sent, []);
  });
});
