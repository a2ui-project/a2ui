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
import type {A2uiBasicRowElement} from './Row.js';

describe('Row Component', () => {
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../index.js')).basicCatalog;
    await import('./Row.js');
    await import('./Text.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiBasicRowElement | null = null;

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
              id: 'row1',
              component: 'Row',
              children: ['txt1', 'txt2'],
              justify: 'center',
              align: 'end',
            },
            {
              id: 'txt1',
              component: 'Text',
              text: 'Left',
            },
            {
              id: 'txt2',
              component: 'Text',
              text: 'Right',
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

  it('should render children and apply flex alignment styles', async () => {
    const el = document.createElement('a2ui-basic-row') as A2uiBasicRowElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'row1');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    // Check flex styles on the host element style attribute
    assert.strictEqual(el.style.justifyContent, 'center');
    assert.strictEqual(el.style.alignItems, 'flex-end');

    const textElements = el.querySelectorAll('a2ui-basic-text') as
      | NodeListOf<HTMLElement & {context?: ComponentContext}>
      | undefined;
    assert.notStrictEqual(textElements, null);
    assert.strictEqual(textElements?.length, 2);
    assert.strictEqual(textElements?.[0].context?.componentModel.id, 'txt1');
    assert.strictEqual(textElements?.[1].context?.componentModel.id, 'txt2');
  });

  it('should track and reuse child elements during a reordering operation', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'row-reorder',
              component: 'Row',
              children: ['t1', 't2', 't3'],
            },
            {id: 't1', component: 'Text', text: 'First'},
            {id: 't2', component: 'Text', text: 'Second'},
            {id: 't3', component: 'Text', text: 'Third'},
          ],
        },
      },
    ]);

    const el = document.createElement('a2ui-basic-row') as A2uiBasicRowElement;
    element = el;
    document.body.appendChild(el);

    const context1 = new ComponentContext(surface, 'row-reorder');
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

    node1.__marker = 'first-marker';
    node2.__marker = 'second-marker';
    node3.__marker = 'third-marker';

    // Reorder children to ['t3', 't1', 't2']
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'row-reorder',
              component: 'Row',
              children: ['t3', 't1', 't2'],
            },
          ],
        },
      },
    ]);

    const context2 = new ComponentContext(surface, 'row-reorder');
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
    assert.strictEqual(reorderedNodes[0].__marker, 'third-marker');
    assert.strictEqual(reorderedNodes[1].__marker, 'first-marker');
    assert.strictEqual(reorderedNodes[2].__marker, 'second-marker');
  });
});
