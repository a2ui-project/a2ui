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
import {describe, it, beforeEach, afterEach, after, before} from 'node:test';
import {
  ComponentContext,
  MessageProcessor,
  Catalog,
  ComponentApi,
  SurfaceModel,
} from '@a2ui/web_core/v0_9';
import type {A2uiSelectElement} from '../../catalogs/basic/components/Select.js';

describe('Select Component', () => {
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/Select.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiSelectElement | null = null;

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
              id: 'select_simple',
              component: 'Select',
              label: 'Choose Option',
              options: [
                {label: 'One', value: '1'},
                {label: 'Two', value: '2'},
              ],
              value: {path: '/select/value'},
            },
            {
              id: 'select_empty',
              component: 'Select',
              label: 'Choose Initial Empty',
              options: [
                {label: 'One', value: '1'},
                {label: 'Two', value: '2'},
              ],
              value: {path: '/select/empty_value'},
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
    surface.dataModel.set('/select/value', '1');
    // /select/empty_value remains undefined
  });

  afterEach(() => {
    if (element) {
      element.remove();
      element = null;
    }
  });

  it('should render options and label correctly', async () => {
    const el = document.createElement('a2ui-select') as A2uiSelectElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'select_simple');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const label = el.shadowRoot?.querySelector('label');
    assert.ok(label);
    assert.strictEqual(label.textContent?.trim(), 'Choose Option');

    const select = el.shadowRoot?.querySelector('select');
    assert.ok(select);
    assert.strictEqual(select.value, '1');

    const options = el.shadowRoot?.querySelectorAll('option');
    assert.ok(options);
    assert.strictEqual(options.length, 2);
    assert.strictEqual(options[0].textContent?.trim(), 'One');
    assert.strictEqual(options[0].value, '1');
    assert.strictEqual(options[1].textContent?.trim(), 'Two');
    assert.strictEqual(options[1].value, '2');
  });

  it('should update the data model value on select change', async () => {
    const el = document.createElement('a2ui-select') as A2uiSelectElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'select_simple');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const select = el.shadowRoot?.querySelector('select');
    assert.ok(select);

    select.value = '2';
    select.dispatchEvent(new Event('change'));
    await asyncUpdate(el, () => {});

    assert.strictEqual(surface.dataModel.get('/select/value'), '2');
  });

  it('should update the data model value on select change even if initial value was empty', async () => {
    const el = document.createElement('a2ui-select') as A2uiSelectElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'select_empty');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const select = el.shadowRoot?.querySelector('select');
    assert.ok(select);
    assert.strictEqual(select.value, '1'); // JSDOM selects first option by default since no empty option exists

    select.value = '2';
    select.dispatchEvent(new Event('change'));
    await asyncUpdate(el, () => {});

    assert.strictEqual(surface.dataModel.get('/select/empty_value'), '2');
  });
});
