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
import {setupTestDom, teardownTestDom, asyncUpdate} from '../../test/dom-setup.js';
import {
  ComponentContext,
  MessageProcessor,
  Catalog,
  ComponentApi,
  SurfaceModel,
  Subscription,
} from '../../index.js';
import type {A2uiLitTabs} from './Tabs.js';

describe('Tabs Component', () => {
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../index.js')).basicCatalog;
    await import('./Tabs.js');
    await import('./Text.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiLitTabs | null = null;
  let subscription: Subscription | null = null;

  beforeEach(() => {
    processor = new MessageProcessor([basicCatalog]);
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: basicCatalog.id,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'comp1',
              component: 'Tabs',
              tabs: [
                {title: 'Tab 1', child: 'txt1'},
                {title: 'Tab 2', child: 'txt2'},
              ],
            },
            {id: 'txt1', component: 'Text', text: 'Content 1'},
            {id: 'txt2', component: 'Text', text: 'Content 2'},
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  afterEach(() => {
    subscription?.unsubscribe();
    subscription = null;
    if (element) {
      element.remove();
      element = null;
    }
  });

  it('should render tab headers with first tab active and display first tab content', async () => {
    const el = document.createElement('a2ui-tabs') as A2uiLitTabs;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'comp1');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    assert.notStrictEqual(el, null);
    const buttons = el.querySelectorAll('button.a2ui-tab-button');
    assert.strictEqual(buttons.length, 2);
    assert.strictEqual(buttons[0].textContent?.trim(), 'Tab 1');
    assert.strictEqual(buttons[1].textContent?.trim(), 'Tab 2');
    assert.strictEqual(buttons[0].classList.contains('active'), true);
    assert.strictEqual(buttons[1].classList.contains('active'), false);

    const content = el.querySelector('.a2ui-tab-content');
    assert.notStrictEqual(content, null);
    assert.strictEqual(content?.textContent?.includes('Content 1'), true);
    assert.strictEqual(content?.textContent?.includes('Content 2'), false);
  });

  it('should switch active tab and render corresponding content when tab header is clicked', async () => {
    const el = document.createElement('a2ui-tabs') as A2uiLitTabs;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'comp1');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const buttons = el.querySelectorAll('button.a2ui-tab-button') as NodeListOf<HTMLButtonElement>;
    assert.strictEqual(buttons.length, 2);

    // Click Tab 2
    buttons[1].click();
    await asyncUpdate(el, () => {});

    assert.strictEqual(buttons[0].classList.contains('active'), false);
    assert.strictEqual(buttons[1].classList.contains('active'), true);

    const content = el.querySelector('.a2ui-tab-content');
    assert.notStrictEqual(content, null);
    assert.strictEqual(content?.textContent?.includes('Content 2'), true);
    assert.strictEqual(content?.textContent?.includes('Content 1'), false);
  });
});
