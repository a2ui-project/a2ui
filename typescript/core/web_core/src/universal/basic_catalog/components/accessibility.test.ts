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
import {after, afterEach, before, describe, it} from 'node:test';

import {setupTestDom, teardownTestDom} from '../../../test/dom-setup.js';

describe('Basic Catalog accessibility helpers', () => {
  let litModule: typeof import('lit');
  let a11yModule: typeof import('./accessibility.js');

  before(async () => {
    setupTestDom();
    litModule = await import('lit');
    a11yModule = await import('./accessibility.js');
  });

  afterEach(() => {
    document.body.textContent = '';
  });

  after(() => {
    teardownTestDom();
  });

  it('sets and clears aria-live and aria-hidden on host without forwarding label or description', () => {
    const {setHostAccessibilityAttributes} = a11yModule;
    const host = document.createElement('div');
    document.body.appendChild(host);

    setHostAccessibilityAttributes(host, {
      label: 'Inner control name',
      description: 'Inner control description',
      live: 'polite',
      hidden: true,
    });

    assert.strictEqual(host.hasAttribute('aria-label'), false);
    assert.strictEqual(host.hasAttribute('aria-description'), false);
    assert.strictEqual(host.getAttribute('aria-live'), 'polite');
    assert.strictEqual(host.getAttribute('aria-hidden'), 'true');

    setHostAccessibilityAttributes(host, {hidden: false});
    assert.strictEqual(host.hasAttribute('aria-live'), false);
    assert.strictEqual(host.getAttribute('aria-hidden'), 'false');

    setHostAccessibilityAttributes(host, undefined);
    assert.strictEqual(host.hasAttribute('aria-live'), false);
    assert.strictEqual(host.hasAttribute('aria-hidden'), false);
  });

  it('sets and clears container group role, aria-label, and aria-description', () => {
    const {setContainerAccessibilityAttributes} = a11yModule;
    const container = document.createElement('div');
    document.body.appendChild(container);

    setContainerAccessibilityAttributes(container, {
      label: 'Billing address',
      description: 'Street and postal code',
    });

    assert.strictEqual(container.getAttribute('role'), 'group');
    assert.strictEqual(container.getAttribute('aria-label'), 'Billing address');
    assert.strictEqual(container.getAttribute('aria-description'), 'Street and postal code');

    setContainerAccessibilityAttributes(container, {label: '', description: ''});
    assert.strictEqual(container.hasAttribute('role'), false);
    assert.strictEqual(container.hasAttribute('aria-label'), false);
    assert.strictEqual(container.hasAttribute('aria-description'), false);
  });

  it('normalizes non-empty accessibility labels and descriptions and returns nothing when empty', () => {
    const {nothing} = litModule;
    const {getAccessibilityDescription, getAccessibilityLabel, hasAttributeValue} = a11yModule;

    assert.strictEqual(hasAttributeValue('Save'), true);
    assert.strictEqual(hasAttributeValue(0), true);
    assert.strictEqual(hasAttributeValue(''), false);
    assert.strictEqual(hasAttributeValue(undefined), false);
    assert.strictEqual(hasAttributeValue(null), false);

    assert.strictEqual(getAccessibilityLabel({label: 'Save'}), 'Save');
    assert.strictEqual(getAccessibilityLabel({label: ''}), nothing);
    assert.strictEqual(getAccessibilityLabel(undefined), nothing);

    assert.strictEqual(
      getAccessibilityDescription({description: 'Saves current draft'}),
      'Saves current draft',
    );
    assert.strictEqual(getAccessibilityDescription({description: ''}), nothing);
    assert.strictEqual(getAccessibilityDescription(undefined), nothing);
  });

  it('computes validation error IDs and renders role="alert" error blocks only when invalid', () => {
    const {nothing, render} = litModule;
    const {getValidationErrorId, hasValidationErrors, renderValidationErrors} = a11yModule;

    const validProps = {isValid: true, validationErrors: ['Ignored when valid']};
    const emptyInvalidProps = {isValid: false, validationErrors: []};
    const invalidProps = {
      isValid: false,
      validationErrors: ['Email is required', 'Must contain @'],
    };

    assert.strictEqual(hasValidationErrors(validProps), false);
    assert.strictEqual(hasValidationErrors(emptyInvalidProps), false);
    assert.strictEqual(hasValidationErrors(invalidProps), true);

    assert.strictEqual(getValidationErrorId('a2ui-n1', validProps), nothing);
    assert.strictEqual(getValidationErrorId('a2ui-n1', emptyInvalidProps), nothing);
    assert.strictEqual(getValidationErrorId('a2ui-n1', invalidProps), 'a2ui-n1-error');
    assert.strictEqual(renderValidationErrors('a2ui-n1', validProps), nothing);

    const mount = document.createElement('div');
    document.body.appendChild(mount);
    render(renderValidationErrors('a2ui-n1', invalidProps), mount);

    const alertEl = mount.querySelector('.a2ui-validation-errors');
    assert.notStrictEqual(alertEl, null);
    assert.strictEqual(alertEl?.id, 'a2ui-n1-error');
    assert.strictEqual(alertEl?.getAttribute('role'), 'alert');

    const messages = Array.from(mount.querySelectorAll('.a2ui-error-message')).map(
      el => el.textContent,
    );
    assert.deepStrictEqual(messages, ['Email is required', 'Must contain @']);
  });
});
