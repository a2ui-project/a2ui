/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, it} from 'node:test';
import * as assert from 'node:assert';

import {
  AgentToRendererMessageSchema,
  UpdateDataModelMessageSchema,
} from './schema/agent-to-renderer.js';

/** Wraps an `updateDataModel` body in a v1.0 agent-to-renderer envelope. */
function updateDataModel(body: Record<string, unknown>) {
  return {version: '1.0', updateDataModel: body};
}

describe('UpdateDataModelMessageSchema', () => {
  it('accepts an update with a value', () => {
    const message = updateDataModel({surfaceId: 's1', path: '/items', value: ['a', 'b']});
    assert.strictEqual(UpdateDataModelMessageSchema.safeParse(message).success, true);
    assert.strictEqual(AgentToRendererMessageSchema.safeParse(message).success, true);
  });

  it('accepts an update whose value is null, which deletes the key', () => {
    const message = updateDataModel({surfaceId: 's1', path: '/items', value: null});
    assert.strictEqual(UpdateDataModelMessageSchema.safeParse(message).success, true);
    assert.strictEqual(AgentToRendererMessageSchema.safeParse(message).success, true);
  });

  it('rejects an update without a value', () => {
    for (const body of [{surfaceId: 's1', path: '/items'}, {surfaceId: 's1'}]) {
      const message = updateDataModel(body);
      const result = UpdateDataModelMessageSchema.safeParse(message);
      assert.strictEqual(result.success, false, JSON.stringify(body));
      assert.deepStrictEqual(
        result.error?.issues.map(issue => issue.path),
        [['updateDataModel', 'value']],
      );
      assert.strictEqual(AgentToRendererMessageSchema.safeParse(message).success, false);
    }
  });
});
