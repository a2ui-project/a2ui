/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, it, expect} from 'vitest';
import {parseRobustJSON, parseRobustJSONSafe} from './json-parser';

describe('parseRobustJSON', () => {
  it('should parse valid JSON', () => {
    const input = '{"foo": "bar", "num": 123, "bool": true}';
    expect(parseRobustJSON(input)).toEqual({
      foo: 'bar',
      num: 123,
      bool: true,
    });
  });

  it('should handle non-string input by returning it as-is', () => {
    const input = {foo: 'bar'};
    expect(parseRobustJSON(input)).toEqual(input);
  });

  it('should parse JSON wrapped in double quotes with unescaped internal quotes', () => {
    // This simulates AI sending: "{ "foo": "bar" }"
    const input = '"{"foo": "bar"}"';
    expect(parseRobustJSON(input)).toEqual({foo: 'bar'});
  });

  it('should parse JSON wrapped in single quotes', () => {
    const input = '\'{"foo": "bar"}\'';
    expect(parseRobustJSON(input)).toEqual({foo: 'bar'});
  });

  it('should handle escaped quotes in a quoted string', () => {
    const input = '"{\\"foo\\": \\"bar\\"}"';
    expect(parseRobustJSON(input)).toEqual({foo: 'bar'});
  });

  it('should handle double-escaped sequences', () => {
    // This is a bit tricky to represent in a JS string literal
    // We want to simulate a string that when trimmed is: "{\"foo\": \"bar\"}"
    const input = '"{\\\\"foo\\\\": \\\\"bar\\\\"}"';
    expect(parseRobustJSON(input)).toEqual({foo: 'bar'});
  });

  it('should throw an error for completely invalid JSON', () => {
    const input = 'not json at all';
    expect(() => parseRobustJSON(input)).toThrow('Failed to parse JSON');
  });

  it('should handle arrays', () => {
    const input = '[1, 2, 3]';
    expect(parseRobustJSON(input)).toEqual([1, 2, 3]);
  });
});

describe('parseRobustJSONSafe', () => {
  it('should return parsed JSON for valid input', () => {
    expect(parseRobustJSONSafe('{"a": 1}', {})).toEqual({a: 1});
  });

  it('should return default value for invalid input', () => {
    expect(parseRobustJSONSafe('invalid', {default: true})).toEqual({
      default: true,
    });
  });
});
