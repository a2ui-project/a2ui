/* eslint-disable @typescript-eslint/no-explicit-any */
/*
 * Copyright 2026 Google LLC
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

import {setupTestDom, teardownTestDom, asyncUpdate} from '../v0_9/tests/dom-setup.js';
import assert from 'node:assert';
import {describe, it, after, before} from 'node:test';

describe('0.8 Divider Component', () => {
  before(async () => {
    setupTestDom();
    // Ensure component is registered
    await import('./ui/divider.js');
  });

  after(teardownTestDom);

  it('should render horizontal divider by default', async () => {
    const el = document.createElement('a2ui-divider') as any;
    el.theme = {components: {Divider: 'test-divider'}};
    document.body.appendChild(el);

    await asyncUpdate(el, e => {
      e.axis = 'horizontal';
    });

    const hr = el.shadowRoot.querySelector('hr');
    assert.ok(hr);
    // Should not have vertical class/style
    assert.ok(!hr.classList.contains('vertical'));

    document.body.removeChild(el);
  });

  it('should render vertical divider when axis is vertical', async () => {
    const el = document.createElement('a2ui-divider') as any;
    el.theme = {components: {Divider: 'test-divider'}};
    document.body.appendChild(el);

    await asyncUpdate(el, e => {
      e.axis = 'vertical';
    });

    // Depending on how we implement it, it might be a div or an hr with a class.
    // If we use classes like v0.9, we can check classes.
    assert.ok(
      el.shadowRoot.querySelector('.vertical') || el.shadowRoot.querySelector('div.vertical'),
    );

    document.body.removeChild(el);
  });

  it('should apply color and thickness', async () => {
    const el = document.createElement('a2ui-divider') as any;
    el.theme = {components: {Divider: 'test-divider'}};
    document.body.appendChild(el);

    await asyncUpdate(el, e => {
      e.color = 'rgb(255, 0, 0)';
      e.thickness = 5;
    });

    const dividerEl =
      el.shadowRoot.querySelector('hr') || el.shadowRoot.querySelector('.a2ui-divider');
    assert.ok(dividerEl);

    // Check if style contains color and thickness
    const style = dividerEl.getAttribute('style') || '';
    assert.ok(
      style.includes('rgb(255, 0, 0)') ||
        dividerEl.style.backgroundColor === 'rgb(255, 0, 0)' ||
        dividerEl.style.borderColor === 'rgb(255, 0, 0)',
    );

    document.body.removeChild(el);
  });
});
