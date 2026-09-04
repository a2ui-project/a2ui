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

import * as assert from 'node:assert';
import {describe, it, before, after, beforeEach, afterEach} from 'node:test';
import {setupTestDom, teardownTestDom} from '../../test/dom-setup.js';
import type {MarkdownRenderer} from '../context/markdown.js';

describe('MarkdownDirective', () => {
  let html: typeof import('lit').html;
  let render: typeof import('lit').render;
  let markdown: typeof import('./markdown.js').markdown;

  before(async () => {
    setupTestDom();
    const lit = await import('lit');
    html = lit.html;
    render = lit.render;
    markdown = (await import('./markdown.js')).markdown;
  });

  after(teardownTestDom);

  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders synchronous fallback span initially and updates asynchronously', async () => {
    const customRenderer: MarkdownRenderer = async (text: string) => {
      return `<strong>${text}</strong>`;
    };

    render(html`<div>${markdown('Hello World', customRenderer)}</div>`, container);

    // Initial render before promise resolution
    const initialSpan = container.querySelector('span.no-markdown-renderer');
    assert.notStrictEqual(initialSpan, null);
    assert.strictEqual(initialSpan?.textContent, 'Hello World');

    // Wait for microtask/async resolution
    await new Promise(r => setTimeout(r, 20));

    const strong = container.querySelector('strong');
    assert.notStrictEqual(strong, null);
    assert.strictEqual(strong?.textContent, 'Hello World');
  });

  it('supports renderer objects with render method', async () => {
    const customRendererObj = {
      render: async (text: string) => `<em>${text}</em>`,
    };

    render(html`<div>${markdown('Obj Test', customRendererObj as any)}</div>`, container);

    await new Promise(r => setTimeout(r, 20));

    const em = container.querySelector('em');
    assert.notStrictEqual(em, null);
    assert.strictEqual(em?.textContent, 'Obj Test');
  });

  it('uses global markdown renderer when no explicit renderer is provided', async () => {
    const {setMarkdownRenderer, getMarkdownRenderer} = await import('./markdown.js');

    const defaultRenderer: MarkdownRenderer = async text => `<h3>${text} (Default)</h3>`;
    setMarkdownRenderer(defaultRenderer);
    assert.strictEqual(getMarkdownRenderer(), defaultRenderer);

    render(html`<div>${markdown('Default Text')}</div>`, container);

    await new Promise(r => setTimeout(r, 20));

    const h3 = container.querySelector('h3');
    assert.notStrictEqual(h3, null);
    assert.strictEqual(h3?.textContent, 'Default Text (Default)');

    // Reset default renderer
    setMarkdownRenderer(undefined);
    assert.strictEqual(getMarkdownRenderer(), undefined);
  });

  it('renders fallback span and emits console warning when no renderer is configured', async () => {
    const {resetMarkdownWarningLoggedForTesting} = await import('./markdown.js');
    resetMarkdownWarningLoggedForTesting();

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(a => String(a)).join(' '));
    };

    try {
      render(html`<div>${markdown('No Renderer Text')}</div>`, container);

      const span = container.querySelector('span.no-markdown-renderer');
      assert.notStrictEqual(span, null);
      assert.strictEqual(span?.textContent, 'No Renderer Text');
      assert.ok(warnings.some(w => w.includes('[MarkdownDirective]')));
    } finally {
      console.warn = originalWarn;
    }
  });
});
