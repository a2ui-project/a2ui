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
import type {A2uiCheckBoxElement} from './CheckBox.js';

describe('CheckBox Component', () => {
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../index.js')).basicCatalog;
    // Ensure component is registered
    await import('./CheckBox.js');
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
              id: 'checkbox_invalid',
              component: 'CheckBox',
              label: 'Check me',
              value: false,
              isValid: false,
              validationErrors: ['This is required'],
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

  it('should render label and reflect true and false checked state', async () => {
    const el = document.createElement('a2ui-checkbox') as A2uiCheckBoxElement;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'checkbox_invalid');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const labelSpan = el.querySelector('.a2ui-check-box-text');
    assert.notStrictEqual(labelSpan, null);
    assert.strictEqual(labelSpan?.textContent?.trim(), 'Check me');

    const input = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
    assert.notStrictEqual(input, null);
    assert.strictEqual(input?.checked, false);

    // Update component to value: true
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'checkbox_invalid',
              component: 'CheckBox',
              label: 'Check me',
              value: true,
            },
          ],
        },
      },
    ]);

    const contextTrue = new ComponentContext(surface, 'checkbox_invalid');
    await asyncUpdate(el, e => {
      e.context = contextTrue;
    });

    assert.strictEqual(input?.checked, true);
    document.body.removeChild(el);
  });

  it('should update bound data model when changed', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'test-surface',
          path: '/agree',
          value: false,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'cb_bound',
              component: 'CheckBox',
              label: 'Agree to terms',
              value: {path: '/agree'},
            },
          ],
        },
      },
    ]);

    const el = document.createElement('a2ui-checkbox') as A2uiCheckBoxElement;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'cb_bound');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const input = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
    assert.notStrictEqual(input, null);
    assert.strictEqual(input?.checked, false);

    // Simulate user toggling checkbox
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.strictEqual(surface.dataModel.get('/agree'), true);
    document.body.removeChild(el);
  });

  it('should render validation error in CheckBox', async () => {
    const el = document.createElement('a2ui-checkbox') as A2uiCheckBoxElement;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'checkbox_invalid');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const errorDiv = el.querySelector('.a2ui-error-message');
    assert.notStrictEqual(errorDiv, null);
    assert.strictEqual(errorDiv?.textContent?.trim(), 'This is required');

    document.body.removeChild(el);
  });
});
