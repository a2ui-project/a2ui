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

import {describe, expect, it} from 'vitest';

import {
  A2uiCompilationError,
  AgentToRendererMessage,
  Parser,
  RawResponsePart,
  RendererState,
} from '../../../src/index.js';
import {loadBasicCatalog} from '../../helpers/basic-catalogs.js';

const BASIC = loadBasicCatalog('1.0');

/** A parser whose blocks each name the surface their `createSurface` creates. */
class TestParser extends Parser {
  readonly catalogs = [BASIC];
  unwrapped: RawResponsePart[] = [];

  unwrap(_content: string): RawResponsePart[] {
    return this.unwrapped;
  }

  compile(formatContent: string, _isFinal?: boolean): AgentToRendererMessage[] {
    if (formatContent === 'throw') throw new Error('broken notation');
    return [
      {
        version: '1.0',
        createSurface: {surfaceId: formatContent, catalogId: BASIC.id},
      } as AgentToRendererMessage,
    ];
  }

  decompile(_a2uiPayload: AgentToRendererMessage[]): string {
    return 'decompiled_string';
  }

  wrap(blocks: RawResponsePart[]): string {
    return blocks.map(b => (b.type === 'text' ? b.text : b.a2uiRaw)).join('');
  }

  hasFormatContent(content: string): boolean {
    return content.includes('<a2ui>');
  }
}

describe('Parser', () => {
  it('compiles each block that unwrap finds and keeps the text in place', () => {
    const parser = new TestParser();
    parser.unwrapped = [
      {type: 'text', text: 'Before', isFinal: true},
      {type: 'a2ui', a2uiRaw: 'a', isFinal: true},
      {type: 'text', text: 'After', isFinal: true},
    ];

    const parts = parser.parseResponse('ignored');

    expect(parts.map(p => p.type)).toEqual(['text', 'a2ui', 'text']);
    expect(parts[1]).toEqual({
      type: 'a2ui',
      a2ui: [{version: '1.0', createSurface: {surfaceId: 'a', catalogId: BASIC.id}}],
    });
  });

  it('compiles the whole content as one block when it is not wrapped', () => {
    const parts = new TestParser().parseResponse('whole', {wrapped: false});

    expect(parts).toEqual([
      {
        type: 'a2ui',
        a2ui: [{version: '1.0', createSurface: {surfaceId: 'whole', catalogId: BASIC.id}}],
      },
    ]);
  });

  it('applies the messages to the state it is given', () => {
    const state = new RendererState([BASIC]);

    new TestParser().parseResponse('s', {wrapped: false, state});

    expect(state.surfaceIds).toEqual(['s']);
  });

  it('applies a response all or nothing', () => {
    const parser = new TestParser();
    const state = new RendererState([BASIC]);
    // The second block creates the surface the first one created.
    parser.unwrapped = [
      {type: 'a2ui', a2uiRaw: 's', isFinal: true},
      {type: 'a2ui', a2uiRaw: 's', isFinal: true},
    ];

    expect(() => parser.parseResponse('ignored', {state})).toThrow(/already exists/);
    expect(state.surfaceIds).toEqual([]);
  });

  it('raises a failure to compile as a compilation error with the parts read before it', () => {
    const parser = new TestParser();
    parser.unwrapped = [
      {type: 'text', text: 'Before', isFinal: true},
      {type: 'a2ui', a2uiRaw: 'throw', isFinal: true},
    ];

    let error: unknown;
    try {
      parser.parseResponse('ignored');
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(A2uiCompilationError);
    expect((error as A2uiCompilationError).message).toContain('broken notation');
    expect((error as A2uiCompilationError).partialResults).toEqual([
      {type: 'text', text: 'Before'},
    ]);
  });

  it('does not support streaming unless a format overrides it', () => {
    const parser = new TestParser();

    expect(parser.supportsStreaming).toBe(false);
    expect(() => parser.openStream()).toThrow('Streaming is not supported by TestParser');
  });
});
