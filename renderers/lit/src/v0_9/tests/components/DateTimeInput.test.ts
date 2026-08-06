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

describe('DateTimeInput Component', () => {
  let basicCatalog: any;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/DateTimeInput.js');
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
              id: 'datetime_test',
              component: 'DateTimeInput',
              label: 'Meeting Time',
              enableDate: true,
              enableTime: true,
              value: '2026-08-05T12:00:00Z',
            },
            {
              id: 'datetime_a11y',
              component: 'DateTimeInput',
              label: 'Event Date',
              enableDate: true,
              value: '',
              isValid: false,
              validationErrors: ['Date is required'],
              accessibility: {
                label: 'A11y Date',
                description: 'Enter event date',
              },
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  it('should render datetime input with label linked by id', async () => {
    const el = document.createElement('a2ui-datetimeinput') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'datetime_test');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const label = el.shadowRoot.querySelector('label');
    assert.ok(label);
    assert.strictEqual(label.textContent.trim(), 'Meeting Time');
    assert.strictEqual(label.getAttribute('for'), 'datetime_test');

    const input = el.shadowRoot.querySelector('input');
    assert.ok(input);
    assert.strictEqual(input.getAttribute('id'), 'datetime_test');
    assert.strictEqual(input.value, '2026-08-05T12:00');

    document.body.removeChild(el);
  });

  it('should bind accessibility label, invalid state, description, and error to aria attributes', async () => {
    const el = document.createElement('a2ui-datetimeinput') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'datetime_a11y');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const input = el.shadowRoot.querySelector('input');
    assert.ok(input);
    assert.strictEqual(input.getAttribute('aria-label'), 'A11y Date');
    assert.strictEqual(input.getAttribute('aria-invalid'), 'true');

    const describedBy = input.getAttribute('aria-describedby');
    assert.ok(describedBy);
    assert.strictEqual(describedBy, 'datetime_a11y-description datetime_a11y-error');

    const desc = el.shadowRoot.querySelector('#datetime_a11y-description');
    assert.ok(desc);
    assert.strictEqual(desc.textContent.trim(), 'Enter event date');

    const error = el.shadowRoot.querySelector('#datetime_a11y-error');
    assert.ok(error);
    assert.strictEqual(error.textContent.trim(), 'Date is required');

    document.body.removeChild(el);
  });
});
