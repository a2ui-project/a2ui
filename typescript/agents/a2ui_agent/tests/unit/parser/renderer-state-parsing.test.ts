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

/**
 * Parsing chat and canvas turns against a `RendererState`.
 */

import {describe, expect, it} from 'vitest';

import {
  A2uiCatalogError,
  A2uiIntegrityError,
  A2uiRequestProcessor,
  A2uiValidationError,
  DirectJsonFormatFactory,
  DirectJsonParser,
  ExpressParser,
  InMemoryCatalogProvider,
  ParseError,
  RendererState,
  ResponsePart,
  validatePayload,
} from '../../../src/index.js';
import {BASIC_CATALOG_IDS, loadBasicCatalog} from '../../helpers/basic-catalogs.js';

type Message = Record<string, unknown>;
type Component = Record<string, unknown>;

const BASIC = loadBasicCatalog('v0.9');
const CREATE: Message = {
  version: 'v0.9',
  createSurface: {surfaceId: 's', catalogId: BASIC_CATALOG_IDS['v0.9']},
};

function update(...components: Component[]): Message {
  return {version: 'v0.9', updateComponents: {surfaceId: 's', components}};
}

function column(...children: string[]): Component {
  return {id: 'root', component: 'Column', children};
}

function text(id: string): Component {
  return {id, component: 'Text', text: id};
}

function block(...messages: Message[]): string {
  return `<a2ui-json>${JSON.stringify(messages)}</a2ui-json>`;
}

function componentIds(state: RendererState): string[] {
  const surface = state.getSurface('s');
  expect(surface).toBeDefined();
  return [...surface!.componentsModel.keys].sort();
}

function components(state: RendererState): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const component of state.getSurface('s')!.componentsModel.values) {
    result[component.id] = component.properties;
  }
  return result;
}

function emitted(parts: ResponsePart[]): unknown[] {
  return parts.flatMap(part => (part.type === 'a2ui' ? part.a2ui : []));
}

function textOf(parts: ResponsePart[]): string {
  return parts.map(part => (part.type === 'text' ? part.text : '')).join('');
}

function otherCatalog() {
  return new InMemoryCatalogProvider({catalogId: 'other', components: {}}, 'v0.9').load();
}

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('Expected the call to throw');
}

describe('parsing against a renderer state', () => {
  it('shows new UI in a chat turn', () => {
    // Without a state, an update to a surface the turn never created is rejected.
    // `validatePayload`, which checks one payload with no record of earlier ones, assumes
    // such a surface exists.
    const parser = new DirectJsonParser([BASIC]);
    const earlier = update(column('earlier'));

    expect(() => parser.parseResponse(block(earlier))).toThrow(/Surface not found/);
    validatePayload([BASIC], [earlier]);
  });

  it('checks a canvas turn against earlier turns', () => {
    const parser = new DirectJsonParser([BASIC]);
    const state = new RendererState([BASIC]);
    parser.parseResponse(block(CREATE, update(column('a'), text('a'))), {state});

    parser.parseResponse(block(update(column('a', 'b'), text('b'))), {state});

    expect(componentIds(state)).toEqual(['a', 'b', 'root']);
    expect(() => parser.parseResponse(block(update(column('a', 'missing'))), {state})).toThrow(
      /Dangling reference/,
    );
  });

  it('leaves the state unchanged after a failed canvas turn', () => {
    const parser = new DirectJsonParser([BASIC]);
    const state = new RendererState([BASIC]);
    parser.parseResponse(block(CREATE, update(column('a'), text('a'))), {state});
    const before = components(state);

    const error = caught(() =>
      parser.parseResponse(
        'Adding b.\n' +
          block(update(column('a', 'b'), text('b'))) +
          block(update({id: 'c', component: 'Unknown'})),
        {state},
      ),
    );

    expect(error).toBeInstanceOf(A2uiValidationError);
    expect(components(state)).toEqual(before);
    expect((error as {partialResults: ResponsePart[]}).partialResults).toHaveLength(2);
  });

  it('lets a response reference a component that a later block adds', () => {
    const parser = new DirectJsonParser([BASIC]);
    const first = block(CREATE, update(column('a')));
    const second = block(update(text('a')));

    const parts = parser.parseResponse(`${first} and ${second}`);

    expect(emitted(parts)).toHaveLength(3);
    // A block parsed on its own is checked as a whole response.
    expect(() => parser.parseResponse(first)).toThrow(/Dangling reference/);
  });

  it('rejects an unclosed direct JSON block', () => {
    const parser = new DirectJsonParser([BASIC]);

    expect(() => parser.parseResponse('<a2ui-json>' + JSON.stringify([CREATE]))).toThrow(
      ParseError,
    );
  });

  it('checks closed surfaces even when a later block on another surface is truncated', () => {
    const parser = new ExpressParser([BASIC]);
    const closedDangling = '<a2ui>\nsurface("s1")\nroot = Column([missing])\n</a2ui>';
    const truncatedOther = '<a2ui>\nsurface("s2")\nroot = Column([a])\na = Text("hi"';

    expect(() => parser.parseResponse(`${closedDangling}\n${truncatedOther}`)).toThrow(
      /Dangling reference/,
    );
  });

  it('wraps a failure that is not an A2UI error as a compilation error', () => {
    class BrokenParser extends DirectJsonParser {
      override compile(): never {
        throw new TypeError('boom');
      }
    }

    expect(() => new BrokenParser([BASIC]).parseResponse(block(CREATE))).toThrow(
      'Failed to compile A2UI block: boom',
    );
  });
});

describe('ResponseStream', () => {
  it('reuses one state while data arrives', () => {
    const parser = new DirectJsonParser([BASIC]);
    const state = new RendererState([BASIC]);
    const stream = parser.openStream({state});
    const response = 'Here. ' + block(CREATE, update(column('a'), text('a'))) + ' Done.';

    const parts: ResponsePart[] = [];
    for (let start = 0; start < response.length; start += 7) {
      parts.push(...stream.feed(response.slice(start, start + 7)));
    }
    parts.push(...stream.close());

    expect(stream.state).toBe(state);
    expect(textOf(parts)).toBe('Here.Done.');
    // Replaying what was emitted rebuilds the state.
    const replayed = new RendererState([BASIC]);
    replayed.apply(emitted(parts));
    expect(componentIds(replayed)).toEqual(componentIds(state));
    expect(componentIds(state)).toEqual(['a', 'root']);
  });

  it('updates the state of an earlier canvas turn', () => {
    const parser = new DirectJsonParser([BASIC]);
    const state = new RendererState([BASIC]);
    parser.parseResponse(block(CREATE, update(column('a'), text('a'))), {state});

    const stream = parser.openStream({state});
    const parts = stream.feed(block(update(column('a', 'b'), text('b'))));
    parts.push(...stream.close());

    expect(emitted(parts)).toEqual([update(column('a', 'b'), text('b'))]);
    expect(componentIds(state)).toEqual(['a', 'b', 'root']);
  });

  it('keeps what it emitted when it fails', () => {
    // The renderer received the emitted messages, so the state keeps them.
    const parser = new DirectJsonParser([BASIC]);
    const state = new RendererState([BASIC]);
    const stream = parser.openStream({state});

    const parts = stream.feed('<a2ui-json>' + JSON.stringify([CREATE, update(column('a'))]));
    expect(() => stream.feed('</a2ui-json>')).toThrow(/Dangling reference/);

    expect(emitted(parts)).toEqual([CREATE, update(column('a'))]);
    expect(componentIds(state)).toEqual(['root']);
  });

  it('emits text held as a possible tag when it closes', () => {
    const stream = new DirectJsonParser([BASIC]).openStream();

    const parts = stream.feed('Compare a <a2ui');
    parts.push(...stream.close());

    expect(textOf(parts)).toBe('Compare a <a2ui');
  });

  it('rejects an unclosed block when it closes', () => {
    const stream = new DirectJsonParser([BASIC]).openStream();
    stream.feed('<a2ui-json>' + JSON.stringify([CREATE]));

    expect(() => stream.close()).toThrow(ParseError);
  });

  it('checks the tree of an unwrapped stream when it closes', () => {
    const stream = new DirectJsonParser([BASIC]).openStream({wrapped: false});
    stream.feed(JSON.stringify([CREATE, update(column('a'))]));

    expect(() => stream.close()).toThrow(A2uiIntegrityError);
  });

  it('rejects a chunk fed after it closes', () => {
    const stream = new DirectJsonParser([BASIC]).openStream();
    stream.close();

    expect(() => stream.feed('more')).toThrow(/closed/);
  });

  it('rebuilds its state from every version it emitted', () => {
    const parser = new DirectJsonParser([BASIC], {progressiveKeys: ['text']});
    const state = new RendererState([BASIC]);
    const stream = parser.openStream({state});
    const longText = {id: 'a', component: 'Text', text: 'a'.repeat(40)};
    const body = JSON.stringify([CREATE, update(column('a'), longText)]);

    const parts = stream.feed('<a2ui-json>');
    for (let start = 0; start < body.length; start += 3) {
      parts.push(...stream.feed(body.slice(start, start + 3)));
    }
    parts.push(...stream.feed('</a2ui-json>'));
    parts.push(...stream.close());

    const all = emitted(parts);
    // The update was emitted again as its text grew.
    expect(all.length).toBeGreaterThan(2);
    const rebuilt = new RendererState([BASIC]);
    rebuilt.apply(all);
    expect(components(rebuilt)).toEqual(components(state));
    expect((components(state).a as {text: string}).text).toBe('a'.repeat(40));
  });

  it('holds a delete until its object closes', () => {
    const parser = new DirectJsonParser([BASIC]);
    const state = new RendererState([BASIC]);
    parser.parseResponse(block(CREATE, update(text('root'))), {state});
    const stream = parser.openStream({state});

    const held = stream.feed('<a2ui-json>[{"version": "v0.9", "deleteSurface": {"surfaceId": "s"}');
    expect(emitted(held)).toEqual([]);
    expect(state.surfaceIds).toEqual(['s']);

    const closed = stream.feed('}]</a2ui-json>');
    expect(emitted(closed)).toEqual([{version: 'v0.9', deleteSurface: {surfaceId: 's'}}]);
    expect(state.surfaceIds).toEqual([]);
  });

  it('ends when it throws', () => {
    const stream = new DirectJsonParser([BASIC]).openStream();
    stream.feed('<a2ui-json>' + JSON.stringify([CREATE, update(column('a'))]));

    expect(() => stream.feed('</a2ui-json> More text.')).toThrow(/Dangling reference/);
    expect(() => stream.feed('More text.')).toThrow(/closed/);
    expect(stream.close()).toEqual([]);
  });

  it('returns nothing when it closes a second time', () => {
    const stream = new DirectJsonParser([BASIC]).openStream();
    stream.feed('Held <a2ui');

    expect(textOf(stream.close())).toBe(' <a2ui');
    expect(stream.close()).toEqual([]);
  });

  it.each([
    ['an unknown component', update({id: 'root', component: 'Unknown'})],
    ['a wrong version', {...update(text('root')), version: '1.0'}],
    ['a duplicate id', update(text('root'), text('root'))],
  ])('checks a block that arrives whole when it closes: %s', (_name, message) => {
    // Messages that never streamed in parts are checked as the block closes.
    const stream = new DirectJsonParser([BASIC]).openStream();

    expect(() => stream.feed(block(CREATE, message))).toThrow(A2uiValidationError);
  });

  it('checks the last message of a block when it closes', () => {
    const stream = new DirectJsonParser([BASIC]).openStream();
    const body = JSON.stringify([CREATE, update({id: 'root', component: 'Unknown'})]);

    stream.feed('<a2ui-json>' + body.slice(0, -2));
    expect(() => stream.feed(body.slice(-2) + '</a2ui-json>')).toThrow(A2uiValidationError);
  });

  it('does not heal a URL under a progressive key', () => {
    const parser = new DirectJsonParser([BASIC], {progressiveKeys: ['url', 'text']});
    const state = new RendererState([BASIC]);
    // The renderer holds a root that names the image the stream sends.
    state.apply([CREATE, update(column('i'))]);
    const stream = parser.openStream({state});

    const parts = stream.feed(
      '<a2ui-json>[{"version": "v0.9", "updateComponents": {"surfaceId": "s", "components": [{"id": "i", "component": "Image", "url": "https://exa',
    );

    expect(emitted(parts)).toEqual([]);
  });
});

/** A canvas state holding surface `s` with `root -> a`. */
function canvas(parser: DirectJsonParser): RendererState {
  const state = new RendererState([BASIC]);
  parser.parseResponse(block(CREATE, update(column('a'), text('a'))), {state});
  return state;
}

const CHANGE_A = update({id: 'a', component: 'Text', text: 'Changed'});

describe('what a failed or cut-off response holds against later turns', () => {
  it('does not hold what a failed stream emitted against later turns', () => {
    const parser = new DirectJsonParser([BASIC]);
    const state = canvas(parser);
    const stream = parser.openStream({state});

    const parts = stream.feed('<a2ui-json>[' + JSON.stringify(update(text('orphan'))));
    expect(emitted(parts)).not.toEqual([]);
    expect(() => stream.feed(']</a2ui-json>')).toThrow(/'orphan' is not reachable/);

    // The renderer holds the orphan, and no message can remove it.
    expect(componentIds(state)).toContain('orphan');
    parser.parseResponse(block(CHANGE_A), {state});
    expect(components(state)['a']).toMatchObject({text: 'Changed'});
  });

  it('does not hold what a stream cut off inside a block emitted', () => {
    const parser = new DirectJsonParser([BASIC]);
    const state = canvas(parser);
    const stream = parser.openStream({state});

    const parts = stream.feed('<a2ui-json>[' + JSON.stringify(update(text('orphan'))) + ',');
    expect(emitted(parts)).not.toEqual([]);
    expect(() => stream.close()).toThrow(/ended inside/);

    parser.parseResponse(block(CHANGE_A), {state});
    expect(components(state)['a']).toMatchObject({text: 'Changed'});
  });

  it('does not hold what it emitted when a chunk finishes a block and fails in the next', () => {
    const parser = new DirectJsonParser([BASIC]);
    const state = canvas(parser);
    const stream = parser.openStream({state});

    const parts = stream.feed('<a2ui-json>[' + JSON.stringify(update(text('b'))) + ',');
    expect(emitted(parts)).toEqual([update(text('b'))]);
    // The chunk finishes the block, which makes `b` reachable, and then fails in a second
    // block, so its rollback leaves `b` emitted and unchecked.
    expect(() =>
      stream.feed(
        JSON.stringify(update(column('a', 'b'))) +
          ']</a2ui-json><a2ui-json>' +
          JSON.stringify([update({id: 'x', component: 'Unknown'})]) +
          '</a2ui-json>',
      ),
    ).toThrow(A2uiValidationError);

    expect(componentIds(state)).toContain('b');
    parser.parseResponse(block(CHANGE_A), {state});
    expect(components(state)['a']).toMatchObject({text: 'Changed'});
  });

  it('keeps only the text in partialResults when the tree check fails', () => {
    const parser = new DirectJsonParser([BASIC]);
    const state = new RendererState([BASIC]);

    const error = caught(() =>
      parser.parseResponse('Here.\n' + block(CREATE, update(column('missing'))), {state}),
    );

    expect(error).toBeInstanceOf(A2uiIntegrityError);
    expect(String(error)).toMatch(/Dangling reference/);
    const partial = (error as {partialResults: ResponsePart[]}).partialResults;
    expect(partial.every(part => part.type === 'text')).toBe(true);
    expect(textOf(partial)).toBe('Here.');
    expect(state.getSurface('s')).toBeUndefined();
  });

  it("does not hold a truncated block's components against later turns", () => {
    /** Compiles a cut-off block as far as it goes, as Express does. */
    class TruncationTolerantParser extends DirectJsonParser {
      override compile(formatContent: string): ReturnType<DirectJsonParser['compile']> {
        return super.compile(formatContent);
      }
    }
    const parser = new TruncationTolerantParser([BASIC]);
    const state = canvas(parser);

    parser.parseResponse('<a2ui-json>' + JSON.stringify([update(text('orphan'))]), {state});

    expect(componentIds(state)).toContain('orphan');
    parser.parseResponse(block(CHANGE_A), {state});
    expect(components(state)['a']).toMatchObject({text: 'Changed'});
  });
});

describe('A2uiRequestProcessor with a renderer state', () => {
  it('parses canvas turns against the state it is given', () => {
    const processor = new A2uiRequestProcessor([BASIC], undefined, new DirectJsonFormatFactory());
    const state = processor.createState();
    processor.parseResponse(block(CREATE, update(column('a'), text('a'))), {state});

    const stream = processor.openStream({state});
    stream.feed(block(update(column('a', 'b'), text('b'))));
    stream.close();

    expect(componentIds(state)).toEqual(['a', 'b', 'root']);
    expect(() => processor.parseResponse(block(update(column('missing'))), {state})).toThrow(
      /Dangling reference/,
    );
  });

  it('checks each call against a new state when it has none', () => {
    const processor = new A2uiRequestProcessor([BASIC], undefined, new DirectJsonFormatFactory());

    processor.parseResponse(block(CREATE, update(text('root'))));
    // The same surface can be created again: nothing was kept from the first call.
    processor.parseResponse(block(CREATE, update(text('root'))));
    expect(processor.state).toBeUndefined();
  });

  it('rejects a state for other catalogs', () => {
    const processor = new A2uiRequestProcessor([BASIC], undefined, new DirectJsonFormatFactory());
    const other = new RendererState([otherCatalog()]);

    expect(() => processor.parseResponse(block(CREATE), {state: other})).toThrow(A2uiCatalogError);
    expect(() => processor.openStream({state: other})).toThrow(/active catalogs/);
  });

  it('uses a bound state when a call passes none', () => {
    const state = new RendererState([BASIC]);
    const processor = new A2uiRequestProcessor([BASIC], undefined, new DirectJsonFormatFactory(), {
      state,
    });

    processor.parseResponse(block(CREATE, update(column('a'), text('a'))));
    const stream = processor.openStream();
    stream.feed(block(update(column('a', 'b'), text('b'))));
    stream.close();

    expect(processor.state).toBe(state);
    expect(componentIds(state)).toEqual(['a', 'b', 'root']);
  });

  it('rejects a bound state for other catalogs', () => {
    const other = new RendererState([otherCatalog()]);

    expect(() => new A2uiRequestProcessor([BASIC], undefined, undefined, {state: other})).toThrow(
      /active catalogs/,
    );
  });

  it('normalizes protocolVersion spelling when checking a bound state', () => {
    const raw = new InMemoryCatalogProvider({catalogId: 'other', components: {}}, '0.9').load();
    const prefixed = new InMemoryCatalogProvider(
      {catalogId: 'other', components: {}},
      'v0.9',
    ).load();
    const state = new RendererState([raw]);

    const processor = new A2uiRequestProcessor([prefixed], undefined, undefined, {state});

    expect(processor.state).toBe(state);
  });

  it('accepts a state that holds the active catalogs in order', () => {
    const other = otherCatalog();
    const processor = new A2uiRequestProcessor(
      [BASIC, other],
      undefined,
      new DirectJsonFormatFactory(),
    );

    expect(processor.acceptsState(processor.createState())).toBe(true);
    expect(processor.acceptsState(new RendererState([BASIC, other]))).toBe(true);
    // The order decides which catalog a surface resolves to.
    expect(processor.acceptsState(new RendererState([other, BASIC]))).toBe(false);
    expect(processor.acceptsState(new RendererState([BASIC]))).toBe(false);
  });

  it('accepts a state for the v0.9.1 spelling of the same catalogs', () => {
    const v091 = loadBasicCatalog('v0.9.1');
    const processor = new A2uiRequestProcessor([BASIC]);

    expect(v091.id).toBe(BASIC.id);
    expect(processor.acceptsState(new RendererState([v091]))).toBe(true);
    expect(new A2uiRequestProcessor([v091]).acceptsState(processor.createState())).toBe(true);
    expect(
      () =>
        new A2uiRequestProcessor([BASIC], undefined, undefined, {state: new RendererState([v091])}),
    ).not.toThrow();
  });

  it('reuses one parser', () => {
    const processor = new A2uiRequestProcessor([BASIC]);

    expect(processor.parser).toBe(processor.parser);
  });
});
