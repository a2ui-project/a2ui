/*
 * Copyright 2025 Google LLC
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

import {setupTestDom, teardownTestDom, asyncUpdate} from './dom-setup.js';
import assert from 'node:assert';
import {describe, it, before, after} from 'node:test';
import * as Types from '@a2ui/web_core/types/types';

describe('Markdown Directive', () => {
  before(() => {
    // Set up the DOM before any lit imports in the tests
    setupTestDom();
  });

  after(() => {
    teardownTestDom();
  });

  it('should render fallback when no renderer is provided', async () => {
    const {html, render} = await import('lit');
    const {markdown} = await import('../directives/markdown.js');

    const container = document.createElement('div');

    // Render the directive directly into our container
    render(html`<div>${markdown('Hello world')}</div>`, container);

    const htmlContent = container.innerHTML;
    assert.ok(htmlContent.includes('no-markdown-renderer'), 'Should render fallback span class');
    assert.ok(
      container.textContent?.includes('Hello world'),
      'Should render fallback text properly',
    );
  });

  it('should render parsed markdown when renderer is provided', async () => {
    const {html, render} = await import('lit');
    const {markdown} = await import('../directives/markdown.js');

    const container = document.createElement('div');

    let resolveRenderer: (value: string) => void;
    // Leak the `resolve` function of this promise to the `resolveRenderer`
    // variable, so we can call it later in the test.
    const renderPromise = new Promise<string>(resolve => {
      resolveRenderer = resolve;
    });
    // Mock a markdown renderer that resolves by calling `resolveRenderer`
    const mockRenderer: Types.MarkdownRenderer = async () => renderPromise;

    // Render the directive with our mock renderer
    render(html`<div>${markdown('Hello markdown', mockRenderer)}</div>`, container);

    // Before resolution, should show the placeholder (until directive)
    assert.ok(container.innerHTML.includes('no-markdown-renderer'));

    // Resolve the promise via asyncUpdate so it yields to the macro-task queue
    await asyncUpdate(container, () => {
      resolveRenderer!('<b>Rendered HTML</b>');
    });

    const htmlContent = container.innerHTML;
    assert.ok(
      htmlContent.includes('<b>Rendered HTML</b>'),
      'Should render the HTML from the renderer',
    );
    assert.ok(!htmlContent.includes('no-markdown-renderer'), 'Placeholder should be gone');
  });
});
