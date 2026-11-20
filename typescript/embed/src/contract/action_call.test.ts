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
import {ActionCallSchema} from './action_call.js';

describe('ActionCallSchema', () => {
  it('parses a full action call', () => {
    const call = {
      name: 'refresh',
      surfaceId: 'main',
      sourceComponentId: 'refresh-button',
      context: {query: 'SELECT 1', limit: 10},
    };
    assert.deepEqual(ActionCallSchema.parse(call), call);
  });

  it('allows a missing sourceComponentId', () => {
    const call = {name: 'refresh', surfaceId: 'main', context: {}};
    assert.deepEqual(ActionCallSchema.parse(call), call);
  });

  it('drops unknown fields', () => {
    const parsed = ActionCallSchema.parse({name: 'a', surfaceId: 's', context: {}, extra: 1});
    assert.deepEqual(parsed, {name: 'a', surfaceId: 's', context: {}});
  });

  for (const [label, call] of [
    ['an empty name', {name: '', surfaceId: 's', context: {}}],
    ['a missing surfaceId', {name: 'a', context: {}}],
    ['a missing context', {name: 'a', surfaceId: 's'}],
    ['an array context', {name: 'a', surfaceId: 's', context: []}],
    [
      'a non-string sourceComponentId',
      {name: 'a', surfaceId: 's', sourceComponentId: 1, context: {}},
    ],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.equal(ActionCallSchema.safeParse(call).success, false);
    });
  }
});
