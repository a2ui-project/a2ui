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
  A2uiError,
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
    const responses = [
      `Intro <a2ui>\nroot = Text("Hi")\n</a2ui> and <a2ui>\nsurface("s2")\nroot = Text("Bye")\n</a2ui> outro`,
      // Fences around the tags, which models often write.
      `Here:\n\`\`\`\n<a2ui>\nroot = Text("Hi")\n</a2ui>\n\`\`\`\nDone.`,
      `\`\`\`express\n<a2ui>\nroot = Text("Hi")\n</a2ui>\n\`\`\`\n\nThen:\n\`\`\`\n<a2ui>\nsurface("s2")\nroot = Text("Bye")\n</a2ui>\n\`\`\``,
    ];
    for (const response of responses) {
      const whole = parser.parseResponse(response);
      for (const size of [1, 2, 3, 7, 50, response.length]) {
        const parts = stream(parser, chunked(response, size)).flat();
        expect(messagesOf(parts), `size ${size}`).toEqual(messagesOf(whole));
        expect(textsOf(parts).join(''), `size ${size}`).toEqual(textsOf(whole).join(''));
      }
    }
  });

  it('drops a fence line right before an open tag and right after a close tag', () => {
    const calls = stream(parser, [
      'Here:\n```\n',
      `${OPEN}\nroot = Text("Hi")\n${CLOSE}`,
      '\n```\nDone.',
    ]);

    expect(textsOf(calls[0])).toEqual(['Here:']);
    expect(calls[1].map(part => part.type)).toEqual(['a2ui']);
    expect(textsOf(calls[2])).toEqual(['Done.']);
    expect(calls[3]).toEqual([]);
  });

  it('keeps a fence that is prose, not a wrapper of a block', () => {
    const calls = stream(parser, ['Run:\n```sh\n', 'make\n```\nThen ', block]);

    expect(textsOf(calls.flat()).join('')).toBe('Run:\n```sh\nmake\n```\nThen');
    expect(componentsOf(messagesOf(calls.flat()))).toHaveLength(1);
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

  it('closes a block on a close tag written on a comment line, as parseResponse does', () => {
    // The conformance rule (response_parser.yaml, test_unwrap_express_close_tag_on_comment_line):
    // a close tag on the same line as a single-line comment still closes the block.
    const response = `${OPEN}\nroot = Text("Hi") # done ${CLOSE} and more`;
    const parts = stream(parser, [response]).flat();

    expect(parts.map(part => part.type)).toEqual(['a2ui', 'text']);
    expect(messagesOf(parts)).toEqual(messagesOf(parser.parseResponse(response)));
    expect(componentsOf(messagesOf(parts))).toEqual([{id: 'root', component: 'Text', text: 'Hi'}]);
    expect(textsOf(parts)).toEqual(['and more']);
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

  it('attaches the parts a chunk emitted before a failing block to error.partialResults', () => {
    const state = new RendererState([catalog]);
    const opened = parser.openStream({state});

    let caught: unknown;
    try {
      opened.feed(`Before ${block} between ${OPEN}\nsurface("s2")\nroot = Card(missing)\n${CLOSE}`);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(A2uiValidationError);
    const partial = (caught as A2uiError).partialResults as ResponsePart[];
    expect(partial.map(part => part.type)).toEqual(['text', 'a2ui', 'text']);
    expect(textsOf(partial)).toEqual(['Before', 'between']);
    expect(state.surfaceIds).toEqual(['s1']);
  });

  it('checks the tree of each block on its own, unlike parseResponse', () => {
    // A stream applies each block as it closes, so a block may not name a component a later
    // block defines. `parseResponse` checks the response as a whole and accepts it.
    const response = `${OPEN}\nroot = Column([a])\n${CLOSE}${OPEN}\nsurface("s1")\na = Text("A")\n${CLOSE}`;
    expect(componentsOf(messagesOf(parser.parseResponse(response)))).toHaveLength(2);

    const opened = parser.openStream();
    expect(() => opened.feed(response)).toThrow(A2uiValidationError);
  });

  it('wraps a failure of the compiler that is not an A2uiError', () => {
    class BrokenParser extends ExpressParser {
      override compile(): never {
        throw new Error('boom');
      }
    }
    const opened = new BrokenParser([catalog], 's1', 'v1.0').openStream();

    expect(() => opened.feed(block)).toThrow(A2uiCompilationError);
    expect(() => opened.feed(block)).toThrow('The response stream is closed.');
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

  describe('isInBlock', () => {
    it('is true from the end of an opening tag to the end of its closing tag', () => {
      const opened = parser.openStream();

      opened.feed('Hello <a2');
      expect(opened.isInBlock).toBe(false);
      opened.feed('ui>\nroot = Text("Hi")\n</a2');
      expect(opened.isInBlock).toBe(true);
      opened.feed('ui> after');
      expect(opened.isInBlock).toBe(false);
    });

    it('is true for an unwrapped stream until it ends', () => {
      const opened = parser.openStream({wrapped: false});

      expect(opened.isInBlock).toBe(true);
      opened.feed('root = Text("Hi")');
      expect(opened.isInBlock).toBe(true);
      opened.close();
      expect(opened.isInBlock).toBe(false);
    });

    it('is false once the stream has ended inside a block', () => {
      const opened = parser.openStream();
      opened.feed(`${OPEN}\nroot = Text("Hi")`);

      opened.close();
      expect(opened.isInBlock).toBe(false);
    });
  });

  describe("afterRejectedBlock: 'continue'", () => {
    const options = {afterRejectedBlock: 'continue'} as const;

    it('returns an error part in place of a rejected block, and reads on', () => {
      const opened = parser.openStream(options);

      const parts = opened.feed(
        `Before ${OPEN}\nroot = Card(missing)\n${CLOSE} between ${OPEN}\nsurface("s2")\nroot = Text("Hi")\n${CLOSE} after`,
      );

      expect(parts.map(part => part.type)).toEqual(['text', 'error', 'text', 'a2ui', 'text']);
      const error = parts[1] as {error: unknown};
      expect(error.error).toBeInstanceOf(A2uiValidationError);
      expect(opened.state.surfaceIds).toEqual(['s2']);
      expect(opened.close()).toEqual([]);
    });

    it('returns an error part for a block that does not compile', () => {
      const opened = parser.openStream(options);

      const parts = opened.feed(`${OPEN}\nroot = Text("Hi"\n${CLOSE} after`);

      expect(parts.map(part => part.type)).toEqual(['error', 'text']);
      const error = parts[0] as {error: unknown};
      expect(error.error).toBeInstanceOf(A2uiCompilationError);
    });

    it('returns an error part for a rejected unwrapped response, and nothing after it', () => {
      const opened = parser.openStream({...options, wrapped: false});

      expect(opened.feed('root = Card(missing)')).toEqual([]);
      expect(opened.close().map(part => part.type)).toEqual(['error']);
    });

    it('still ends the stream on an error that does not reject a block', () => {
      const opened = parser.openStream(options);
      opened.close();

      expect(() => opened.feed('text')).toThrow('The response stream is closed.');
    });
  });
});
