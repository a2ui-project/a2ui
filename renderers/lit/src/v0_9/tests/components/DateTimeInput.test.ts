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
              id: 'datetime_normal',
              component: 'DateTimeInput',
              value: '2026-07-31T12:00:00Z',
              type: 'dateTime',
            },
            {
              id: 'datetime_a11y',
              component: 'DateTimeInput',
              value: '2026-07-31T12:00:00Z',
              type: 'dateTime',
              accessibility: {
                label: 'Choose date and time',
                description: 'Please select a future date and time',
              },
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  it('should render datetime input', async () => {
    const el = document.createElement('a2ui-datetimeinput') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'datetime_normal');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const input = el.shadowRoot.querySelector('input');
    assert.ok(input);
    assert.strictEqual(input.getAttribute('type'), 'datetime-local');

    document.body.removeChild(el);
  });

  it('should render accessibility attributes in DateTimeInput', async () => {
    const el = document.createElement('a2ui-datetimeinput') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'datetime_a11y');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const input = el.shadowRoot.querySelector('input');
    assert.ok(input);
    assert.strictEqual(input.getAttribute('aria-label'), 'Choose date and time');
    assert.strictEqual(input.getAttribute('aria-description'), 'Please select a future date and time');

    document.body.removeChild(el);
  });
});
