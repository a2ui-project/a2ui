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

import {describe, expect, it} from 'vitest';

import {balanceJson, parseModelJson} from './lenient_json.js';

describe('parseModelJson', () => {
  it('parses valid JSON unchanged', () => {
    expect(parseModelJson('{"a": [1, {"b": "}"}]}')).toEqual({a: [1, {b: '}'}]});
    expect(balanceJson('{"a": 1}')).toBeUndefined();
  });

  it('drops extra closers, adds missing ones and removes trailing commas', () => {
    expect(parseModelJson('{"a": {"b": 1}}}')).toEqual({a: {b: 1}});
    expect(parseModelJson('{"a": [1, 2')).toEqual({a: [1, 2]});
    expect(parseModelJson('{"a": [1, 2,], "b": {"c": 3,},}')).toEqual({a: [1, 2], b: {c: 3}});
    expect(parseModelJson('{"a": [1, 2}')).toEqual({a: [1, 2]});
    // An extra brace inside an array of objects (seen from Gemini).
    expect(parseModelJson('{"outputs": [{"v": {"x": 1}}}, {"v": 2}], "t": "y"}')).toEqual({
      outputs: [{v: {x: 1}}, {v: 2}],
      t: 'y',
    });
    expect(parseModelJson('{"a": {"b": [1}, "c": 2}')).toEqual({a: {b: [1], c: 2}});
  });

  it('leaves brackets inside strings alone and gives up on other errors', () => {
    expect(parseModelJson('{"a": "x]}"}}')).toEqual({a: 'x]}'});
    expect(() => parseModelJson('{"a": nope}')).toThrow(SyntaxError);
    expect(() => parseModelJson('{"a": "unterminated')).toThrow(SyntaxError);
  });
});
