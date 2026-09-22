/**
 * @license
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
import {parseAndFix, removeTrailingCommas} from '../../../src/parser/payload_fixer.js';
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
});
