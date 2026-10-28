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
import {RendererState} from '../../../../src/utils/renderer-state.js';
import {loadBasicCatalog} from '../../../helpers/basic-catalogs.js';
import {loadConformanceCatalog} from '../../../helpers/conformance-catalogs.js';

const v10Catalog = loadConformanceCatalog('simplified_catalog_v1_0.json');
const v09Catalog = loadBasicCatalog('v0.9');

describe('ExpressResponseStream unit tests', () => {
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
      healProgressiveFragment('$/bio = "Draft', compiler.helpers, DEFAULT_EXPRESS_PROGRESSIVE_KEYS),
    ).toBe('$/bio = "Draft"');
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
          version: 'v1.0',
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
            version: 'v1.0',
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
});
