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

describe('ChoicePicker Component', () => {
  let basicCatalog: any;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    // Ensure component is registered
    await import('../../catalogs/basic/components/ChoicePicker.js');
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
              id: 'choice_picker_chips',
              component: 'ChoicePicker',
              label: 'Pick chips',
              options: [
                {label: 'Apple', value: 'apple'},
                {label: 'Banana', value: 'banana'},
              ],
              value: [],
              displayStyle: 'chips',
            },
            {
              id: 'choice_picker_filterable',
              component: 'ChoicePicker',
              label: 'Filter me',
              options: [
                {label: 'Apple', value: 'apple'},
                {label: 'Banana', value: 'banana'},
              ],
              value: [],
              filterable: true,
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  it('should render chips when displayStyle is chips', async () => {
    const el = document.createElement('a2ui-choicepicker') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'choice_picker_chips');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const buttons = el.shadowRoot.querySelectorAll('button.chip');
    assert.strictEqual(buttons.length, 2);
    assert.strictEqual(buttons[0].textContent.trim(), 'Apple');

    document.body.removeChild(el);
  });

  it('should filter options when filterable is true', async () => {
    const el = document.createElement('a2ui-choicepicker') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'choice_picker_filterable');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    // Initially 2 options + 1 main label = 3 labels
    assert.strictEqual(el.shadowRoot.querySelectorAll('label').length, 3);

    // Simulate input by setting state directly
    await asyncUpdate(el, e => {
      e.filter = 'app';
    });

    // Now only Apple should be visible + main label = 2 labels
    assert.strictEqual(el.shadowRoot.querySelectorAll('label').length, 2);

    document.body.removeChild(el);
  });
});
