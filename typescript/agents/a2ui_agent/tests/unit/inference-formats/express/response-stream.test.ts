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
  A2uiValidationError,
  ExpressParser,
  RendererState,
  ResponsePart,
} from '../../../../src/index.js';
import {loadConformanceCatalog} from '../../../helpers/conformance-catalogs.js';

type Message = Record<string, unknown>;

const OPEN = '<a2ui>';
const CLOSE = '</a2ui>';
const catalog = loadConformanceCatalog('simplified_catalog_v1_0.json');

function textsOf(parts: ResponsePart[]): string[] {
  return parts.flatMap(part => (part.type === 'text' ? [part.text] : []));
}

function messagesOf(parts: ResponsePart[]): Message[] {
  return parts.flatMap(part => (part.type === 'a2ui' ? (part.a2ui as Message[]) : []));
}

function chunked(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += size) {
    chunks.push(text.slice(start, start + size));
  }
  return chunks;
}

/** Feeds the chunks and closes, returning the parts of each call in order. */
function stream(parser: ExpressParser, chunks: string[], state?: RendererState): ResponsePart[][] {
  const opened = parser.openStream({state});
  const calls = chunks.map(chunk => opened.feed(chunk));
  calls.push(opened.close());
  return calls;
}

function componentsOf(messages: Message[]): unknown[] {
  return messages.flatMap(message => {
    const body = (message.createSurface ?? message.updateComponents) as {
      components?: unknown[];
    };
    return body?.components ?? [];
  });
}

describe('ExpressResponseStream', () => {
  const parser = new ExpressParser([catalog], 's1', 'v1.0');
  const block = `${OPEN}\nroot = Text("Hello")\n${CLOSE}`;

  it('emits text as it arrives and the block when its close tag arrives', () => {
    const calls = stream(parser, ['Here you ', 'go: ', block, ' Done.']);

    expect(textsOf(calls[0])).toEqual(['Here you']);
    expect(textsOf(calls[1])).toEqual([' go:']);
    expect(messagesOf(calls[1])).toEqual([]);
    expect(componentsOf(messagesOf(calls[2]))).toEqual([
      {id: 'root', component: 'Text', text: 'Hello'},
    ]);
    expect(textsOf(calls[3])).toEqual(['Done.']);
    expect(calls[4]).toEqual([]);
  });

  it('reads the same parts whatever the chunking', () => {
    const response = `Intro <a2ui>\nroot = Text("Hi")\n</a2ui> and <a2ui>\nsurface("s2")\nroot = Text("Bye")\n</a2ui> outro`;
    const whole = parser.parseResponse(response);

    for (const size of [1, 3, 7, 50, response.length]) {
      const parts = stream(parser, chunked(response, size)).flat();
      expect(messagesOf(parts)).toEqual(messagesOf(whole));
      expect(textsOf(parts).join('')).toEqual(textsOf(whole).join(''));
    }
  });

  it('holds back text that could start a tag until the next chunk settles it', () => {
    const opened = parser.openStream();

    expect(textsOf(opened.feed('Look <a2'))).toEqual(['Look']);
    expect(textsOf(opened.feed('t> here'))).toEqual([' <a2t> here']);
    expect(textsOf(opened.feed(' and <'))).toEqual([' and']);
    expect(opened.close()).toEqual([{type: 'text', text: ' <'}]);
  });

  it('holds a partial open tag even when a later < is plain text', () => {
    const opened = parser.openStream();

    expect(textsOf(opened.feed('Note: 1 < 2. <a2ui x="1 < 2"'))).toEqual(['Note: 1 < 2.']);
    const parts = opened.feed(`>\nroot = Text("Hi")\n${CLOSE}`);
    expect(componentsOf(messagesOf(parts))).toEqual([{id: 'root', component: 'Text', text: 'Hi'}]);
  });

  it('does not close a block on a tag written inside a comment', () => {
    const calls = stream(parser, [`${OPEN}\nroot = Text("Hi") # not </a2ui> yet\n${CLOSE}`]);

    expect(componentsOf(messagesOf(calls.flat()))).toEqual([
      {id: 'root', component: 'Text', text: 'Hi'},
    ]);
  });

  it('strips a Markdown fence around the block', () => {
    const calls = stream(parser, [...`${OPEN}\n\`\`\`\nroot = Text("Hi")\n\`\`\`\n${CLOSE}`]);

    expect(componentsOf(messagesOf(calls.flat()))).toEqual([
      {id: 'root', component: 'Text', text: 'Hi'},
    ]);
  });

  it('applies each block to the state as it is emitted', () => {
    const state = new RendererState([catalog]);
    const opened = parser.openStream({state});

    opened.feed(block);
    expect(state.surfaceIds).toEqual(['s1']);
    opened.feed(`${OPEN}\nsurface("s2")\nroot = Text("Again")\n${CLOSE}`);
    expect(state.surfaceIds).toEqual(['s1', 's2']);
    expect(state.getSurface('s2')?.componentsModel.get('root')?.properties).toEqual({
      text: 'Again',
    });
  });

  it('reads a response without tags as one block when it closes', () => {
    const opened = parser.openStream({wrapped: false});

    expect(opened.feed('root = Te')).toEqual([]);
    expect(opened.feed('xt("Hi")')).toEqual([]);
    expect(componentsOf(messagesOf(opened.close()))).toEqual([
      {id: 'root', component: 'Text', text: 'Hi'},
    ]);
  });

  it('throws on the chunk that closes a block the state rejects, and keeps the state', () => {
    const state = new RendererState([catalog]);
    const opened = parser.openStream({state});
    opened.feed(block);

    expect(() => opened.feed(`${OPEN}\nsurface("s2")\nroot = Card(missing)\n${CLOSE}`)).toThrow(
      A2uiValidationError,
    );
    expect(state.surfaceIds).toEqual(['s1']);
    expect(state.getSurface('s1')?.componentsModel.get('root')?.properties).toEqual({
      text: 'Hello',
    });
    expect(() => opened.feed('more')).toThrow('The response stream is closed.');
  });

  it('throws on the chunk that closes a block that does not compile', () => {
    const opened = parser.openStream();

    expect(() => opened.feed(`${OPEN}\nroot = Text("Hi"\n${CLOSE}`)).toThrow(A2uiCompilationError);
  });

  it('compiles a block cut off by the end of the response as far as it goes', () => {
    const state = new RendererState([catalog]);
    const opened = parser.openStream({state});

    expect(opened.feed(`${OPEN}\nroot = Column([a])\na = Text("A")\nb = Te`)).toEqual([]);
    const closing = opened.close();
    expect(componentsOf(messagesOf(closing))).toEqual([
      {id: 'root', component: 'Column', children: ['a']},
      {id: 'a', component: 'Text', text: 'A'},
    ]);
    expect(state.surfaceIds).toEqual(['s1']);
  });

  it('emits nothing for a response that ends right after an open tag', () => {
    const opened = parser.openStream();
    opened.feed(`Text ${OPEN}`);

    expect(opened.close()).toEqual([]);
  });

  it('returns nothing from a second close', () => {
    const opened = parser.openStream();
    opened.feed('Hi <');

    expect(opened.close()).toEqual([{type: 'text', text: ' <'}]);
    expect(opened.close()).toEqual([]);
  });
});
