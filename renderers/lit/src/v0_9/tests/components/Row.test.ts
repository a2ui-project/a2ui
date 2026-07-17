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
import type {A2uiBasicRowElement} from '../../catalogs/basic/components/Row.js';

describe('Row Component', () => {
  // Note: basicCatalog and the component files must be imported dynamically inside before()
  // because setupTestDom() initializes global browser variables (window, document, customElements)
  // that need to exist when the modules are evaluated and components register themselves.
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/Row.js');
    await import('../../catalogs/basic/components/Text.js');
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

    // Check children are rendered
    // Since our test runner runs custom elements, they will register and render shadow roots.
    // Let's check shadow root has slot or elements.
    // Wait, row does: return html` ${map(children, child => html`${this.renderNode(child)}`)} `
    // It renders nodes inside its own shadow DOM directly.
    const textElements = el.shadowRoot?.querySelectorAll('a2ui-basic-text') as
      | NodeListOf<HTMLElement & {context?: ComponentContext}>
      | undefined;
    assert.ok(textElements);
    assert.strictEqual(textElements.length, 2);
    assert.strictEqual(textElements[0].context?.componentModel.id, 'txt1');
    assert.strictEqual(textElements[1].context?.componentModel.id, 'txt2');
  });
});
