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
import type {A2uiIconElement} from '../../catalogs/basic/components/Icon.js';

describe('Icon Component', () => {
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/Icon.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiIconElement | null = null;

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
              id: 'icon_symbol',
              component: 'Icon',
              name: 'play',
              accessibility: {
                label: 'Play Video',
                description: 'Start playback of the selected video',
              },
            },
            {
              id: 'icon_svg',
              component: 'Icon',
              name: {svgPath: 'M0 0h24v24H0z'},
              accessibility: {
                label: 'Custom SVG Icon',
                description: 'Custom path description',
              },
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

  it('should render span with role="img", aria-label, and aria-description for material symbol icon', async () => {
    const el = document.createElement('a2ui-icon') as unknown as A2uiIconElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'icon_symbol');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const span = el.shadowRoot?.querySelector('span.material-symbol');
    assert.ok(span);
    assert.strictEqual(span.getAttribute('role'), 'img');
    assert.strictEqual(span.getAttribute('aria-label'), 'Play Video');
    assert.strictEqual(
      span.getAttribute('aria-description'),
      'Start playback of the selected video',
    );
  });

  it('should render svg with aria-label and aria-description for path icon', async () => {
    const el = document.createElement('a2ui-icon') as unknown as A2uiIconElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'icon_svg');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const svg = el.shadowRoot?.querySelector('svg.svg');
    assert.ok(svg);
    assert.strictEqual(svg.getAttribute('aria-label'), 'Custom SVG Icon');
    assert.strictEqual(svg.getAttribute('aria-description'), 'Custom path description');
  });
});
