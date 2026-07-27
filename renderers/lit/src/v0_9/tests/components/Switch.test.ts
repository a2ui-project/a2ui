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
import type {A2uiSwitchElement} from '../../catalogs/basic/components/Switch.js';

describe('Switch Component', () => {
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/Switch.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiSwitchElement | null = null;

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
              id: 'switch_simple',
              component: 'Switch',
              label: 'Enable Mode',
              value: {path: '/switch/value'},
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
    surface.dataModel.set('/switch/value', false);
  });

  afterEach(() => {
    if (element) {
      element.remove();
      element = null;
    }
  });

  it('should render label and checkbox state correctly', async () => {
    const el = document.createElement('a2ui-switch') as A2uiSwitchElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'switch_simple');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const labelText = el.shadowRoot?.querySelector('.label-text');
    assert.ok(labelText);
    assert.strictEqual(labelText.textContent?.trim(), 'Enable Mode');

    const input = el.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    assert.ok(input);
    assert.strictEqual(input.checked, false);

    // Update value in dataModel and check if it reflects
    surface.dataModel.set('/switch/value', true);
    await asyncUpdate(el, () => {});
    assert.strictEqual(input.checked, true);
  });

  it('should update the data model value on toggle', async () => {
    const el = document.createElement('a2ui-switch') as A2uiSwitchElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'switch_simple');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const input = el.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    assert.ok(input);

    input.checked = true;
    input.dispatchEvent(new Event('change'));
    await asyncUpdate(el, () => {});

    assert.strictEqual(surface.dataModel.get('/switch/value'), true);

    input.checked = false;
    input.dispatchEvent(new Event('change'));
    await asyncUpdate(el, () => {});

    assert.strictEqual(surface.dataModel.get('/switch/value'), false);
  });
});
