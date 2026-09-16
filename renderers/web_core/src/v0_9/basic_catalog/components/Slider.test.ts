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
  Subscription,
} from '../../index.js';
import {SliderApi} from './basic_components.js';
import type {A2uiSliderElement} from './Slider.js';

describe('Slider Component', () => {
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../index.js')).basicCatalog;
    await import('./Slider.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiSliderElement | null = null;
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
    const el = document.createElement('a2ui-slider') as A2uiSliderElement;
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

    const el = document.createElement('a2ui-slider') as A2uiSliderElement;
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
});
