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
import {isWebComponentImplementation} from './is_web_component_implementation.js';
import {z} from 'zod';

describe('isWebComponentImplementation', () => {
  it('returns true for a valid WebComponentImplementation', () => {
    assert.strictEqual(
      isWebComponentImplementation({
        name: 'test',
        schema: z.object({}),
        tagName: 'a2ui-test',
      }),
      true,
    );
  });

  it('returns false when missing tagName', () => {
    assert.strictEqual(
      isWebComponentImplementation({
        name: 'test',
        schema: z.object({}),
      }),
      false,
    );
  });

  it('returns true when defining tagName even if name or schema omitted', () => {
    assert.strictEqual(
      isWebComponentImplementation({
        tagName: 'a2ui-test',
      }),
      true,
    );
  });

  it('returns false for primitives or null', () => {
    assert.strictEqual(isWebComponentImplementation(null), false);
    assert.strictEqual(isWebComponentImplementation(undefined), false);
    assert.strictEqual(isWebComponentImplementation('test'), false);
    assert.strictEqual(isWebComponentImplementation(123), false);
  });
});
