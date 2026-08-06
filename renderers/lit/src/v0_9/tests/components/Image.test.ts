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
import {describe, it, beforeEach, after, before} from 'node:test';
import {ComponentContext, MessageProcessor} from '@a2ui/web_core/v0_9';

describe('Image Component', () => {
  let basicCatalog: any;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/Image.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<any>;
  let surface: any;

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
              id: 'img_desc',
              component: 'Image',
              url: 'https://example.com/photo.jpg',
              description: 'A mountain landscape',
            },
            {
              id: 'img_a11y',
              component: 'Image',
              url: 'https://example.com/photo.jpg',
              description: 'A mountain landscape',
              accessibility: {
                label: 'Accessible Mountain Landscape',
              },
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  it('should use description for alt text if accessibility label is not set', async () => {
    const el = document.createElement('a2ui-image') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'img_desc');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const img = el.shadowRoot.querySelector('img');
    assert.ok(img);
    assert.strictEqual(img.getAttribute('alt'), 'A mountain landscape');

    document.body.removeChild(el);
  });

  it('should prioritize accessibility label over description for alt text', async () => {
    const el = document.createElement('a2ui-image') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'img_a11y');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const img = el.shadowRoot.querySelector('img');
    assert.ok(img);
    assert.strictEqual(img.getAttribute('alt'), 'Accessible Mountain Landscape');

    document.body.removeChild(el);
  });
});
