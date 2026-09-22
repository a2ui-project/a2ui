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
import {Parser} from '../../../src/parser/parser.js';
import {RawResponsePart, ResponsePart} from '../../../src/parser/response_part.js';
import {AgentToRendererMessage} from '../../../src/internal/web_core.js';

class TestParser extends Parser {
  unwrap(content: string): RawResponsePart[] {
    return [{type: 'text', text: content, isFinal: true}];
  }

  compile(formatContent: string, _isFinal?: boolean): AgentToRendererMessage[] {
    return [
      {
        version: 'v1.0',
        createSurface: {surfaceId: formatContent + ' (compiled)'},
      } as unknown as AgentToRendererMessage,
    ];
  }

  decompile(_a2uiPayload: AgentToRendererMessage[]): string {
    return 'decompiled_string';
  }

  wrap(blocks: RawResponsePart[]): string {
    return blocks.map(b => (b.type === 'text' ? b.text : b.a2uiRaw)).join('') + ' (wrapped)';
  }

  parseChunk(chunk: string, wrapped = true): ResponsePart[] {
    return [{type: 'text', text: chunk + `(wrapped=${wrapped})`}];
  }

  hasA2uiParts(content: string): boolean {
    return content.includes('<a2ui>');
  }
}

describe('Parser', () => {
  it('parseResponse delegates to unwrap and compile when wrapped = true', () => {
    const parser = new TestParser();

    // Mock unwrap to return an a2ui part to test compile flow
    parser.unwrap = c => [{type: 'a2ui', a2uiRaw: c, isFinal: true}];

    const result = parser.parseResponse('hello');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('a2ui');

    if (result[0].type === 'a2ui') {
      expect(
        (result[0].a2ui[0] as {createSurface?: {surfaceId: string}}).createSurface?.surfaceId,
      ).toBe('hello (compiled)');
    }
  });

  it('parseResponse compiles whole content when wrapped = false', () => {
    const parser = new TestParser();
    const result = parser.parseResponse('hello', false);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('a2ui');

    if (result[0].type === 'a2ui') {
      expect(
        (result[0].a2ui[0] as {createSurface?: {surfaceId: string}}).createSurface?.surfaceId,
      ).toBe('hello (compiled)');
    }
  });

  it('parseStream yields correctly and propagates wrapped flag', async () => {
    const parser = new TestParser();

    async function* getChunks() {
      yield 'hello';
      yield ' world';
    }

    const results: ResponsePart[][] = [];
    for await (const chunks of parser.parseStream(getChunks(), false)) {
      results.push(chunks);
    }

    expect(results).toHaveLength(2);
    expect((results[0][0] as import('../../../src/parser/response_part.js').TextPart).text).toBe(
      'hello(wrapped=false)',
    );
    expect((results[1][0] as import('../../../src/parser/response_part.js').TextPart).text).toBe(
      ' world(wrapped=false)',
    );
  });
});
