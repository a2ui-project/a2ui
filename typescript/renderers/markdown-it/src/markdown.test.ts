/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
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
import {createMarkdownRenderer, renderMarkdown} from './markdown.js';

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

describe('renderMarkdown follows the Markdown subset', () => {
  it('renders links as their text', async () => {
    const html = await renderMarkdown('Visit [Docs](https://example.com) and <https://a.example>.');
    assert.doesNotMatch(html, /<a\b/);
    assert.match(html, /Visit Docs and https:\/\/a\.example\./);
  });

  it('renders images as their alt text', async () => {
    const html = await renderMarkdown('Look at ![a *nice* photo](https://example.com/p.png)');
    assert.doesNotMatch(html, /<img\b/);
    assert.match(html, /Look at a nice photo/);
  });

  it('escapes HTML in image alt text', async () => {
    const html = await renderMarkdown('![<b>bold</b>](https://example.com/p.png)');
    assert.doesNotMatch(html, /<b>/);
    assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/);
  });

  it('ignores a sanitizer, since links and images stay off', async () => {
    const calls: string[] = [];
    const html = await renderMarkdown('[a](https://example.com) ![b](https://example.com/b.png)', {
      sanitizeUrl: url => {
        calls.push(url);
        return url;
      },
    });
    assert.doesNotMatch(html, /<a\b|<img\b/);
    assert.deepStrictEqual(calls, []);
  });
});

describe('createMarkdownRenderer', () => {
  it('renders links as text when only images are enabled', async () => {
    const render = createMarkdownRenderer({allowImages: true});
    const html = await render('[a](https://example.com) ![b](https://example.com/b.png)');
    assert.doesNotMatch(html, /<a\b/);
    assert.match(html, /<img src="https:\/\/example\.com\/b\.png" alt="b">/);
  });

  it('checks links as navigation and images as media URLs', async () => {
    const calls: Array<[string, string]> = [];
    const render = createMarkdownRenderer({allowLinks: true, allowImages: true});
    const html = await render('[a](https://example.com/x) ![b](https://cdn.example.com/b.png)', {
      sanitizeUrl: (url, context) => {
        calls.push([url, context]);
        return url;
      },
    });
    assert.deepStrictEqual(calls, [
      ['https://example.com/x', 'navigation'],
      ['https://cdn.example.com/b.png', 'media'],
    ]);
    assert.match(html, /<a href="https:\/\/example\.com\/x">a<\/a>/);
    assert.match(html, /<img src="https:\/\/cdn\.example\.com\/b\.png" alt="b">/);
  });

  it('renders a blocked link as its text and a blocked image as its alt text', async () => {
    const render = createMarkdownRenderer({allowLinks: true, allowImages: true});
    const html = await render(
      'See [the *docs*](https://evil.example/?d=1) then [ok](https://ok.example) ![pic](https://evil.example/p.png)',
      {sanitizeUrl: url => (url.startsWith('https://evil.example') ? undefined : url)},
    );
    assert.doesNotMatch(html, /evil\.example/);
    assert.doesNotMatch(html, /<img\b/);
    assert.match(html, /See the <em>docs<\/em> then <a href="https:\/\/ok\.example">ok<\/a> pic/);
  });

  it('uses the URL the sanitizer returns', async () => {
    const render = createMarkdownRenderer({allowLinks: true, allowImages: true});
    const html = await render('[a](https://other.example/a) ![b](https://other.example/b.png)', {
      sanitizeUrl: url => `https://proxy.example/?u=${encodeURIComponent(url)}`,
    });
    assert.match(html, /href="https:\/\/proxy\.example\/\?u=https%3A%2F%2Fother\.example%2Fa"/);
    assert.match(html, /src="https:\/\/proxy\.example\/\?u=https%3A%2F%2Fother\.example%2Fb\.png"/);
  });

  it('blocks URLs when the sanitizer throws', async () => {
    const render = createMarkdownRenderer({allowLinks: true});
    const html = await render('[a](https://example.com)', {
      sanitizeUrl: () => {
        throw new Error('boom');
      },
    });
    assert.doesNotMatch(html, /<a\b/);
    assert.match(html, /<p>a<\/p>/);
  });

  it('applies the baseline checks without a sanitizer', async () => {
    const render = createMarkdownRenderer({allowLinks: true, allowImages: true});
    const html = await render(
      '[rel](/page) [mail](mailto:a@example.com) ![png](data:image/png;base64,iVBORw0KGgo=)',
    );
    assert.match(html, /<a href="\/page">rel<\/a>/);
    assert.match(html, /<a href="mailto:a@example\.com">mail<\/a>/);
    assert.match(html, /<img src="data:image\/png;base64,iVBORw0KGgo=" alt="png">/);
  });

  it('blocks what the baseline rejects without a sanitizer', async () => {
    const render = createMarkdownRenderer({allowLinks: true, allowImages: true});
    // markdown-it itself rejects `javascript:` and SVG data URLs, so these
    // reach the rules only through other schemes and hostless http URLs.
    const html = await render('[a](https:evil.example) ![b](ftp://example.com/b.png)');
    assert.doesNotMatch(html, /<a\b|<img\b/);
    assert.match(html, /<p>a b<\/p>/);
  });

  it('keeps tag classes on allowed links', async () => {
    const render = createMarkdownRenderer({allowLinks: true});
    const html = await render('[a](https://example.com)', {tagClassMap: {a: ['link']}});
    assert.match(html, /<a href="https:\/\/example\.com" class="link">a<\/a>/);
  });
});
