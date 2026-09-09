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
import type {A2uiBasicTextElement} from './Text.js';

describe('Text Component', () => {
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../index.js')).basicCatalog;
    await import('./Text.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiBasicTextElement | null = null;

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
              id: 't_static',
              component: 'Text',
              text: 'Hello static text',
            },
            {
              id: 't_dynamic',
              component: 'Text',
              text: {path: '/dynamic_msg'},
            },
            {
              id: 't_caption',
              component: 'Text',
              text: 'Caption text',
              variant: 'caption',
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
    surface.dataModel.set('/dynamic_msg', 'Hello dynamic text');
  });

  afterEach(() => {
    if (element) {
      element.remove();
      element = null;
    }
  });

  it('should render static text content', async () => {
    const el = document.createElement('a2ui-basic-text') as A2uiBasicTextElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 't_static');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const span = el.querySelector('.no-markdown-renderer');
    assert.notStrictEqual(span, null);
    assert.strictEqual(span?.textContent?.trim(), 'Hello static text');
  });

  it('should render reactive dynamic text content', async () => {
    const el = document.createElement('a2ui-basic-text') as A2uiBasicTextElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 't_dynamic');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const span = el.querySelector('.no-markdown-renderer');
    assert.notStrictEqual(span, null);
    assert.strictEqual(span?.textContent?.trim(), 'Hello dynamic text');

    // Update the data model value
    surface.dataModel.set('/dynamic_msg', 'Updated dynamic text');
    await asyncUpdate(el, () => {});

    assert.strictEqual(span?.textContent?.trim(), 'Updated dynamic text');
  });

  it('should apply caption variant styling structure', async () => {
    const el = document.createElement('a2ui-basic-text') as A2uiBasicTextElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 't_caption');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const captionSpan = el.querySelector('span.a2ui-text.caption');
    assert.notStrictEqual(captionSpan, null);
    const em = captionSpan?.querySelector('em');
    assert.notStrictEqual(em, null);

    assert.strictEqual(em?.textContent?.trim(), 'Caption text');
  });
});
