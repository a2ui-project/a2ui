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
import {describe, it, after, before} from 'node:test';
import {ComponentContext, MessageProcessor} from '@a2ui/web_core/v0_9';

describe('DateTimeInput Component', () => {
  let basicCatalog: any;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    // Ensure component is registered
    await import('../../catalogs/basic/components/DateTimeInput.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<any>;
  let surface: any;

  const renderComponentWithVal = async (val: any, enableDate = true, enableTime = false) => {
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
              id: 'dt1',
              component: 'DateTimeInput',
              label: 'When',
              value: val,
              enableDate,
              enableTime,
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;

    const el = document.createElement('a2ui-datetimeinput') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'dt1');
    await asyncUpdate(el, e => {
      e.context = context;
    });
    return el;
  };

  it('parses date-only formats correctly', async () => {
    const testCases = [
      {input: '2026-03-20', expected: '2026-03-20'},
      {input: '2026-03-20T12:00:00Z', expected: '2026-03-20'},
      {input: '2026-03-20T12:00:00+05:30', expected: '2026-03-20'},
      {input: '2026/03/20 12:00:00', expected: '2026-03-20'},
    ];

    for (const {input, expected} of testCases) {
      const el = await renderComponentWithVal(input, true, false);
      const inputEl = el.shadowRoot.querySelector('input') as HTMLInputElement;
      assert.strictEqual(inputEl.type, 'date');
      assert.strictEqual(inputEl.value, expected);
      document.body.removeChild(el);
    }
  });

  it('parses time-only formats correctly', async () => {
    const testCases = [
      {input: '12:00', expected: '12:00'},
      {input: '12:00:00', expected: '12:00'},
      {input: '2026-03-20T12:00:00Z', expected: '12:00'},
      {input: '2026-03-20T12:00:00+05:30', expected: '12:00'},
      {input: '2026/03/20 12:34:56', expected: '12:34'},
    ];

    for (const {input, expected} of testCases) {
      const el = await renderComponentWithVal(input, false, true);
      const inputEl = el.shadowRoot.querySelector('input') as HTMLInputElement;
      assert.strictEqual(inputEl.type, 'time');
      assert.strictEqual(inputEl.value, expected);
      document.body.removeChild(el);
    }
  });

  it('parses datetime-local formats correctly', async () => {
    const testCases = [
      {input: '2026-03-20T12:00', expected: '2026-03-20T12:00'},
      {input: '2026-03-20T12:00:00Z', expected: '2026-03-20T12:00'},
      {input: '2026-03-20T12:00:00+05:30', expected: '2026-03-20T12:00'},
      {input: '2026/03/20 12:34:56', expected: '2026-03-20T12:34'},
    ];

    for (const {input, expected} of testCases) {
      const el = await renderComponentWithVal(input, true, true);
      const inputEl = el.shadowRoot.querySelector('input') as HTMLInputElement;
      assert.strictEqual(inputEl.type, 'datetime-local');
      assert.strictEqual(inputEl.value, expected);
      document.body.removeChild(el);
    }
  });
});
