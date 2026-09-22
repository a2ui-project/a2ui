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
import {DirectJsonParser} from '../../../../src/inference_formats/direct_json/parser.js';
import {basicCatalog} from '../../../../src/types.js';
import {ParseError} from '../../../../src/errors.js';

describe('DirectJsonParser', () => {
  const catalog = basicCatalog();

  it('hasA2uiParts correctly identifies complete and incomplete format content', () => {
    const parser = new DirectJsonParser(catalog);
    expect(parser.hasA2uiParts('No tags here')).toBe(false);
    expect(parser.hasA2uiParts('<a2ui-json>\n{"a": 1}\n</a2ui-json>')).toBe(true);
    expect(parser.hasA2uiParts('<a2ui-json>\n{"a": 1}')).toBe(false); // unterminated opening tag
  });

  it('unwraps valid A2UI JSON payload', () => {
    const parser = new DirectJsonParser(catalog);
    const content = 'Text before\n<a2ui-json>\n[{"action": "test"}]\n</a2ui-json>\nText after';
    const parts = parser.unwrap(content);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({type: 'text', text: 'Text before', isFinal: true});
    expect(parts[1]).toEqual({type: 'a2ui', a2uiRaw: '[{"action": "test"}]', isFinal: true});
    expect(parts[2]).toEqual({type: 'text', text: 'Text after', isFinal: true});
  });

  it('throws ParseError on missing close tag', () => {
    const parser = new DirectJsonParser(catalog);
    const content = 'Text before\n<a2ui-json>\n[{"action": "test"}]';
    expect(() => parser.unwrap(content)).toThrow(ParseError);
  });

  it('throws ParseError on empty JSON part', () => {
    const parser = new DirectJsonParser(catalog);
    const content = 'Text before\n<a2ui-json>\n</a2ui-json>';
    expect(() => parser.unwrap(content)).toThrow(ParseError);
  });

  it('throws ParseError when no tags are found', () => {
    const parser = new DirectJsonParser(catalog);
    const content = 'Text before\nNo tags here';
    expect(() => parser.unwrap(content)).toThrow(ParseError);
  });

  it('compiles raw format content', () => {
    const parser = new DirectJsonParser(catalog);
    const payload = '[{"version": "1.0", "createSurface": {"surfaceId": "1"}}]';
    const compiled = parser.compile(payload);
    expect(compiled).toEqual([{version: '1.0', createSurface: {surfaceId: '1'}}]);
  });

  it('parseChunk throws without a stream processor', () => {
    const parser = new DirectJsonParser(catalog);
    expect(() => parser.parseChunk('<a2ui-json>')).toThrow(
      /DirectJsonStreamProcessor is not injected/,
    );
  });
});
