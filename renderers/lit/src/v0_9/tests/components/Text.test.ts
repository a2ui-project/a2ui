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
import type {A2uiBasicTextElement} from '../../catalogs/basic/components/Text.js';

describe('Text Component', () => {
  // Note: basicCatalog and the component files must be imported dynamically inside before()
  // because setupTestDom() initializes global browser variables (window, document, customElements)
  // that need to exist when the modules are evaluated and components register themselves.
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/Text.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiBasicTextElement | null = null;

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
              id: 't_static',
              component: 'Text',
              text: 'Hello static text',
            },
            {
              id: 't_dynamic',
              component: 'Text',
              text: {path: '/dynamic_msg'},
            },
            {
              id: 't_caption',
              component: 'Text',
              text: 'Caption text',
              variant: 'caption',
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
    surface.dataModel.set('/dynamic_msg', 'Hello dynamic text');
  });

  afterEach(() => {
    if (element) {
      element.remove();
      element = null;
    }
  });

  it('should render static text content', async () => {
    const el = document.createElement('a2ui-basic-text') as A2uiBasicTextElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 't_static');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const span = el.shadowRoot?.querySelector('.no-markdown-renderer');
    assert.ok(span);
    assert.strictEqual(span.textContent?.trim(), 'Hello static text');
  });

  it('should render reactive dynamic text content', async () => {
    const el = document.createElement('a2ui-basic-text') as A2uiBasicTextElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 't_dynamic');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const span = el.shadowRoot?.querySelector('.no-markdown-renderer');
    assert.ok(span);
    assert.strictEqual(span.textContent?.trim(), 'Hello dynamic text');

    // Update the data model value
    surface.dataModel.set('/dynamic_msg', 'Updated dynamic text');
    await asyncUpdate(el, () => {});

    assert.strictEqual(span.textContent?.trim(), 'Updated dynamic text');
  });

  it('should apply caption variant styling structure', async () => {
    const el = document.createElement('a2ui-basic-text') as A2uiBasicTextElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 't_caption');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const captionSpan = el.shadowRoot?.querySelector('span.a2ui-caption');
    assert.ok(captionSpan);
    const innerSpan = captionSpan.querySelector('.no-markdown-renderer');
    assert.ok(innerSpan);
    assert.strictEqual(innerSpan.textContent?.trim(), 'Caption text');
  });
});
