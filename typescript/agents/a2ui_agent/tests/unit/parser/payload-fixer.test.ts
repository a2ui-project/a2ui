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

import {describe, it, expect} from 'vitest';
import {parseAndFix, removeTrailingCommas} from '../../../src/parser/payload-fixer.js';
import {ParseError} from '../../../src/errors.js';

describe('PayloadFixer', () => {
  it('unescaped backslashes error hint', () => {
    const invalidJson = '{"formula": "\\approx \\Delta x"}';
    expect(() => parseAndFix(invalidJson)).toThrow(ParseError);
    try {
      parseAndFix(invalidJson);
    } catch (e: unknown) {
      expect((e as Error).message).toContain('Help: Unescaped backslash found');
      expect((e as Error).message).toContain('In JSON strings, all backslashes must be escaped');
    }
  });

  it('fix trailing commas', () => {
    const trailingCommaJson = '{"a": [1, 2, ], "b": {"k": "v", }, }';
    const fixed = removeTrailingCommas(trailingCommaJson);
    expect(fixed).not.toContain(', ]');
    expect(fixed).not.toContain(', }');
    expect(fixed).toBe('{"a": [1, 2 ], "b": {"k": "v" } }');
  });

  it('keeps commas inside string literals', () => {
    const json = '{"formula": "a,}", "list": "x, ]", "b": [1, ],}';
    expect(removeTrailingCommas(json)).toBe('{"formula": "a,}", "list": "x, ]", "b": [1 ]}');
  });

  it('keeps commas inside strings that contain escaped quotes', () => {
    const json = '{"s": "say \\",}\\" and \\\\", "t": [1,],}';
    expect(JSON.parse(removeTrailingCommas(json))).toEqual({s: 'say ",}" and \\', t: [1]});
  });

  it('parseAndFix keeps string contents while recovering trailing commas', () => {
    const res = parseAndFix('[{"formula": "a,}", "items": ["x", ],},]');
    expect(res).toEqual([{formula: 'a,}', items: ['x']}]);
  });

  it('parseAndFix recovers trailing commas', () => {
    const corruptPayload =
      '[{"version": "v0.9", "createSurface": {"surfaceId": "default",' +
      ' "components": [' +
      '{"id": "t1", "component": "Text", "text": "Hello world",},' +
      ']}}]';
    const res = parseAndFix(corruptPayload);
    expect(res).toHaveLength(1);
    const components = (res[0] as {createSurface: {components: {text: string}[]}}).createSurface
      .components;
    expect(components[0].text).toBe('Hello world');
  });

  it('normalize smart quotes automatically', () => {
    const validSmartQuotePayload = '[\u201Cversion\u201D, \u201Cstr\u201D]';
    const res = parseAndFix(validSmartQuotePayload);
    expect(res).toEqual(['version', 'str']);
  });

  it('repairs raw line breaks in keys and single-token strings while keeping prose newlines', () => {
    const payload =
      '[{"children\\n": ["work\\nText"], "\\nevent": {"id": "\\ntext3", "text": "Line 1\\nLine 2"}}]';
    const rawNewlinePayload = payload.replace(/\\n/g, '\n');
    const res = parseAndFix(rawNewlinePayload);
    expect(res).toEqual([
      {
        children: ['workText'],
        event: {id: 'text3', text: 'Line 1\nLine 2'},
      },
    ]);
  });

  it('repairs raw newlines in string containing smart quotes without corrupting inner quotes', () => {
    const rawPayload = '{"text": "He said \u201chi\u201d\nbye"}';
    const res = parseAndFix(rawPayload);
    expect(res).toEqual([{text: 'He said \u201chi\u201d\nbye'}]);
  });

  it('handles 200k-character strings without throwing RangeError', () => {
    const largeText = 'A'.repeat(200_000);
    const payload = `[{"id": "\\ncard1", "text": "${largeText}"}]`.replace('\\n', '\n');
    const res = parseAndFix(payload);
    expect(res).toEqual([{id: 'card1', text: largeText}]);
  });
});
