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
} from '../../index.js';
import type {A2uiChoicePickerElement} from './ChoicePicker.js';

describe('ChoicePicker Component', () => {
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../index.js')).basicCatalog;
    // Ensure component is registered
    await import('./ChoicePicker.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;

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

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should render chips when displayStyle is chips', async () => {
    const el = document.createElement('a2ui-choicepicker') as A2uiChoicePickerElement;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'choice_picker_chips');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const buttons = el.querySelectorAll('button.a2ui-chip');
    assert.strictEqual(buttons.length, 2);
    assert.strictEqual(buttons[0].textContent?.trim(), 'Apple');

    document.body.removeChild(el);
  });

  it('should update bound data model when clicking a chip', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'test-surface',
          path: '/chosen',
          value: [],
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'choice_picker_chips_bound',
              component: 'ChoicePicker',
              options: [
                {label: 'Apple', value: 'apple'},
                {label: 'Banana', value: 'banana'},
              ],
              value: {path: '/chosen'},
              displayStyle: 'chips',
            },
          ],
        },
      },
    ]);

    const el = document.createElement('a2ui-choicepicker') as A2uiChoicePickerElement;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'choice_picker_chips_bound');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const buttons = el.querySelectorAll('button.a2ui-chip') as NodeListOf<HTMLButtonElement>;
    assert.strictEqual(buttons.length, 2);

    // Click Apple chip
    buttons[0].click();
    await new Promise(resolve => setTimeout(resolve, 0));

    const selected = surface.dataModel.get('/chosen');
    assert.deepStrictEqual(selected, ['apple']);

    document.body.removeChild(el);
  });

  it('ChoicePicker radio groups do not collide across surfaces', async () => {
    // Component ids are only surface-scoped, so two surfaces may each
    // contain a ChoicePicker with the same id. Radio names are
    // document-scoped: if the group name is derived from the component id,
    // both pickers merge into one radio group and fight over one selection.
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'second-surface',
          catalogId: basicCatalog.id,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'second-surface',
          components: [
            {
              id: 'choice_picker_filterable',
              component: 'ChoicePicker',
              label: 'Filter me',
              options: [
                {label: 'Apple', value: 'apple'},
                {label: 'Banana', value: 'banana'},
              ],
              value: [],
            },
          ],
        },
      },
    ]);
    const secondSurface = processor.model.getSurface('second-surface')!;

    const firstContext = new ComponentContext(surface, 'choice_picker_filterable');
    const secondContext = new ComponentContext(secondSurface, 'choice_picker_filterable');

    const firstEl = document.createElement('a2ui-choicepicker') as A2uiChoicePickerElement;
    firstEl.context = firstContext;
    document.body.appendChild(firstEl);
    await firstEl.updateComplete;

    const secondEl = document.createElement('a2ui-choicepicker') as A2uiChoicePickerElement;
    secondEl.context = secondContext;
    document.body.appendChild(secondEl);
    await secondEl.updateComplete;

    const getGroupNames = (el: HTMLElement) =>
      new Set(
        Array.from(el.querySelectorAll<HTMLInputElement>('input[type="radio"]')).map(
          input => input.name,
        ),
      );

    const firstNames = getGroupNames(firstEl);
    const secondNames = getGroupNames(secondEl);

    assert.strictEqual(firstNames.size, 1);
    assert.strictEqual(secondNames.size, 1);
    assert.notStrictEqual([...firstNames][0], [...secondNames][0]);

    document.body.removeChild(firstEl);
    document.body.removeChild(secondEl);
  });

  it('should not set a name on checkbox inputs', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'choice_picker_multi',
              component: 'ChoicePicker',
              label: 'Multi pick',
              options: [{label: 'Option 1', value: 'opt1'}],
              value: [],
              variant: 'multipleSelection',
            },
          ],
        },
      },
    ]);

    const el = document.createElement('a2ui-choicepicker') as A2uiChoicePickerElement;
    el.context = new ComponentContext(surface, 'choice_picker_multi');
    document.body.appendChild(el);
    await el.updateComplete;

    const checkbox = el.querySelector('input[type="checkbox"]');
    assert.ok(checkbox);
    assert.strictEqual(checkbox.hasAttribute('name'), false);

    document.body.removeChild(el);
  });
});
