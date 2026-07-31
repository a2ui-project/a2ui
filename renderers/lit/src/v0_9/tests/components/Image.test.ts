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
import type {A2uiImageElement} from '../../catalogs/basic/components/Image.js';

describe('Image Component', () => {
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/Image.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiImageElement | null = null;

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
              id: 'img_normal',
              component: 'Image',
              url: 'https://example.com/image.png',
              description: 'A beautiful sunset',
            },
            {
              id: 'img_a11y_label',
              component: 'Image',
              url: 'https://example.com/image.png',
              description: 'Fallback description',
              accessibility: {
                label: 'Sunset at the beach',
              },
            },
            {
              id: 'img_a11y_desc',
              component: 'Image',
              url: 'https://example.com/image.png',
              description: 'Fallback description',
              accessibility: {
                description: 'Sunset at the beach with waves crashing',
              },
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

  it('should render image with src and alt description', async () => {
    const el = document.createElement('a2ui-image') as A2uiImageElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'img_normal');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const img = el.shadowRoot?.querySelector('img');
    assert.ok(img);
    assert.strictEqual(img.getAttribute('src'), 'https://example.com/image.png');
    assert.strictEqual(img.getAttribute('alt'), 'A beautiful sunset');
  });

  it('should prioritize accessibility label for alt attribute', async () => {
    const el = document.createElement('a2ui-image') as A2uiImageElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'img_a11y_label');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const img = el.shadowRoot?.querySelector('img');
    assert.ok(img);
    assert.strictEqual(img.getAttribute('alt'), 'Sunset at the beach');
  });

  it('should fall back to accessibility description for alt attribute', async () => {
    const el = document.createElement('a2ui-image') as A2uiImageElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'img_a11y_desc');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const img = el.shadowRoot?.querySelector('img');
    assert.ok(img);
    assert.strictEqual(img.getAttribute('alt'), 'Sunset at the beach with waves crashing');
  });
});
