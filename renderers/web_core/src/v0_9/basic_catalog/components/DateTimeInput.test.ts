/*
 * Copyright 2024 Google LLC
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

import * as assert from 'node:assert';
import {describe, it, before, after, beforeEach, afterEach} from 'node:test';
import {setupTestDom, teardownTestDom, asyncUpdate} from '../../test/dom-setup.js';
import {
  ComponentContext,
  MessageProcessor,
  Catalog,
  ComponentApi,
  SurfaceModel,
  Subscription,
} from '../../index.js';
import type {A2uiDateTimeInputElement} from './DateTimeInput.js';

describe('DateTimeInput Component', () => {
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../index.js')).basicCatalog;
    await import('./DateTimeInput.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiDateTimeInputElement | null = null;
  let subscription: Subscription | null = null;

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
              id: 'comp1',
              component: 'DateTimeInput',
              label: 'Birthday',
              value: '2023-01-01',
              enableDate: true,
              enableTime: false,
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  afterEach(() => {
    subscription?.unsubscribe();
    subscription = null;
    if (element) {
      element.remove();
      element = null;
    }
  });

  it('should render date and label value', async () => {
    const el = document.createElement('a2ui-datetimeinput') as A2uiDateTimeInputElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'comp1');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    assert.notStrictEqual(el, null);
    const label = el.querySelector('.a2ui-date-time-label');
    assert.notStrictEqual(label, null);
    assert.strictEqual(label?.textContent?.trim(), 'Birthday');

    const input = el.querySelector('input[type="date"]') as HTMLInputElement;
    assert.notStrictEqual(input, null);
    assert.strictEqual(input?.value, '2023-01-01');
  });

  it('should update bound data model when date is selected', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'test-surface',
          path: '/selectedDate',
          value: '2023-01-01',
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'dt_bound',
              component: 'DateTimeInput',
              label: 'Event Date',
              value: {path: '/selectedDate'},
              enableDate: true,
              enableTime: false,
            },
          ],
        },
      },
    ]);

    const el = document.createElement('a2ui-datetimeinput') as A2uiDateTimeInputElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'dt_bound');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const input = el.querySelector('input[type="date"]') as HTMLInputElement;
    assert.notStrictEqual(input, null);
    assert.strictEqual(input?.value, '2023-01-01');

    input.value = '2024-05-20';
    input.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.strictEqual(surface.dataModel.get('/selectedDate'), '2024-05-20');
  });

  it('should render and update correctly in time-only mode', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'test-surface',
          path: '/timeVal',
          value: '09:30',
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'dt_time_only',
              component: 'DateTimeInput',
              label: 'Meeting Time',
              value: {path: '/timeVal'},
              enableDate: false,
              enableTime: true,
            },
          ],
        },
      },
    ]);

    const el = document.createElement('a2ui-datetimeinput') as A2uiDateTimeInputElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'dt_time_only');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    // Date input should not be present
    assert.strictEqual(el.querySelector('input[type="date"]'), null);

    const timeInput = el.querySelector('input[type="time"]') as HTMLInputElement;
    assert.notStrictEqual(timeInput, null);
    assert.strictEqual(timeInput.value, '09:30');

    // Changing time in time-only mode must update to '14:00', NOT '09:30T14:00:00'
    timeInput.value = '14:00';
    timeInput.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.strictEqual(surface.dataModel.get('/timeVal'), '14:00');
  });

  it('should preserve date and time components when editing in datetime mode', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'test-surface',
          path: '/appointment',
          value: '2024-06-15T10:00:00',
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'dt_combined',
              component: 'DateTimeInput',
              label: 'Appointment',
              value: {path: '/appointment'},
              enableDate: true,
              enableTime: true,
            },
          ],
        },
      },
    ]);

    const el = document.createElement('a2ui-datetimeinput') as A2uiDateTimeInputElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'dt_combined');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const dateInput = el.querySelector('input[type="date"]') as HTMLInputElement;
    const timeInput = el.querySelector('input[type="time"]') as HTMLInputElement;
    assert.notStrictEqual(dateInput, null);
    assert.notStrictEqual(timeInput, null);
    assert.strictEqual(dateInput.value, '2024-06-15');
    assert.strictEqual(timeInput.value, '10:00');

    // Changing time should update time part while preserving date part
    timeInput.value = '15:30';
    timeInput.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(surface.dataModel.get('/appointment'), '2024-06-15T15:30:00');

    // Changing date should update date part while preserving time part
    dateInput.value = '2025-01-20';
    dateInput.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(surface.dataModel.get('/appointment'), '2025-01-20T15:30:00');
  });

  it('should fallback to local calendar date when choosing time first in datetime mode', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'test-surface',
          path: '/new_event',
          value: '',
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'dt_empty',
              component: 'DateTimeInput',
              label: 'New Event',
              value: {path: '/new_event'},
              enableDate: true,
              enableTime: true,
            },
          ],
        },
      },
    ]);

    const el = document.createElement('a2ui-datetimeinput') as A2uiDateTimeInputElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'dt_empty');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const timeInput = el.querySelector('input[type="time"]') as HTMLInputElement;
    timeInput.value = '11:00';
    timeInput.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));

    const now = new Date();
    const expectedLocalDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    assert.strictEqual(surface.dataModel.get('/new_event'), `${expectedLocalDate}T11:00:00`);
  });
});
