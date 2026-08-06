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
            {
              id: 'choice_picker_radio',
              component: 'ChoicePicker',
              label: 'Pick one',
              options: [
                {label: 'Option 1', value: '1'},
                {label: 'Option 2', value: '2'},
              ],
              value: ['1'],
              variant: 'mutuallyExclusive',
            },
            {
              id: 'choice_picker_a11y',
              component: 'ChoicePicker',
              label: 'Pick items',
              variant: 'multipleSelection',
              options: [
                {label: 'Item 1', value: '1'},
                {label: 'Item 2', value: '2'},
              ],
              value: [],
              isValid: false,
              validationErrors: ['Selection is required'],
              accessibility: {
                label: 'A11y ChoicePicker',
                description: 'Pick at least one item',
              },
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
    const labels = el.shadowRoot.querySelectorAll('label');
    assert.strictEqual(labels.length, 3);
    assert.strictEqual(labels[1].getAttribute('for'), 'choice_picker_filterable-0');
    assert.strictEqual(labels[2].getAttribute('for'), 'choice_picker_filterable-1');

    const inputs = el.shadowRoot.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    assert.strictEqual(inputs.length, 2);
    assert.strictEqual(inputs[0].getAttribute('id'), 'choice_picker_filterable-0');
    assert.strictEqual(inputs[1].getAttribute('id'), 'choice_picker_filterable-1');

    // Simulate input by setting state directly
    await asyncUpdate(el, e => {
      e.filter = 'app';
    });

    // Now only Apple should be visible + main label = 2 labels
    const labelsAfterFilter = el.shadowRoot.querySelectorAll('label');
    assert.strictEqual(labelsAfterFilter.length, 2);
    assert.strictEqual(labelsAfterFilter[1].getAttribute('for'), 'choice_picker_filterable-0');

    document.body.removeChild(el);
  });

  it('should render radiogroup role for mutuallyExclusive variant', async () => {
    const el = document.createElement('a2ui-choicepicker') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'choice_picker_radio');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const container = el.shadowRoot.querySelector('.options');
    assert.ok(container);
    assert.strictEqual(container.getAttribute('role'), 'radiogroup');

    const radios = el.shadowRoot.querySelectorAll('input[type="radio"]');
    assert.strictEqual(radios.length, 2);

    document.body.removeChild(el);
  });

  it('should bind accessibility label, aria-labelledby, description, and validation errors', async () => {
    const el = document.createElement('a2ui-choicepicker') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'choice_picker_a11y');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const container = el.shadowRoot.querySelector('.options');
    assert.ok(container);
    assert.strictEqual(container.getAttribute('role'), 'group');
    assert.strictEqual(container.getAttribute('aria-labelledby'), 'choice_picker_a11y-label');
    assert.strictEqual(container.getAttribute('aria-label'), 'A11y ChoicePicker');
    assert.strictEqual(container.getAttribute('aria-invalid'), 'true');
    assert.strictEqual(
      container.getAttribute('aria-describedby'),
      'choice_picker_a11y-description choice_picker_a11y-error',
    );

    const desc = el.shadowRoot.querySelector('#choice_picker_a11y-description');
    assert.ok(desc);
    assert.strictEqual(desc.textContent.trim(), 'Pick at least one item');

    const error = el.shadowRoot.querySelector('#choice_picker_a11y-error');
    assert.ok(error);
    assert.strictEqual(error.textContent.trim(), 'Selection is required');

    document.body.removeChild(el);
  });
});
