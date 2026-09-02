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
import {describe, it, before, beforeEach, after, afterEach} from 'node:test';
import {setupTestDom, teardownTestDom, asyncUpdate} from '../test/dom-setup.js';
import {z} from 'zod';
import {
  ComponentContext,
  MessageProcessor,
  Catalog,
  ComponentApi,
  SurfaceModel,
  Subscription,
} from '../index.js';

describe('BasicCatalogA2uiLitElement', () => {
  let customCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();

    const {BasicCatalogA2uiLitElement} = await import('./basic-catalog-a2ui-lit-element.js');
    const {A2uiController} = await import('../catalog/a2ui-controller.js');
    const {css, html} = await import('lit');

    const TestComponentSchema = z.object({
      text: z.string().optional(),
      weight: z.number().optional(),
    });

    const TestComponentApi: ComponentApi<typeof TestComponentSchema> = {
      name: 'TestComponent',
      schema: TestComponentSchema,
    };

    class TestBasicElement extends BasicCatalogA2uiLitElement<typeof TestComponentApi> {
      static override styles = css`
        :host {
          display: block;
          color: red;
        }
        .inner {
          font-size: 14px;
        }
      `;

      protected createController() {
        return new A2uiController(this, TestComponentApi);
      }

      override render() {
        return html`<div class="inner">${this.controller?.props?.text ?? ''}</div>`;
      }
    }

    if (!customElements.get('a2ui-test-basic-element')) {
      customElements.define('a2ui-test-basic-element', TestBasicElement);
    }

    customCatalog = new Catalog('https://test.catalog', [TestComponentApi]);
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel<ComponentApi>;
  let element: any = null;
  let subscription: Subscription | null = null;

  beforeEach(() => {
    processor = new MessageProcessor([customCatalog]);
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: customCatalog.id,
          theme: {
            primaryColor: '#ff0055',
          },
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'comp1',
              component: 'TestComponent',
              text: 'Hello',
              weight: 2,
            },
            {
              id: 'comp2',
              component: 'TestComponent',
              text: 'Themed',
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

  it('renders into light DOM (createRenderRoot returns this)', () => {
    element = document.createElement('a2ui-test-basic-element');
    assert.strictEqual(element.createRenderRoot(), element);
    assert.strictEqual(element.shadowRoot, null);
  });

  it('adopts and scopes component styles into document on connection', () => {
    element = document.createElement('a2ui-test-basic-element');
    document.body.appendChild(element);

    const styleEl = document.head.querySelector('style');
    if (document.adoptedStyleSheets && document.adoptedStyleSheets.length > 0) {
      assert.ok(document.adoptedStyleSheets.length > 0);
    } else {
      assert.notStrictEqual(styleEl, null);
      assert.ok(styleEl?.textContent?.includes('a2ui-test-basic-element'));
    }
  });

  it('applies flex weight when props.weight is provided and removes when undefined', async () => {
    element = document.createElement('a2ui-test-basic-element');
    document.body.appendChild(element);

    const context = new ComponentContext(surface, 'comp1');
    await asyncUpdate(element, (e: any) => {
      e.context = context;
    });

    assert.ok(element.style.flex.startsWith('2'));

    // Update weight to undefined
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'comp1',
              component: 'TestComponent',
              text: 'Hello',
              weight: undefined,
            },
          ],
        },
      },
    ]);

    await asyncUpdate(element, () => {});
    assert.strictEqual(element.style.flex, '');
  });

  it('sets theme primaryColor CSS variables and computes variants', async () => {
    element = document.createElement('a2ui-test-basic-element');
    document.body.appendChild(element);

    const context = new ComponentContext(surface, 'comp2');
    await asyncUpdate(element, (e: any) => {
      e.context = context;
    });

    assert.strictEqual(element.style.getPropertyValue('--a2ui-color-primary'), '#ff0055');
    assert.ok(element.style.getPropertyValue('--a2ui-color-primary-light').length > 0);
    assert.ok(element.style.getPropertyValue('--a2ui-color-primary-dark').length > 0);
    assert.ok(element.style.getPropertyValue('--a2ui-color-primary-hover').length > 0);
  });

  it('clears theme primaryColor CSS variables when primaryColor is absent', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'no-theme-surface',
          catalogId: customCatalog.id,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'no-theme-surface',
          components: [
            {
              id: 'comp3',
              component: 'TestComponent',
              text: 'Un-themed',
            },
          ],
        },
      },
    ]);

    const noThemeSurface = processor.model.getSurface('no-theme-surface')!;
    const context = new ComponentContext(noThemeSurface, 'comp3');

    element = document.createElement('a2ui-test-basic-element');
    document.body.appendChild(element);

    await asyncUpdate(element, (e: any) => {
      e.context = context;
    });

    assert.strictEqual(element.style.getPropertyValue('--a2ui-color-primary'), '');
    assert.strictEqual(element.style.getPropertyValue('--a2ui-color-primary-light'), '');
    assert.strictEqual(element.style.getPropertyValue('--a2ui-color-primary-dark'), '');
    assert.strictEqual(element.style.getPropertyValue('--a2ui-color-primary-hover'), '');
  });
});
