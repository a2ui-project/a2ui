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
import type {A2uiCardElement} from '../../catalogs/basic/components/Card.js';

describe('Card Component', () => {
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/Card.js');
    await import('../../catalogs/basic/components/Text.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiCardElement | null = null;

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
              id: 'card1',
              component: 'Card',
              child: 'txt1',
            },
            {
              id: 'card_a11y',
              component: 'Card',
              child: 'txt1',
              accessibility: {
                label: 'Card Region Label',
                description: 'Card Region Description',
              },
            },
            {
              id: 'txt1',
              component: 'Text',
              text: 'Card Content',
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  afterEach(() => {
    if (element) {
      element.remove();
      element = null;
    }
  });

  it('should render child node without wrapper when accessibility is omitted', async () => {
    const el = document.createElement('a2ui-card') as unknown as A2uiCardElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'card1');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const regionDiv = el.shadowRoot?.querySelector('div[role="region"]');
    assert.strictEqual(regionDiv, null);
    const childText = el.shadowRoot?.querySelector('a2ui-basic-text');
    assert.ok(childText);
  });

  it('should render wrapper with role="region", aria-label, and aria-description when accessibility attributes are set', async () => {
    const el = document.createElement('a2ui-card') as unknown as A2uiCardElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'card_a11y');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const regionDiv = el.shadowRoot?.querySelector('div[role="region"]');
    assert.ok(regionDiv);
    assert.strictEqual(regionDiv.getAttribute('role'), 'region');
    assert.strictEqual(regionDiv.getAttribute('aria-label'), 'Card Region Label');
    assert.strictEqual(regionDiv.getAttribute('aria-description'), 'Card Region Description');
  });
});
