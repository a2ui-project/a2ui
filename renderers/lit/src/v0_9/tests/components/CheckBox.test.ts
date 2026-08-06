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

describe('CheckBox Component', () => {
  let basicCatalog: any;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    // Ensure component is registered
    await import('../../catalogs/basic/components/CheckBox.js');
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
              id: 'checkbox_invalid',
              component: 'CheckBox',
              label: 'Check me',
              value: false,
              isValid: false,
              validationErrors: ['This is required'],
            },
            {
              id: 'checkbox_a11y',
              component: 'CheckBox',
              label: 'Subscribe',
              value: false,
              isValid: false,
              validationErrors: ['Subscription is required'],
              accessibility: {
                label: 'A11y Subscribe',
                description: 'Subscribe to newsletter',
              },
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  it('should render validation error in CheckBox', async () => {
    const el = document.createElement('a2ui-checkbox') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'checkbox_invalid');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const errorDiv = el.shadowRoot.querySelector('.error');
    assert.ok(errorDiv);
    assert.strictEqual(errorDiv.textContent.trim(), 'This is required');

    document.body.removeChild(el);
  });

  it('should render checkbox with label linked by id', async () => {
    const el = document.createElement('a2ui-checkbox') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'checkbox_invalid');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const label = el.shadowRoot.querySelector('label');
    assert.ok(label);
    assert.strictEqual(label.getAttribute('for'), 'checkbox_invalid');

    const input = el.shadowRoot.querySelector('input');
    assert.ok(input);
    assert.strictEqual(input.getAttribute('id'), 'checkbox_invalid');

    document.body.removeChild(el);
  });

  it('should bind accessibility label, invalid state, description, and error to aria attributes', async () => {
    const el = document.createElement('a2ui-checkbox') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'checkbox_a11y');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const input = el.shadowRoot.querySelector('input');
    assert.ok(input);
    assert.strictEqual(input.getAttribute('aria-label'), 'A11y Subscribe');
    assert.strictEqual(input.getAttribute('aria-invalid'), 'true');

    const describedBy = input.getAttribute('aria-describedby');
    assert.ok(describedBy);
    assert.strictEqual(describedBy, 'checkbox_a11y-description checkbox_a11y-error');

    const desc = el.shadowRoot.querySelector('#checkbox_a11y-description');
    assert.ok(desc);
    assert.strictEqual(desc.textContent.trim(), 'Subscribe to newsletter');

    const error = el.shadowRoot.querySelector('#checkbox_a11y-error');
    assert.ok(error);
    assert.strictEqual(error.textContent.trim(), 'Subscription is required');

    document.body.removeChild(el);
  });
});
