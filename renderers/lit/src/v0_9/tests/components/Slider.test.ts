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

describe('Slider Component', () => {
  let basicCatalog: any;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/Slider.js');
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
              id: 'slider_normal',
              component: 'Slider',
              value: 50,
            },
            {
              id: 'slider_a11y',
              component: 'Slider',
              value: 50,
              accessibility: {
                label: 'Volume Control',
                description: 'Adjust the playback volume',
              },
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  it('should render slider', async () => {
    const el = document.createElement('a2ui-slider') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'slider_normal');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const input = el.shadowRoot.querySelector('input[type="range"]');
    assert.ok(input);
    assert.strictEqual(input.value, '50');

    document.body.removeChild(el);
  });

  it('should render accessibility attributes on input in Slider', async () => {
    const el = document.createElement('a2ui-slider') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'slider_a11y');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const input = el.shadowRoot.querySelector('input[type="range"]');
    assert.ok(input);
    assert.strictEqual(input.getAttribute('aria-label'), 'Volume Control');
    assert.strictEqual(input.getAttribute('aria-description'), 'Adjust the playback volume');

    document.body.removeChild(el);
  });
});
