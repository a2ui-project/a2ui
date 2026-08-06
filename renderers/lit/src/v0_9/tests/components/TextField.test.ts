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
import type {A2uiBasicTextFieldElement} from '../../catalogs/basic/components/TextField.js';

describe('TextField Component', () => {
  // Note: basicCatalog and the component files must be imported dynamically inside before()
  // because setupTestDom() initializes global browser variables (window, document, customElements)
  // that need to exist when the modules are evaluated and components register themselves.
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/TextField.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiBasicTextFieldElement | null = null;

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
              id: 'field_name',
              component: 'TextField',
              label: 'Username',
              value: {path: '/user/name'},
            },
            {
              id: 'field_long',
              component: 'TextField',
              label: 'Bio',
              value: 'Initial Bio',
              variant: 'longText',
            },
            {
              id: 'field_invalid',
              component: 'TextField',
              label: 'Email',
              value: '',
              isValid: false,
              validationErrors: ['Email is invalid'],
            },
            {
              id: 'field_a11y',
              component: 'TextField',
              label: 'Password',
              value: '',
              variant: 'obscured',
              isValid: false,
              validationErrors: ['Password is required'],
              accessibility: {
                label: 'A11y Password',
                description: 'Enter your account password',
              },
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
    surface.dataModel.set('/user/name', 'Bob');
  });

  afterEach(() => {
    if (element) {
      element.remove();
      element = null;
    }
  });

  it('should render input field with label and initial value', async () => {
    const el = document.createElement('a2ui-basic-textfield') as A2uiBasicTextFieldElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'field_name');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const label = el.shadowRoot?.querySelector('label');
    assert.ok(label);
    assert.strictEqual(label.textContent?.trim(), 'Username');
    assert.strictEqual(label.getAttribute('for'), 'field_name');

    const input = el.shadowRoot?.querySelector('input');
    assert.ok(input);
    assert.strictEqual(input.value, 'Bob');
    assert.strictEqual(input.getAttribute('id'), 'field_name');
  });

  it('should update the data model value on input event', async () => {
    const el = document.createElement('a2ui-basic-textfield') as A2uiBasicTextFieldElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'field_name');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const input = el.shadowRoot?.querySelector('input');
    assert.ok(input);

    input.value = 'Alice';
    input.dispatchEvent(new Event('input'));
    await asyncUpdate(el, () => {});

    // Check that the value is updated in the data model
    assert.strictEqual(surface.dataModel.get('/user/name'), 'Alice');
  });

  it('should render textarea for longText variant', async () => {
    const el = document.createElement('a2ui-basic-textfield') as A2uiBasicTextFieldElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'field_long');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const label = el.shadowRoot?.querySelector('label');
    assert.ok(label);
    assert.strictEqual(label.getAttribute('for'), 'field_long');

    const textarea = el.shadowRoot?.querySelector('textarea');
    assert.ok(textarea);
    assert.strictEqual(textarea.value, 'Initial Bio');
    assert.strictEqual(textarea.getAttribute('id'), 'field_long');

    const input = el.shadowRoot?.querySelector('input');
    assert.strictEqual(input, null);
  });

  it('should render validation error message when invalid', async () => {
    const el = document.createElement('a2ui-basic-textfield') as A2uiBasicTextFieldElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'field_invalid');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const error = el.shadowRoot?.querySelector('.error');
    assert.ok(error);
    assert.strictEqual(error.textContent?.trim(), 'Email is invalid');

    const input = el.shadowRoot?.querySelector('input');
    assert.ok(input);
    assert.ok(input.classList.contains('invalid'));
  });

  it('should bind accessibility label, invalid state, description, and error to aria attributes', async () => {
    const el = document.createElement('a2ui-basic-textfield') as A2uiBasicTextFieldElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'field_a11y');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const input = el.shadowRoot?.querySelector('input');
    assert.ok(input);
    assert.strictEqual(input.getAttribute('type'), 'password');
    assert.strictEqual(input.getAttribute('aria-label'), 'A11y Password');
    assert.strictEqual(input.getAttribute('aria-invalid'), 'true');

    const describedBy = input.getAttribute('aria-describedby');
    assert.ok(describedBy);
    assert.strictEqual(describedBy, 'field_a11y-description field_a11y-error');

    const desc = el.shadowRoot?.querySelector('#field_a11y-description');
    assert.ok(desc);
    assert.strictEqual(desc.textContent?.trim(), 'Enter your account password');

    const error = el.shadowRoot?.querySelector('#field_a11y-error');
    assert.ok(error);
    assert.strictEqual(error.textContent?.trim(), 'Password is required');
  });
});
