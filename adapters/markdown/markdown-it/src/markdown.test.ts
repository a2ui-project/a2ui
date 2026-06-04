/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {JSDOM} from 'jsdom';

// Provide a jsdom window for DOMPurify in the Node test environment.
const jsdom = new JSDOM('');
(globalThis as any).window = jsdom.window;
(globalThis as any).document = jsdom.window.document;

import {describe, it} from 'node:test';
import assert from 'node:assert';
import {MarkdownItRenderer} from './raw-markdown.js';
import {renderMarkdown} from './markdown.js';

describe('MarkdownItRenderer', () => {
  it('renders basic markdown', () => {
    const renderer = new MarkdownItRenderer();
    const result = renderer.render('# Hello');
    assert.match(result, /<h1>Hello<\/h1>/);
  });

  it('applies tag classes via tagClassMap', () => {
    const renderer = new MarkdownItRenderer();
    const result = renderer.render('# Hello', {h1: ['custom-class']});
    assert.match(result, /<h1 class="custom-class">Hello<\/h1>/);
  });

  it('applies multiple classes', () => {
    const renderer = new MarkdownItRenderer();
    const result = renderer.render('para', {p: ['class1', 'class2']});
    assert.match(result, /<p class="class1 class2">para<\/p>/);
  });

  it('is stateless (tagClassMap does not persist)', () => {
    const renderer = new MarkdownItRenderer();

    // First render with class
    const result1 = renderer.render('# Hello', {h1: ['persistent?']});
    assert.match(result1, /class="persistent\?"/);

    // Second render without class
    const result2 = renderer.render('# Hello');
    assert.doesNotMatch(result2, /class="persistent\?"/);
    assert.match(result2, /<h1>Hello<\/h1>/);
  });

  it('handles empty tagClassMap', () => {
    const renderer = new MarkdownItRenderer();
    const result = renderer.render('# Hello', {});
    assert.match(result, /<h1>Hello<\/h1>/);
  });
});

describe('renderMarkdown', () => {
  it('renders markdown successfully', async () => {
    const html = await renderMarkdown('# Hello World');
    assert.match(html, /<h1>Hello World<\/h1>/);
  });

  it('sanitizes malicious markdown links', async () => {
    // Markdown-it strips javascript links by default, emitting the raw markdown string.
    // DOMPurify acts as a secondary layer of defense.
    const input = 'This is a test [link](javascript:alert("XSS"))';
    const html = await renderMarkdown(input);

    // Ensure the javascript protocol link is neutralized completely
    assert.doesNotMatch(html, /href="javascript:alert/);
    assert.match(html, /\[link\]\(javascript:alert\("XSS"\)\)/); // It remains raw text
  });

  it('safely escapes HTML input without enabling raw HTML', async () => {
    const input = 'This is a test <script>alert("XSS")</script>';
    const html = await renderMarkdown(input);

    // Markdown-it will escape it to &lt;script&gt;
    assert.match(html, /&lt;script&gt;alert\("XSS"\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>/);
  });

  it('preserves safe HTML output', async () => {
    const input = 'This is **bold** and *italic*.';
    const html = await renderMarkdown(input);

    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<em>italic<\/em>/);
  });

  it('preserves classnames applied via tagClassMap', async () => {
    const input = '# Heading\n\nParagraph text';
    const html = await renderMarkdown(input, {
      tagClassMap: {
        h1: ['text-h1', 'bold'],
        p: ['body-text'],
      },
    });

    assert.match(html, /<h1 class="text-h1 bold">Heading<\/h1>/);
    assert.match(html, /<p class="body-text">Paragraph text<\/p>/);
  });
});
