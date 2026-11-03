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

import {describe, expect, test} from 'vitest';

import {removeA2uiThinking} from '../../../src/index.js';

describe('removeA2uiThinking', () => {
  test('an empty thought stays empty', () => {
    expect(removeA2uiThinking('')).toBe('');
  });

  test('blank lines before the first removed line stay', () => {
    expect(removeA2uiThinking('\n\nThe JSON is ready.\nShe wants red.')).toBe('\n\nShe wants red.');
  });

  test('a price is not a data path', () => {
    expect(removeA2uiThinking('It costs $450.')).toBe('It costs $450.');
  });
});
