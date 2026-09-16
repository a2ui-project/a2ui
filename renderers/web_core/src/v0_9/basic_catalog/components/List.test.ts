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
import type {A2uiListElement} from './List.js';

describe('List Component', () => {
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../index.js')).basicCatalog;
    await import('./List.js');
    await import('./Text.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiListElement | null = null;
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
              component: 'List',
              children: ['txt1', 'txt2'],
              listStyle: 'unordered',
            },
            {
              id: 'txt1',
              component: 'Text',
              text: 'List Item 1',
            },
            {
              id: 'txt2',
              component: 'Text',
              text: 'List Item 2',
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

  it('should render children in list container', async () => {
    const el = document.createElement('a2ui-list') as A2uiListElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'comp1');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    assert.notStrictEqual(el, null);
    const ul = el.querySelector('ul.a2ui-list');
    assert.notStrictEqual(ul, null);

    const textElements = el.querySelectorAll('a2ui-basic-text');
    assert.strictEqual(textElements.length, 2);
    assert.strictEqual(el.textContent?.includes('List Item 1'), true);
    assert.strictEqual(el.textContent?.includes('List Item 2'), true);
  });

  it('should track and reuse child elements during a reordering operation', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'list-reorder',
              component: 'List',
              children: ['item1', 'item2', 'item3'],
              listStyle: 'ordered',
            },
            {id: 'item1', component: 'Text', text: 'First Item'},
            {id: 'item2', component: 'Text', text: 'Second Item'},
            {id: 'item3', component: 'Text', text: 'Third Item'},
          ],
        },
      },
    ]);

    const el = document.createElement('a2ui-list') as A2uiListElement;
    element = el;
    document.body.appendChild(el);

    const context1 = new ComponentContext(surface, 'list-reorder');
    await asyncUpdate(el, e => {
      e.context = context1;
    });

    const initialNodes = Array.from(el.querySelectorAll('a2ui-basic-text')) as (HTMLElement & {
      __marker?: string;
    })[];
    assert.strictEqual(initialNodes.length, 3);
    const node1 = initialNodes[0];
    const node2 = initialNodes[1];
    const node3 = initialNodes[2];

    node1.__marker = 'marker-1';
    node2.__marker = 'marker-2';
    node3.__marker = 'marker-3';

    // Reorder children to ['item3', 'item1', 'item2']
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'list-reorder',
              component: 'List',
              children: ['item3', 'item1', 'item2'],
              listStyle: 'ordered',
            },
          ],
        },
      },
    ]);

    const context2 = new ComponentContext(surface, 'list-reorder');
    await asyncUpdate(el, e => {
      e.context = context2;
    });

    const reorderedNodes = Array.from(el.querySelectorAll('a2ui-basic-text')) as (HTMLElement & {
      __marker?: string;
    })[];
    assert.strictEqual(reorderedNodes.length, 3);

    // Assert that the exact DOM element instances were moved/reused based on tracking
    assert.strictEqual(reorderedNodes[0], node3);
    assert.strictEqual(reorderedNodes[1], node1);
    assert.strictEqual(reorderedNodes[2], node2);
    assert.strictEqual(reorderedNodes[0].__marker, 'marker-3');
    assert.strictEqual(reorderedNodes[1].__marker, 'marker-1');
    assert.strictEqual(reorderedNodes[2].__marker, 'marker-2');
  });
});
