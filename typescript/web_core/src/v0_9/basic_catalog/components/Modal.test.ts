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
import type {A2uiLitModal} from './Modal.js';

describe('Modal Component', () => {
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../index.js')).basicCatalog;
    await import('./Modal.js');
    await import('./Text.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiLitModal | null = null;
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
              component: 'Modal',
              trigger: 'txt1',
              content: 'txt2',
            },
            {id: 'txt1', component: 'Text', text: 'Open Modal'},
            {id: 'txt2', component: 'Text', text: 'Modal Dialog Content'},
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

  it('should render trigger initially and open modal on click to render content', async () => {
    const el = document.createElement('a2ui-modal') as A2uiLitModal;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'comp1');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    assert.notStrictEqual(el, null);
    const trigger = el.querySelector('.a2ui-modal-trigger') as HTMLElement;
    assert.notStrictEqual(trigger, null);
    assert.strictEqual(trigger?.textContent?.includes('Open Modal'), true);

    // Initially closed
    assert.strictEqual(el.querySelector('.a2ui-modal-overlay'), null);

    // Click trigger to open
    trigger.click();
    await asyncUpdate(el, () => {});

    const overlay = el.querySelector('.a2ui-modal-overlay');
    assert.notStrictEqual(overlay, null);
    const modalContent = el.querySelector('.a2ui-modal-content');
    assert.notStrictEqual(modalContent, null);
    assert.strictEqual(modalContent?.textContent?.includes('Modal Dialog Content'), true);
  });

  it('should close when clicking the close button', async () => {
    const el = document.createElement('a2ui-modal') as A2uiLitModal;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'comp1');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const trigger = el.querySelector('.a2ui-modal-trigger') as HTMLElement;
    trigger.click();
    await asyncUpdate(el, () => {});
    assert.notStrictEqual(el.querySelector('.a2ui-modal-overlay'), null);

    const closeBtn = el.querySelector('button.a2ui-modal-close') as HTMLButtonElement;
    assert.notStrictEqual(closeBtn, null);
    closeBtn.click();
    await asyncUpdate(el, () => {});

    assert.strictEqual(el.querySelector('.a2ui-modal-overlay'), null);
  });

  it('should close when clicking the outside backdrop', async () => {
    const el = document.createElement('a2ui-modal') as A2uiLitModal;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'comp1');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const trigger = el.querySelector('.a2ui-modal-trigger') as HTMLElement;
    trigger.click();
    await asyncUpdate(el, () => {});
    assert.notStrictEqual(el.querySelector('.a2ui-modal-overlay'), null);

    const overlay = el.querySelector('.a2ui-modal-overlay') as HTMLElement;
    overlay.click();
    await asyncUpdate(el, () => {});

    assert.strictEqual(el.querySelector('.a2ui-modal-overlay'), null);
  });

  it('should not close when clicking inside', async () => {
    const el = document.createElement('a2ui-modal') as A2uiLitModal;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'comp1');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const trigger = el.querySelector('.a2ui-modal-trigger') as HTMLElement;
    trigger.click();
    await asyncUpdate(el, () => {});
    assert.notStrictEqual(el.querySelector('.a2ui-modal-overlay'), null);

    const content = el.querySelector('.a2ui-modal-content') as HTMLElement;
    content.click();
    await asyncUpdate(el, () => {});

    // Modal overlay should remain open because inner content click event stops propagation
    assert.notStrictEqual(el.querySelector('.a2ui-modal-overlay'), null);
  });
});
