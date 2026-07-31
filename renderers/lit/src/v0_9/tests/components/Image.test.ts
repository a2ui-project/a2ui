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
              id: 'img_a11y',
              component: 'Image',
              url: 'https://example.com/image.png',
              accessibility: {
                label: 'Accessible Image Alt Text',
                description: 'Detailed description of the image content',
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

  it('should set alt and aria-description, and omit redundant aria-label on img element', async () => {
    const el = document.createElement('a2ui-image') as unknown as A2uiImageElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'img_a11y');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const img = el.shadowRoot?.querySelector('img');
    assert.ok(img);
    assert.strictEqual(img.getAttribute('alt'), 'Accessible Image Alt Text');
    assert.strictEqual(
      img.getAttribute('aria-description'),
      'Detailed description of the image content',
    );
    assert.strictEqual(img.hasAttribute('aria-label'), false);
  });
});
