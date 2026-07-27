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
import type {A2uiToastElement} from '../../catalogs/basic/components/Toast.js';

describe('Toast Component', () => {
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/Toast.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiToastElement | null = null;

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
              id: 'toast_info',
              component: 'Toast',
              message: 'Info message',
              // variant defaults to info
            },
            {
              id: 'toast_error',
              component: 'Toast',
              message: 'Error message',
              variant: 'error',
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

  it('should render message and default to info variant style', async () => {
    const el = document.createElement('a2ui-toast') as A2uiToastElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'toast_info');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const msg = el.shadowRoot?.querySelector('.toast-message');
    assert.ok(msg);
    assert.strictEqual(msg.textContent?.trim(), 'Info message');

    const toastDiv = el.shadowRoot?.querySelector('.toast');
    assert.ok(toastDiv);
    assert.ok(toastDiv.classList.contains('toast-info'));
  });

  it('should render correct variant style when specified', async () => {
    const el = document.createElement('a2ui-toast') as A2uiToastElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'toast_error');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const msg = el.shadowRoot?.querySelector('.toast-message');
    assert.ok(msg);
    assert.strictEqual(msg.textContent?.trim(), 'Error message');

    const toastDiv = el.shadowRoot?.querySelector('.toast');
    assert.ok(toastDiv);
    assert.ok(toastDiv.classList.contains('toast-error'));
  });
});
