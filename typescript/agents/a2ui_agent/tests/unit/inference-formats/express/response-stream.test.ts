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
  A2uiCompilationParseError,
  A2uiCompilationValidationError,
  ParseError,
} from '../../../../src/errors.js';
import {ExpressCompiler} from '../../../../src/inference-formats/express/compiler.js';
import {ExpressParser} from '../../../../src/inference-formats/express/parser.js';
import {
  DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
  healProgressiveFragment,
  splitCompleteStatements,
} from '../../../../src/inference-formats/express/response-stream.js';
import {AgentToRendererMessage} from '../../../../src/internal/web-core.js';
import {ResponsePart} from '../../../../src/parser/response-part.js';
import {RendererState} from '../../../../src/utils/renderer-state.js';
import {loadBasicCatalog} from '../../../helpers/basic-catalogs.js';
import {loadConformanceCatalog} from '../../../helpers/conformance-catalogs.js';

const v10Catalog = loadConformanceCatalog('simplified_catalog_v1_0.json');
const v09Catalog = loadBasicCatalog('v0.9');

function streamBySize(parser: ExpressParser, response: string, size: number): ResponsePart[] {
  const stream = parser.openStream();
  const out: ResponsePart[] = [];
  for (let i = 0; i < response.length; i += size) {
    out.push(...stream.feed(response.slice(i, i + size)));
  }
  out.push(...stream.close());
  return out;
}

function coalesceText(parts: ResponsePart[]): ResponsePart[] {
  const out: ResponsePart[] = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    if (part.type === 'text' && prev?.type === 'text') {
      prev.text += part.text;
    } else {
      out.push(part.type === 'text' ? {type: 'text', text: part.text} : part);
    }
  }
  return out;
}

describe('ExpressResponseStream unit tests', () => {
  it('DEFAULT_EXPRESS_PROGRESSIVE_KEYS is frozen at runtime', () => {
    expect(Object.isFrozen(DEFAULT_EXPRESS_PROGRESSIVE_KEYS)).toBe(true);
    expect(() => (DEFAULT_EXPRESS_PROGRESSIVE_KEYS as Set<string>).add('title')).toThrow(TypeError);
    expect(() => (DEFAULT_EXPRESS_PROGRESSIVE_KEYS as Set<string>).delete('text')).toThrow(
      TypeError,
    );
    expect(() => (DEFAULT_EXPRESS_PROGRESSIVE_KEYS as Set<string>).clear()).toThrow(TypeError);
    expect(DEFAULT_EXPRESS_PROGRESSIVE_KEYS.has('text')).toBe(true);
  });

  it('splitCompleteStatements handles multiline and semicolons', () => {
    const src = 'surface("main")\nroot = Column(\n  [a, b]\n)\na = Text("Hi';
    const [prefix, tail] = splitCompleteStatements(src, false);
    expect(prefix).toBe('surface("main")\nroot = Column(\n  [a, b]\n)\n');
    expect(tail).toBe('a = Text("Hi');
  });

  it('healProgressiveFragment heals positional, keyword, and data path strings', () => {
    const compiler = new ExpressCompiler([v10Catalog]);
    expect(
      healProgressiveFragment('a = Text("Hel', compiler.helpers, DEFAULT_EXPRESS_PROGRESSIVE_KEYS),
    ).toBe('a = Text("Hel")');
    expect(
      healProgressiveFragment(
        'a = Text(text="Hel\\',
        compiler.helpers,
        DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
      ),
    ).toBe('a = Text(text="Hel")');
    expect(
      healProgressiveFragment(
        'a = Image("https://example.com/a',
        compiler.helpers,
        DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
      ),
    ).toBeUndefined();
    expect(
      healProgressiveFragment(
        'a = Text(variant="h1',
        compiler.helpers,
        DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
      ),
    ).toBeUndefined();
    expect(
      healProgressiveFragment(
        '$/text = "Draft',
        compiler.helpers,
        DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
      ),
    ).toBe('$/text = "Draft"');
    expect(
      healProgressiveFragment('$/bio = "Draft', compiler.helpers, DEFAULT_EXPRESS_PROGRESSIVE_KEYS),
    ).toBeUndefined();
    expect(healProgressiveFragment('a = Text("Hel', compiler.helpers, new Set())).toBeUndefined();
    expect(
      healProgressiveFragment(
        'a = Text("""Hello "',
        compiler.helpers,
        DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
      ),
    ).toBe('a = Text("""Hello \\"""")');
    expect(
      healProgressiveFragment('openUrl(url="tel:+1555', compiler.helpers, new Set(['url'])),
    ).toBeUndefined();
  });

  it('streams unwrapped Express payload when wrapped is false', () => {
    const parser = new ExpressParser([v10Catalog]);
    const stream = parser.openStream({wrapped: false});
    const p1 = stream.feed('surface("main")\nroot = Text("Hello")\n');
    expect(p1).toHaveLength(1);
    expect(p1[0]).toEqual({
      type: 'a2ui',
      a2ui: [
        {
          version: '1.0',
          createSurface: {
            surfaceId: 'main',
            catalogId: v10Catalog.id,
            components: [{id: 'root', component: 'Text', text: 'Hello'}],
          },
        },
      ],
    });
    expect(stream.close()).toEqual([]);
  });

  it('rolls back state transaction on unemitted failing chunk and marks emitted surface checked', () => {
    const parser = new ExpressParser([v09Catalog]);
    const state = new RendererState([v09Catalog]);
    const stream = parser.openStream({state});

    const p1 = stream.feed('<a2ui>\nsurface("main")\nroot = Text("ok")\norphan = Text("unused")\n');
    expect(p1).toHaveLength(1);
    expect(state.surfaceIds).toContain('main');

    expect(() => stream.feed('bad = UnknownWidget("bad")\n</a2ui>')).toThrow(
      A2uiCompilationValidationError,
    );
    expect(() => state.checkTopology(['main'])).not.toThrow();
    expect(() => stream.feed('more')).toThrow('The response stream is closed.');
  });

  it('closes stream after mid-block parse error', () => {
    const parser = new ExpressParser([v10Catalog]);
    const stream = parser.openStream();
    expect(stream.feed('<a2ui>\nsurface("main")\n')).toEqual([]);
    expect(() => stream.feed('root = Text(\n</a2ui>')).toThrow(A2uiCompilationParseError);
    expect(() => stream.feed('after')).toThrow('The response stream is closed.');
  });

  it('coalesces complete and healed component updates for the same surface', () => {
    const parser = new ExpressParser([v10Catalog]);
    const stream = parser.openStream();
    stream.feed('<a2ui>\nsurface("main")\nroot = Column([t1, t2])\n');
    const parts = stream.feed('t1 = Text("First")\nt2 = Text("Sec');
    expect(parts).toEqual([
      {
        type: 'a2ui',
        a2ui: [
          {
            version: '1.0',
            updateComponents: {
              surfaceId: 'main',
              components: [
                {id: 't1', component: 'Text', text: 'First'},
                {id: 't2', component: 'Text', text: 'Sec'},
              ],
            },
          },
        ],
      },
    ]);
    stream.feed('ond")\n</a2ui>');
    expect(stream.close()).toEqual([]);
  });

  it('discards speculative healed update rejected by RendererState without aborting stream', () => {
    const parser = new ExpressParser([v09Catalog], 'main', undefined, {
      progressiveKeys: ['variant'],
    });
    const stream = parser.openStream();
    const p1 = stream.feed(
      '<a2ui>\nsurface("main")\nroot = Column([t1, t2])\n' +
        't1 = Text("First")\nt2 = Text("Second", variant="h',
    );
    expect(p1).toHaveLength(1);
    const p2 = stream.feed('1")\n</a2ui>');
    expect(p2).toEqual([
      {
        type: 'a2ui',
        a2ui: [
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: 'main',
              components: [{id: 't2', component: 'Text', text: 'Second', variant: 'h1'}],
            },
          },
        ],
      },
    ]);
    expect(stream.close()).toEqual([]);
  });

  it('throws ParseError on close when a wrapped block is still open', () => {
    const parser = new ExpressParser([v10Catalog]);
    const stream = parser.openStream();
    expect(stream.feed('<a2ui>\nsurface("main")\nroot = Text("Ready")\n')).toHaveLength(1);
    expect(() => stream.close()).toThrow(ParseError);
  });

  it('carries the parts read before a failure in partialResults', () => {
    const parser = new ExpressParser([v10Catalog]);
    const stream = parser.openStream();
    let thrown: unknown;
    try {
      stream.feed('Before <a2ui>\nroot = (\n</a2ui>');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(A2uiCompilationParseError);
    expect((thrown as {partialResults?: unknown}).partialResults).toEqual([
      {type: 'text', text: 'Before'},
    ]);
    expect(stream.isInBlock).toBe(false);
  });

  it('reads past a rejected block as an ErrorPart when asked to continue', () => {
    const parser = new ExpressParser([v10Catalog]);
    const stream = parser.openStream({afterRejectedBlock: 'continue'});
    const p1 = stream.feed('<a2ui>\nsurface("main")\nroot = Text("Kept")\n');
    expect(p1).toHaveLength(1);
    expect(stream.isInBlock).toBe(true);
    const p2 = stream.feed('bad = UnknownWidget("x")\n');
    expect(p2).toHaveLength(1);
    expect(p2[0].type).toBe('error');
    expect(stream.state.surfaceIds).toContain('main');
    const p3 = stream.feed('ignored = Text("skipped")\n</a2ui> After');
    expect(p3).toEqual([{type: 'text', text: 'After'}]);
    expect(stream.isInBlock).toBe(false);
    expect(stream.close()).toEqual([]);
  });

  it('returns an ErrorPart on close for an open block when asked to continue', () => {
    const parser = new ExpressParser([v10Catalog]);
    const stream = parser.openStream({afterRejectedBlock: 'continue'});
    stream.feed('<a2ui>\nsurface("main")\nroot = Text("Open")\n');
    const closed = stream.close();
    expect(closed).toHaveLength(1);
    expect(closed[0].type).toBe('error');
    expect(stream.isInBlock).toBe(false);
  });

  it('matches parseResponse for outer fences and inline backticks regardless of chunk size', () => {
    const parser = new ExpressParser([v10Catalog], 'main', undefined, {progressiveKeys: []});
    const response =
      'Intro with `inline` code:\n' +
      '```a2ui\n<a2ui>\nsurface("s1")\nroot = Text("One")\n</a2ui>\n```\n' +
      '`<a2ui>`\nsurface("s1", update=true)\n$/title = "Two"\n`</a2ui>`\n' +
      '```a2ui\n<a2ui>\nsurface("s1", update=true)\n$/title = "Three"\n</a2ui>\n```\n' +
      'Done.';
    const expected = parser.parseResponse(response);
    for (const size of [1, 2, 3, 5, 11, response.length]) {
      expect(coalesceText(streamBySize(parser, response, size))).toEqual(expected);
    }
  });

  it('drops a markdown fence line before <a2ui> and after </a2ui>', () => {
    const parser = new ExpressParser([v10Catalog], 'main', undefined, {progressiveKeys: []});
    const stream = parser.openStream();
    expect(stream.feed('Intro\n```')).toEqual([{type: 'text', text: 'Intro'}]);
    expect(stream.feed('a2ui\n<a2')).toEqual([]);
    const block = stream.feed('ui>\nsurface("s1")\nroot = Text("Hi")\n</a2ui>\n`');
    expect(block).toHaveLength(1);
    expect(block[0].type).toBe('a2ui');
    expect(stream.feed('``\nAfter')).toEqual([{type: 'text', text: 'After'}]);
    expect(stream.close()).toEqual([]);
  });

  it('keeps a prose code block before an <a2ui> block', () => {
    const parser = new ExpressParser([v10Catalog], 'main', undefined, {progressiveKeys: []});
    const response =
      'Run:\n```sh\nls\n```\nAnd UI:\n<a2ui>\nsurface("s1")\nroot = Text("Hi")\n</a2ui>';
    expect(coalesceText(streamBySize(parser, response, 2))).toEqual(parser.parseResponse(response));
  });

  it('holds a partial <a2ui ...> open tag whose attribute contains <', () => {
    const parser = new ExpressParser([v10Catalog], 'main', undefined, {progressiveKeys: []});
    const stream = parser.openStream();
    expect(stream.feed('Before <a2ui x="1 < 2"')).toEqual([{type: 'text', text: 'Before'}]);
    expect(stream.feed('>\nsurface("s1")\nroot = Text("Hi")\n</a2ui>')).toHaveLength(1);
    expect(stream.close()).toEqual([]);
  });

  it('checks topology as each block closes rather than across blocks', () => {
    const parser = new ExpressParser([v10Catalog], 'main', undefined, {progressiveKeys: []});
    const twoBlocks =
      '<a2ui>\nsurface("s1")\nroot = Card(c1)\n</a2ui>\n' +
      '<a2ui>\nsurface("s1", update=true)\nc1 = Text("Later")\n</a2ui>';
    // One-shot parsing checks topology across all blocks at the end.
    expect(() => parser.parseResponse(twoBlocks)).not.toThrow();

    const stream = parser.openStream();
    expect(() => stream.feed(twoBlocks)).toThrow();
  });

  it('wraps a non-A2uiError thrown by compile into A2uiCompilationError', () => {
    class BrokenParser extends ExpressParser {
      override compile(_formatContent: string, _isFinal?: boolean): AgentToRendererMessage[] {
        throw new TypeError('unexpected');
      }
    }
    const broken = new BrokenParser([v10Catalog], 'main', undefined, {progressiveKeys: []});
    const stream = broken.openStream({afterRejectedBlock: 'continue'});
    const parts = stream.feed('<a2ui>surface("s1")</a2ui> tail');
    expect(parts).toHaveLength(2);
    expect(parts[0].type).toBe('error');
    if (parts[0].type === 'error') {
      expect(parts[0].error).toBeInstanceOf(A2uiCompilationError);
    }
    expect(parts[1]).toEqual({type: 'text', text: 'tail'});
  });

  it('returns an error part on close for a rejected unwrapped response when afterRejectedBlock is continue', () => {
    const parser = new ExpressParser([v10Catalog], 'main', undefined, {progressiveKeys: []});
    const stream = parser.openStream({wrapped: false, afterRejectedBlock: 'continue'});
    const feedParts = stream.feed('surface("s1")\nroot = Card(missing)\n');
    expect(feedParts).toHaveLength(1);
    expect(feedParts[0].type).toBe('a2ui');
    expect(stream.close().map(part => part.type)).toEqual(['error']);
  });

  it('re-emits an earlier scope component when a later scope in the same block supersedes its ID', () => {
    const parser = new ExpressParser([v10Catalog]);
    const state = new RendererState([v10Catalog]);
    const stream = parser.openStream({state});

    const p1 = stream.feed(
      '<a2ui>\nsurface("s1")\nroot = Column([hdr, body])\nhdr = Text("V1")\n' +
        'body = Text("Initial")\nsurface("s1", update=true)\nhdr = Text("Hel',
    );
    expect(p1).toHaveLength(1);
    const p2 = stream.feed('lo", id="body")\n</a2ui>');
    expect(p2).toEqual([
      {
        type: 'a2ui',
        a2ui: [
          {
            version: '1.0',
            updateComponents: {
              surfaceId: 's1',
              components: [
                {id: 'body', component: 'Text', text: 'Hello'},
                {id: 'hdr', component: 'Text', text: 'V1'},
              ],
            },
          },
        ],
      },
    ]);
  });

  it('rolls back completePrefix statements when a later statement in the same chunk fails', () => {
    const parser = new ExpressParser([v10Catalog]);
    const state = new RendererState([v10Catalog]);
    const stream = parser.openStream({state, afterRejectedBlock: 'continue'});

    expect(stream.feed('<a2ui>\nsurface("s1")\nroot = Column([t1])\n')).toHaveLength(1);
    const errParts = stream.feed('t1 = Text("Good")\nbad = UnknownWidget("x")\n');
    expect(errParts.map(p => p.type)).toEqual(['error']);
    expect(state.getSurface('s1')?.componentsModel.get('t1')).toBeUndefined();
  });

  it('heals empty triple-quoted strings and skips raw triple-quoted strings ending in a quote', () => {
    const parser = new ExpressParser([v10Catalog]);
    const stream = parser.openStream();
    const p1 = stream.feed('<a2ui>\nsurface("s1")\nroot = Text("""');
    expect(p1).toEqual([
      {
        type: 'a2ui',
        a2ui: [
          {
            version: '1.0',
            createSurface: {
              surfaceId: 's1',
              catalogId: v10Catalog.id,
              components: [{id: 'root', component: 'Text', text: ''}],
            },
          },
        ],
      },
    ]);
    const streamRaw = parser.openStream();
    expect(streamRaw.feed('<a2ui>\nsurface("s1")\nroot = Text(r"""Hello "')).toEqual([]);
  });

  it('handles chunk boundaries across raw strings, //, --, and /* comments', () => {
    const parser = new ExpressParser([v10Catalog], 'main', undefined, {progressiveKeys: []});
    const response =
      '<a2ui>\nsurface("s1")\n' +
      '// comment with " quote\n' +
      '-- sql comment with " quote\n' +
      '/* block comment with </a2ui> and " quote */\n' +
      'root = Text(r"raw </a2ui> text")\n' +
      '</a2ui>\nAfter';
    const expected = coalesceText(streamBySize(parser, response, response.length));
    for (const size of [1, 2, 3, 4, 7]) {
      expect(coalesceText(streamBySize(parser, response, size))).toEqual(expected);
    }
  });

  it('defers createSurface until a forward-referenced surface(extensions=...) variable arrives', () => {
    const parser = new ExpressParser([v10Catalog]);
    const stream = parser.openStream();
    expect(stream.feed('<a2ui>\nsurface("s1", extensions=ext)\nroot = Text("Hello")\n')).toEqual(
      [],
    );
    expect(stream.feed('ext = {surfaceTheme: "dark"}\n</a2ui>')).toEqual([
      {
        type: 'a2ui',
        a2ui: [
          {
            version: '1.0',
            createSurface: {
              surfaceId: 's1',
              catalogId: v10Catalog.id,
              components: [{id: 'root', component: 'Text', text: 'Hello'}],
              metadata: {extensions: {surfaceTheme: 'dark'}},
            },
          },
        ],
      },
    ]);
    expect(stream.close()).toEqual([]);
  });

  it('rejects surface(extensions=...) on a non-creating scope when streaming an existing surface', () => {
    const parser = new ExpressParser([v10Catalog]);
    const state = new RendererState([v10Catalog]);
    const seedStream = parser.openStream({state});
    seedStream.feed('<a2ui>\nsurface("s1")\nroot = Text("Initial")\n</a2ui>');
    expect(seedStream.close()).toEqual([]);

    const updateStream = parser.openStream({state});
    expect(
      updateStream.feed(
        '<a2ui>\nsurface("s1", extensions={surfaceTheme: "dark"})\nc1 = Text("Updated")\n',
      ),
    ).toEqual([]);
    expect(() => updateStream.feed('</a2ui>')).toThrow(/surface-creating scope/);
  });
});
