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
import {removeA2uiThinking} from './thinking.js';

// The shared cases are in conformance/core/thinking.yaml.
describe('removeA2uiThinking', () => {
  it('keeps an empty thought empty', () => {
    assert.strictEqual(removeA2uiThinking(''), '');
  });

  it('keeps the blank lines before the first removed line', () => {
    assert.strictEqual(
      removeA2uiThinking('\n\nThe JSON is ready.\nShe wants red.'),
      '\n\nShe wants red.',
    );
  });

  it('does not take a price for a data path', () => {
    assert.strictEqual(removeA2uiThinking('It costs $450.'), 'It costs $450.');
  });

  it('removes a line that opens and closes a fence', () => {
    assert.strictEqual(removeA2uiThinking('```x = 1```\nIt fits.'), 'It fits.');
  });
});
