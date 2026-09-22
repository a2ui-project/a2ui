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
import {BlockLexer} from '../../../src/parser/lexer.js';

describe('BlockLexer', () => {
  it('standard parsing', () => {
    const content = 'Preamble\n<a2ui>\ncode_here\n</a2ui>\nPostamble';
    const lexer = new BlockLexer();
    const parts = lexer.tokenize(content);

    expect(parts).toHaveLength(3); // text, a2ui, text
    expect(parts[0]).toEqual({type: 'text', text: 'Preamble', isFinal: true});
    expect(parts[1]).toEqual({type: 'a2ui', a2uiRaw: 'code_here', isFinal: true});
    expect(parts[2]).toEqual({type: 'text', text: 'Postamble', isFinal: true});
  });

  it('embedded tag in string literal', () => {
    const content = 'Preamble\n<a2ui>\ntext = "Hello </a2ui> World"\n</a2ui>';
    const lexer = new BlockLexer();
    const parts = lexer.tokenize(content);

    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({type: 'text', text: 'Preamble', isFinal: true});
    expect(parts[1]).toEqual({
      type: 'a2ui',
      a2uiRaw: 'text = "Hello </a2ui> World"',
      isFinal: true,
    });
  });

  it('triple quoted string', () => {
    const content = 'Preamble\n<a2ui>\ntext = """\nLine 1\n</a2ui>\nLine 2\n"""\n</a2ui>';
    const lexer = new BlockLexer();
    const parts = lexer.tokenize(content);

    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({type: 'text', text: 'Preamble', isFinal: true});
    expect(parts[1]).toEqual({
      type: 'a2ui',
      a2uiRaw: 'text = """\nLine 1\n</a2ui>\nLine 2\n"""',
      isFinal: true,
    });
  });

  it('unclosed block truncation', () => {
    const content = 'Preamble\n<a2ui>\ntext = "Hello';
    const lexer = new BlockLexer();
    const parts = lexer.tokenize(content);

    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({type: 'text', text: 'Preamble', isFinal: false});
    expect(parts[1]).toEqual({type: 'a2ui', a2uiRaw: 'text = "Hello', isFinal: false});
  });

  it('embedded tag in comment', () => {
    const content = 'Preamble\n<a2ui>\n# Some </a2ui> comment\ntext = 123\n</a2ui>';
    const lexer = new BlockLexer();
    const parts = lexer.tokenize(content);

    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({type: 'text', text: 'Preamble', isFinal: true});
    expect(parts[1]).toEqual({
      type: 'a2ui',
      a2uiRaw: '# Some </a2ui> comment\ntext = 123',
      isFinal: true,
    });
  });

  it('open tag with attributes', () => {
    const content = 'Preamble\n<a2ui id="main" surfaceId="foo">\ncode_here\n</a2ui>\nPostamble';
    const lexer = new BlockLexer();
    const parts = lexer.tokenize(content);

    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({type: 'text', text: 'Preamble', isFinal: true});
    expect(parts[1]).toEqual({type: 'a2ui', a2uiRaw: 'code_here', isFinal: true});
    expect(parts[2]).toEqual({type: 'text', text: 'Postamble', isFinal: true});
  });

  it('markdown cleaning (conversational text and code block disambiguation)', () => {
    const content = 'Preamble\n```html\n<a2ui>\ncode_here\n</a2ui>\n```\nPostamble';
    const lexer = new BlockLexer();
    const parts = lexer.tokenize(content);

    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({type: 'text', text: 'Preamble', isFinal: true});
    expect(parts[1]).toEqual({type: 'a2ui', a2uiRaw: 'code_here', isFinal: true});
    expect(parts[2]).toEqual({type: 'text', text: 'Postamble', isFinal: true});
  });

  it('inner markdown cleaning', () => {
    const content = 'Preamble\n<a2ui>\n```json\ncode_here\n```\n</a2ui>\nPostamble';
    const lexer = new BlockLexer();
    const parts = lexer.tokenize(content);

    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({type: 'text', text: 'Preamble', isFinal: true});
    expect(parts[1]).toEqual({type: 'a2ui', a2uiRaw: 'code_here', isFinal: true});
    expect(parts[2]).toEqual({type: 'text', text: 'Postamble', isFinal: true});
  });
});

it('accepts caller-supplied RegExp patterns and ensures sticky flag', () => {
  const content = 'Preamble\n<foo bar="1">\ncode\n</foo>\nPostamble';
  const lexer = new BlockLexer(/<foo\b[^>]*>/, /<\/foo\s*>/i);
  const parts = lexer.tokenize(content);

  expect(parts).toHaveLength(3);
  expect(parts[0]).toEqual({type: 'text', text: 'Preamble', isFinal: true});
  expect(parts[1]).toEqual({type: 'a2ui', a2uiRaw: 'code', isFinal: true});
  expect(parts[2]).toEqual({type: 'text', text: 'Postamble', isFinal: true});
});
