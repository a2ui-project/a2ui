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
              id: 'slider_test',
              component: 'Slider',
              label: 'Volume',
              value: 50,
              max: 100,
            },
            {
              id: 'slider_a11y',
              component: 'Slider',
              label: 'Brightness',
              value: 0,
              max: 100,
              isValid: false,
              validationErrors: ['Brightness is required'],
              accessibility: {
                label: 'A11y Brightness',
                description: 'Set screen brightness',
              },
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  it('should render slider with label linked by id', async () => {
    const el = document.createElement('a2ui-slider') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'slider_test');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const label = el.shadowRoot.querySelector('label');
    assert.ok(label);
    assert.strictEqual(label.textContent.trim(), 'Volume');
    assert.strictEqual(label.getAttribute('for'), 'slider_test');

    const input = el.shadowRoot.querySelector('input');
    assert.ok(input);
    assert.strictEqual(input.getAttribute('id'), 'slider_test');
    assert.strictEqual(input.value, '50');

    document.body.removeChild(el);
  });

  it('should bind accessibility label, invalid state, description, and error to aria attributes', async () => {
    const el = document.createElement('a2ui-slider') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'slider_a11y');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const input = el.shadowRoot.querySelector('input');
    assert.ok(input);
    assert.strictEqual(input.getAttribute('aria-label'), 'A11y Brightness');
    assert.strictEqual(input.getAttribute('aria-invalid'), 'true');

    const describedBy = input.getAttribute('aria-describedby');
    assert.ok(describedBy);
    assert.strictEqual(describedBy, 'slider_a11y-description slider_a11y-error');

    const desc = el.shadowRoot.querySelector('#slider_a11y-description');
    assert.ok(desc);
    assert.strictEqual(desc.textContent.trim(), 'Set screen brightness');

    const error = el.shadowRoot.querySelector('#slider_a11y-error');
    assert.ok(error);
    assert.strictEqual(error.textContent.trim(), 'Brightness is required');

    document.body.removeChild(el);
  });
});
