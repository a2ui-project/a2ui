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

import * as assert from 'node:assert';
import {describe, it} from 'node:test';

import {checkV08ExactlyOneKey} from './exactly-one-key.js';

describe('checkV08ExactlyOneKey', () => {
  it('accepts a well-formed message', () => {
    assert.deepStrictEqual(
      checkV08ExactlyOneKey({
        surfaceUpdate: {surfaceId: 's', components: [{id: 'a', component: {Text: {}}}]},
      }),
      [],
    );
    assert.deepStrictEqual(
      checkV08ExactlyOneKey({
        dataModelUpdate: {
          surfaceId: 's',
          contents: [{key: 'k', valueMap: [{key: 'n', valueNumber: 1}]}],
        },
      }),
      [],
    );
  });

  it('requires exactly one action', () => {
    const issues = checkV08ExactlyOneKey({
      deleteSurface: {surfaceId: 's'},
      beginRendering: {surfaceId: 's', root: 'r'},
    });
    assert.strictEqual(issues.length, 1);
    assert.match(issues[0].message, /exactly one of/);
  });

  it('requires a component wrapper with exactly one component type key', () => {
    const issues = checkV08ExactlyOneKey({
      surfaceUpdate: {surfaceId: 's', components: [{id: 'a', component: {Text: {}, Image: {}}}]},
    });
    assert.strictEqual(issues.length, 1);
    assert.deepStrictEqual(issues[0].path, ['surfaceUpdate', 'components', 0, 'component']);
  });

  it('requires exactly one value property in each data entry, nested entries included', () => {
    const issues = checkV08ExactlyOneKey({
      dataModelUpdate: {
        surfaceId: 's',
        contents: [
          {key: 'none'},
          {key: 'two', valueString: 'a', valueNumber: 1},
          {key: 'map', valueMap: [{key: 'inner'}]},
        ],
      },
    });
    assert.deepStrictEqual(
      issues.map(i => i.path),
      [
        ['dataModelUpdate', 'contents', 0],
        ['dataModelUpdate', 'contents', 1],
        ['dataModelUpdate', 'contents', 2, 'valueMap', 0],
      ],
    );
    assert.match(issues[0].message, /must have exactly one value property/);
  });
});
