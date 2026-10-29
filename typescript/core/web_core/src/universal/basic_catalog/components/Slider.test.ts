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
import {setupTestDom, teardownTestDom, asyncUpdate} from '../../../test/dom-setup.js';
import {
  ComponentContext,
  MessageProcessor,
  Catalog,
  SurfaceModel,
  Subscription,
} from '../../../v0_9/index.js';
import {
  type A2uiWebComponentElement,
  registerUniversalElement,
  type WebComponentImplementation,
} from '../../index.js';
import {SliderApi} from '../../../v0_9/basic_catalog/components/basic_components.js';

describe('Slider Component', () => {
  let basicCatalog: Catalog<WebComponentImplementation>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../../v0_9/basic_catalog/index.js')).basicCatalog;
    basicCatalog.components.forEach(c => registerUniversalElement(c));
  });

  after(teardownTestDom);

  let processor: MessageProcessor<WebComponentImplementation>;
  let surface: SurfaceModel;
  let element: A2uiWebComponentElement | null = null;
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
              component: 'Slider',
              label: 'Volume',
              min: 10,
              max: 100,
              value: 50,
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

  it('should render slider input and header with correct attributes and values', async () => {
    const el = document.createElement('a2ui-slider') as A2uiWebComponentElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'comp1');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    assert.notStrictEqual(el, null);
    const label = el.querySelector('.a2ui-slider-label');
    assert.notStrictEqual(label, null);
    assert.strictEqual(label?.textContent?.trim(), 'Volume');

    const valueSpan = el.querySelector('.a2ui-slider-value');
    assert.notStrictEqual(valueSpan, null);
    assert.strictEqual(valueSpan?.textContent?.trim(), '50');

    const input = el.querySelector('input[type="range"]') as HTMLInputElement;
    assert.notStrictEqual(input, null);
    assert.strictEqual(input?.getAttribute('min'), '10');
    assert.strictEqual(input?.getAttribute('max'), '100');
    assert.strictEqual(input?.value, '50');
    assert.strictEqual(input?.classList.contains('a2ui-slider'), true);
  });

  it('should update bound data model when slider value changes', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'test-surface',
          path: '/volume',
          value: 50,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'slider_bound',
              component: 'Slider',
              label: 'Volume Control',
              min: 0,
              max: 100,
              value: {path: '/volume'},
            },
          ],
        },
      },
    ]);

    const el = document.createElement('a2ui-slider') as A2uiWebComponentElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'slider_bound');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const input = el.querySelector('input[type="range"]') as HTMLInputElement;
    assert.notStrictEqual(input, null);
    assert.strictEqual(input?.value, '50');

    input.value = '80';
    input.dispatchEvent(new Event('input'));
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.strictEqual(surface.dataModel.get('/volume'), 80);
  });

  describe('SliderApi schema validation', () => {
    it('should reject non-spec step property', () => {
      const validSlider = {
        max: 100,
        value: 50,
      };
      SliderApi.schema.parse(validSlider);

      const result = SliderApi.schema.safeParse({
        ...validSlider,
        step: 5,
      });

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(
          result.error.issues.some(
            issue => issue.code === 'unrecognized_keys' && issue.keys.includes('step'),
          ),
          true,
        );
      }
    });
  });

  it('links <label for> to range input and wires accessibility and validation attributes', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'slider_invalid',
              component: 'Slider',
              label: 'Party Size',
              min: 1,
              max: 12,
              value: 1,
              accessibility: {
                description: 'Use arrow keys to adjust guests',
              },
              checks: [
                {
                  condition: false,
                  message: 'Minimum 2 guests required',
                },
              ],
            },
            {
              id: 'slider_unlabeled',
              component: 'Slider',
              min: 0,
              max: 10,
              value: 5,
              accessibility: {
                label: 'Brightness',
              },
            },
          ],
        },
      },
    ]);

    const el = document.createElement('a2ui-slider') as A2uiWebComponentElement;
    element = el;
    document.body.appendChild(el);

    await asyncUpdate(el, e => {
      e.context = new ComponentContext(surface, 'slider_invalid');
    });

    assert.strictEqual(el.hasAttribute('aria-label'), false);
    const label = el.querySelector('label.a2ui-slider-label');
    const input = el.querySelector('input[type="range"]');
    const errorAlert = el.querySelector('.a2ui-validation-errors');
    assert.notStrictEqual(label, null);
    assert.ok(input?.id);
    assert.strictEqual(label?.getAttribute('for'), input?.id);
    assert.strictEqual(input?.getAttribute('aria-description'), 'Use arrow keys to adjust guests');
    assert.strictEqual(input?.getAttribute('aria-invalid'), 'true');
    assert.strictEqual(errorAlert?.getAttribute('role'), 'alert');
    assert.strictEqual(input?.getAttribute('aria-describedby'), errorAlert?.id);

    await asyncUpdate(el, e => {
      e.context = new ComponentContext(surface, 'slider_unlabeled');
    });

    assert.strictEqual(el.querySelector('label.a2ui-slider-label'), null);
    assert.notStrictEqual(el.querySelector('span.a2ui-slider-label'), null);
    const unlabeledInput = el.querySelector('input[type="range"]');
    assert.strictEqual(unlabeledInput?.getAttribute('aria-label'), 'Brightness');
    assert.strictEqual(unlabeledInput?.hasAttribute('aria-invalid'), false);
  });
});
