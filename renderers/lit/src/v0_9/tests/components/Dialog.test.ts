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

import {setupTestDom, teardownTestDom, asyncUpdate} from '../dom-setup.js';
import assert from 'node:assert';
import {describe, it, beforeEach, afterEach, after, before} from 'node:test';
import {
  ComponentContext,
  MessageProcessor,
  Catalog,
  ComponentApi,
  SurfaceModel,
} from '@a2ui/web_core/v0_9';
import type {A2uiDialogElement} from '../../catalogs/basic/components/Dialog.js';

describe('Dialog Component', () => {
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/Dialog.js');
    await import('../../catalogs/basic/components/Text.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiDialogElement | null = null;

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
              id: 'dialog_closed',
              component: 'Dialog',
              title: 'Closed Dialog',
              child: 'txt1',
              // open defaults to false
            },
            {
              id: 'dialog_open',
              component: 'Dialog',
              title: 'Open Dialog',
              child: 'txt1',
              open: true,
            },
            {
              id: 'txt1',
              component: 'Text',
              text: 'Dialog content',
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  afterEach(() => {
    if (element) {
      element.remove();
      element = null;
    }
  });

  it('should remain closed when open prop is false or undefined', async () => {
    const el = document.createElement('a2ui-dialog') as A2uiDialogElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'dialog_closed');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const dialog = el.shadowRoot?.querySelector('dialog');
    assert.ok(dialog);
    assert.strictEqual(dialog.open, false);
  });

  it('should open using showModal when open prop is true', async () => {
    const el = document.createElement('a2ui-dialog') as A2uiDialogElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'dialog_open');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const dialog = el.shadowRoot?.querySelector('dialog');
    assert.ok(dialog);
    // In JSDOM setup, dialog.showModal() might set dialog.open to true.
    assert.strictEqual(dialog.open, true);

    const title = el.shadowRoot?.querySelector('.dialog-title');
    assert.ok(title);
    assert.strictEqual(title.textContent?.trim(), 'Open Dialog');
  });

  it('should dispatch a2uiclose event when close button is clicked', async () => {
    const el = document.createElement('a2ui-dialog') as A2uiDialogElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'dialog_open');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const closeBtn = el.shadowRoot?.querySelector('.close-btn') as HTMLButtonElement;
    assert.ok(closeBtn);

    let closeDispatched = false;
    el.addEventListener('a2uiclose', () => {
      closeDispatched = true;
    });

    closeBtn.click();
    assert.strictEqual(closeDispatched, true);
  });

  it('should dispatch a2uiclose event when native dialog close event occurs', async () => {
    const el = document.createElement('a2ui-dialog') as A2uiDialogElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'dialog_open');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const dialog = el.shadowRoot?.querySelector('dialog');
    assert.ok(dialog);

    let closeDispatched = false;
    el.addEventListener('a2uiclose', () => {
      closeDispatched = true;
    });

    // Dispatch native close event on the dialog element
    dialog.dispatchEvent(new Event('close'));
    assert.strictEqual(closeDispatched, true);
  });
});
